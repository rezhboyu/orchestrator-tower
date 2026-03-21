//! 專案與 Agent 生命週期管理
//!
//! 提供 projects.json atomic read/write、專案 CRUD、Agent 建立/移除功能。
//! 所有狀態寫入在 Rust 層完成。

pub mod agent;
pub mod project;
pub mod projects_json;

use thiserror::Error;

/// 生命週期操作錯誤
#[derive(Error, Debug)]
pub enum LifecycleError {
    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    #[error("Agents still running, cannot delete project")]
    AgentsStillRunning,

    #[error("Agent still running, cannot remove")]
    AgentStillRunning,

    #[error("Not a valid git repository: {0}")]
    NotGitRepo(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Database error: {0}")]
    Db(#[from] crate::db::DbError),

    #[error("Git error: {0}")]
    Git(#[from] crate::git::GitError),
}

pub type Result<T> = std::result::Result<T, LifecycleError>;
