//! Agent 生命週期管理
//!
//! create_agent: 建立 worktree → 插入 AppState → 寫入 DB → 送 IPC agent:start
//! remove_agent: 確認 idle → 移除 AppState → 軟刪除 DB → 移除 worktree

use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use super::projects_json;
use super::{LifecycleError, Result};
use crate::db::open_db;
use crate::git::worktree;
use crate::state::{AgentState, AgentStatus, AppState};

/// 建立新 Agent
///
/// 流程：
/// 1. 產生 agentId（UUID v4）
/// 2. 從 projects.json 取得專案路徑
/// 3. 建立 Git worktree：{projectPath}/.trees/agent-{agentId}
/// 4. 插入 AppState.agents（in-memory）
/// 5. 插入 agent.db agents 表
/// 6. 回傳 agentId（IPC agent:start 由呼叫端處理）
pub async fn create_agent(
    project_id: String,
    model: String,
    priority: u32,
    state: &AppState,
) -> Result<String> {
    // 查找專案
    let project = {
        let pid = project_id.clone();
        tokio::task::spawn_blocking(move || projects_json::find_project(&pid))
            .await
            .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))??
    };

    let project =
        project.ok_or_else(|| LifecycleError::ProjectNotFound(project_id.clone()))?;

    let agent_id = Uuid::new_v4().to_string();
    let project_path = PathBuf::from(&project.path);

    // 建立 Git worktree
    let wt_path = worktree::create_worktree(&project_path, &agent_id).await?;

    // 插入 AppState
    let agent_state = AgentState::new(
        agent_id.clone(),
        project_id.clone(),
        wt_path,
        model.clone(),
        state.tower_port,
    );
    // 設定 priority
    let mut agent_state = agent_state;
    agent_state.priority = priority;

    {
        let mut agents = state.agents.write().map_err(|_| {
            LifecycleError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "lock poisoned",
            ))
        })?;
        agents.insert(agent_id.clone(), agent_state);
    }

    // 寫入 agent.db（DB 已在 create_project 時 init，這裡只開啟）
    let data_dir = projects_json::project_data_dir(&project_id);
    let db_path = data_dir.join("agent.db");
    let database = open_db(&db_path).await.map_err(LifecycleError::Db)?;

    let aid = agent_id.clone();
    let pid = project_id.clone();
    let mdl = model.clone();
    let now = Utc::now().timestamp();
    let pri = priority as i32;

    tokio::task::spawn_blocking(move || {
        let conn = database.lock().map_err(|_| {
            crate::db::DbError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "lock poisoned",
            ))
        })?;
        conn.execute(
            "INSERT INTO agents (id, project_id, model, priority, created_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            rusqlite::params![aid, pid, mdl, pri, now],
        )?;
        Ok::<(), crate::db::DbError>(())
    })
    .await
    .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
    .map_err(LifecycleError::Db)?;

    Ok(agent_id)
}

/// 移除 Agent
///
/// 流程：
/// 1. 確認 agent 為 Idle（否則回傳 AgentStillRunning）
/// 2. 從 AppState 移除
/// 3. 軟刪除 DB 記錄（設定 deleted_at）
/// 4. 移除 Git worktree
pub async fn remove_agent(agent_id: String, state: &AppState) -> Result<()> {
    // 取得 agent info 並驗證狀態
    let project_id = {
        let agents = state.agents.read().map_err(|_| {
            LifecycleError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "lock poisoned",
            ))
        })?;

        let agent = agents
            .get(&agent_id)
            .ok_or_else(|| LifecycleError::AgentNotFound(agent_id.clone()))?;

        if agent.status != AgentStatus::Idle {
            return Err(LifecycleError::AgentStillRunning);
        }

        agent.project_id.clone()
    };

    // 取得專案路徑
    let project_path = {
        let pid = project_id.clone();
        let project = tokio::task::spawn_blocking(move || projects_json::find_project(&pid))
            .await
            .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))??;
        PathBuf::from(
            project
                .ok_or_else(|| LifecycleError::ProjectNotFound(project_id.clone()))?
                .path,
        )
    };

    // 從 AppState 移除
    {
        let mut agents = state.agents.write().map_err(|_| {
            LifecycleError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "lock poisoned",
            ))
        })?;
        agents.remove(&agent_id);
    }

    // 軟刪除 DB 記錄
    let data_dir = projects_json::project_data_dir(&project_id);
    let db_path = data_dir.join("agent.db");
    if db_path.exists() {
        let database = open_db(&db_path).await.map_err(LifecycleError::Db)?;
        let aid = agent_id.clone();
        let now = Utc::now().timestamp();

        tokio::task::spawn_blocking(move || {
            let conn = database.lock().map_err(|_| {
                crate::db::DbError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "lock poisoned",
                ))
            })?;
            conn.execute(
                "UPDATE agents SET deleted_at = ?1 WHERE id = ?2",
                rusqlite::params![now, aid],
            )?;
            Ok::<(), crate::db::DbError>(())
        })
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
        .map_err(LifecycleError::Db)?;
    }

    // 移除 Git worktree
    if worktree::worktree_exists(&project_path, &agent_id) {
        // 忽略 worktree 移除錯誤（可能已被手動清理）
        let _ = worktree::remove_worktree(&project_path, &agent_id).await;
    }

    Ok(())
}

/// 查詢專案下所有活躍 agents（deleted_at IS NULL）
pub async fn list_active_agents(project_id: &str) -> Result<Vec<crate::db::models::AgentRecord>> {
    let data_dir = projects_json::project_data_dir(project_id);
    let db_path = data_dir.join("agent.db");

    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let database = open_db(&db_path).await.map_err(LifecycleError::Db)?;

    let records = tokio::task::spawn_blocking(move || {
        let conn = database.lock().map_err(|_| {
            crate::db::DbError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "lock poisoned",
            ))
        })?;
        let mut stmt = conn.prepare(
            "SELECT id, project_id, model, priority, created_at, deleted_at FROM agents WHERE deleted_at IS NULL",
        )?;
        let rows = stmt
            .query_map([], |row| {
                crate::db::models::AgentRecord::from_row(row)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok::<_, crate::db::DbError>(rows)
    })
    .await
    .map_err(|e| LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
    .map_err(LifecycleError::Db)?;

    Ok(records)
}
