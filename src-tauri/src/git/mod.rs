//! Git operations module for Orchestrator Tower
//!
//! This module provides Git Worktree management and Shadow Branch snapshot functionality
//! using Git Plumbing commands (not Porcelain).

pub mod crash_commit;
pub mod rollback;
pub mod snapshot;
pub mod worktree;

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::process::Command;

/// Default timeout for git commands (30 seconds)
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

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

    #[error("Git command timed out after {0} seconds")]
    Timeout(u64),

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
///
/// Has a 30-second timeout to prevent hanging on stuck git processes.
pub async fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let unix_path = to_unix_path(repo_path);
    let git_cmd = args.join(" ");

    let cmd_future = Command::new("bash")
        .args(["-c", &format!("cd '{}' && git {}", unix_path, git_cmd)])
        .output();

    let output = tokio::time::timeout(GIT_COMMAND_TIMEOUT, cmd_future)
        .await
        .map_err(|_| GitError::Timeout(GIT_COMMAND_TIMEOUT.as_secs()))??;

    if !output.status.success() {
        return Err(GitError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Execute a git command with stdin input
///
/// Has a 30-second timeout to prevent hanging on stuck git processes.
pub async fn run_git_with_stdin(repo_path: &Path, args: &[&str], stdin: &str) -> Result<String> {
    let unix_path = to_unix_path(repo_path);
    let git_cmd = args.join(" ");
    let escaped_stdin = stdin.replace('\'', "'\\''");

    let cmd_future = Command::new("bash")
        .args([
            "-c",
            &format!(
                "cd '{}' && echo '{}' | git {}",
                unix_path, escaped_stdin, git_cmd
            ),
        ])
        .output();

    let output = tokio::time::timeout(GIT_COMMAND_TIMEOUT, cmd_future)
        .await
        .map_err(|_| GitError::Timeout(GIT_COMMAND_TIMEOUT.as_secs()))??;

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
/// 1. Lists all refs under refs/orchestrator/ (snapshot refs)
/// 2. Lists all refs under refs/heads/__orch_shadow_ (shadow branches)
/// 3. Compares their creation time against the cutoff
/// 4. Deletes refs older than retention_days
/// 5. Removes corresponding worktrees (from shadow branch agentId)
///
/// Order: Delete ref first, then worktree
pub async fn cleanup_old_refs(repo_path: &Path, retention_days: u64) -> Result<()> {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - (retention_days * 24 * 60 * 60);

    let mut deleted_agents: Vec<String> = Vec::new();

    // Helper to process refs from a pattern
    async fn process_refs(
        repo_path: &Path,
        pattern: &str,
        cutoff: u64,
        deleted_agents: &mut Vec<String>,
    ) -> Result<()> {
        let output = run_git(
            repo_path,
            &["for-each-ref", "--format=%(refname) %(creatordate:unix)", pattern],
        )
        .await;

        let refs_output = match output {
            Ok(o) => o,
            Err(GitError::CommandFailed(msg)) if msg.contains("unknown field name") => return Ok(()),
            Err(GitError::CommandFailed(msg)) if msg.is_empty() => return Ok(()),
            Err(e) => return Err(e),
        };

        if refs_output.is_empty() {
            return Ok(());
        }

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

                // Extract agentId from shadow branch refs
                if let Some(agent_id) = extract_agent_id_from_ref(refname) {
                    if !deleted_agents.contains(&agent_id) {
                        deleted_agents.push(agent_id.clone());
                    }
                }
            }
        }

        Ok(())
    }

    // Process snapshot refs (refs/orchestrator/)
    process_refs(repo_path, "refs/orchestrator/", cutoff, &mut deleted_agents).await?;

    // Process shadow branch refs (refs/heads/__orch_shadow_*)
    // These contain the agentId we need for worktree cleanup
    process_refs(repo_path, "refs/heads/__orch_shadow_*", cutoff, &mut deleted_agents).await?;

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
///
/// Supports two ref formats:
/// - Shadow branch: `refs/heads/__orch_shadow_{projectId}_{agentId}` → returns agentId
/// - Snapshot ref: `refs/orchestrator/{projectId}/node-{nodeId}` → returns None (no agentId info)
///
/// For snapshot refs, we need to also scan shadow branches to get agentId mapping.
///
/// # Limitations
/// TODO: [CLARIFY] If projectId or agentId contains underscores (e.g., `my_project_agent_1`),
/// parsing may be incorrect since we use `rfind('_')` to split. In practice, UUIDs are used
/// for agentId so this is unlikely. Consider documenting that projectId/agentId should not
/// contain underscores, or use a different separator (e.g., `::` or `/`).
fn extract_agent_id_from_ref(refname: &str) -> Option<String> {
    // Shadow branch format: refs/heads/__orch_shadow_{projectId}_{agentId}
    const SHADOW_PREFIX: &str = "refs/heads/__orch_shadow_";

    if refname.starts_with(SHADOW_PREFIX) {
        let suffix = &refname[SHADOW_PREFIX.len()..];
        // suffix = "{projectId}_{agentId}"
        // Find the last underscore to split projectId and agentId
        // TODO: This assumes neither projectId nor agentId contains underscores
        if let Some(last_underscore) = suffix.rfind('_') {
            let agent_id = &suffix[last_underscore + 1..];
            if !agent_id.is_empty() {
                return Some(agent_id.to_string());
            }
        }
    }

    // Snapshot ref format: refs/orchestrator/{projectId}/node-{nodeId}
    // Cannot extract agentId from this format
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
    #[ignore = "Requires real git repository with old refs"]
    async fn cleanup_removes_refs_older_than_retention() {
        // This test requires a real git repository
        // In a real test environment, we would:
        // 1. Create a temporary git repo
        // 2. Create refs with fake old timestamps
        // 3. Run cleanup_old_refs
        // 4. Verify old refs are deleted and new refs remain
    }

    #[test]
    fn test_extract_agent_id_from_shadow_branch() {
        // Shadow branch format: refs/heads/__orch_shadow_{projectId}_{agentId}
        let ref1 = "refs/heads/__orch_shadow_proj1_agent-42";
        assert_eq!(extract_agent_id_from_ref(ref1), Some("agent-42".to_string()));

        let ref2 = "refs/heads/__orch_shadow_my-project_abc123";
        assert_eq!(extract_agent_id_from_ref(ref2), Some("abc123".to_string()));

        // Snapshot refs don't contain agentId
        let ref3 = "refs/orchestrator/proj1/node-7";
        assert_eq!(extract_agent_id_from_ref(ref3), None);

        // Invalid refs
        let ref4 = "refs/heads/main";
        assert_eq!(extract_agent_id_from_ref(ref4), None);
    }
}
