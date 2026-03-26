//! 專案生命週期管理
//!
//! - `create_project`：驗證 Git repo、建目錄、初始化 DB、寫 projects.json
//! - `delete_project`：檢查無 running agent 後刪除目錄並更新 projects.json

use crate::db::{init_db, Database};
use crate::lifecycle::projects_json::{
    default_orchestrator_dir, read_projects_in, write_projects_in, Project,
};
use crate::lifecycle::LifecycleError;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;

// =============================================================================
// Public API（使用預設 orchestrator 目錄）
// =============================================================================

/// 建立新專案
///
/// 回傳 `(projectId, Database)` 供呼叫端將 DB 登記至 DatabaseRegistry。
pub async fn create_project(path: &str, name: &str) -> Result<(String, Database), LifecycleError> {
    create_project_in(path, name, &default_orchestrator_dir()).await
}

/// 刪除專案
///
/// `running_agent_ids`：目前該專案仍在執行的 agent ID 列表。
/// 非空時拒絕刪除，回傳 `AgentsStillRunning` 錯誤。
pub async fn delete_project(
    project_id: &str,
    running_agent_ids: &[String],
) -> Result<(), LifecycleError> {
    delete_project_in(project_id, running_agent_ids, &default_orchestrator_dir()).await
}

// =============================================================================
// Testable implementation（接受自訂 base 目錄）
// =============================================================================

/// 建立新專案（指定 orchestrator 根目錄）
pub async fn create_project_in(
    path: &str,
    name: &str,
    base: &Path,
) -> Result<(String, Database), LifecycleError> {
    let project_path = PathBuf::from(path);

    // 1. 驗證路徑存在
    if !project_path.exists() {
        return Err(LifecycleError::PathNotFound(path.to_string()));
    }

    // 2. 驗證為 Git repo
    let output = Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(&project_path)
        .output()
        .await?;

    if !output.status.success() {
        return Err(LifecycleError::NotAGitRepo(path.to_string()));
    }

    // 3. 生成 projectId（UUID v4）
    let project_id = Uuid::new_v4().to_string();

    // 4. 建立 {base}/projects/{id}/
    let project_dir = base.join("projects").join(&project_id);
    tokio::fs::create_dir_all(&project_dir).await?;

    // 5. 初始化 agent.db（WAL 模式，建 schema）
    let db_path = project_dir.join("agent.db");
    let db = init_db(&db_path).await?;

    // 6. atomic write 更新 projects.json
    let mut projects = read_projects_in(base)?;
    projects.push(Project {
        id: project_id.clone(),
        name: name.to_string(),
        path: path.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    write_projects_in(base, &projects)?;

    Ok((project_id, db))
}

/// 刪除專案（指定 orchestrator 根目錄）
pub async fn delete_project_in(
    project_id: &str,
    running_agent_ids: &[String],
    base: &Path,
) -> Result<(), LifecycleError> {
    // 1. 確認無 running agents
    if !running_agent_ids.is_empty() {
        return Err(LifecycleError::AgentsStillRunning(project_id.to_string()));
    }

    // 2. 刪除 {base}/projects/{id}/ 目錄
    let project_dir = base.join("projects").join(project_id);
    if project_dir.exists() {
        tokio::fs::remove_dir_all(&project_dir).await?;
    }

    // 3. atomic write 更新 projects.json（移除該專案）
    let projects: Vec<Project> = read_projects_in(base)?
        .into_iter()
        .filter(|p| p.id != project_id)
        .collect();
    write_projects_in(base, &projects)?;

    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 在 tempdir 中初始化 git repo
    async fn init_git_repo(dir: &Path) {
        Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .output()
            .await
            .expect("git init failed");
    }

    #[tokio::test]
    async fn create_project_writes_projects_json() {
        let base = tempdir().unwrap();
        let repo = tempdir().unwrap();
        init_git_repo(repo.path()).await;

        let (id, _db) =
            create_project_in(repo.path().to_str().unwrap(), "test", base.path())
                .await
                .unwrap();

        let projects = read_projects_in(base.path()).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "test");
        assert_eq!(projects[0].id, id);
    }

    #[tokio::test]
    async fn create_project_rejects_nonexistent_path() {
        let base = tempdir().unwrap();
        let err = create_project_in("/nonexistent/path", "test", base.path())
            .await
            .unwrap_err();
        assert!(matches!(err, LifecycleError::PathNotFound(_)));
    }

    #[tokio::test]
    async fn create_project_rejects_non_git_dir() {
        let base = tempdir().unwrap();
        let plain_dir = tempdir().unwrap(); // 不 init git

        let err = create_project_in(plain_dir.path().to_str().unwrap(), "test", base.path())
            .await
            .unwrap_err();
        assert!(matches!(err, LifecycleError::NotAGitRepo(_)));
    }

    #[tokio::test]
    async fn delete_project_rejects_running_agents() {
        let err = delete_project_in(
            "proj-1",
            &["agent-1".to_string()],
            &PathBuf::from("/tmp"),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("agents_still_running"));
    }

    #[tokio::test]
    async fn delete_project_removes_from_json() {
        let base = tempdir().unwrap();
        let repo = tempdir().unwrap();
        init_git_repo(repo.path()).await;

        let (id, _db) =
            create_project_in(repo.path().to_str().unwrap(), "app", base.path())
                .await
                .unwrap();

        delete_project_in(&id, &[], base.path()).await.unwrap();

        let projects = read_projects_in(base.path()).unwrap();
        assert!(projects.iter().all(|p| p.id != id));
    }
}
