/**
 * CLI Detector - Claude Code / Gemini CLI 路徑偵測與認證檢查
 *
 * 偵測順序（Claude Code）：
 * 1. 環境變數 ORCHESTRATOR_CLAUDE_PATH
 * 2. which/where claude 命令
 * 3. ~/.local/bin/claude
 * 4. ~/.npm-global/bin/claude
 * 5. npm root -g 動態查詢
 *
 * 偵測順序（Gemini CLI）：
 * 1. 環境變數 ORCHESTRATOR_GEMINI_PATH
 * 2. which/where gemini 命令
 * 3. ~/.npm-global/bin/gemini
 * 4. npm root -g 動態查詢
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isWindows } from '../ipc/platform.js';
import type { CliDetectionResult, AuthCheckResult, WindowsConfig } from './types.js';

const execAsync = promisify(exec);

// =============================================================================
// Helper Functions
// =============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function execCommand(command: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function getHomedir(): string {
  return os.homedir();
}

// =============================================================================
// Windows Git Bash Detection
// =============================================================================

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];

/**
 * 偵測 Windows 上的 Git Bash 路徑
 * Claude Code 原生安裝器需要 Git Bash 環境
 */
export async function detectGitBash(): Promise<string | null> {
  // 1. 環境變數
  const envPath = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (envPath && await fileExists(envPath)) {
    return envPath;
  }

  // 2. 常見路徑
  for (const candidate of GIT_BASH_CANDIDATES) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  // 3. where bash 命令
  const whereBash = await execCommand('where bash');
  if (whereBash) {
    const firstLine = whereBash.split('\n')[0]?.trim();
    if (firstLine && await fileExists(firstLine)) {
      return firstLine;
    }
  }

  return null;
}

/**
 * 取得 Windows 配置（包含 Git Bash 路徑）
 */
export async function getWindowsConfig(): Promise<WindowsConfig> {
  if (!isWindows()) {
    return { gitBashPath: null };
  }
  const gitBashPath = await detectGitBash();
  return { gitBashPath };
}

// =============================================================================
// Claude Code Detection
// =============================================================================

/**
 * 偵測 Claude Code CLI 路徑
 */
export async function detectClaude(userConfigPath?: string): Promise<CliDetectionResult> {
  const home = getHomedir();

  // 1. 使用者設定路徑（從環境變數）
  const envPath = userConfigPath ?? process.env.ORCHESTRATOR_CLAUDE_PATH;
  if (envPath) {
    const resolvedPath = path.resolve(envPath);
    if (await fileExists(resolvedPath)) {
      return { path: resolvedPath, error: null };
    }
    // Windows: 加上 .exe
    if (isWindows() && !envPath.endsWith('.exe')) {
      const exePath = resolvedPath + '.exe';
      if (await fileExists(exePath)) {
        return { path: exePath, error: null };
      }
    }
  }

  // 2. which/where 命令
  const whichCmd = isWindows() ? 'where claude' : 'which claude';
  const whichResult = await execCommand(whichCmd);
  if (whichResult) {
    const firstLine = whichResult.split('\n')[0]?.trim();
    if (firstLine && await fileExists(firstLine)) {
      return { path: firstLine, error: null };
    }
  }

  // 3. ~/.local/bin/claude（原生安裝器預設路徑）
  const localBinPath = path.join(home, '.local', 'bin', isWindows() ? 'claude.exe' : 'claude');
  if (await fileExists(localBinPath)) {
    return { path: localBinPath, error: null };
  }

  // 4. ~/.npm-global/bin/claude（npm 自訂 prefix）
  const npmGlobalPath = path.join(home, '.npm-global', 'bin', isWindows() ? 'claude.cmd' : 'claude');
  if (await fileExists(npmGlobalPath)) {
    return { path: npmGlobalPath, error: null };
  }

  // 5. npm root -g 動態查詢
  const npmRoot = await execCommand('npm root -g');
  if (npmRoot) {
    // npm root -g 回傳 node_modules 路徑，bin 在上層的 ../bin
    const npmBinPath = path.join(path.dirname(npmRoot), 'bin', isWindows() ? 'claude.cmd' : 'claude');
    if (await fileExists(npmBinPath)) {
      return { path: npmBinPath, error: null };
    }
  }

  return { path: null, error: 'cli_not_found' };
}

// =============================================================================
// Gemini CLI Detection
// =============================================================================

/**
 * 偵測 Gemini CLI 路徑
 */
export async function detectGemini(userConfigPath?: string): Promise<CliDetectionResult> {
  const home = getHomedir();

  // 1. 使用者設定路徑（從環境變數）
  const envPath = userConfigPath ?? process.env.ORCHESTRATOR_GEMINI_PATH;
  if (envPath) {
    const resolvedPath = path.resolve(envPath);
    if (await fileExists(resolvedPath)) {
      return { path: resolvedPath, error: null };
    }
  }

  // 2. which/where 命令
  const whichCmd = isWindows() ? 'where gemini' : 'which gemini';
  const whichResult = await execCommand(whichCmd);
  if (whichResult) {
    const firstLine = whichResult.split('\n')[0]?.trim();
    if (firstLine && await fileExists(firstLine)) {
      return { path: firstLine, error: null };
    }
  }

  // 3. ~/.npm-global/bin/gemini（npm 自訂 prefix）
  const npmGlobalPath = path.join(home, '.npm-global', 'bin', isWindows() ? 'gemini.cmd' : 'gemini');
  if (await fileExists(npmGlobalPath)) {
    return { path: npmGlobalPath, error: null };
  }

  // 4. npm root -g 動態查詢
  const npmRoot = await execCommand('npm root -g');
  if (npmRoot) {
    const npmBinPath = path.join(path.dirname(npmRoot), 'bin', isWindows() ? 'gemini.cmd' : 'gemini');
    if (await fileExists(npmBinPath)) {
      return { path: npmBinPath, error: null };
    }
  }

  return { path: null, error: 'cli_not_found' };
}

// =============================================================================
// Authentication Check
// =============================================================================

/**
 * 檢查 Claude Code 認證憑證
 *
 * 認證快取位置：
 * - Linux/Windows: ~/.claude/.credentials.json
 * - macOS: 使用系統 Keychain（暫時假設已認證）
 */
export async function checkClaudeAuth(): Promise<AuthCheckResult> {
  const platform = process.platform;

  // macOS 使用 Keychain，無法簡單檢查
  if (platform === 'darwin') {
    // TODO: [CLARIFY] 需要確認 Keychain 的 service 名稱
    // 暫時假設已認證，實際執行時 CLI 會報錯
    return { authenticated: true };
  }

  // Linux/Windows: 檢查憑證檔案
  const credsPath = path.join(getHomedir(), '.claude', '.credentials.json');

  try {
    await fs.promises.access(credsPath, fs.constants.R_OK);
    return { authenticated: true };
  } catch {
    return { authenticated: false, error: 'error:cli_not_authenticated' };
  }
}

/**
 * 檢查 Gemini CLI 認證憑證
 *
 * 認證快取位置：~/.gemini/settings.json
 */
export async function checkGeminiAuth(): Promise<AuthCheckResult> {
  const settingsPath = path.join(getHomedir(), '.gemini', 'settings.json');

  try {
    await fs.promises.access(settingsPath, fs.constants.R_OK);
    return { authenticated: true };
  } catch {
    return { authenticated: false, error: 'error:cli_not_authenticated' };
  }
}

// =============================================================================
// Combined Detection
// =============================================================================

export interface CliPaths {
  claude: string | null;
  gemini: string | null;
  windowsConfig: WindowsConfig;
  errors: {
    claude?: CliDetectionResult['error'];
    gemini?: CliDetectionResult['error'];
  };
}

/**
 * 偵測所有 CLI 路徑
 */
export async function detectAllClis(): Promise<CliPaths> {
  const [claudeResult, geminiResult, windowsConfig] = await Promise.all([
    detectClaude(),
    detectGemini(),
    getWindowsConfig(),
  ]);

  return {
    claude: claudeResult.path,
    gemini: geminiResult.path,
    windowsConfig,
    errors: {
      claude: claudeResult.error ?? undefined,
      gemini: geminiResult.error ?? undefined,
    },
  };
}
