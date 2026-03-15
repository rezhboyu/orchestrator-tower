/**
 * Agent Manager Types
 *
 * 定義 Agent 生命週期管理所需的型別。
 */

import type { ChildProcess } from 'node:child_process';
import type { ClaudeStreamParser, GeminiAcpParser, ExitedFlag } from '../stream-parser/index.js';

// =============================================================================
// Agent Configuration
// =============================================================================

export type AgentRole = 'worker' | 'master';
export type AgentProtocol = 'claude-stream-json' | 'gemini-acp';
export type AgentState = 'running' | 'stopping' | 'stopped' | 'crashed';

export interface AgentConfig {
  agentId: string;
  role: AgentRole;
  protocol: AgentProtocol;
  worktreePath: string;
  model: string;
  maxTurns: number;
  towerPort: number;
  prompt?: string;
}

// =============================================================================
// Managed Agent (Internal State)
// =============================================================================

export interface ManagedAgent {
  config: AgentConfig;
  process: ChildProcess;
  parser: ClaudeStreamParser | GeminiAcpParser;
  exitedFlag: ExitedFlag;
  resultReceived: boolean;
  lastSessionId: string | null;
  lastToolUse: unknown | null;
  state: AgentState;
}

// =============================================================================
// Crash Information
// =============================================================================

export interface CrashInfo {
  agentId: string;
  exitCode: number | null;
  signal: string | null;
  lastSessionId: string | null;
  lastToolUse: unknown | null;
}

// =============================================================================
// CLI Detection Results
// =============================================================================

export type CliDetectionError =
  | 'cli_not_found'
  | 'cli_not_authenticated'
  | 'git_bash_not_found';

export interface CliDetectionResult {
  path: string | null;
  error: CliDetectionError | null;
}

export interface AuthCheckResult {
  authenticated: boolean;
  error?: string;
}

// =============================================================================
// Windows Configuration
// =============================================================================

export interface WindowsConfig {
  gitBashPath: string | null;
}

// =============================================================================
// Spawn Options
// =============================================================================

export interface SpawnWorkerOptions {
  claudePath: string;
  gitBashPath: string | null;
}

export interface SpawnMasterOptions {
  claudePath?: string;
  geminiPath?: string;
  gitBashPath: string | null;
}
