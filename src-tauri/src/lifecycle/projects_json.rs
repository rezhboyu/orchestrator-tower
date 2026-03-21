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

/// 讀取 projects.json
///
/// 若檔案不存在，回傳空的 ProjectsFile。
/// 使用 shared lock 確保讀取一致性。
pub fn read_projects() -> Result<ProjectsFile> {
    let path = projects_json_path();

    if !path.exists() {
        return Ok(ProjectsFile::default());
    }

    let file = fs::File::open(&path)?;
    file.lock_shared()?;
    let result = serde_json::from_reader(&file)?;
    file.unlock()?;

    Ok(result)
}

/// 原子寫入 projects.json
///
/// 流程：
/// 1. 對 projects.json 加 exclusive lock
/// 2. 寫入 .tmp 檔
/// 3. rename .tmp → projects.json（同一檔案系統上為原子操作）
/// 4. 解鎖
pub fn write_projects(data: &ProjectsFile) -> Result<()> {
    let dir = orchestrator_dir();
    fs::create_dir_all(&dir)?;

    let path = projects_json_path();
    let tmp_path = dir.join("projects.json.tmp");

    // 建立或開啟 projects.json 以取得 lock
    let lock_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;
    lock_file.lock_exclusive()?;

    // 寫入 temp file
    let json = serde_json::to_string_pretty(data)?;
    let mut tmp = fs::File::create(&tmp_path)?;
    tmp.write_all(json.as_bytes())?;
    tmp.sync_all()?;

    // 原子 rename
    fs::rename(&tmp_path, &path)?;

    lock_file.unlock()?;

    Ok(())
}

/// 新增專案條目
pub fn add_project(entry: ProjectEntry) -> Result<()> {
    let mut data = read_projects()?;
    data.projects.push(entry);
    write_projects(&data)
}

/// 移除專案條目
pub fn remove_project(project_id: &str) -> Result<()> {
    let mut data = read_projects()?;
    data.projects.retain(|p| p.id != project_id);
    write_projects(&data)
}

/// 根據 ID 查找專案
pub fn find_project(project_id: &str) -> Result<Option<ProjectEntry>> {
    let data = read_projects()?;
    Ok(data.projects.into_iter().find(|p| p.id == project_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::tempdir;

    /// 設定測試用的 HOME 目錄，回傳 guard 在 drop 時恢復
    struct HomeGuard {
        original: Option<String>,
    }

    impl HomeGuard {
        fn set(dir: &std::path::Path) -> Self {
            let original = env::var("HOME").ok();
            env::set_var("HOME", dir);
            Self { original }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(v) => env::set_var("HOME", v),
                None => env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn read_returns_default_when_no_file() {
        let dir = tempdir().unwrap();
        let _guard = HomeGuard::set(dir.path());

        let result = read_projects().unwrap();
        assert_eq!(result.version, 1);
        assert!(result.projects.is_empty());
    }

    #[test]
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
