//! IPC Messages - Rust ↔ Node.js 訊息型別定義
//!
//! 對應 Node.js 端的 `sidecar/src/ipc/messages.ts`

use serde::{Deserialize, Serialize};
use serde_json::Value;

// =============================================================================
// Node.js → Rust（上報事件）
// =============================================================================

/// 風險等級
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Critical,
    High,
    Medium,
    Low,
}

/// HITL 請求來源
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HitlSource {
    TowerMcp,
    AcpPermission,
}

/// Node.js → Rust 上報事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    #[serde(rename = "agent:session_start")]
    AgentSessionStart {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        model: String,
    },

    #[serde(rename = "agent:text")]
    AgentText {
        #[serde(rename = "agentId")]
        agent_id: String,
        text: String,
    },

    #[serde(rename = "agent:tool_use")]
    AgentToolUse {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "toolId")]
        tool_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: Value,
    },

    #[serde(rename = "agent:tool_result")]
    AgentToolResult {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: String,
        #[serde(rename = "isError")]
        is_error: bool,
    },

    #[serde(rename = "agent:session_end")]
    AgentSessionEnd {
        #[serde(rename = "agentId")]
        agent_id: String,
        subtype: String,
        #[serde(rename = "numTurns")]
        num_turns: u32,
        #[serde(rename = "totalCostUsd")]
        total_cost_usd: f64,
        usage: Value,
    },

    #[serde(rename = "agent:stream_delta")]
    AgentStreamDelta {
        #[serde(rename = "agentId")]
        agent_id: String,
        text: String,
    },

    #[serde(rename = "agent:crash")]
    AgentCrash {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        signal: Option<String>,
        #[serde(rename = "lastSessionId")]
        last_session_id: Option<String>,
        #[serde(rename = "lastToolUse")]
        last_tool_use: Option<Value>,
    },

    /// Agent 主動停止確認（回應 agent:stop 指令）
    #[serde(rename = "agent:stopped")]
    AgentStopped {
        #[serde(rename = "agentId")]
        agent_id: String,
    },

    #[serde(rename = "hitl:request")]
    HitlRequest {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: Value,
        #[serde(rename = "riskLevel")]
        risk_level: RiskLevel,
        source: HitlSource,
    },

    #[serde(rename = "heartbeat")]
    Heartbeat,
}

// =============================================================================
// Rust → Node.js（指令）
// =============================================================================

/// 凍結原因
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FreezeReason {
    Quota,
    Orchestrator,
    Human,
}

/// Rust → Node.js 指令
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RustCommand {
    #[serde(rename = "agent:start")]
    AgentStart {
        #[serde(rename = "agentId")]
        agent_id: String,
        prompt: String,
        model: String,
        #[serde(rename = "maxTurns")]
        max_turns: u32,
        #[serde(rename = "towerPort")]
        tower_port: u16,
        #[serde(rename = "worktreePath")]
        worktree_path: String,
    },

    #[serde(rename = "agent:stop")]
    AgentStop {
        #[serde(rename = "agentId")]
        agent_id: String,
    },

    #[serde(rename = "agent:assign")]
    AgentAssign {
        #[serde(rename = "agentId")]
        agent_id: String,
        prompt: String,
        #[serde(rename = "maxTurns")]
        max_turns: u32,
    },

    #[serde(rename = "agent:freeze")]
    AgentFreeze {
        #[serde(rename = "agentId")]
        agent_id: String,
        reason: FreezeReason,
        immediate: bool,
    },

    #[serde(rename = "agent:unfreeze")]
    AgentUnfreeze {
        #[serde(rename = "agentId")]
        agent_id: String,
        reason: FreezeReason,
    },

    #[serde(rename = "hitl:response")]
    HitlResponse {
        #[serde(rename = "requestId")]
        request_id: String,
        approved: bool,
        #[serde(rename = "modifiedInput", skip_serializing_if = "Option::is_none")]
        modified_input: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

// =============================================================================
// IPC Request/Response 配對機制
// =============================================================================

/// IPC 查詢類型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IpcQueryType {
    // 狀態查詢
    GetWorkerStatus,
    GetQuotaStatus,
    GetGitSnapshot,
    GetBModeStatus,

    // State MCP 控制操作（Task 07）
    AssignTask,
    PauseWorker,
    ResumeWorker,
    ApproveHitl,
    DenyHitl,

    // Quota 管理操作（Task 10）
    FreezeAllAgents,
}

/// IPC 查詢請求（來自 Node.js）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    #[serde(rename = "type")]
    pub msg_type: String, // 固定為 "ipc:query"
    #[serde(rename = "ipcRequestId")]
    pub ipc_request_id: String,
    pub query: IpcQueryType,
    pub params: Value,
}

/// IPC 查詢回應（發送至 Node.js）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    #[serde(rename = "type")]
    pub msg_type: String, // 固定為 "ipc:response"
    #[serde(rename = "ipcRequestId")]
    pub ipc_request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl IpcResponse {
    /// 建立成功回應
    pub fn success(ipc_request_id: String, data: Value) -> Self {
        Self {
            msg_type: "ipc:response".to_string(),
            ipc_request_id,
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    /// 建立失敗回應
    pub fn error(ipc_request_id: String, error: String) -> Self {
        Self {
            msg_type: "ipc:response".to_string(),
            ipc_request_id,
            ok: false,
            data: None,
            error: Some(error),
        }
    }
}

// =============================================================================
// 統一訊息類型（用於反序列化）
// =============================================================================

/// 從 Node.js 接收的訊息（可能是 SidecarEvent 或 IpcRequest）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IncomingMessage {
    Event(SidecarEvent),
    Query(IpcRequest),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_event_deserializes_correctly() {
        let json = r#"{"type":"agent:session_start","agentId":"a1","sessionId":"s1","model":"claude-opus-4"}"#;
        let event: SidecarEvent = serde_json::from_str(json).unwrap();

        match event {
            SidecarEvent::AgentSessionStart {
                agent_id,
                session_id,
                model,
            } => {
                assert_eq!(agent_id, "a1");
                assert_eq!(session_id, "s1");
                assert_eq!(model, "claude-opus-4");
            }
            _ => panic!("Wrong event type"),
        }
    }

    #[test]
    fn rust_command_serializes_correctly() {
        let cmd = RustCommand::AgentStart {
            agent_id: "a1".to_string(),
            prompt: "Hello".to_string(),
            model: "claude-opus-4".to_string(),
            max_turns: 10,
            tower_port: 3701,
            worktree_path: "/tmp/worktree".to_string(),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains(r#""type":"agent:start""#));
        assert!(json.contains(r#""agentId":"a1""#));
    }

    #[test]
    fn heartbeat_event_parses() {
        let json = r#"{"type":"heartbeat"}"#;
        let event: SidecarEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, SidecarEvent::Heartbeat));
    }

    #[test]
    fn hitl_request_with_risk_level() {
        let json = r#"{
            "type": "hitl:request",
            "agentId": "a1",
            "requestId": "r1",
            "toolName": "Bash",
            "input": {"command": "rm -rf /"},
            "riskLevel": "critical",
            "source": "tower-mcp"
        }"#;

        let event: SidecarEvent = serde_json::from_str(json).unwrap();

        match event {
            SidecarEvent::HitlRequest {
                risk_level, source, ..
            } => {
                assert_eq!(risk_level, RiskLevel::Critical);
                assert_eq!(source, HitlSource::TowerMcp);
            }
            _ => panic!("Wrong event type"),
        }
    }

    #[test]
    fn ipc_response_success() {
        let resp = IpcResponse::success(
            "req-123".to_string(),
            serde_json::json!({"status": "running"}),
        );

        assert!(resp.ok);
        assert!(resp.data.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn ipc_response_error() {
        let resp = IpcResponse::error("req-123".to_string(), "Not found".to_string());

        assert!(!resp.ok);
        assert!(resp.data.is_none());
        assert_eq!(resp.error, Some("Not found".to_string()));
    }
}
