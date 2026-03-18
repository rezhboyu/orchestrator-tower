//! State Rebuild - AgentState 從 TaskState JSON 重建
//!
//! Task 15 產出

use crate::state::AgentState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// =============================================================================
// TaskState (對應 Node.js 端的 TaskState)
// =============================================================================

/// TaskState JSON 結構
///
/// 路徑：~/.orchestrator/projects/{projectId}/tasks/{taskId}.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub version: u32,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub prompt: String,
    #[serde(rename = "lastCompletedNodeId")]
    pub last_completed_node_id: Option<String>,
    #[serde(rename = "lastGitSha")]
    pub last_git_sha: Option<String>,
    #[serde(rename = "lastSessionId")]
    pub last_session_id: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

// =============================================================================
// Path Utilities
// =============================================================================

/// 取得 ~/.orchestrator 目錄路徑
pub fn get_orchestrator_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Failed to get home directory")
        .join(".orchestrator")
}

/// 取得專案 tasks 目錄路徑
pub fn get_tasks_dir(project_id: &str) -> PathBuf {
    get_orchestrator_dir()
        .join("projects")
        .join(project_id)
        .join("tasks")
}

/// 取得 TaskState JSON 檔案路徑
pub fn get_task_state_path(project_id: &str, task_id: &str) -> PathBuf {
    get_tasks_dir(project_id).join(format!("{}.json", task_id))
}

// =============================================================================
// State Rebuild
// =============================================================================

/// 讀取 TaskState JSON
///
/// # Arguments
/// * `path` - TaskState JSON 檔案路徑
///
/// # Returns
/// TaskState 或 None（若檔案不存在或格式錯誤）
pub fn read_task_state(path: &Path) -> Option<TaskState> {
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(state) => Some(state),
            Err(e) => {
                eprintln!("[Recovery] Failed to parse TaskState JSON: {}", e);
                None
            }
        },
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                None
            } else {
                eprintln!("[Recovery] Failed to read TaskState JSON: {}", e);
                None
            }
        }
    }
}

/// 列出專案所有 TaskState
///
/// # Arguments
/// * `project_id` - 專案 ID
///
/// # Returns
/// TaskState 列表，按 updatedAt 降序排列
pub fn list_task_states(project_id: &str) -> Vec<TaskState> {
    let dir = get_tasks_dir(project_id);

    if !dir.exists() {
        return vec![];
    }

    let mut states: Vec<TaskState> = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map_or(false, |ext| ext == "json")
        })
        .filter_map(|entry| read_task_state(&entry.path()))
        .collect();

    // 按 updatedAt 降序排列
    states.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    states
}

/// 從 TaskState 重建 AgentState
///
/// # Arguments
/// * `task_state` - TaskState
/// * `worktree_path` - Worktree 路徑
/// * `tower_port` - Tower MCP Server port
///
/// # Returns
/// AgentState
pub fn rebuild_agent_state(
    task_state: &TaskState,
    worktree_path: PathBuf,
    tower_port: u16,
) -> AgentState {
    use crate::state::AgentStatus;

    AgentState {
        id: task_state.agent_id.clone(),
        project_id: task_state.project_id.clone(),
        worktree_path,
        status: AgentStatus::Idle, // 重建後設為 Idle，等待重新啟動
        session_id: task_state.last_session_id.clone(),
        model: String::new(), // 需要從其他來源獲取
        tower_port,
        priority: 0,
        worker_pid: None, // 重建後無 PID
        task_id: Some(task_state.task_id.clone()),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn create_test_task_state() -> TaskState {
        TaskState {
            version: 1,
            task_id: "task-123".to_string(),
            agent_id: "agent-456".to_string(),
            project_id: "project-789".to_string(),
            prompt: "Test prompt".to_string(),
            last_completed_node_id: Some("node-001".to_string()),
            last_git_sha: Some("abc123".to_string()),
            last_session_id: Some("session-xyz".to_string()),
            started_at: 1709900000000,
            updated_at: 1709900001000,
        }
    }

    #[test]
    fn read_task_state_parses_correctly() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("task-123.json");

        let state = create_test_task_state();
        let json = serde_json::to_string_pretty(&state).unwrap();
        fs::write(&file_path, json).unwrap();

        let read_state = read_task_state(&file_path);
        assert!(read_state.is_some());

        let read_state = read_state.unwrap();
        assert_eq!(read_state.task_id, "task-123");
        assert_eq!(read_state.agent_id, "agent-456");
        assert_eq!(read_state.project_id, "project-789");
        assert_eq!(
            read_state.last_session_id,
            Some("session-xyz".to_string())
        );
    }

    #[test]
    fn read_task_state_returns_none_for_missing_file() {
        let result = read_task_state(Path::new("/nonexistent/path/task.json"));
        assert!(result.is_none());
    }

    #[test]
    fn rebuild_agent_state_creates_correct_state() {
        let task_state = create_test_task_state();
        let worktree_path = PathBuf::from("/tmp/worktree");

        let agent_state = rebuild_agent_state(&task_state, worktree_path.clone(), 3701);

        assert_eq!(agent_state.id, "agent-456");
        assert_eq!(agent_state.project_id, "project-789");
        assert_eq!(agent_state.worktree_path, worktree_path);
        assert_eq!(
            agent_state.session_id,
            Some("session-xyz".to_string())
        );
        assert_eq!(agent_state.task_id, Some("task-123".to_string()));
        assert!(agent_state.worker_pid.is_none());
    }

    #[test]
    fn task_state_path_format() {
        let path = get_task_state_path("proj-001", "task-002");
        assert!(path.to_string_lossy().contains("projects"));
        assert!(path.to_string_lossy().contains("proj-001"));
        assert!(path.to_string_lossy().contains("tasks"));
        assert!(path.to_string_lossy().contains("task-002.json"));
    }
}
