//! SQLite 持久層模組
//!
//! 負責推理節點歷史與 HITL 記錄的 SQLite 持久化。
//! 每個專案使用獨立的 DB 檔案：`~/.orchestrator/projects/{id}/agent.db`

pub mod hitl;
pub mod models;
pub mod nodes;
pub mod schema;

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// 資料庫錯誤類型
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Record not found: {0}")]
    NotFound(String),

    #[error("Database lock error")]
    LockError,
}

/// 資料庫操作結果類型
pub type Result<T> = std::result::Result<T, DbError>;

/// 資料庫連線包裝，支援多執行緒存取
#[derive(Debug, Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// 初始化資料庫
    ///
    /// 建立連線並啟用 WAL 模式，若資料表不存在則自動建立。
    pub fn init(db_path: &Path) -> Result<Self> {
        // 確保父目錄存在
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(db_path)?;

        // 啟用 WAL 模式以支援高並發寫入
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=10000;
             PRAGMA temp_store=MEMORY;",
        )?;

        // 建立資料表
        schema::create_tables(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// 開啟已存在的資料庫（不執行 schema migration）
    ///
    /// 適用於 DB 已由 `init` 建立後的後續存取，避免重複跑 create_tables。
    pub fn open(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// 取得資料庫連線的鎖定
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| DbError::LockError)
    }

    /// 執行查詢並回傳單一值
    pub fn query_row<T, F>(&self, sql: &str, params: &[&dyn rusqlite::ToSql], f: F) -> Result<T>
    where
        F: FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    {
        let conn = self.lock()?;
        conn.query_row(sql, params, f).map_err(DbError::from)
    }
}

/// 異步初始化資料庫
///
/// 使用 `spawn_blocking` 包裝同步操作以保持 async 接口。
pub async fn init_db(db_path: &Path) -> Result<Database> {
    let path = db_path.to_path_buf();
    tokio::task::spawn_blocking(move || Database::init(&path))
        .await
        .map_err(|_| DbError::LockError)?
}

/// 異步開啟已存在的資料庫（不執行 schema migration）
pub async fn open_db(db_path: &Path) -> Result<Database> {
    let path = db_path.to_path_buf();
    tokio::task::spawn_blocking(move || Database::open(&path))
        .await
        .map_err(|_| DbError::LockError)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn wal_mode_enabled_on_init() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = init_db(&db_path).await.unwrap();

        let mode: String = db
            .query_row("PRAGMA journal_mode", &[], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[tokio::test]
    async fn synchronous_mode_is_normal() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = init_db(&db_path).await.unwrap();

        let sync: i32 = db
            .query_row("PRAGMA synchronous", &[], |r| r.get(0))
            .unwrap();
        // NORMAL = 1
        assert_eq!(sync, 1);
    }

    #[tokio::test]
    async fn creates_parent_directories() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("nested").join("dir").join("test.db");
        let _db = init_db(&db_path).await.unwrap();
        assert!(db_path.exists());
    }
}
