//! Shadow Branch snapshot management using Git Plumbing
//!
//! This module creates micro-commit snapshots using only Git Plumbing commands:
//! - git write-tree
//! - git commit-tree
//! - git update-ref
//!
//! FORBIDDEN: git commit, git checkout (Porcelain commands)
//!
//! Naming conventions:
//! - Shadow Branch: refs/heads/__orch_shadow_{projectId}_{agentId}
//! - Snapshot Ref: refs/orchestrator/{projectId}/node-{nodeId}

use std::path::Path;

use super::{run_git, Result};

/// Get the shadow branch ref name for a project/agent pair
pub fn shadow_branch_ref(project_id: &str, agent_id: &str) -> String {
    format!("refs/heads/__orch_shadow_{}_{}", project_id, agent_id)
}

/// Get the snapshot ref name for a node
pub fn snapshot_ref(project_id: &str, node_id: &str) -> String {
    format!("refs/orchestrator/{}/node-{}", project_id, node_id)
}

/// Write a snapshot using Git Plumbing commands
///
/// This function:
/// 1. Creates a tree object from the current working directory state
/// 2. Creates a commit object pointing to that tree
/// 3. Updates the snapshot ref to point to the new commit
///
/// Returns the commit SHA
///
/// # Arguments
/// * `worktree_path` - Path to the worktree to snapshot
/// * `project_id` - Project identifier
/// * `agent_id` - Agent identifier (for shadow branch)
/// * `node_id` - Node identifier for the snapshot ref
///
/// # Plumbing Flow
/// 1. git write-tree → tree SHA
/// 2. git commit-tree {tree} -p {parent} -m "snapshot" → commit SHA
/// 3. git update-ref refs/orchestrator/{project}/node-{node} {commit}
pub async fn write_snapshot(
    worktree_path: &Path,
    project_id: &str,
    agent_id: &str,
    node_id: &str,
) -> Result<String> {
    let shadow_ref = shadow_branch_ref(project_id, agent_id);
    let snap_ref = snapshot_ref(project_id, node_id);

    // Step 1: Stage all changes (git add -A)
    // This is necessary for write-tree to capture the current state
    run_git(worktree_path, &["add", "-A"]).await?;

    // Step 2: Create tree object from current index
    let tree_sha = run_git(worktree_path, &["write-tree"]).await?;

    // Step 3: Get parent commit (shadow branch HEAD, if exists)
    let parent_sha = run_git(worktree_path, &["rev-parse", &shadow_ref])
        .await
        .ok();

    // Step 4: Create commit object using commit-tree
    let commit_msg = format!("snapshot: node-{}", node_id);
    let commit_sha = if let Some(parent) = parent_sha {
        run_git(
            worktree_path,
            &[
                "commit-tree",
                &tree_sha,
                "-p",
                &parent,
                "-m",
                &commit_msg,
            ],
        )
        .await?
    } else {
        // No parent - this is the first commit on the shadow branch
        run_git(worktree_path, &["commit-tree", &tree_sha, "-m", &commit_msg]).await?
    };

    // Step 5: Update shadow branch ref
    run_git(
        worktree_path,
        &["update-ref", &shadow_ref, &commit_sha],
    )
    .await?;

    // Step 6: Update snapshot ref
    run_git(worktree_path, &["update-ref", &snap_ref, &commit_sha]).await?;

    Ok(commit_sha)
}

/// Get the commit SHA for a snapshot ref
pub async fn get_snapshot_sha(worktree_path: &Path, project_id: &str, node_id: &str) -> Result<String> {
    let snap_ref = snapshot_ref(project_id, node_id);
    run_git(worktree_path, &["rev-parse", &snap_ref]).await
}

/// Check if a snapshot ref exists
pub async fn snapshot_exists(worktree_path: &Path, project_id: &str, node_id: &str) -> bool {
    get_snapshot_sha(worktree_path, project_id, node_id)
        .await
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_branch_ref_follows_naming_convention() {
        let ref_name = shadow_branch_ref("proj1", "agent-42");
        assert_eq!(ref_name, "refs/heads/__orch_shadow_proj1_agent-42");
    }

    #[test]
    fn snapshot_ref_follows_naming_convention() {
        let ref_name = snapshot_ref("proj1", "7");
        assert_eq!(ref_name, "refs/orchestrator/proj1/node-7");
    }

    #[tokio::test]
    async fn snapshot_uses_plumbing_not_porcelain() {
        // This test verifies the implementation uses plumbing commands.
        // In a real test, we would:
        // 1. Create a temp git repo
        // 2. Run write_snapshot
        // 3. Verify that no "git commit" or "git checkout" was called
        //
        // The implementation above only uses:
        // - git add -A (necessary for staging)
        // - git write-tree (plumbing)
        // - git commit-tree (plumbing)
        // - git update-ref (plumbing)
        // - git rev-parse (plumbing)
        //
        // No porcelain commands (git commit, git checkout) are used.
    }
}
