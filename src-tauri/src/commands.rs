use crate::state::AppState;
use tauri::State;

/// Start an agent with the given ID
#[tauri::command]
pub async fn start_agent(
    agent_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Implement agent start logic
    // 1. Create worktree for the agent
    // 2. Send agent:start command to sidecar via IPC
    // 3. Update agent status in AppState
    let _ = agent_id;
    todo!("start_agent not implemented")
}

/// Stop an agent with the given ID
#[tauri::command]
pub async fn stop_agent(
    agent_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Implement agent stop logic
    // 1. Send agent:stop command to sidecar via IPC
    // 2. Update agent status in AppState
    // 3. Clean up worktree if needed
    let _ = agent_id;
    todo!("stop_agent not implemented")
}

/// Approve a HITL (Human-in-the-Loop) request
#[tauri::command]
pub async fn approve_hitl(
    request_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Implement HITL approval logic
    // 1. Send hitl:response with behavior='allow' to sidecar
    // 2. Update any waiting agents
    let _ = request_id;
    todo!("approve_hitl not implemented")
}

/// Deny a HITL (Human-in-the-Loop) request with a reason
#[tauri::command]
pub async fn deny_hitl(
    request_id: String,
    reason: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Implement HITL denial logic
    // 1. Send hitl:response with behavior='deny' to sidecar
    // 2. Update any waiting agents
    let _ = (request_id, reason);
    todo!("deny_hitl not implemented")
}

/// Rollback an agent to a specific reasoning tree node
#[tauri::command]
pub async fn rollback_to_node(
    agent_id: String,
    node_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // TODO: Implement rollback logic using Git plumbing
    // 1. Find the commit associated with node_id
    // 2. Use git reset --keep to rollback
    // 3. Update agent state
    let _ = (agent_id, node_id);
    todo!("rollback_to_node not implemented")
}

/// Create a new project at the given path
#[tauri::command]
pub async fn create_project(
    path: String,
    name: String,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    // TODO: Implement project creation
    // 1. Initialize git repository if not exists
    // 2. Create project entry in projects.json
    // 3. Return project ID
    let _ = (path, name);
    todo!("create_project not implemented")
}

/// Get the current application state
#[tauri::command]
pub async fn get_app_state(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    // TODO: Implement full state retrieval
    // For now, return basic state info
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
