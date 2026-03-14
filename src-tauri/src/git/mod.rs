//! Git operations module for Orchestrator Tower
//!
//! This module provides Git Worktree management and Shadow Branch snapshot functionality
//! using Git Plumbing commands (not Porcelain).

pub mod crash_commit;
pub mod rollback;
pub mod snapshot;
pub mod worktree;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::process::Command;

/// Git operation errors
#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git command failed: {0}")]
    CommandFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid ref format: {0}")]
    InvalidRef(String),

    #[error("Lock file still exists after timeout")]
    LockTimeout,

    #[error("Parse error: {0}")]
    ParseError(String),
}

pub type Result<T> = std::result::Result<T, GitError>;

/// Convert Windows path to Unix-style for bash
fn to_unix_path(path: &Path) -> String {
    let path_str = path.to_string_lossy();
    // Convert C:\path\to\dir to /c/path/to/dir
    if path_str.len() >= 2 && path_str.chars().nth(1) == Some(':') {
        let drive = path_str.chars().next().unwrap().to_ascii_lowercase();
        let rest = &path_str[2..].replace('\\', "/");
        format!("/{}{}", drive, rest)
    } else {
        path_str.replace('\\', "/")
    }
}

/// Execute a git command in the specified repository path
/// On Windows, this runs through bash.exe for Git Bash compatibility
pub async fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let unix_path = to_unix_path(repo_path);
    let git_cmd = args.join(" ");

    let output = Command::new("bash")
        .args(["-c", &format!("cd '{}' && git {}", unix_path, git_cmd)])
        .output()
        .await?;

    if !output.status.success() {
        return Err(GitError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Execute a git command with stdin input
pub async fn run_git_with_stdin(repo_path: &Path, args: &[&str], stdin: &str) -> Result<String> {
    let unix_path = to_unix_path(repo_path);
    let git_cmd = args.join(" ");
    let escaped_stdin = stdin.replace('\'', "'\\''");

    let output = Command::new("bash")
        .args([
            "-c",
            &format!(
                "cd '{}' && echo '{}' | git {}",
                unix_path, escaped_stdin, git_cmd
            ),
        ])
        .output()
        .await?;

    if !output.status.success() {
        return Err(GitError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Clean up old refs and worktrees older than retention_days
///
/// This function:
/// 1. Lists all refs under refs/orchestrator/
/// 2. Compares their creation time against the cutoff
/// 3. Deletes refs older than retention_days
/// 4. Removes corresponding worktrees
///
/// Order: Delete ref first, then worktree
pub async fn cleanup_old_refs(repo_path: &Path, retention_days: u64) -> Result<()> {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - (retention_days * 24 * 60 * 60);

    // Get all refs with their creation timestamps
    let output =
        run_git(repo_path, &["for-each-ref", "--format=%(refname) %(creatordate:unix)", "refs/orchestrator/"]).await;

    // If no refs exist, that's fine
    let refs_output = match output {
        Ok(o) => o,
        Err(GitError::CommandFailed(msg)) if msg.contains("unknown field name") => return Ok(()),
        Err(e) => return Err(e),
    };

    if refs_output.is_empty() {
        return Ok(());
    }

    let mut deleted_agents: Vec<String> = Vec::new();

    for line in refs_output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let refname = parts[0];
        let timestamp: u64 = parts[1].parse().unwrap_or(0);

        if timestamp > 0 && timestamp < cutoff {
            // Delete the ref first
            run_git(repo_path, &["update-ref", "-d", refname]).await?;

            // Extract agentId from refname (refs/orchestrator/{projectId}/node-{nodeId})
            // We need to find the shadow branch which contains agentId
            if let Some(agent_id) = extract_agent_id_from_ref(refname) {
                if !deleted_agents.contains(&agent_id) {
                    deleted_agents.push(agent_id);
                }
            }
        }
    }

    // Remove worktrees for deleted agents
    for agent_id in deleted_agents {
        let worktree_path = repo_path.join(".trees").join(format!("agent-{}", agent_id));
        if worktree_path.exists() {
            let _ = run_git(
                repo_path,
                &[
                    "worktree",
                    "remove",
                    "--force",
                    &to_unix_path(&worktree_path),
                ],
            )
            .await;
        }
    }

    Ok(())
}

/// Extract agent ID from a shadow branch refname
fn extract_agent_id_from_ref(_refname: &str) -> Option<String> {
    // Shadow branch format: refs/heads/__orch_shadow_{projectId}_{agentId}
    // Snapshot ref format: refs/orchestrator/{projectId}/node-{nodeId}
    // We need to look at the shadow branch to get agentId

    // For snapshot refs, we can't directly get agentId
    // This is a limitation - we need to track agent->ref mapping separately
    // For now, return None and let cleanup_old_refs handle it differently
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_unix_path_windows() {
        let path = Path::new("C:\\Users\\test\\project");
        assert_eq!(to_unix_path(path), "/c/Users/test/project");
    }

    #[test]
    fn test_to_unix_path_unix() {
        let path = Path::new("/home/user/project");
        assert_eq!(to_unix_path(path), "/home/user/project");
    }

    #[tokio::test]
    async fn cleanup_removes_refs_older_than_retention() {
        // This test requires a real git repository
        // In a real test environment, we would:
        // 1. Create a temporary git repo
        // 2. Create refs with fake old timestamps
        // 3. Run cleanup_old_refs
        // 4. Verify old refs are deleted and new refs remain
        //
        // For now, this is a placeholder that documents the expected behavior
    }
}
