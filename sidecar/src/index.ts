/**
 * Orchestrator Tower - Node.js Sidecar
 *
 * This is the entry point for the Node.js sidecar process.
 * It will be spawned by the Tauri application to manage CLI subprocesses.
 */

import { IpcClient, type RustCommand } from './ipc/index.js';

console.log('[Sidecar] Orchestrator Tower Sidecar starting...');
console.log(`[Sidecar] Node.js version: ${process.version}`);
console.log(`[Sidecar] PID: ${process.pid}`);

// =============================================================================
// IPC Client
// =============================================================================

const ipcClient = new IpcClient({
  reconnectInterval: 1000,
  heartbeatInterval: 1000,
  queryTimeout: 10000,
  maxReconnectAttempts: 10,
});

// 連線事件
ipcClient.on('connect', () => {
  console.log('[Sidecar] Connected to Rust IPC server');
});

ipcClient.on('disconnect', () => {
  console.log('[Sidecar] Disconnected from Rust IPC server');
});

ipcClient.on('reconnecting', (attempt) => {
  console.log(`[Sidecar] Reconnecting to Rust IPC server (attempt ${attempt})`);
});

ipcClient.on('error', (err) => {
  console.error('[Sidecar] IPC error:', err.message);
});

// 處理來自 Rust 的指令
ipcClient.on('command', (command: RustCommand) => {
  console.log('[Sidecar] Received command:', command.type);
  handleCommand(command);
});

/**
 * 處理 Rust 指令
 */
function handleCommand(command: RustCommand): void {
  switch (command.type) {
    case 'agent:start':
      console.log(`[Sidecar] Starting agent ${command.agentId}`);
      // TODO: Task 05 實作 Agent 子程序管理
      break;

    case 'agent:stop':
      console.log(`[Sidecar] Stopping agent ${command.agentId}`);
      // TODO: Task 05 實作 Agent 子程序管理
      break;

    case 'agent:assign':
      console.log(`[Sidecar] Assigning task to agent ${command.agentId}`);
      // TODO: Task 05 實作 Agent 子程序管理
      break;

    case 'agent:freeze':
      console.log(
        `[Sidecar] Freezing agent ${command.agentId} (reason: ${command.reason})`
      );
      // TODO: Task 05 實作 Agent 子程序管理
      break;

    case 'agent:unfreeze':
      console.log(
        `[Sidecar] Unfreezing agent ${command.agentId} (reason: ${command.reason})`
      );
      // TODO: Task 05 實作 Agent 子程序管理
      break;

    case 'hitl:response':
      console.log(
        `[Sidecar] HITL response for ${command.requestId}: ${command.approved ? 'approved' : 'denied'}`
      );
      // TODO: Task 06 實作 Tower MCP Server
      break;

    default:
      console.warn('[Sidecar] Unknown command type:', (command as RustCommand).type);
  }
}

// =============================================================================
// Startup
// =============================================================================

// 連線至 Rust IPC Server
ipcClient.connect();

// 保持程序運行
process.stdin.resume();

// =============================================================================
// Graceful Shutdown
// =============================================================================

process.on('SIGTERM', () => {
  console.log('[Sidecar] Received SIGTERM, shutting down...');
  ipcClient.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Sidecar] Received SIGINT, shutting down...');
  ipcClient.disconnect();
  process.exit(0);
});

console.log('[Sidecar] Ready and waiting for IPC connection...');
