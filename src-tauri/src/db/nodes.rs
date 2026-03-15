//! 推理節點 CRUD 操作
//!
//! 提供 ReasoningNode 的資料庫操作函式

use super::models::{NodeStatus, ReasoningNode};
use super::{Database, DbError, Result};
use rusqlite::params;

/// 插入單一推理節點
pub fn insert(db: &Database, node: &ReasoningNode) -> Result<()> {
    let conn = db.lock()?;
    conn.execute(
        "INSERT INTO reasoning_nodes (id, agent_id, project_id, parent_id, node_type, content, status, git_snapshot_sha, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            node.id,
            node.agent_id,
            node.project_id,
            node.parent_id,
            node.node_type.as_str(),
            node.content,
            node.status.as_str(),
            node.git_snapshot_sha,
            node.created_at,
            node.updated_at,
        ],
    )?;
    Ok(())
}

/// 批量插入推理節點（高效能寫入）
///
/// 使用單一事務批量插入，達成 50K inserts/sec 的效能要求。
pub fn insert_batch(db: &Database, nodes: &[ReasoningNode]) -> Result<()> {
    let mut conn = db.lock()?;
    let tx = conn.transaction()?;

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO reasoning_nodes (id, agent_id, project_id, parent_id, node_type, content, status, git_snapshot_sha, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;

        for node in nodes {
            stmt.execute(params![
                node.id,
                node.agent_id,
                node.project_id,
                node.parent_id,
                node.node_type.as_str(),
                node.content,
                node.status.as_str(),
                node.git_snapshot_sha,
                node.created_at,
                node.updated_at,
            ])?;
        }
    }

    tx.commit()?;
    Ok(())
}

/// 取得單一推理節點
pub fn get(db: &Database, id: &str) -> Result<ReasoningNode> {
    let conn = db.lock()?;
    let node = conn.query_row(
        "SELECT id, agent_id, project_id, parent_id, node_type, content, status, git_snapshot_sha, created_at, updated_at
         FROM reasoning_nodes WHERE id = ?1",
        params![id],
        ReasoningNode::from_row,
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound(format!("Node not found: {}", id)),
        _ => DbError::from(e),
    })?;
    Ok(node)
}

/// 取得 Agent 的所有推理節點
pub fn get_by_agent(db: &Database, agent_id: &str) -> Result<Vec<ReasoningNode>> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, project_id, parent_id, node_type, content, status, git_snapshot_sha, created_at, updated_at
         FROM reasoning_nodes WHERE agent_id = ?1 ORDER BY created_at ASC",
    )?;

    let nodes = stmt
        .query_map(params![agent_id], ReasoningNode::from_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(nodes)
}

/// 取得專案的所有推理節點
pub fn get_by_project(db: &Database, project_id: &str) -> Result<Vec<ReasoningNode>> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, project_id, parent_id, node_type, content, status, git_snapshot_sha, created_at, updated_at
         FROM reasoning_nodes WHERE project_id = ?1 ORDER BY created_at ASC",
    )?;

    let nodes = stmt
        .query_map(params![project_id], ReasoningNode::from_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(nodes)
}

/// 更新節點狀態
pub fn update_status(db: &Database, id: &str, status: NodeStatus, updated_at: i64) -> Result<()> {
    let conn = db.lock()?;
    let rows = conn.execute(
        "UPDATE reasoning_nodes SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status.as_str(), updated_at, id],
    )?;

    if rows == 0 {
        return Err(DbError::NotFound(format!("Node not found: {}", id)));
    }
    Ok(())
}

/// 更新節點的 Git 快照 SHA
pub fn update_git_snapshot(db: &Database, id: &str, sha: &str, updated_at: i64) -> Result<()> {
    let conn = db.lock()?;
    let rows = conn.execute(
        "UPDATE reasoning_nodes SET git_snapshot_sha = ?1, updated_at = ?2 WHERE id = ?3",
        params![sha, updated_at, id],
    )?;

    if rows == 0 {
        return Err(DbError::NotFound(format!("Node not found: {}", id)));
    }
    Ok(())
}

/// 刪除 Agent 的所有節點
pub fn delete_by_agent(db: &Database, agent_id: &str) -> Result<usize> {
    let conn = db.lock()?;
    let rows = conn.execute(
        "DELETE FROM reasoning_nodes WHERE agent_id = ?1",
        params![agent_id],
    )?;
    Ok(rows)
}

/// 計算節點數量
pub fn count(db: &Database) -> Result<i64> {
    let conn = db.lock()?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM reasoning_nodes", [], |r| r.get(0))?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::super::init_db;
    use super::*;
    use crate::db::models::NodeType;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn make_node(i: usize) -> ReasoningNode {
        ReasoningNode {
            id: format!("node-{}", i),
            agent_id: "agent-1".to_string(),
            project_id: "project-1".to_string(),
            parent_id: None,
            node_type: NodeType::Thought,
            content: r#"{"text": "thinking..."}"#.to_string(),
            status: NodeStatus::Pending,
            git_snapshot_sha: None,
            created_at: 1700000000 + i as i64,
            updated_at: 1700000000 + i as i64,
        }
    }

    #[tokio::test]
    async fn insert_reasoning_node_and_query_back() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let node = make_node(1);
        insert(&db, &node).unwrap();

        let fetched = get(&db, "node-1").unwrap();
        assert_eq!(fetched.id, "node-1");
        assert_eq!(fetched.agent_id, "agent-1");
        assert_eq!(fetched.node_type, NodeType::Thought);
    }

    #[tokio::test]
    async fn get_nonexistent_returns_not_found() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let result = get(&db, "nonexistent");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[tokio::test]
    async fn get_by_agent_returns_all_nodes() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        for i in 0..5 {
            insert(&db, &make_node(i)).unwrap();
        }

        let nodes = get_by_agent(&db, "agent-1").unwrap();
        assert_eq!(nodes.len(), 5);
    }

    #[tokio::test]
    async fn update_status_works() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let node = make_node(1);
        insert(&db, &node).unwrap();

        update_status(&db, "node-1", NodeStatus::Completed, 1700001000).unwrap();

        let fetched = get(&db, "node-1").unwrap();
        assert_eq!(fetched.status, NodeStatus::Completed);
        assert_eq!(fetched.updated_at, 1700001000);
    }

    #[tokio::test]
    async fn delete_by_agent_removes_all() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        for i in 0..5 {
            insert(&db, &make_node(i)).unwrap();
        }

        let deleted = delete_by_agent(&db, "agent-1").unwrap();
        assert_eq!(deleted, 5);

        let nodes = get_by_agent(&db, "agent-1").unwrap();
        assert!(nodes.is_empty());
    }

    #[tokio::test]
    async fn concurrent_writes_no_lock_conflict() {
        let dir = tempdir().unwrap();
        let db = Arc::new(init_db(&dir.path().join("test.db")).await.unwrap());

        let handles: Vec<_> = (0..5)
            .map(|i| {
                let db = db.clone();
                tokio::spawn(async move {
                    let node = make_node(i);
                    insert(&db, &node).unwrap();
                })
            })
            .collect();

        for h in handles {
            h.await.unwrap();
        }

        let total = count(&db).unwrap();
        assert_eq!(total, 5);
    }

    #[tokio::test]
    async fn batch_insert_works() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let nodes: Vec<_> = (0..100).map(make_node).collect();
        insert_batch(&db, &nodes).unwrap();

        let total = count(&db).unwrap();
        assert_eq!(total, 100);
    }

    #[tokio::test]
    async fn write_throughput_exceeds_50k_per_sec() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let nodes: Vec<_> = (0..50_000).map(make_node).collect();

        let start = std::time::Instant::now();
        insert_batch(&db, &nodes).unwrap();
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_secs() < 1,
            "Insertion took {:?}, expected < 1 second",
            elapsed
        );
    }
}
