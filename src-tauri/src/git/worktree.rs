//! Git Worktree management
//!
//! Provides functions to create, lock, unlock, and remove Git worktrees.
//! Worktree naming convention: {project_root}/.trees/agent-{agentId}/

use std::path::{Path, PathBuf};

use super::{run_git, to_unix_path, GitError, Result};

/// Get the worktree path for an agent
///
/// Returns: {project_root}/.trees/agent-{agentId}/
pub fn worktree_path(project_root: &Path, agent_id: &str) -> PathBuf {
    project_root.join(".trees").join(format!("agent-{}", agent_id))
}

/// Create a new worktree for an agent
///
/// Creates the worktree at {project_root}/.trees/agent-{agentId}/
/// based on HEAD of the main repository.
pub async fn create_worktree(project_root: &Path, agent_id: &str) -> Result<PathBuf> {
    let path = worktree_path(project_root, agent_id);

    // Ensure .trees directory exists
    let trees_dir = project_root.join(".trees");
    if !trees_dir.exists() {
        tokio::fs::create_dir_all(&trees_dir).await?;
    }

    let unix_path = to_unix_path(&path);
    run_git(project_root, &["worktree", "add", &unix_path, "HEAD"]).await?;

    Ok(path)
}

/// Lock a worktree to prevent accidental removal
pub async fn lock_worktree(wt_path: &Path) -> Result<()> {
    // Find the main repository from worktree
    let git_dir = wt_path.join(".git");
    if !git_dir.exists() {
        return Err(GitError::CommandFailed(format!(
            "Not a valid worktree: {}",
            wt_path.display()
        )));
    }

    // Read the gitdir file to find main repo
    let gitdir_content = tokio::fs::read_to_string(&git_dir).await?;
    let main_git_dir = PathBuf::from(gitdir_content.trim());
    let main_repo = main_git_dir
        .parent() // worktrees/agent-xxx
        .and_then(|p| p.parent()) // worktrees
        .and_then(|p| p.parent()) // .git
        .and_then(|p| p.parent()) // repo root
        .ok_or_else(|| GitError::CommandFailed("Cannot find main repository".to_string()))?;

    let unix_path = to_unix_path(wt_path);
    run_git(main_repo, &["worktree", "lock", &unix_path]).await?;

    Ok(())
}

/// Unlock a worktree
pub async fn unlock_worktree(wt_path: &Path) -> Result<()> {
    let git_dir = wt_path.join(".git");
    if !git_dir.exists() {
        return Err(GitError::CommandFailed(format!(
            "Not a valid worktree: {}",
            wt_path.display()
        )));
    }

    let gitdir_content = tokio::fs::read_to_string(&git_dir).await?;
    let main_git_dir = PathBuf::from(gitdir_content.trim());
    let main_repo = main_git_dir
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or_else(|| GitError::CommandFailed("Cannot find main repository".to_string()))?;

    let unix_path = to_unix_path(wt_path);
    run_git(main_repo, &["worktree", "unlock", &unix_path]).await?;

    Ok(())
}

/// Remove a worktree
///
/// Uses --force to remove even if there are uncommitted changes.
pub async fn remove_worktree(project_root: &Path, agent_id: &str) -> Result<()> {
    let path = worktree_path(project_root, agent_id);
    let unix_path = to_unix_path(&path);

    run_git(project_root, &["worktree", "remove", "--force", &unix_path]).await?;

    Ok(())
}

/// Check if a worktree exists
pub fn worktree_exists(project_root: &Path, agent_id: &str) -> bool {
    let path = worktree_path(project_root, agent_id);
    path.exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_path_follows_naming_convention() {
        // Test with a platform-agnostic approach
        let path = worktree_path(Path::new("/repo"), "42");

        // Check that path contains expected components
        let path_str = path.to_string_lossy();
        assert!(path_str.contains(".trees"), "Path should contain .trees");
        assert!(path_str.contains("agent-42"), "Path should contain agent-42");

        // Verify path structure: {project_root}/.trees/agent-{agentId}
        let components: Vec<_> = path.components().collect();
        assert!(components.len() >= 3, "Path should have at least 3 components");
    }

    #[test]
    fn worktree_path_with_windows_root() {
        let path = worktree_path(Path::new("C:\\Users\\test\\project"), "agent-1");
        let path_str = path.to_string_lossy();
        assert!(path_str.contains(".trees"));
        assert!(path_str.contains("agent-agent-1"));
    }
}
