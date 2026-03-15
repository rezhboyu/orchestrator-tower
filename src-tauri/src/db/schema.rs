//! 資料庫 Schema 定義
//!
//! 包含所有資料表的 CREATE TABLE SQL 和索引建立

use rusqlite::Connection;

/// 建立所有資料表
pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

/// 完整的 Schema SQL
const SCHEMA_SQL: &str = r#"
-- ============================================
-- 推理節點表
-- ============================================
CREATE TABLE IF NOT EXISTS reasoning_nodes (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    node_type TEXT NOT NULL,        -- thought/tool_call/tool_result/decision/error
    content TEXT NOT NULL,          -- JSON
    status TEXT NOT NULL,           -- pending/active/completed/failed/frozen
    git_snapshot_sha TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_agent ON reasoning_nodes(agent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON reasoning_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON reasoning_nodes(parent_id);

-- ============================================
-- HITL 記錄表（審計日誌）
-- ============================================
CREATE TABLE IF NOT EXISTS hitl_records (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,            -- JSON
    risk_level TEXT NOT NULL,       -- critical/high/medium/low
    approved INTEGER NOT NULL,      -- 0/1
    modified_input TEXT,            -- JSON，若審批時修改了輸入
    reason TEXT,
    decided_by TEXT NOT NULL,       -- 'human' / 'orchestrator_b_mode'
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_agent ON hitl_records(agent_id);

-- ============================================
-- Agent 記錄表（生命週期追蹤）
-- ============================================
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,            -- agentId（UUID v4）
    project_id TEXT NOT NULL,
    model TEXT NOT NULL,
    priority INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER              -- null 表示仍活躍，非 null 表示已刪除
);

CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_tables_succeeds() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();

        // 驗證表存在
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"reasoning_nodes".to_string()));
        assert!(tables.contains(&"hitl_records".to_string()));
        assert!(tables.contains(&"agents".to_string()));
    }

    #[test]
    fn indexes_are_created() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();

        // 驗證索引存在
        let indexes: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(indexes.contains(&"idx_nodes_agent".to_string()));
        assert!(indexes.contains(&"idx_nodes_project".to_string()));
        assert!(indexes.contains(&"idx_nodes_parent".to_string()));
        assert!(indexes.contains(&"idx_hitl_agent".to_string()));
        assert!(indexes.contains(&"idx_agents_project".to_string()));
    }

    #[test]
    fn create_tables_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        // 第二次呼叫應該不會失敗
        create_tables(&conn).unwrap();
    }
}
