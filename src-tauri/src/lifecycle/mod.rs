//! 專案與 Agent 生命週期管理（Task 16）
//!
//! 模組結構：
//! - `projects_json`：projects.json atomic read/write（fs2 lock + rename）
//! - `project`：create_project / delete_project
//! - `agent`：create_agent / remove_agent

pub mod agent;
pub mod project;
pub mod projects_json;

use thiserror::Error;

/// 生命週期操作錯誤型別
#[derive(Debug, Error)]
pub enum LifecycleError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Git error: {0}")]
    Git(#[from] crate::git::GitError),

    #[error("Database error: {0}")]
    Db(#[from] crate::db::DbError),

    #[error("agents_still_running: project {0} has running agents")]
    AgentsStillRunning(String),

    #[error("agent_still_running: agent {0} is not idle")]
    AgentStillRunning(String),

    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    #[error("Path does not exist: {0}")]
    PathNotFound(String),

    #[error("Path is not a git repository: {0}")]
    NotAGitRepo(String),

    #[error("Lock poisoned")]
    LockPoisoned,
}
