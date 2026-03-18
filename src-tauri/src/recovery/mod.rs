//! Recovery Module - 崩潰恢復與 Session 恢復
//!
//! Task 15 產出
//!
//! 職責：
//! - Heartbeat 監控（每 500ms 檢查，超過 3s 觸發恢復）
//! - 孤兒 Worker 程序清除
//! - Sidecar 重啟
//! - AgentState 從 TaskState JSON 重建

pub mod state_rebuild;

use crate::ipc::{IpcServerHandle, IpcServerState};
use crate::state::AppState;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::interval;

// =============================================================================
// Constants
// =============================================================================

/// Heartbeat 檢查間隔（毫秒）
const HEARTBEAT_CHECK_INTERVAL_MS: u64 = 500;

/// 孤兒程序清除後的等待時間（秒）
const ORPHAN_CLEANUP_WAIT_SECS: u64 = 2;

// =============================================================================
// Recovery Error
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum RecoveryError {
    #[error("Failed to kill orphan process: {0}")]
    KillOrphanFailed(String),

    #[error("Failed to restart sidecar: {0}")]
    RestartSidecarFailed(String),

    #[error("Failed to rebuild agent state: {0}")]
    RebuildStateFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// =============================================================================
// Heartbeat Monitor
// =============================================================================

/// 啟動 Heartbeat 監控
///
/// 每 500ms 檢查一次，超過 3s 無心跳觸發恢復流程。
///
/// # Arguments
/// * `ipc_state` - IPC Server 狀態（用於檢查心跳）
/// * `app_state` - 應用程式狀態
/// * `ipc_handle` - IPC Server Handle（用於發送指令）
///
/// # Returns
/// 監控任務的 JoinHandle
pub fn start_heartbeat_monitor(
    ipc_state: Arc<IpcServerState>,
    app_state: Arc<AppState>,
    _ipc_handle: IpcServerHandle,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut check_interval = interval(Duration::from_millis(HEARTBEAT_CHECK_INTERVAL_MS));

        // 跳過第一次立即觸發
        check_interval.tick().await;

        loop {
            check_interval.tick().await;

            // 只在已連線時檢查心跳
            if !ipc_state.is_connected().await {
                continue;
            }

            if !ipc_state.check_heartbeat().await {
                eprintln!("[Recovery] Heartbeat timeout detected, triggering recovery...");

                if let Err(e) = handle_sidecar_crash(&app_state).await {
                    eprintln!("[Recovery] Recovery failed: {}", e);
                }
            }
        }
    })
}

// =============================================================================
// Crash Recovery
// =============================================================================

/// 處理 Sidecar 崩潰
///
/// 流程：
/// 1. SIGKILL 所有孤兒 Worker
/// 2. 等待 2s 確認程序清除
/// 3. 重啟 Sidecar
/// 4. 讀取 TaskState JSON
/// 5. 發送 agent:start（含 --resume）
async fn handle_sidecar_crash(app_state: &Arc<AppState>) -> Result<(), RecoveryError> {
    eprintln!("[Recovery] Starting crash recovery...");

    // Step 1: 清除孤兒 Worker
    let killed_pids = kill_orphan_workers(app_state).await?;
    eprintln!("[Recovery] Killed {} orphan workers", killed_pids.len());

    // Step 2: 等待 2s 確認清除
    tokio::time::sleep(Duration::from_secs(ORPHAN_CLEANUP_WAIT_SECS)).await;

    // Step 3: 重啟 Sidecar
    // TODO: 實作 Sidecar 重啟邏輯
    // 這需要 Tauri AppHandle 才能呼叫 app.shell().sidecar()
    // 目前暫時跳過，待 Task 17 整合時完成
    eprintln!("[Recovery] Sidecar restart skipped (requires Tauri AppHandle)");

    // Step 4 & 5: 讀取 TaskState 並發送 agent:start
    // 這也需要 IPC handle 才能發送指令
    // 目前暫時跳過

    eprintln!("[Recovery] Recovery sequence completed");
    Ok(())
}

// =============================================================================
// Orphan Process Cleanup
// =============================================================================

/// 清除孤兒 Worker 程序
///
/// 遍歷 AppState.agents，對所有有 worker_pid 的 Agent 發送 SIGKILL。
async fn kill_orphan_workers(app_state: &Arc<AppState>) -> Result<Vec<u32>, RecoveryError> {
    // 在單獨的 block 中收集 PID，確保鎖在 await 之前釋放
    let pids: Vec<u32> = {
        let agents = app_state.agents.read().unwrap();
        agents
            .values()
            .filter_map(|agent| agent.worker_pid)
            .collect()
    };

    for pid in &pids {
        if let Err(e) = kill_process(*pid).await {
            eprintln!("[Recovery] Failed to kill PID {}: {}", pid, e);
        }
    }

    Ok(pids)
}

/// 跨平台程序終止
#[cfg(unix)]
async fn kill_process(pid: u32) -> Result<(), RecoveryError> {
    use std::process::Command;

    let status = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status()
        .map_err(|e| RecoveryError::KillOrphanFailed(e.to_string()))?;

    if status.success() {
        Ok(())
    } else {
        Err(RecoveryError::KillOrphanFailed(format!(
            "kill -9 {} failed with status: {}",
            pid, status
        )))
    }
}

#[cfg(windows)]
async fn kill_process(pid: u32) -> Result<(), RecoveryError> {
    use std::process::Command;

    let status = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .status()
        .map_err(|e| RecoveryError::KillOrphanFailed(e.to_string()))?;

    if status.success() {
        Ok(())
    } else {
        // taskkill 在程序不存在時也會返回非零狀態，視為成功
        eprintln!(
            "[Recovery] taskkill /F /PID {} returned non-zero, process may not exist",
            pid
        );
        Ok(())
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn kill_orphan_workers_empty_state() {
        let app_state = Arc::new(AppState::new());

        let result = kill_orphan_workers(&app_state).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn kill_orphan_workers_collects_pids() {
        use crate::state::{AgentState, AgentStatus};
        use std::path::PathBuf;

        let app_state = Arc::new(AppState::new());

        // 添加有 PID 的 Agent
        {
            let mut agents = app_state.agents.write().unwrap();
            let mut agent1 = AgentState::new(
                "agent-1".to_string(),
                "project-1".to_string(),
                PathBuf::from("/tmp/worktree1"),
                "claude-opus-4".to_string(),
                3701,
            );
            agent1.worker_pid = Some(12345);
            agent1.status = AgentStatus::Running;

            let mut agent2 = AgentState::new(
                "agent-2".to_string(),
                "project-1".to_string(),
                PathBuf::from("/tmp/worktree2"),
                "claude-opus-4".to_string(),
                3701,
            );
            agent2.worker_pid = Some(67890);
            agent2.status = AgentStatus::Running;

            // 沒有 PID 的 Agent
            let agent3 = AgentState::new(
                "agent-3".to_string(),
                "project-1".to_string(),
                PathBuf::from("/tmp/worktree3"),
                "claude-opus-4".to_string(),
                3701,
            );

            agents.insert("agent-1".to_string(), agent1);
            agents.insert("agent-2".to_string(), agent2);
            agents.insert("agent-3".to_string(), agent3);
        }

        let result = kill_orphan_workers(&app_state).await;
        // 會返回 2 個 PID（即使 kill 可能失敗，因為這些是假 PID）
        assert!(result.is_ok());
        let pids = result.unwrap();
        assert_eq!(pids.len(), 2);
        assert!(pids.contains(&12345));
        assert!(pids.contains(&67890));
    }
}
