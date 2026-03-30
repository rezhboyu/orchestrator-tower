use crate::db::DatabaseRegistry;
use crate::ipc::IpcState;
use crate::lifecycle::agent::{create_agent as lc_create_agent, remove_agent as lc_remove_agent};
use crate::lifecycle::project::{
    create_project as lc_create_project, delete_project as lc_delete_project,
};
use crate::lifecycle::projects_json::{read_projects, Project};
use crate::state::{AgentStatus, AppState};
use std::sync::Arc;
use tauri::State;

// =============================================================================
// 專案生命週期指令
// =============================================================================

/// 建立新專案
///
/// 驗證 Git repo、建目錄、初始化 agent.db，並將 DB 登記至 DatabaseRegistry。
#[tauri::command]
pub async fn create_project(
    path: String,
    name: String,
    db_registry: State<'_, DatabaseRegistry>,
) -> Result<String, String> {
    let (project_id, db) = lc_create_project(&path, &name)
        .await
        .map_err(|e| e.to_string())?;

    db_registry
        .0
        .lock()
        .map_err(|_| "db_registry lock poisoned".to_string())?
        .insert(project_id.clone(), db);

    Ok(project_id)
}

/// 刪除專案
///
/// 有 running agent 時拒絕刪除（agents_still_running）。
/// 先移除所有 idle agents，再清除目錄及 projects.json 記錄。
#[tauri::command]
pub async fn delete_project(
    project_id: String,
    state: State<'_, Arc<AppState>>,
    ipc_state: State<'_, IpcState>,
    db_registry: State<'_, DatabaseRegistry>,
) -> Result<(), String> {
    // 分類該專案的 agents：running vs idle
    let (running_ids, idle_ids): (Vec<String>, Vec<String>) = {
        let agents = state
            .agents
            .read()
            .map_err(|_| "agents lock poisoned".to_string())?;
        let mut running = vec![];
        let mut idle = vec![];
        for a in agents.values().filter(|a| a.project_id == project_id) {
            if matches!(a.status, AgentStatus::Idle) {
                idle.push(a.id.clone());
            } else {
                running.push(a.id.clone());
            }
        }
        (running, idle)
    };

    // 有 running agent → 拒絕（不進行任何刪除）
    if !running_ids.is_empty() {
        return Err(format!(
            "agents_still_running: project {} has running agents",
            project_id
        ));
    }

    // 先移除 idle agents（確保 agents 清除後再刪專案目錄）
    let db_opt = db_registry
        .0
        .lock()
        .map_err(|_| "db_registry lock poisoned".to_string())?
        .get(&project_id)
        .cloned();

    if let Some(db) = db_opt {
        let ipc_opt = ipc_state
            .0
            .lock()
            .map_err(|_| "ipc_state lock poisoned".to_string())?
            .clone();
        for agent_id in &idle_ids {
            let _ = lc_remove_agent(agent_id, &**state, &db, ipc_opt.as_ref()).await;
        }
    }

    // 再刪除專案目錄及 projects.json 記錄
    lc_delete_project(&project_id, &running_ids)
        .await
        .map_err(|e| e.to_string())?;

    // 從 DatabaseRegistry 移除
    db_registry
        .0
        .lock()
        .map_err(|_| "db_registry lock poisoned".to_string())?
        .remove(&project_id);

    Ok(())
}

/// 列出所有專案
#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, String> {
    read_projects().map_err(|e| e.to_string())
}

// =============================================================================
// Agent 生命週期指令
// =============================================================================

/// 建立新 Agent
///
/// 建立 git worktree、寫入 AppState、初始化 DB 記錄，並透過 IPC 送 agent:start。
#[tauri::command]
pub async fn create_agent(
    project_id: String,
    prompt: String,
    model: String,
    max_turns: u32,
    state: State<'_, Arc<AppState>>,
    ipc_state: State<'_, IpcState>,
    db_registry: State<'_, DatabaseRegistry>,
) -> Result<String, String> {
    let db = db_registry
        .0
        .lock()
        .map_err(|_| "db_registry lock poisoned".to_string())?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| format!("No database registered for project {}", project_id))?;

    let ipc_opt = ipc_state
        .0
        .lock()
        .map_err(|_| "ipc_state lock poisoned".to_string())?
        .clone();

    lc_create_agent(&project_id, &prompt, &model, max_turns, &**state, &db, ipc_opt.as_ref())
        .await
        .map_err(|e| e.to_string())
}

/// 移除 Agent
///
/// 確認 Idle → 送 agent:stop → 等待 agent:stopped ACK（5s）→
/// 移除 AppState → 移除 worktree → DB 軟刪除。
#[tauri::command]
pub async fn remove_agent(
    agent_id: String,
    state: State<'_, Arc<AppState>>,
    ipc_state: State<'_, IpcState>,
    db_registry: State<'_, DatabaseRegistry>,
) -> Result<(), String> {
    // 取得 project_id 以找到對應 DB
    let project_id = {
        let agents = state
            .agents
            .read()
            .map_err(|_| "agents lock poisoned".to_string())?;
        agents
            .get(&agent_id)
            .map(|a| a.project_id.clone())
            .ok_or_else(|| format!("Agent {} not found", agent_id))?
    };

    let db = db_registry
        .0
        .lock()
        .map_err(|_| "db_registry lock poisoned".to_string())?
        .get(&project_id)
        .cloned()
        .ok_or_else(|| format!("No database registered for project {}", project_id))?;

    let ipc_opt = ipc_state
        .0
        .lock()
        .map_err(|_| "ipc_state lock poisoned".to_string())?
        .clone();

    lc_remove_agent(&agent_id, &**state, &db, ipc_opt.as_ref())
        .await
        .map_err(|e| e.to_string())
}

// =============================================================================
// 既有指令（Task 02 骨架，待後續 Task 實作）
// =============================================================================

/// 取得目前應用程式狀態（快照）
#[tauri::command]
pub async fn get_app_state(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let agents = state.agents.read().map_err(|e| e.to_string())?;
    let quota = state.quota.read().map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "tower_port": state.tower_port,
        "state_port": state.state_port,
        "agent_count": agents.len(),
        "quota": {
            "tier1_available": quota.tier1_available,
            "tier2_available": quota.tier2_available,
            "tier3_available": quota.tier3_available,
        }
    }))
}

/// 啟動 Agent（Task 05 完整實作的入口，目前由 create_agent 取代）
#[tauri::command]
pub async fn start_agent(
    agent_id: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _ = agent_id;
    Err("start_agent is deprecated; use the create_agent Tauri command instead".to_string())
}

/// 停止 Agent（Task 05 完整實作的入口，目前由 remove_agent 取代）
#[tauri::command]
pub async fn stop_agent(
    agent_id: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _ = agent_id;
    Err("stop_agent is deprecated; use the remove_agent Tauri command instead".to_string())
}

/// 核准 HITL 請求
#[tauri::command]
pub async fn approve_hitl(
    request_id: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _ = request_id;
    todo!("approve_hitl: Task 06/07 整合後實作")
}

/// 拒絕 HITL 請求
#[tauri::command]
pub async fn deny_hitl(
    request_id: String,
    reason: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _ = (request_id, reason);
    todo!("deny_hitl: Task 06/07 整合後實作")
}

/// 回滾至 ReasoningTree 節點
#[tauri::command]
pub async fn rollback_to_node(
    agent_id: String,
    node_id: String,
    _state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _ = (agent_id, node_id);
    todo!("rollback_to_node: Task 08 整合後實作")
}
