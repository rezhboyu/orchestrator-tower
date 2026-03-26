//! Agent 生命週期管理
//!
//! - `create_agent`：建立 worktree、寫入 AppState、寫 DB、送 agent:start IPC
//! - `remove_agent`：idle 確認、送 agent:stop、等待 agent:stopped（5s timeout）
//!                   、移除 AppState、移除 worktree、DB 軟刪除

use crate::db::Database;
use crate::git::worktree::{create_worktree, remove_worktree, worktree_path};
use crate::ipc::messages::RustCommand;
use crate::ipc::IpcServerHandle;
use crate::lifecycle::projects_json::{default_orchestrator_dir, read_projects_in};
use crate::lifecycle::LifecycleError;
use crate::state::{AgentState, AgentStatus, AppState};
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

/// agent:stop 後等待 agent:stopped 的 timeout
const STOP_ACK_TIMEOUT: Duration = Duration::from_secs(5);

// =============================================================================
// create_agent
// =============================================================================

/// 建立新 Agent
///
/// 流程：
/// 1. 從 projects.json 查 project_path
/// 2. 生成 agentId（UUID v4）
/// 3. git worktree add
/// 4. 寫入 AppState.agents（記憶體）
/// 5. INSERT INTO agents 表（DB）
/// 6. 透過 IPC 送 agent:start（若 IPC 已連線）
///
/// 回傳 agentId。
pub async fn create_agent(
    project_id: &str,
    prompt: &str,
    model: &str,
    max_turns: u32,
    app_state: &AppState,
    db: &Database,
    ipc_handle: Option<&IpcServerHandle>,
) -> Result<String, LifecycleError> {
    create_agent_in(
        project_id,
        prompt,
        model,
        max_turns,
        app_state,
        db,
        ipc_handle,
        &default_orchestrator_dir(),
    )
    .await
}

pub async fn create_agent_in(
    project_id: &str,
    prompt: &str,
    model: &str,
    max_turns: u32,
    app_state: &AppState,
    db: &Database,
    ipc_handle: Option<&IpcServerHandle>,
    base: &std::path::Path,
) -> Result<String, LifecycleError> {
    // 1. 查 project_path
    let projects = read_projects_in(base)?;
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| LifecycleError::ProjectNotFound(project_id.to_string()))?;
    let project_path = PathBuf::from(&project.path);
    let tower_port = app_state.tower_port;

    // 2. 生成 agentId
    let agent_id = Uuid::new_v4().to_string();

    // 3. git worktree add
    let worktree = create_worktree(&project_path, &agent_id).await?;

    // 4. 寫入 AppState
    let agent_state = AgentState::new(
        agent_id.clone(),
        project_id.to_string(),
        worktree.clone(),
        model.to_string(),
        tower_port,
    );
    app_state
        .agents
        .write()
        .map_err(|_| LifecycleError::LockPoisoned)?
        .insert(agent_id.clone(), agent_state);

    // 5. INSERT INTO agents
    let now = chrono::Utc::now().timestamp();
    {
        let conn = db.lock()?;
        conn.execute(
            "INSERT INTO agents (id, project_id, model, priority, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&agent_id, project_id, model, 0i32, now],
        )
        .map_err(|e| crate::db::DbError::from(e))?;
    }

    // 6. 送 agent:start（best effort）
    if let Some(handle) = ipc_handle {
        let cmd = RustCommand::AgentStart {
            agent_id: agent_id.clone(),
            prompt: prompt.to_string(),
            model: model.to_string(),
            max_turns,
            tower_port,
            worktree_path: worktree.to_string_lossy().to_string(),
        };
        let _ = handle.send_command(cmd).await;
    }

    Ok(agent_id)
}

// =============================================================================
// remove_agent
// =============================================================================

/// 移除 Agent
///
/// 流程：
/// 1. 確認 Agent 狀態為 Idle
/// 2. 送 agent:stop IPC，等待 agent:stopped 確認（5s timeout）
/// 3. 從 AppState.agents 移除
/// 4. git worktree remove
/// 5. agents 表軟刪除（deleted_at = now）
pub async fn remove_agent(
    agent_id: &str,
    app_state: &AppState,
    db: &Database,
    ipc_handle: Option<&IpcServerHandle>,
) -> Result<(), LifecycleError> {
    // 1. 確認 Agent 狀態 + 取得 worktree 資訊
    let (project_path, agent_worktree) = {
        let agents = app_state
            .agents
            .read()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        let agent = agents
            .get(agent_id)
            .ok_or_else(|| LifecycleError::AgentNotFound(agent_id.to_string()))?;

        if agent.status != AgentStatus::Idle {
            return Err(LifecycleError::AgentStillRunning(agent_id.to_string()));
        }

        // project_root 從 worktree_path 往上兩層：
        // {project_root}/.trees/agent-{id} → .trees → project_root
        let project_root = agent
            .worktree_path
            .parent() // .trees
            .and_then(|p| p.parent()) // project_root
            .map(|p| p.to_path_buf())
            .ok_or_else(|| LifecycleError::PathNotFound(
                agent.worktree_path.to_string_lossy().to_string(),
            ))?;

        (project_root, agent.worktree_path.clone())
    };

    // 2. 送 agent:stop 並等待 agent:stopped ACK
    if let Some(handle) = ipc_handle {
        let cmd = RustCommand::AgentStop {
            agent_id: agent_id.to_string(),
        };
        let _ = handle.send_command(cmd).await;

        // 等待 agent:stopped 事件（5s timeout）
        let mut rx = handle.subscribe();
        let _ = tokio::time::timeout(STOP_ACK_TIMEOUT, async {
            loop {
                match rx.recv().await {
                    Ok(crate::ipc::messages::SidecarEvent::AgentStopped { agent_id: id })
                        if id == agent_id =>
                    {
                        break;
                    }
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
        })
        .await;
    }

    // 3. 從 AppState 移除
    app_state
        .agents
        .write()
        .map_err(|_| LifecycleError::LockPoisoned)?
        .remove(agent_id);

    // 4. git worktree remove
    let _ = remove_worktree(&project_path, agent_id).await;
    drop(agent_worktree); // suppress unused warning

    // 5. 軟刪除（deleted_at = now）
    let now = chrono::Utc::now().timestamp();
    {
        let conn = db.lock()?;
        conn.execute(
            "UPDATE agents SET deleted_at = ?1 WHERE id = ?2",
            rusqlite::params![now, agent_id],
        )
        .map_err(|e| crate::db::DbError::from(e))?;
    }

    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

// TODO: [TEST ENV] 同 projects_json.rs，需要 libgtk-3-dev 才能執行。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use crate::state::AppState;
    use std::collections::HashMap;
    use tempfile::tempdir;

    /// 建立已有 agent 在 AppState 且狀態為 Idle 的測試場景
    async fn setup_idle_agent(
        agent_id: &str,
        project_id: &str,
        worktree: PathBuf,
    ) -> (AppState, Database) {
        let state = AppState::new();
        let mut agents = state.agents.write().unwrap();
        agents.insert(
            agent_id.to_string(),
            AgentState::new(
                agent_id.to_string(),
                project_id.to_string(),
                worktree,
                "claude-sonnet-4-6".to_string(),
                3701,
            ),
        );
        drop(agents);

        let db_dir = tempdir().unwrap();
        let db = init_db(&db_dir.path().join("agent.db")).await.unwrap();

        // 插入 agents 記錄
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO agents (id, project_id, model, priority, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![agent_id, project_id, "claude-sonnet-4-6", 0i32, 0i64],
            )
            .unwrap();
        }

        (state, db)
    }

    #[tokio::test]
    async fn remove_agent_soft_deletes_db_record() {
        let base = tempdir().unwrap();
        let project_root = tempdir().unwrap();

        // 建立 .trees/agent-test-1 目錄模擬 worktree
        let trees_dir = project_root.path().join(".trees");
        tokio::fs::create_dir_all(&trees_dir).await.unwrap();
        let wt_path = trees_dir.join("agent-test-1");
        tokio::fs::create_dir_all(&wt_path).await.unwrap();

        let (state, db) =
            setup_idle_agent("test-1", "proj-1", wt_path).await;

        // 無 IPC（None），只測試 DB 軟刪除
        remove_agent("test-1", &state, &db, None)
            .await
            .unwrap();

        // 驗證 deleted_at 非 null
        let deleted_at: Option<i64> = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT deleted_at FROM agents WHERE id = ?1",
                rusqlite::params!["test-1"],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert!(deleted_at.is_some(), "deleted_at 應為非 null（軟刪除）");
    }

    #[tokio::test]
    async fn remove_agent_rejects_non_idle() {
        let base = tempdir().unwrap();
        let project_root = tempdir().unwrap();
        let wt_path = project_root.path().join(".trees").join("agent-x");
        tokio::fs::create_dir_all(&wt_path).await.unwrap();

        let (state, db) = setup_idle_agent("x", "proj-1", wt_path).await;

        // 將 agent 狀態改為 Running
        state
            .agents
            .write()
            .unwrap()
            .get_mut("x")
            .unwrap()
            .status = AgentStatus::Running;

        let err = remove_agent("x", &state, &db, None)
            .await
            .unwrap_err();
        assert!(matches!(err, LifecycleError::AgentStillRunning(_)));
    }
}
