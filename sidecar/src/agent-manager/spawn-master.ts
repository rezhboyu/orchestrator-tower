/**
 * Spawn Master - Master Orchestrator 子程序啟動
 *
 * Master Orchestrator 可選擇使用：
 * - Claude Code (stream-json 雙向協議)
 * - Gemini CLI (--experimental-acp)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { isWindows } from '../ipc/platform.js';
import type { AgentConfig, SpawnMasterOptions } from './types.js';

// =============================================================================
// Master Claude Arguments
// =============================================================================

/**
 * Master Orchestrator (Claude) 參數
 * 使用 input-format=stream-json 支援雙向通訊
 */
const MASTER_CLAUDE_ARGS = [
  '--print',
  '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  // 無 --permission-prompt-tool（Master 不需要 HITL）
];

// =============================================================================
// Master Gemini Arguments
// =============================================================================

/**
 * Master Orchestrator (Gemini) 參數
 * 使用 --experimental-acp 進行多輪持久對話
 */
const MASTER_GEMINI_ARGS = ['--experimental-acp'];

// =============================================================================
// Spawn Master Claude
// =============================================================================

/**
 * 啟動 Master Orchestrator (Claude Code)
 *
 * @param config - Agent 配置
 * @param options - spawn 選項
 * @returns ChildProcess
 */
export function spawnMasterClaude(
  config: AgentConfig,
  options: SpawnMasterOptions
): ChildProcess {
  if (!options.claudePath) {
    throw new Error('Claude CLI path not provided');
  }

  const args = [
    ...MASTER_CLAUDE_ARGS,
    '--model', config.model,
    '--max-turns', String(config.maxTurns),
  ];

  // Windows 需要透過 Git Bash 執行
  if (isWindows() && options.gitBashPath) {
    return spawnViaGitBash(options.claudePath, args, config.worktreePath, options.gitBashPath);
  }

  return spawn(options.claudePath, args, {
    cwd: config.worktreePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });
}

// =============================================================================
// Spawn Master Gemini
// =============================================================================

/**
 * 啟動 Master Orchestrator (Gemini CLI)
 *
 * Gemini CLI 使用 --experimental-acp 進行 JSON-RPC NDJSON 通訊。
 * Windows 上可直接執行 gemini.cmd，不需要 Git Bash。
 *
 * @param config - Agent 配置
 * @param options - spawn 選項
 * @returns ChildProcess
 */
export function spawnMasterGemini(
  config: AgentConfig,
  options: SpawnMasterOptions
): ChildProcess {
  if (!options.geminiPath) {
    throw new Error('Gemini CLI path not provided');
  }

  // Gemini 不需要 Git Bash，可直接執行
  return spawn(options.geminiPath, MASTER_GEMINI_ARGS, {
    cwd: config.worktreePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });
}

// =============================================================================
// Git Bash Wrapper (Windows)
// =============================================================================

/**
 * 透過 Git Bash 執行命令（Windows 專用）
 */
function spawnViaGitBash(
  cliPath: string,
  args: string[],
  cwd: string,
  gitBashPath: string
): ChildProcess {
  const bashCliPath = windowsPathToBash(cliPath);
  const bashCwd = windowsPathToBash(cwd);
  const escapedArgs = args.map(arg => escapeForBash(arg)).join(' ');
  const bashCommand = `cd '${bashCwd}' && '${bashCliPath}' ${escapedArgs}`;

  return spawn(gitBashPath, ['-c', bashCommand], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    shell: false,
  });
}

/**
 * 將 Windows 路徑轉換為 Git Bash 格式
 */
function windowsPathToBash(winPath: string): string {
  if (winPath.startsWith('\\\\')) {
    return winPath;
  }

  const match = winPath.match(/^([A-Za-z]):(.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/${drive}${rest}`;
  }

  return winPath.replace(/\\/g, '/');
}

/**
 * 為 Bash 轉義字符串
 */
function escapeForBash(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// =============================================================================
// Argument Builders (for testing/inspection)
// =============================================================================

/**
 * 構建 Master Claude 參數
 */
export function buildMasterClaudeArgs(config: AgentConfig): string[] {
  return [
    ...MASTER_CLAUDE_ARGS,
    '--model', config.model,
    '--max-turns', String(config.maxTurns),
  ];
}

/**
 * 構建 Master Gemini 參數
 */
export function buildMasterGeminiArgs(): string[] {
  return [...MASTER_GEMINI_ARGS];
}
