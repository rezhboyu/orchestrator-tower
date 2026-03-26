//! 崩潰恢復模組
//!
//! 負責：
//! - 偵測 Sidecar 心跳超時（3 秒內）
//! - SIGKILL 所有孤兒 Worker 程序
//! - 重啟 Sidecar
//! - 從 Git SHA + SQLite 重建 AgentState
//! - 發送 agent:start --resume 至新 Sidecar

pub mod state_rebuild;

use crate::db::Database;
use crate::ipc::IpcServerHandle;
use crate::state::{AgentState, AgentStatus, AppState};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

// =============================================================================
// Constants
// =============================================================================

/// 心跳檢查間隔
const HEARTBEAT_CHECK_INTERVAL: Duration = Duration::from_millis(500);

/// 心跳超時閾值（3 秒）
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(3);

/// 孤兒程序清除後等待時間
const ORPHAN_CLEANUP_WAIT: Duration = Duration::from_secs(2);

/// Sidecar 重啟後等待連線時間
const SIDECAR_RECONNECT_TIMEOUT: Duration = Duration::from_secs(10);

// =============================================================================
// Error Types
// =============================================================================

#[derive(Error, Debug)]
pub enum RecoveryError {
    #[error("Heartbeat timeout detected")]
    HeartbeatTimeout,

    #[error("Failed to kill orphan process (pid={0}): {1}")]
    OrphanKillFailed(u32, String),

    #[error("Sidecar restart failed: {0}")]
    SidecarRestartFailed(String),

    #[error("State rebuild failed: {0}")]
    StateRebuildFailed(String),

    #[error("Database error: {0}")]
    DbError(#[from] crate::db::DbError),

    #[error("Git error: {0}")]
    GitError(#[from] crate::git::GitError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, RecoveryError>;

// =============================================================================
// CrashDetector
// =============================================================================

/// 崩潰偵測配置
#[derive(Debug, Clone)]
pub struct CrashDetectorConfig {
    pub check_interval: Duration,
    pub heartbeat_timeout: Duration,
    pub orphan_cleanup_wait: Duration,
    pub reconnect_timeout: Duration,
}

impl Default for CrashDetectorConfig {
    fn default() -> Self {
        Self {
            check_interval: HEARTBEAT_CHECK_INTERVAL,
            heartbeat_timeout: HEARTBEAT_TIMEOUT,
            orphan_cleanup_wait: ORPHAN_CLEANUP_WAIT,
            reconnect_timeout: SIDECAR_RECONNECT_TIMEOUT,
        }
    }
}

/// 心跳監控任務
///
/// 每 500ms 檢查一次心跳。若超過 3 秒未收到，觸發恢復流程。
/// 此函式設計為在 `tokio::spawn` 中長期執行。
pub async fn start_heartbeat_monitor(
    ipc_handle: IpcServerHandle,
    app_state: Arc<AppState>,
    config: CrashDetectorConfig,
) {
    // 等待初始連線
    loop {
        if ipc_handle.is_connected().await {
            break;
        }
        tokio::time::sleep(config.check_interval).await;
    }

    println!("[Recovery] Heartbeat monitor started");

    loop {
        tokio::time::sleep(config.check_interval).await;

        // 只在已連線狀態下檢查心跳
        if !ipc_handle.is_connected().await {
            // Sidecar 未連線，等待重連
            continue;
        }

        if !ipc_handle.is_heartbeat_ok().await {
            println!("[Recovery] Heartbeat timeout detected! Starting recovery...");

            // 執行恢復流程
            if let Err(e) = handle_sidecar_crash(&app_state, &config).await {
                eprintln!("[Recovery] Recovery failed: {}", e);
            }

            // 恢復後等待重新連線
            println!("[Recovery] Waiting for Sidecar reconnection...");
            let deadline = tokio::time::Instant::now() + config.reconnect_timeout;
            loop {
                if ipc_handle.is_connected().await {
                    println!("[Recovery] Sidecar reconnected");
                    break;
                }
                if tokio::time::Instant::now() > deadline {
                    eprintln!("[Recovery] Sidecar reconnection timeout");
                    break;
                }
                tokio::time::sleep(config.check_interval).await;
            }
        }
    }
}

// =============================================================================
// Recovery Flow
// =============================================================================

/// Sidecar 崩潰後的恢復流程
///
/// 步驟：
/// 1. 收集所有活躍 Agent 的 PID
/// 2. SIGKILL 所有孤兒 Worker 程序
/// 3. 等待清除完成
/// 4. 將所有 Agent 標記為 Error 狀態
async fn handle_sidecar_crash(
    app_state: &Arc<AppState>,
    config: &CrashDetectorConfig,
) -> Result<()> {
    println!("[Recovery] Step 1: Collecting orphan worker PIDs...");

    // 從 AppState 讀取所有活躍 Agent
    let agent_snapshots: Vec<AgentState> = {
        let agents = app_state.agents.read().map_err(|e| {
            RecoveryError::StateRebuildFailed(format!("Failed to read agents: {}", e))
        })?;
        agents
            .values()
            .filter(|a| matches!(a.status, AgentStatus::Running | AgentStatus::WaitingHitl))
            .cloned()
            .collect()
    };

    let agent_count = agent_snapshots.len();
    println!("[Recovery] Found {} active agents to clean up", agent_count);

    // Step 2: Kill orphan workers
    // 注意：實際的 PID 追蹤在 Node.js Sidecar 層
    // Rust 不直接持有 Worker PID（架構約束：Rust 不管理 child process）
    // 這裡透過系統級方式清理（查找 claude/gemini 程序）
    println!("[Recovery] Step 2: Killing orphan worker processes...");
    kill_orphan_workers().await;

    // Step 3: 等待孤兒清除
    println!("[Recovery] Step 3: Waiting {}s for cleanup...", config.orphan_cleanup_wait.as_secs());
    tokio::time::sleep(config.orphan_cleanup_wait).await;

    // Step 4: 更新所有 Agent 狀態為 Error
    println!("[Recovery] Step 4: Updating agent states...");
    {
        let mut agents = app_state.agents.write().map_err(|e| {
            RecoveryError::StateRebuildFailed(format!("Failed to write agents: {}", e))
        })?;
        for agent in agents.values_mut() {
            if matches!(agent.status, AgentStatus::Running | AgentStatus::WaitingHitl) {
                agent.status = AgentStatus::Error("sidecar_crash".to_string());
            }
        }
    }

    println!("[Recovery] Recovery steps completed. Waiting for Sidecar restart...");
    Ok(())
}

/// 殺死所有孤兒 Worker 程序
///
/// 在 Sidecar 崩潰後，Worker 程序（claude / gemini CLI）
/// 會變成孤兒，需要清除。
///
/// 策略：使用 pkill 殺死相關程序
async fn kill_orphan_workers() {
    // Unix: 使用 pkill 殺死 claude 和 gemini 子程序
    #[cfg(unix)]
    {
        use tokio::process::Command;

        // 殺死 claude CLI 相關程序
        let _ = Command::new("pkill")
            .args(["-9", "-f", "claude.*--output-format.*stream-json"])
            .output()
            .await;

        // 殺死 gemini CLI 相關程序
        let _ = Command::new("pkill")
            .args(["-9", "-f", "gemini.*--experimental-acp"])
            .output()
            .await;
    }

    // Windows: 使用 taskkill
    #[cfg(windows)]
    {
        use tokio::process::Command;

        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "claude.exe"])
            .output()
            .await;

        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "gemini.cmd"])
            .output()
            .await;
    }
}

/// 從 Git SHA 和 SQLite 重建 Agent 狀態
///
/// 用於 Sidecar 重啟後恢復 Agent 狀態。
pub async fn rebuild_agents_from_db(
    app_state: &Arc<AppState>,
    db: &Database,
) -> Result<Vec<AgentRecoveryInfo>> {
    let agents_to_recover: Vec<AgentState> = {
        let agents = app_state.agents.read().map_err(|e| {
            RecoveryError::StateRebuildFailed(format!("Failed to read agents: {}", e))
        })?;
        agents
            .values()
            .filter(|a| matches!(a.status, AgentStatus::Error(ref msg) if msg == "sidecar_crash"))
            .cloned()
            .collect()
    };

    let mut recovery_infos = Vec::new();

    for agent in &agents_to_recover {
        match state_rebuild::rebuild_agent_state(
            &agent.id,
            &agent.project_id,
            db,
            &agent.worktree_path,
        )
        .await
        {
            Ok(info) => {
                recovery_infos.push(info);
            }
            Err(e) => {
                eprintln!(
                    "[Recovery] Failed to rebuild state for agent {}: {}",
                    agent.id, e
                );
            }
        }
    }

    Ok(recovery_infos)
}

/// Agent 恢復資訊（用於 Sidecar 重啟後發送 agent:start）
#[derive(Debug, Clone)]
pub struct AgentRecoveryInfo {
    pub agent_id: String,
    pub project_id: String,
    pub model: String,
    pub session_id: Option<String>,
    pub last_git_sha: Option<String>,
    pub last_completed_node_id: Option<String>,
    pub reasoning_node_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_detector_config_defaults() {
        let config = CrashDetectorConfig::default();
        assert_eq!(config.check_interval, Duration::from_millis(500));
        assert_eq!(config.heartbeat_timeout, Duration::from_secs(3));
        assert_eq!(config.orphan_cleanup_wait, Duration::from_secs(2));
        assert_eq!(config.reconnect_timeout, Duration::from_secs(10));
    }

    #[test]
    fn recovery_error_display() {
        let err = RecoveryError::HeartbeatTimeout;
        assert_eq!(err.to_string(), "Heartbeat timeout detected");

        let err = RecoveryError::OrphanKillFailed(1234, "Permission denied".to_string());
        assert!(err.to_string().contains("1234"));
    }
}
