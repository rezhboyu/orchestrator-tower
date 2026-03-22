//! projects.json 原子讀寫
//!
//! 路徑：~/.orchestrator/projects.json
//! 使用 temp file + rename 確保原子寫入
//! 使用 fs2 file lock 確保並發安全

use super::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// projects.json 頂層結構
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectsFile {
    pub version: u32,
    pub projects: Vec<ProjectEntry>,
}

impl Default for ProjectsFile {
    fn default() -> Self {
        Self {
            version: 1,
            projects: Vec::new(),
        }
    }
}

/// 單一專案條目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String, // ISO 8601
}

/// 取得 ~/.orchestrator/ 目錄路徑
fn orchestrator_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".orchestrator")
}

/// 取得 projects.json 路徑
pub fn projects_json_path() -> PathBuf {
    orchestrator_dir().join("projects.json")
}

/// 取得專案資料目錄：~/.orchestrator/projects/{id}/
pub fn project_data_dir(project_id: &str) -> PathBuf {
    orchestrator_dir().join("projects").join(project_id)
}

/// 取得 lock 檔路徑（獨立於 projects.json，避免 rename 導致 inode 變更使 lock 失效）
fn lock_file_path() -> PathBuf {
    orchestrator_dir().join("projects.json.lock")
}

/// 取得 exclusive lock（用於所有讀寫操作）
///
/// 回傳 lock file handle，呼叫端在操作完成後 drop 即自動解鎖。
fn acquire_lock() -> std::result::Result<fs::File, std::io::Error> {
    let dir = orchestrator_dir();
    fs::create_dir_all(&dir)?;

    let lock = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_file_path())?;
    lock.lock_exclusive()?;
    Ok(lock)
}

/// 在已持有 lock 的情況下讀取 projects.json
fn read_projects_locked() -> Result<ProjectsFile> {
    let path = projects_json_path();
    if !path.exists() {
        return Ok(ProjectsFile::default());
    }
    let content = fs::read_to_string(&path)?;
    if content.is_empty() {
        return Ok(ProjectsFile::default());
    }
    Ok(serde_json::from_str(&content)?)
}

/// 在已持有 lock 的情況下原子寫入 projects.json
fn write_projects_locked(data: &ProjectsFile) -> Result<()> {
    let dir = orchestrator_dir();
    let path = projects_json_path();
    let tmp_path = dir.join("projects.json.tmp");

    let json = serde_json::to_string_pretty(data)?;
    let mut tmp = fs::File::create(&tmp_path)?;
    tmp.write_all(json.as_bytes())?;
    tmp.sync_all()?;

    // 原子 rename（同一檔案系統）
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// 讀取 projects.json
///
/// 若檔案不存在，回傳空的 ProjectsFile。
/// 使用獨立 .lock 檔確保與寫入互斥。
pub fn read_projects() -> Result<ProjectsFile> {
    let _lock = acquire_lock()?;
    read_projects_locked()
}

/// 原子寫入 projects.json
pub fn write_projects(data: &ProjectsFile) -> Result<()> {
    let _lock = acquire_lock()?;
    write_projects_locked(data)
}

/// 新增專案條目（在 exclusive lock 內完成 read-modify-write）
pub fn add_project(entry: ProjectEntry) -> Result<()> {
    let _lock = acquire_lock()?;
    let mut data = read_projects_locked()?;
    data.projects.push(entry);
    write_projects_locked(&data)
}

/// 移除專案條目（在 exclusive lock 內完成 read-modify-write）
pub fn remove_project(project_id: &str) -> Result<()> {
    let _lock = acquire_lock()?;
    let mut data = read_projects_locked()?;
    data.projects.retain(|p| p.id != project_id);
    write_projects_locked(&data)
}

/// 根據 ID 查找專案
pub fn find_project(project_id: &str) -> Result<Option<ProjectEntry>> {
    let _lock = acquire_lock()?;
    let data = read_projects_locked()?;
    Ok(data.projects.into_iter().find(|p| p.id == project_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;
    use tempfile::tempdir;

    /// 設定測試用的 HOME 目錄，回傳 guard 在 drop 時恢復
    struct HomeGuard {
        original: Option<String>,
    }

    impl HomeGuard {
        #[allow(deprecated)] // env::set_var is unsafe in multi-threaded, hence #[serial]
        fn set(dir: &std::path::Path) -> Self {
            let original = env::var("HOME").ok();
            env::set_var("HOME", dir);
            Self { original }
        }
    }

    impl Drop for HomeGuard {
        #[allow(deprecated)]
        fn drop(&mut self) {
            match &self.original {
                Some(v) => env::set_var("HOME", v),
                None => env::remove_var("HOME"),
            }
        }
    }

    #[test]
    #[serial]
    fn read_returns_default_when_no_file() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        let result = read_projects().unwrap();
        assert_eq!(result.version, 1);
        assert!(result.projects.is_empty());
    }

    #[test]
    #[serial]
    fn create_project_writes_projects_json() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        let entry = ProjectEntry {
            id: "test-001".to_string(),
            name: "my-app".to_string(),
            path: "/home/user/my-app".to_string(),
            created_at: "2026-03-14T10:00:00Z".to_string(),
        };

        add_project(entry.clone()).unwrap();

        let data = read_projects().unwrap();
        assert_eq!(data.projects.len(), 1);
        assert_eq!(data.projects[0].id, "test-001");
        assert_eq!(data.projects[0].name, "my-app");
    }

    #[test]
    #[serial]
    fn remove_project_updates_json() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        // 先加兩個
        add_project(ProjectEntry {
            id: "p1".to_string(),
            name: "proj1".to_string(),
            path: "/p1".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .unwrap();
        add_project(ProjectEntry {
            id: "p2".to_string(),
            name: "proj2".to_string(),
            path: "/p2".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        })
        .unwrap();

        // 刪除 p1
        remove_project("p1").unwrap();

        let data = read_projects().unwrap();
        assert_eq!(data.projects.len(), 1);
        assert_eq!(data.projects[0].id, "p2");
    }

    #[test]
    #[serial]
    fn concurrent_project_writes_no_corruption() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        // 先建立空的 projects.json
        write_projects(&ProjectsFile::default()).unwrap();

        // 模擬 5 次連續寫入（同執行緒，因 lock 是 per-process）
        for i in 0..5 {
            add_project(ProjectEntry {
                id: format!("proj-{}", i),
                name: format!("project-{}", i),
                path: format!("/path/{}", i),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .unwrap();
        }

        let data = read_projects().unwrap();
        assert_eq!(data.projects.len(), 5);

        // 確認所有 5 個都在
        for i in 0..5 {
            assert!(data
                .projects
                .iter()
                .any(|p| p.id == format!("proj-{}", i)));
        }
    }

    #[test]
    #[serial]
    fn find_project_returns_match() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        add_project(ProjectEntry {
            id: "find-me".to_string(),
            name: "findable".to_string(),
            path: "/find".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .unwrap();

        let found = find_project("find-me").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "findable");

        let missing = find_project("not-here").unwrap();
        assert!(missing.is_none());
    }
}
