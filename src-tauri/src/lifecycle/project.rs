//! 專案生命週期管理
//!
//! create_project: 驗證 Git repo → 建立目錄 → 初始化 DB → 寫入 projects.json
//! delete_project: 確認無 running agents → 移除 agents → 刪除目錄 → 更新 projects.json

use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use super::projects_json::{self, ProjectEntry};
use super::{LifecycleError, Result};
use crate::db;
use crate::git::run_git;
use crate::state::{AgentStatus, AppState};

/// 建立新專案
///
/// 流程：
/// 1. 驗證 path 是有效的 Git repo
/// 2. 產生 project ID（UUID v4）
/// 3. 建立 ~/.orchestrator/projects/{id}/ 目錄
/// 4. 初始化 agent.db（WAL 模式 + schema）
/// 5. 原子寫入 projects.json
pub async fn create_project(path: String, name: String) -> Result<String> {
    let repo_path = Path::new(&path);

    // 驗證是 Git repo
    run_git(repo_path, &["rev-parse", "--git-dir"])
        .await
        .map_err(|_| LifecycleError::NotGitRepo(path.clone()))?;

    let project_id = Uuid::new_v4().to_string();

    // 建立專案資料目錄
    let data_dir = projects_json::project_data_dir(&project_id);
    tokio::fs::create_dir_all(&data_dir).await?;

    // 初始化 agent.db
    let db_path = data_dir.join("agent.db");
    db::init_db(&db_path).await.map_err(LifecycleError::Db)?;

    // 寫入 projects.json
    let entry = ProjectEntry {
        id: project_id.clone(),
        name,
        path,
        created_at: Utc::now().to_rfc3339(),
    };

    // 使用 spawn_blocking 因為 projects_json 是同步 IO + file lock
    let entry_clone = entry.clone();
    tokio::task::spawn_blocking(move || projects_json::add_project(entry_clone))
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))??;

    Ok(project_id)
}

/// 刪除專案
///
/// 流程：
/// 1. 確認所有 agents 都是 Idle（否則回傳 AgentsStillRunning）
/// 2. 對每個 agent 呼叫 remove_agent
/// 3. 刪除 ~/.orchestrator/projects/{id}/ 目錄
/// 4. 原子更新 projects.json
pub async fn delete_project(project_id: String, state: &AppState) -> Result<()> {
    // 檢查是否有 running agents
    let agents = state.agents.read().map_err(|_| {
        LifecycleError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            "lock poisoned",
        ))
    })?;

    let project_agents: Vec<String> = agents
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(id, _)| id.clone())
        .collect();

    // 確認所有 agents 都是 idle
    for agent_id in &project_agents {
        if let Some(agent) = agents.get(agent_id) {
            if agent.status != AgentStatus::Idle {
                return Err(LifecycleError::AgentsStillRunning);
            }
        }
    }
    drop(agents); // 釋放 read lock

    // 移除每個 agent
    for agent_id in project_agents {
        super::agent::remove_agent(agent_id, state).await?;
    }

    // 刪除專案資料目錄
    let data_dir = projects_json::project_data_dir(&project_id);
    if data_dir.exists() {
        tokio::fs::remove_dir_all(&data_dir).await?;
    }

    // 更新 projects.json
    let pid = project_id.clone();
    tokio::task::spawn_blocking(move || projects_json::remove_project(&pid))
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))??;

    Ok(())
}

/// 列出所有專案
pub async fn list_projects() -> Result<Vec<ProjectEntry>> {
    let data = tokio::task::spawn_blocking(projects_json::read_projects)
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))??;

    Ok(data.projects)
}
