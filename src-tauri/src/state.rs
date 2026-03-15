use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

/// Agent status representing the current state of an AI agent
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Running,
    WaitingHitl,
    Error(String),
    Frozen,
}

/// State of an individual AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub id: String,
    pub project_id: String,
    pub worktree_path: PathBuf,
    pub status: AgentStatus,
    pub session_id: Option<String>,
    pub model: String,
    pub tower_port: u16,
    pub priority: u32,
}

impl AgentState {
    // TODO: This function will be used in Task 05 (Worker Agent subprocess management)
    #[allow(dead_code)]
    pub fn new(
        id: String,
        project_id: String,
        worktree_path: PathBuf,
        model: String,
        tower_port: u16,
    ) -> Self {
        Self {
            id,
            project_id,
            worktree_path,
            status: AgentStatus::Idle,
            session_id: None,
            model,
            tower_port,
            priority: 0,
        }
    }
}

/// Quota state for rate limiting across different tiers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaState {
    pub tier1_available: u32,
    pub tier2_available: u32,
    pub tier3_available: u32,
}

impl Default for QuotaState {
    fn default() -> Self {
        Self {
            tier1_available: 10,
            tier2_available: 50,
            tier3_available: 100,
        }
    }
}

/// Main application state - the single source of truth
#[derive(Debug)]
pub struct AppState {
    pub agents: RwLock<HashMap<String, AgentState>>,
    pub tower_port: u16,
    pub state_port: u16,
    pub quota: RwLock<QuotaState>,
    /// B mode: Master Orchestrator 自動審批 HITL 請求（預設關閉）
    pub b_mode_enabled: RwLock<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            tower_port: 3701,
            state_port: 3702,
            quota: RwLock::new(QuotaState::default()),
            b_mode_enabled: RwLock::new(false),
        }
    }

    // TODO: This function will be used in Task 03 (IPC channel) for dynamic port allocation
    #[allow(dead_code)]
    pub fn with_ports(tower_port: u16, state_port: u16) -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            tower_port,
            state_port,
            quota: RwLock::new(QuotaState::default()),
            b_mode_enabled: RwLock::new(false),
        }
    }

    /// 取得 B mode 狀態
    pub fn is_b_mode_enabled(&self) -> bool {
        *self.b_mode_enabled.read().unwrap()
    }

    /// 設定 B mode 狀態
    #[allow(dead_code)]
    pub fn set_b_mode(&self, enabled: bool) {
        *self.b_mode_enabled.write().unwrap() = enabled;
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_status_serializes_correctly() {
        // Test each variant serializes to expected JSON
        assert_eq!(
            serde_json::to_string(&AgentStatus::Idle).unwrap(),
            "\"idle\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::WaitingHitl).unwrap(),
            "\"waiting_hitl\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Frozen).unwrap(),
            "\"frozen\""
        );

        // Error variant with message
        let error_status = AgentStatus::Error("connection failed".to_string());
        let serialized = serde_json::to_string(&error_status).unwrap();
        assert!(serialized.contains("error"));
        assert!(serialized.contains("connection failed"));
    }

    #[test]
    fn appstate_ports_default_values() {
        let state = AppState::new();

        // Ports must be > 1024 (non-privileged)
        assert!(state.tower_port > 1024, "tower_port must be > 1024");
        assert!(state.state_port > 1024, "state_port must be > 1024");

        // Ports must be different
        assert_ne!(
            state.tower_port, state.state_port,
            "tower_port and state_port must be different"
        );
    }

    #[test]
    fn agent_state_clone_is_independent() {
        let original = AgentState::new(
            "agent-1".to_string(),
            "project-1".to_string(),
            PathBuf::from("/tmp/worktree"),
            "claude-opus-4".to_string(),
            3701,
        );

        let mut cloned = original.clone();
        cloned.status = AgentStatus::Running;
        cloned.session_id = Some("session-123".to_string());

        // Original should be unchanged
        assert_eq!(original.status, AgentStatus::Idle);
        assert_eq!(original.session_id, None);

        // Cloned should have new values
        assert_eq!(cloned.status, AgentStatus::Running);
        assert_eq!(cloned.session_id, Some("session-123".to_string()));
    }
}
