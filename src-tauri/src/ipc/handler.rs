//! IPC Query Handler - 處理來自 Node.js 的 IPC 查詢
//!
//! 實作 State MCP Server (Task 07) 所需的查詢處理邏輯。
//! 所有狀態都從 AppState 讀取/寫入，Node.js 層無狀態。

use super::messages::{FreezeReason, IpcQueryType, IpcRequest, IpcResponse, RustCommand};
use crate::state::{AgentStatus, AppState};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;

/// 處理 IPC 查詢請求
///
/// # Arguments
/// * `request` - 來自 Node.js 的查詢請求
/// * `app_state` - 應用程式狀態
/// * `command_tx` - 用於發送 RustCommand 至 Node.js
///
/// # Returns
/// * `IpcResponse` - 查詢結果
pub async fn handle_query(
    request: &IpcRequest,
    app_state: &Arc<AppState>,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    match request.query {
        // =========================================================================
        // 狀態查詢（唯讀）
        // =========================================================================
        IpcQueryType::GetWorkerStatus => handle_get_worker_status(request, app_state),
        IpcQueryType::GetQuotaStatus => handle_get_quota_status(request, app_state),
        IpcQueryType::GetGitSnapshot => handle_get_git_snapshot(request, app_state),
        IpcQueryType::GetBModeStatus => handle_get_b_mode_status(request, app_state),

        // =========================================================================
        // State MCP 控制操作（Task 07）
        // =========================================================================
        IpcQueryType::AssignTask => handle_assign_task(request, command_tx).await,
        IpcQueryType::PauseWorker => handle_pause_worker(request, command_tx).await,
        IpcQueryType::ResumeWorker => handle_resume_worker(request, command_tx).await,
        IpcQueryType::ApproveHitl => handle_approve_hitl(request, app_state, command_tx).await,
        IpcQueryType::DenyHitl => handle_deny_hitl(request, app_state, command_tx).await,

        // =========================================================================
        // Quota 管理操作（Task 10）
        // =========================================================================
        IpcQueryType::FreezeAllAgents => {
            handle_freeze_all_agents(request, app_state, command_tx).await
        }
    }
}

// =============================================================================
// 狀態查詢處理器
// =============================================================================

fn handle_get_worker_status(request: &IpcRequest, app_state: &Arc<AppState>) -> IpcResponse {
    let agent_id = match request.params.get("agentId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing agentId parameter".to_string(),
            )
        }
    };

    let agents = app_state.agents.read().unwrap();

    match agents.get(agent_id) {
        Some(agent) => {
            let status_str = match &agent.status {
                AgentStatus::Idle => "idle",
                AgentStatus::Running => "running",
                AgentStatus::WaitingHitl => "waiting_hitl",
                AgentStatus::Error(_) => "error",
                AgentStatus::Frozen => "frozen",
            };

            IpcResponse::success(
                request.ipc_request_id.clone(),
                json!({
                    "id": agent.id,
                    "status": status_str,
                    "model": agent.model,
                    "projectId": agent.project_id,
                    "priority": agent.priority,
                    "sessionId": agent.session_id,
                }),
            )
        }
        None => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Agent not found: {}", agent_id),
        ),
    }
}

fn handle_get_quota_status(request: &IpcRequest, app_state: &Arc<AppState>) -> IpcResponse {
    let quota = app_state.quota.read().unwrap();

    IpcResponse::success(
        request.ipc_request_id.clone(),
        json!({
            "tier1_available": quota.tier1_available,
            "tier2_available": quota.tier2_available,
            "tier3_available": quota.tier3_available,
        }),
    )
}

fn handle_get_git_snapshot(request: &IpcRequest, app_state: &Arc<AppState>) -> IpcResponse {
    let agent_id = match request.params.get("agentId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing agentId parameter".to_string(),
            )
        }
    };

    // TODO: 整合 Git 模組（Task 08）取得實際快照
    // 目前回傳 stub 資料
    let _agents = app_state.agents.read().unwrap();

    IpcResponse::success(
        request.ipc_request_id.clone(),
        json!({
            "agentId": agent_id,
            "sha": null,
            "timestamp": null,
            "nodeId": null,
            "message": "Git snapshot not yet implemented (Task 08)"
        }),
    )
}

fn handle_get_b_mode_status(request: &IpcRequest, app_state: &Arc<AppState>) -> IpcResponse {
    let enabled = app_state.is_b_mode_enabled();

    IpcResponse::success(
        request.ipc_request_id.clone(),
        json!({
            "enabled": enabled
        }),
    )
}

// =============================================================================
// State MCP 控制操作處理器
// =============================================================================

async fn handle_assign_task(
    request: &IpcRequest,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    // 解析參數
    let agent_id = match request.params.get("agentId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing agentId parameter".to_string(),
            )
        }
    };

    let prompt = match request.params.get("prompt").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing prompt parameter".to_string(),
            )
        }
    };

    let max_turns = request
        .params
        .get("maxTurns")
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as u32;

    // 發送 agent:assign 指令至 Node.js
    let cmd = RustCommand::AgentAssign {
        agent_id,
        prompt,
        max_turns,
    };

    match command_tx.send(cmd).await {
        Ok(_) => IpcResponse::success(request.ipc_request_id.clone(), json!({ "ok": true })),
        Err(e) => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Failed to send command: {}", e),
        ),
    }
}

async fn handle_pause_worker(
    request: &IpcRequest,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    let agent_id = match request.params.get("agentId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing agentId parameter".to_string(),
            )
        }
    };

    // 從參數讀取 reason 和 immediate（符合 Spec: reason: orchestrator, immediate: true）
    let reason = match request.params.get("reason").and_then(|v| v.as_str()) {
        Some("quota") => FreezeReason::Quota,
        Some("human") => FreezeReason::Human,
        _ => FreezeReason::Orchestrator, // 預設為 orchestrator
    };

    let immediate = request
        .params
        .get("immediate")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let cmd = RustCommand::AgentFreeze {
        agent_id,
        reason,
        immediate,
    };

    match command_tx.send(cmd).await {
        Ok(_) => IpcResponse::success(request.ipc_request_id.clone(), json!({ "ok": true })),
        Err(e) => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Failed to send command: {}", e),
        ),
    }
}

async fn handle_resume_worker(
    request: &IpcRequest,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    let agent_id = match request.params.get("agentId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing agentId parameter".to_string(),
            )
        }
    };

    let reason = match request.params.get("reason").and_then(|v| v.as_str()) {
        Some("quota") => FreezeReason::Quota,
        Some("human") => FreezeReason::Human,
        _ => FreezeReason::Orchestrator,
    };

    let cmd = RustCommand::AgentUnfreeze { agent_id, reason };

    match command_tx.send(cmd).await {
        Ok(_) => IpcResponse::success(request.ipc_request_id.clone(), json!({ "ok": true })),
        Err(e) => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Failed to send command: {}", e),
        ),
    }
}

async fn handle_approve_hitl(
    request: &IpcRequest,
    app_state: &Arc<AppState>,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    // B mode 檢查：B mode 關閉時不允許自動審批
    // 注意：這個檢查在 Node.js 層也有，但 Rust 層做第二道防線
    if !app_state.is_b_mode_enabled() {
        return IpcResponse::error(
            request.ipc_request_id.clone(),
            "B mode is disabled. HITL approval requires human intervention.".to_string(),
        );
    }

    let request_id = match request.params.get("requestId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing requestId parameter".to_string(),
            )
        }
    };

    let modified_input = request.params.get("modifiedInput").cloned();

    let cmd = RustCommand::HitlResponse {
        request_id,
        approved: true,
        modified_input,
        reason: None,
    };

    match command_tx.send(cmd).await {
        Ok(_) => IpcResponse::success(request.ipc_request_id.clone(), json!({ "ok": true })),
        Err(e) => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Failed to send command: {}", e),
        ),
    }
}

async fn handle_deny_hitl(
    request: &IpcRequest,
    app_state: &Arc<AppState>,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    // B mode 檢查
    if !app_state.is_b_mode_enabled() {
        return IpcResponse::error(
            request.ipc_request_id.clone(),
            "B mode is disabled. HITL denial requires human intervention.".to_string(),
        );
    }

    let request_id = match request.params.get("requestId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return IpcResponse::error(
                request.ipc_request_id.clone(),
                "Missing requestId parameter".to_string(),
            )
        }
    };

    let reason = request
        .params
        .get("reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let cmd = RustCommand::HitlResponse {
        request_id,
        approved: false,
        modified_input: None,
        reason,
    };

    match command_tx.send(cmd).await {
        Ok(_) => IpcResponse::success(request.ipc_request_id.clone(), json!({ "ok": true })),
        Err(e) => IpcResponse::error(
            request.ipc_request_id.clone(),
            format!("Failed to send command: {}", e),
        ),
    }
}

// =============================================================================
// Quota 管理操作處理器（Task 10）
// =============================================================================

/// 凍結所有 Agent
///
/// 當配額耗盡時，Node.js QuotaManager 會呼叫此函數。
/// 遍歷所有已註冊的 Agent 並發送 agent:freeze 指令。
///
/// 參數：
/// - reason: 凍結原因（預設 "quota"）
/// - immediate: 是否立即凍結（預設 false，等待當前 turn 完成）
async fn handle_freeze_all_agents(
    request: &IpcRequest,
    app_state: &Arc<AppState>,
    command_tx: &mpsc::Sender<RustCommand>,
) -> IpcResponse {
    // 解析 immediate 參數（配額凍結預設 false，等待當前 turn 完成）
    let immediate = request
        .params
        .get("immediate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // 取得所有 Agent ID
    let agent_ids: Vec<String> = {
        let agents = app_state.agents.read().unwrap();
        agents.keys().cloned().collect()
    };

    if agent_ids.is_empty() {
        return IpcResponse::success(
            request.ipc_request_id.clone(),
            json!({ "ok": true, "frozenCount": 0 }),
        );
    }

    let mut frozen_count = 0;
    let mut errors: Vec<String> = Vec::new();

    // 對每個 Agent 發送 freeze 指令
    for agent_id in agent_ids {
        let cmd = RustCommand::AgentFreeze {
            agent_id: agent_id.clone(),
            reason: FreezeReason::Quota,
            immediate,
        };

        match command_tx.send(cmd).await {
            Ok(_) => {
                frozen_count += 1;
            }
            Err(e) => {
                errors.push(format!("Failed to freeze {}: {}", agent_id, e));
            }
        }
    }

    if errors.is_empty() {
        IpcResponse::success(
            request.ipc_request_id.clone(),
            json!({ "ok": true, "frozenCount": frozen_count }),
        )
    } else {
        // 部分成功，回報錯誤但仍標記為成功
        IpcResponse::success(
            request.ipc_request_id.clone(),
            json!({
                "ok": true,
                "frozenCount": frozen_count,
                "errors": errors
            }),
        )
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::Value;

    fn create_test_request(query: IpcQueryType, params: Value) -> IpcRequest {
        IpcRequest {
            msg_type: "ipc:query".to_string(),
            ipc_request_id: "test-req-123".to_string(),
            query,
            params,
        }
    }

    #[test]
    fn get_b_mode_status_returns_disabled_by_default() {
        let app_state = Arc::new(AppState::new());
        let request = create_test_request(IpcQueryType::GetBModeStatus, json!({}));

        let response = handle_get_b_mode_status(&request, &app_state);

        assert!(response.ok);
        assert_eq!(
            response.data.unwrap().get("enabled").unwrap(),
            &Value::Bool(false)
        );
    }

    #[test]
    fn get_b_mode_status_returns_enabled_when_set() {
        let app_state = Arc::new(AppState::new());
        app_state.set_b_mode(true);
        let request = create_test_request(IpcQueryType::GetBModeStatus, json!({}));

        let response = handle_get_b_mode_status(&request, &app_state);

        assert!(response.ok);
        assert_eq!(
            response.data.unwrap().get("enabled").unwrap(),
            &Value::Bool(true)
        );
    }

    #[test]
    fn get_quota_status_returns_default_values() {
        let app_state = Arc::new(AppState::new());
        let request = create_test_request(IpcQueryType::GetQuotaStatus, json!({}));

        let response = handle_get_quota_status(&request, &app_state);

        assert!(response.ok);
        let data = response.data.unwrap();
        assert_eq!(data.get("tier1_available").unwrap(), &json!(10));
        assert_eq!(data.get("tier2_available").unwrap(), &json!(50));
        assert_eq!(data.get("tier3_available").unwrap(), &json!(100));
    }

    #[test]
    fn get_worker_status_returns_error_for_missing_agent() {
        let app_state = Arc::new(AppState::new());
        let request =
            create_test_request(IpcQueryType::GetWorkerStatus, json!({"agentId": "unknown"}));

        let response = handle_get_worker_status(&request, &app_state);

        assert!(!response.ok);
        assert!(response.error.unwrap().contains("not found"));
    }

    #[test]
    fn get_worker_status_returns_error_for_missing_param() {
        let app_state = Arc::new(AppState::new());
        let request = create_test_request(IpcQueryType::GetWorkerStatus, json!({}));

        let response = handle_get_worker_status(&request, &app_state);

        assert!(!response.ok);
        assert!(response.error.unwrap().contains("Missing agentId"));
    }
}
