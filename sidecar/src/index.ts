/**
 * Orchestrator Tower - Node.js Sidecar
 *
 * This is the entry point for the Node.js sidecar process.
 * It will be spawned by the Tauri application to manage CLI subprocesses.
 */

import { IpcClient, type RustCommand } from './ipc/index.js';
import { startTowerMcpServer, type TowerMcpServer } from './mcp-servers/tower/index.js';

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

// =============================================================================
// Tower MCP Server (Task 06)
// =============================================================================

const TOWER_PORT = 3701;
let towerMcpServer: TowerMcpServer | null = null;

/**
 * 初始化 Tower MCP Server
 */
async function initializeTowerMcp(): Promise<void> {
  try {
    towerMcpServer = await startTowerMcpServer(ipcClient, {
      preferredPort: TOWER_PORT,
    });
    console.log(
      `[Sidecar] Tower MCP Server started on port ${towerMcpServer.actualPort}`
    );
  } catch (err) {
    console.error('[Sidecar] Failed to start Tower MCP Server:', err);
    throw err;
  }
}

// =============================================================================
// IPC Events
// =============================================================================

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
      // 路由至 Tower MCP Server
      if (towerMcpServer) {
        towerMcpServer.handleHitlResponse(command);
      } else {
        console.warn('[Sidecar] Tower MCP Server not initialized, ignoring HITL response');
      }
      break;

    default:
      console.warn('[Sidecar] Unknown command type:', (command as RustCommand).type);
  }
}

// =============================================================================
// Startup
// =============================================================================

async function startup(): Promise<void> {
  // 啟動 Tower MCP Server
  await initializeTowerMcp();

  // 連線至 Rust IPC Server
  ipcClient.connect();

  console.log('[Sidecar] Ready and waiting for IPC connection...');
}

// 保持程序運行
process.stdin.resume();

// 執行啟動
startup().catch((err) => {
  console.error('[Sidecar] Startup failed:', err);
  process.exit(1);
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function shutdown(): Promise<void> {
  console.log('[Sidecar] Shutting down...');

  // 關閉 Tower MCP Server
  if (towerMcpServer) {
    await towerMcpServer.shutdown();
    towerMcpServer = null;
  }

  // 斷開 IPC 連線
  ipcClient.disconnect();

  console.log('[Sidecar] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => {
  console.log('[Sidecar] Received SIGTERM');
  shutdown();
});

process.on('SIGINT', () => {
  console.log('[Sidecar] Received SIGINT');
  shutdown();
});
