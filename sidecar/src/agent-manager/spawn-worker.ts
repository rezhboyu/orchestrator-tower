/**
 * Spawn Worker - Worker Agent (Claude Code) 子程序啟動
 *
 * Worker Agent 固定使用 Claude Code stream-json 協議。
 * 這是架構決策：Worker 需要 --permission-prompt-tool，Gemini 不支援。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { isWindows } from '../ipc/platform.js';
import type { AgentConfig, SpawnWorkerOptions } from './types.js';
// Task 15: 崩潰恢復
import { buildResumeArgs } from '../recovery/index.js';

// =============================================================================
// Worker Fixed Arguments
// =============================================================================

/**
 * Worker Agent 固定參數（不可修改）
 * 來自 CLAUDE.md 規格
 */
const WORKER_FIXED_ARGS = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--permission-prompt-tool', 'mcp__tower__auth',
];

// =============================================================================
// Spawn Worker
// =============================================================================

/**
 * 啟動 Worker Agent (Claude Code)
 *
 * @param config - Agent 配置
 * @param options - spawn 選項（包含 CLI 路徑）
 * @returns ChildProcess
 */
export function spawnWorker(
  config: AgentConfig,
  options: SpawnWorkerOptions
): ChildProcess {
  // 構建 MCP 配置
  const mcpConfig = JSON.stringify({
    mcpServers: {
      tower: {
        type: 'http',
        url: `http://localhost:${config.towerPort}/mcp`,
      },
    },
  });

  // 構建參數列表
  const args = [
    ...WORKER_FIXED_ARGS,
    '--mcp-config', mcpConfig,
    '--model', config.model,
    '--max-turns', String(config.maxTurns),
    '--tools', 'Read,Write,Edit,Bash,Glob,Grep',
    // Task 15: 崩潰恢復 --resume 參數注入
    ...buildResumeArgs(config.sessionId ?? null),
  ];

  // 添加 prompt（如果有）
  if (config.prompt) {
    args.push(config.prompt);
  }

  // Windows 需要透過 Git Bash 執行 Claude Code
  if (isWindows() && options.gitBashPath) {
    return spawnViaGitBash(options.claudePath, args, config.worktreePath, options.gitBashPath);
  }

  // Linux/macOS: 直接執行
  return spawn(options.claudePath, args, {
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
  claudePath: string,
  args: string[],
  cwd: string,
  gitBashPath: string
): ChildProcess {
  // 將 Windows 路徑轉換為 Git Bash 路徑
  const bashClaudePath = windowsPathToBash(claudePath);
  const bashCwd = windowsPathToBash(cwd);

  // 轉義參數中的特殊字符
  const escapedArgs = args.map(arg => escapeForBash(arg)).join(' ');

  // 構建 bash 命令
  const bashCommand = `cd '${bashCwd}' && '${bashClaudePath}' ${escapedArgs}`;

  return spawn(gitBashPath, ['-c', bashCommand], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    // Windows 上使用 shell: false 以避免 CMD 介入
    shell: false,
  });
}

/**
 * 將 Windows 路徑轉換為 Git Bash 格式
 * C:\Users\foo → /c/Users/foo
 */
function windowsPathToBash(winPath: string): string {
  // 處理 UNC 路徑
  if (winPath.startsWith('\\\\')) {
    return winPath;
  }

  // C:\path → /c/path
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
  // 使用單引號包裹，並處理內部的單引號
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// =============================================================================
// Argument Builder (for testing/inspection)
// =============================================================================

/**
 * 構建 Worker Agent 參數（僅用於測試和檢查）
 */
export function buildWorkerArgs(config: AgentConfig): string[] {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      tower: {
        type: 'http',
        url: `http://localhost:${config.towerPort}/mcp`,
      },
    },
  });

  const args = [
    ...WORKER_FIXED_ARGS,
    '--mcp-config', mcpConfig,
    '--model', config.model,
    '--max-turns', String(config.maxTurns),
    '--tools', 'Read,Write,Edit,Bash,Glob,Grep',
    // Task 15: 崩潰恢復 --resume 參數注入
    ...buildResumeArgs(config.sessionId ?? null),
  ];

  if (config.prompt) {
    args.push(config.prompt);
  }

  return args;
}
