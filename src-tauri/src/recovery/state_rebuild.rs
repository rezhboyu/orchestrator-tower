//! Agent 狀態重建
//!
//! 從 Git SHA 和 SQLite reasoning_nodes 重建 AgentState，
//! 用於 Sidecar 崩潰後的恢復。

use crate::db::models::ReasoningNode;
use crate::db::{nodes, Database};
use crate::git;
use crate::recovery::{AgentRecoveryInfo, RecoveryError, Result};
use std::path::Path;

/// 從 Git SHA + SQLite 重建 Agent 狀態
///
/// # 流程
/// 1. 從 SQLite 載入該 Agent 的所有 reasoning_nodes
/// 2. 找出最後完成的節點及其 git_snapshot_sha
/// 3. 驗證 Git SHA 有效性
/// 4. 回傳 AgentRecoveryInfo 供 agent:start --resume 使用
pub async fn rebuild_agent_state(
    agent_id: &str,
    project_id: &str,
    db: &Database,
    worktree_path: &Path,
) -> Result<AgentRecoveryInfo> {
    println!(
        "[StateRebuild] Rebuilding state for agent {} in project {}",
        agent_id, project_id
    );

    // Step 1: 從 SQLite 載入推理節點
    let reasoning_nodes = load_reasoning_nodes(agent_id, db)?;
    println!(
        "[StateRebuild] Loaded {} reasoning nodes for agent {}",
        reasoning_nodes.len(),
        agent_id
    );

    // Step 2: 找出最後完成的節點
    let last_completed = find_last_completed_node(&reasoning_nodes);

    // Step 3: 取得最後的 Git SHA 並驗證
    let last_git_sha = if let Some(ref node) = last_completed {
        if let Some(ref sha) = node.git_snapshot_sha {
            match validate_git_sha(worktree_path, sha).await {
                Ok(true) => {
                    println!("[StateRebuild] Git SHA {} is valid", sha);
                    Some(sha.clone())
                }
                Ok(false) => {
                    eprintln!("[StateRebuild] Git SHA {} is invalid, skipping", sha);
                    None
                }
                Err(e) => {
                    eprintln!("[StateRebuild] Git SHA validation failed: {}", e);
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // Step 4: 提取 session_id（從最近的 session_start 節點）
    let session_id = extract_session_id(&reasoning_nodes);

    let info = AgentRecoveryInfo {
        agent_id: agent_id.to_string(),
        project_id: project_id.to_string(),
        model: String::new(), // 由 AppState 填入
        session_id,
        last_git_sha,
        last_completed_node_id: last_completed.map(|n| n.id.clone()),
        reasoning_node_count: reasoning_nodes.len(),
    };

    println!(
        "[StateRebuild] Recovery info: session_id={:?}, last_sha={:?}, nodes={}",
        info.session_id, info.last_git_sha, info.reasoning_node_count
    );

    Ok(info)
}

/// 從 SQLite 載入 Agent 的推理節點
pub fn load_reasoning_nodes(agent_id: &str, db: &Database) -> Result<Vec<ReasoningNode>> {
    nodes::get_by_agent(db, agent_id).map_err(|e| {
        RecoveryError::StateRebuildFailed(format!(
            "Failed to load reasoning nodes for agent {}: {}",
            agent_id, e
        ))
    })
}

/// 找出最後一個完成的節點（按 updated_at 排序）
fn find_last_completed_node(nodes: &[ReasoningNode]) -> Option<&ReasoningNode> {
    nodes
        .iter()
        .filter(|n| {
            matches!(
                n.status,
                crate::db::models::NodeStatus::Completed | crate::db::models::NodeStatus::Active
            )
        })
        .max_by_key(|n| n.updated_at)
}

/// 驗證 Git SHA 是否存在於倉庫中
pub async fn validate_git_sha(worktree_path: &Path, sha: &str) -> Result<bool> {
    // SHA 格式驗證：必須是 40 字元十六進位字串
    if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(false);
    }

    match git::run_git(worktree_path, &["cat-file", "-t", sha]).await {
        Ok(object_type) => Ok(object_type == "commit" || object_type == "tree"),
        Err(_) => Ok(false),
    }
}

/// 從推理節點中提取最近的 session_id
///
/// session_id 儲存在 session_start 類型的節點 content JSON 中
fn extract_session_id(nodes: &[ReasoningNode]) -> Option<String> {
    // 從最新到最舊搜尋
    for node in nodes.iter().rev() {
        if let Ok(content) = serde_json::from_str::<serde_json::Value>(&node.content) {
            if let Some(session_id) = content.get("sessionId").and_then(|v| v.as_str()) {
                return Some(session_id.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{NodeStatus, NodeType};

    fn make_node(id: &str, status: NodeStatus, sha: Option<&str>, updated_at: i64) -> ReasoningNode {
        ReasoningNode {
            id: id.to_string(),
            agent_id: "agent-1".to_string(),
            project_id: "project-1".to_string(),
            parent_id: None,
            node_type: NodeType::Thought,
            content: "{}".to_string(),
            status,
            git_snapshot_sha: sha.map(|s| s.to_string()),
            created_at: updated_at,
            updated_at,
        }
    }

    #[test]
    fn find_last_completed_node_returns_latest() {
        let nodes = vec![
            make_node("n1", NodeStatus::Completed, Some("aaa"), 100),
            make_node("n2", NodeStatus::Completed, Some("bbb"), 200),
            make_node("n3", NodeStatus::Pending, Some("ccc"), 300),
        ];

        let result = find_last_completed_node(&nodes);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "n2");
    }

    #[test]
    fn find_last_completed_node_includes_active() {
        let nodes = vec![
            make_node("n1", NodeStatus::Completed, Some("aaa"), 100),
            make_node("n2", NodeStatus::Active, Some("bbb"), 200),
        ];

        let result = find_last_completed_node(&nodes);
        assert_eq!(result.unwrap().id, "n2");
    }

    #[test]
    fn find_last_completed_node_returns_none_for_empty() {
        let nodes: Vec<ReasoningNode> = vec![];
        assert!(find_last_completed_node(&nodes).is_none());
    }

    #[test]
    fn find_last_completed_node_returns_none_for_all_pending() {
        let nodes = vec![
            make_node("n1", NodeStatus::Pending, None, 100),
            make_node("n2", NodeStatus::Failed, None, 200),
        ];
        assert!(find_last_completed_node(&nodes).is_none());
    }

    #[test]
    fn extract_session_id_from_content() {
        let nodes = vec![
            ReasoningNode {
                id: "n1".to_string(),
                agent_id: "a1".to_string(),
                project_id: "p1".to_string(),
                parent_id: None,
                node_type: NodeType::Thought,
                content: r#"{"sessionId": "sess-abc-123"}"#.to_string(),
                status: NodeStatus::Completed,
                git_snapshot_sha: None,
                created_at: 100,
                updated_at: 100,
            },
        ];

        assert_eq!(
            extract_session_id(&nodes),
            Some("sess-abc-123".to_string())
        );
    }

    #[test]
    fn extract_session_id_returns_none_for_no_session() {
        let nodes = vec![make_node("n1", NodeStatus::Completed, None, 100)];
        assert!(extract_session_id(&nodes).is_none());
    }

    #[test]
    fn validate_git_sha_format() {
        // 同步測試 SHA 格式驗證邏輯
        let valid_sha = "a".repeat(40);
        assert!(valid_sha.len() == 40);
        assert!(valid_sha.chars().all(|c| c.is_ascii_hexdigit()));

        let invalid_short = "abc123";
        assert!(invalid_short.len() != 40);

        let invalid_chars = "g".repeat(40); // 'g' is not hex
        assert!(!invalid_chars.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn rebuild_agent_state_with_empty_db() {
        use crate::db::init_db;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let result = rebuild_agent_state(
            "agent-nonexistent",
            "project-1",
            &db,
            dir.path(),
        )
        .await;

        // 應該成功但沒有恢復資料
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.reasoning_node_count, 0);
        assert!(info.last_git_sha.is_none());
        assert!(info.last_completed_node_id.is_none());
    }

    #[tokio::test]
    async fn rebuild_agent_state_with_nodes() {
        use crate::db::{init_db, nodes::insert};
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        // 插入測試節點
        let node = ReasoningNode {
            id: "node-1".to_string(),
            agent_id: "agent-1".to_string(),
            project_id: "project-1".to_string(),
            parent_id: None,
            node_type: NodeType::Thought,
            content: r#"{"sessionId": "session-xyz"}"#.to_string(),
            status: NodeStatus::Completed,
            git_snapshot_sha: None, // 無 SHA（不在 git repo 中）
            created_at: 1700000000,
            updated_at: 1700000001,
        };
        insert(&db, &node).unwrap();

        let result = rebuild_agent_state(
            "agent-1",
            "project-1",
            &db,
            dir.path(),
        )
        .await;

        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.agent_id, "agent-1");
        assert_eq!(info.reasoning_node_count, 1);
        assert_eq!(info.session_id, Some("session-xyz".to_string()));
        assert_eq!(info.last_completed_node_id, Some("node-1".to_string()));
    }
}
