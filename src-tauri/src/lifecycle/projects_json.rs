//! projects.json 原子讀寫
//!
//! 路徑：`~/.orchestrator/projects.json`
//!
//! 寫入策略：
//! 1. 取得 ~/.orchestrator/projects.json.lock 的 exclusive file lock（fs2）
//! 2. 寫入 ~/.orchestrator/projects.json.tmp
//! 3. std::fs::rename（同一 filesystem，atomic）
//! 4. lock 在 lock_file drop 時自動釋放
//!
//! 提供 `_in(base)` 版本供測試時指定自訂目錄，避免汙染真實 ~/.orchestrator。

use crate::lifecycle::LifecycleError;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// =============================================================================
// Types
// =============================================================================

/// 單一專案記錄
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

/// projects.json 檔案結構
#[derive(Debug, Serialize, Deserialize)]
struct ProjectsFile {
    version: u32,
    projects: Vec<Project>,
}

// =============================================================================
// Directory helpers
// =============================================================================

/// 回傳預設 orchestrator 目錄（~/.orchestrator）
pub fn default_orchestrator_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".orchestrator")
}

// =============================================================================
// Public API（使用預設目錄）
// =============================================================================

/// 讀取 ~/.orchestrator/projects.json，不存在時回傳空陣列
pub fn read_projects() -> Result<Vec<Project>, LifecycleError> {
    read_projects_in(&default_orchestrator_dir())
}

/// 原子寫入 ~/.orchestrator/projects.json
pub fn write_projects(projects: &[Project]) -> Result<(), LifecycleError> {
    write_projects_in(&default_orchestrator_dir(), projects)
}

// =============================================================================
// Testable implementation（接受自訂 base 目錄）
// =============================================================================

/// 讀取 {base}/projects.json，不存在時回傳空陣列
pub fn read_projects_in(base: &Path) -> Result<Vec<Project>, LifecycleError> {
    let path = base.join("projects.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)?;
    let file: ProjectsFile = serde_json::from_str(&content)?;
    Ok(file.projects)
}

/// 原子寫入 {base}/projects.json
///
/// 流程：exclusive lock → 寫 .tmp → rename
pub fn write_projects_in(base: &Path, projects: &[Project]) -> Result<(), LifecycleError> {
    fs::create_dir_all(base)?;

    let json_path = base.join("projects.json");
    let tmp_path = base.join("projects.json.tmp");
    let lock_path = base.join("projects.json.lock");

    // 取得 exclusive lock
    let lock_file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&lock_path)?;
    lock_file.lock_exclusive()?;

    // 寫入 tmp
    let file = ProjectsFile {
        version: 1,
        projects: projects.to_vec(),
    };
    let content = serde_json::to_string_pretty(&file)?;
    fs::write(&tmp_path, &content)?;

    // atomic rename
    fs::rename(&tmp_path, &json_path)?;

    // lock_file drop → 自動釋放 lock
    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

// TODO: [TEST ENV] cargo test lifecycle:: 需要 libgtk-3-dev + libwebkit2gtk-4.1-dev。
// 在未安裝 Tauri 系統依賴的 CI 環境中，測試無法編譯（build script 強制 link GTK）。
// 本地開發環境安裝依賴後可執行：
//   sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev
//   cargo test --manifest-path src-tauri/Cargo.toml lifecycle::
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_project(id: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/tmp/{}", id),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn read_returns_empty_when_file_missing() {
        let dir = tempdir().unwrap();
        let projects = read_projects_in(dir.path()).unwrap();
        assert!(projects.is_empty());
    }

    #[test]
    fn write_and_read_round_trip() {
        let dir = tempdir().unwrap();
        let expected = vec![make_project("p1", "my-app")];
        write_projects_in(dir.path(), &expected).unwrap();
        let got = read_projects_in(dir.path()).unwrap();
        assert_eq!(got, expected);
    }

    #[test]
    fn write_is_idempotent() {
        let dir = tempdir().unwrap();
        let p1 = vec![make_project("p1", "app1")];
        write_projects_in(dir.path(), &p1).unwrap();
        let p2 = vec![make_project("p1", "app1"), make_project("p2", "app2")];
        write_projects_in(dir.path(), &p2).unwrap();
        let got = read_projects_in(dir.path()).unwrap();
        assert_eq!(got.len(), 2);
    }

    #[tokio::test]
    async fn concurrent_project_writes_no_corruption() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();

        // 5 個 task 同時建立不同 project，確認 projects.json 不損壞
        let handles: Vec<_> = (0..5u32)
            .map(|i| {
                let b = base.clone();
                tokio::spawn(async move {
                    // 讀取現有 → 新增 → 寫入（帶 lock 保護）
                    let mut projects = read_projects_in(&b).unwrap_or_default();
                    projects.push(make_project(&format!("p{}", i), &format!("proj-{}", i)));
                    write_projects_in(&b, &projects)
                })
            })
            .collect();

        for h in handles {
            h.await.unwrap().unwrap();
        }

        // 讀回來的 JSON 必須合法（不損壞）
        let projects = read_projects_in(&base).unwrap();
        // 至少有 1 筆（因為 lock 保護，不應全部 0 筆）
        assert!(!projects.is_empty());
        // 所有 id 應該是合法的 p0..p4
        for p in &projects {
            assert!(p.id.starts_with('p'));
        }
    }
}
