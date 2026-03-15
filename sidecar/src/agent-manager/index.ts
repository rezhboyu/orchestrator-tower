/**
 * Agent Manager Module
 *
 * 提供 Agent 生命週期管理功能。
 */

// =============================================================================
// Core
// =============================================================================

export { AgentManager } from './agent-manager.js';
export type { AgentManagerEvents } from './agent-manager.js';

// =============================================================================
// Types
// =============================================================================

export type {
  AgentRole,
  AgentProtocol,
  AgentState,
  AgentConfig,
  ManagedAgent,
  CrashInfo,
  CliDetectionError,
  CliDetectionResult,
  AuthCheckResult,
  WindowsConfig,
  SpawnWorkerOptions,
  SpawnMasterOptions,
} from './types.js';

// =============================================================================
// CLI Detection
// =============================================================================

export {
  detectClaude,
  detectGemini,
  detectGitBash,
  detectAllClis,
  checkClaudeAuth,
  checkGeminiAuth,
  getWindowsConfig,
} from './cli-detector.js';

export type { CliPaths } from './cli-detector.js';

// =============================================================================
// Spawn (for testing)
// =============================================================================

export { spawnWorker, buildWorkerArgs } from './spawn-worker.js';
export { spawnMasterClaude, spawnMasterGemini, buildMasterClaudeArgs, buildMasterGeminiArgs } from './spawn-master.js';
