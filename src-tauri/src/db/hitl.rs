//! HITL 記錄 CRUD 操作
//!
//! 提供 HitlRecord 的資料庫操作函式（審計日誌）

use super::models::HitlRecord;
use super::{Database, DbError, Result};
use rusqlite::params;

/// 插入 HITL 記錄
pub fn insert(db: &Database, record: &HitlRecord) -> Result<()> {
    let conn = db.lock()?;
    conn.execute(
        "INSERT INTO hitl_records (id, agent_id, tool_name, input, risk_level, approved, modified_input, reason, decided_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            record.id,
            record.agent_id,
            record.tool_name,
            record.input,
            record.risk_level.as_str(),
            record.approved as i32,
            record.modified_input,
            record.reason,
            record.decided_by.as_str(),
            record.created_at,
        ],
    )?;
    Ok(())
}

/// 取得單一 HITL 記錄
pub fn get(db: &Database, id: &str) -> Result<HitlRecord> {
    let conn = db.lock()?;
    let record = conn
        .query_row(
            "SELECT id, agent_id, tool_name, input, risk_level, approved, modified_input, reason, decided_by, created_at
             FROM hitl_records WHERE id = ?1",
            params![id],
            HitlRecord::from_row,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                DbError::NotFound(format!("HITL record not found: {}", id))
            }
            _ => DbError::from(e),
        })?;
    Ok(record)
}

/// 取得 Agent 的所有 HITL 記錄
pub fn get_by_agent(db: &Database, agent_id: &str) -> Result<Vec<HitlRecord>> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, tool_name, input, risk_level, approved, modified_input, reason, decided_by, created_at
         FROM hitl_records WHERE agent_id = ?1 ORDER BY created_at ASC",
    )?;

    let records = stmt
        .query_map(params![agent_id], HitlRecord::from_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

/// 取得已批准的 HITL 記錄
pub fn get_approved(db: &Database, agent_id: &str) -> Result<Vec<HitlRecord>> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, tool_name, input, risk_level, approved, modified_input, reason, decided_by, created_at
         FROM hitl_records WHERE agent_id = ?1 AND approved = 1 ORDER BY created_at ASC",
    )?;

    let records = stmt
        .query_map(params![agent_id], HitlRecord::from_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

/// 取得被拒絕的 HITL 記錄
pub fn get_denied(db: &Database, agent_id: &str) -> Result<Vec<HitlRecord>> {
    let conn = db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, tool_name, input, risk_level, approved, modified_input, reason, decided_by, created_at
         FROM hitl_records WHERE agent_id = ?1 AND approved = 0 ORDER BY created_at ASC",
    )?;

    let records = stmt
        .query_map(params![agent_id], HitlRecord::from_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

/// 計算 HITL 記錄數量
pub fn count(db: &Database) -> Result<i64> {
    let conn = db.lock()?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM hitl_records", [], |r| r.get(0))?;
    Ok(count)
}

/// 計算 Agent 的 HITL 記錄數量
pub fn count_by_agent(db: &Database, agent_id: &str) -> Result<i64> {
    let conn = db.lock()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM hitl_records WHERE agent_id = ?1",
        params![agent_id],
        |r| r.get(0),
    )?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::super::init_db;
    use super::*;
    use crate::db::models::{DecidedBy, RiskLevel};
    use tempfile::tempdir;

    fn make_record(id: &str, approved: bool, decided_by: DecidedBy) -> HitlRecord {
        HitlRecord {
            id: id.to_string(),
            agent_id: "agent-1".to_string(),
            tool_name: "Bash".to_string(),
            input: r#"{"command": "ls -la"}"#.to_string(),
            risk_level: RiskLevel::Medium,
            approved,
            modified_input: None,
            reason: Some("User approved".to_string()),
            decided_by,
            created_at: 1700000000,
        }
    }

    #[tokio::test]
    async fn insert_and_get_hitl_record() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let record = make_record("hitl-1", true, DecidedBy::Human);
        insert(&db, &record).unwrap();

        let fetched = get(&db, "hitl-1").unwrap();
        assert_eq!(fetched.id, "hitl-1");
        assert_eq!(fetched.tool_name, "Bash");
        assert!(fetched.approved);
    }

    #[tokio::test]
    async fn hitl_record_decided_by_field() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let record = make_record("hitl-1", true, DecidedBy::Human);
        insert(&db, &record).unwrap();

        let fetched = get(&db, "hitl-1").unwrap();
        assert_eq!(fetched.decided_by, DecidedBy::Human);

        let record2 = make_record("hitl-2", true, DecidedBy::OrchestratorBMode);
        insert(&db, &record2).unwrap();

        let fetched2 = get(&db, "hitl-2").unwrap();
        assert_eq!(fetched2.decided_by, DecidedBy::OrchestratorBMode);
    }

    #[tokio::test]
    async fn get_by_agent_returns_all() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        for i in 0..5 {
            let record = HitlRecord {
                id: format!("hitl-{}", i),
                agent_id: "agent-1".to_string(),
                tool_name: "Bash".to_string(),
                input: r#"{"command": "ls"}"#.to_string(),
                risk_level: RiskLevel::Low,
                approved: i % 2 == 0,
                modified_input: None,
                reason: None,
                decided_by: DecidedBy::Human,
                created_at: 1700000000 + i as i64,
            };
            insert(&db, &record).unwrap();
        }

        let records = get_by_agent(&db, "agent-1").unwrap();
        assert_eq!(records.len(), 5);
    }

    #[tokio::test]
    async fn get_approved_and_denied() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        // 3 approved, 2 denied
        for i in 0..5 {
            let record = HitlRecord {
                id: format!("hitl-{}", i),
                agent_id: "agent-1".to_string(),
                tool_name: "Bash".to_string(),
                input: r#"{"command": "ls"}"#.to_string(),
                risk_level: RiskLevel::Medium,
                approved: i < 3,
                modified_input: None,
                reason: None,
                decided_by: DecidedBy::Human,
                created_at: 1700000000 + i as i64,
            };
            insert(&db, &record).unwrap();
        }

        let approved = get_approved(&db, "agent-1").unwrap();
        assert_eq!(approved.len(), 3);

        let denied = get_denied(&db, "agent-1").unwrap();
        assert_eq!(denied.len(), 2);
    }

    #[tokio::test]
    async fn count_functions_work() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        for i in 0..3 {
            let record = make_record(&format!("hitl-{}", i), true, DecidedBy::Human);
            insert(&db, &record).unwrap();
        }

        assert_eq!(count(&db).unwrap(), 3);
        assert_eq!(count_by_agent(&db, "agent-1").unwrap(), 3);
        assert_eq!(count_by_agent(&db, "agent-2").unwrap(), 0);
    }

    #[tokio::test]
    async fn get_nonexistent_returns_not_found() {
        let dir = tempdir().unwrap();
        let db = init_db(&dir.path().join("test.db")).await.unwrap();

        let result = get(&db, "nonexistent");
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }
}
