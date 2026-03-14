/**
 * Platform-specific IPC socket path selection
 *
 * 根據作業系統選擇適當的 IPC 通道路徑：
 * - Linux/macOS: Unix Domain Socket
 * - Windows: Named Pipe
 */

export type Platform = 'linux' | 'darwin' | 'win32';

/**
 * 取得 IPC socket 路徑
 *
 * @param agentId - Agent 識別碼（用於建立唯一的 socket）
 * @param platform - 作業系統平台（預設使用 process.platform）
 * @returns socket 路徑
 *
 * @example
 * // Linux
 * getSocketPath('agent-1', 'linux') // => '/tmp/orchestrator-agent-1.sock'
 *
 * // Windows
 * getSocketPath('agent-1', 'win32') // => '\\\\.\\pipe\\orchestrator-agent-1'
 */
export function getSocketPath(
  agentId: string,
  platform: Platform | string = process.platform
): string {
  switch (platform) {
    case 'win32':
      // Windows Named Pipe
      // 格式：\\.\pipe\<name>
      return `\\\\.\\pipe\\orchestrator-${agentId}`;

    case 'linux':
    case 'darwin':
    default:
      // Unix Domain Socket
      // 格式：/tmp/orchestrator-<agentId>.sock
      return `/tmp/orchestrator-${agentId}.sock`;
  }
}

/**
 * 取得全域 IPC server socket 路徑（用於 Sidecar ↔ Rust 主通道）
 *
 * @param platform - 作業系統平台
 * @returns socket 路徑
 */
export function getServerSocketPath(
  platform: Platform | string = process.platform
): string {
  switch (platform) {
    case 'win32':
      return '\\\\.\\pipe\\orchestrator-tower-ipc';

    case 'linux':
    case 'darwin':
    default:
      return '/tmp/orchestrator-tower-ipc.sock';
  }
}

/**
 * 檢查當前平台是否為 Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * 檢查當前平台是否為 Unix-like（Linux 或 macOS）
 */
export function isUnixLike(): boolean {
  return process.platform === 'linux' || process.platform === 'darwin';
}
