/**
 * Orchestrator Tower - Node.js Sidecar
 *
 * This is the entry point for the Node.js sidecar process.
 * It will be spawned by the Tauri application to manage CLI subprocesses.
 */

import { IpcClient, type RustCommand } from './ipc/index.js';
import { startTowerMcpServer, type TowerMcpServer } from './mcp-servers/tower/index.js';
import { startStateMcpServer, type StateMcpServer } from './mcp-servers/state/index.js';
import { AgentManager } from './agent-manager/index.js';

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
// Agent Manager (Task 05)
// =============================================================================

const agentManager = new AgentManager(ipcClient);

// Agent 事件監聽
agentManager.on('agentStarted', (agentId) => {
  console.log(`[Sidecar] Agent started: ${agentId}`);
});

agentManager.on('agentStopped', (agentId) => {
  console.log(`[Sidecar] Agent stopped: ${agentId}`);
});

agentManager.on('agentCrashed', (agentId, info) => {
  console.error(`[Sidecar] Agent crashed: ${agentId}`, info);
});

agentManager.on('error', (agentId, err) => {
  console.error(`[Sidecar] Agent error: ${agentId}`, err.message);
});

// =============================================================================
// Port Configuration (從 Rust AppState 透過環境變數傳入)
// =============================================================================

/**
 * 從環境變數讀取 port（Rust 啟動 Sidecar 時設定）
 * 不使用硬編碼，符合 Spec 要求
 */
function getPortFromEnv(envVar: string, defaultPort: number): number {
  const envValue = process.env[envVar];
  if (envValue) {
    const port = parseInt(envValue, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      console.log(`[Sidecar] ${envVar}=${port} (from environment)`);
      return port;
    }
    console.warn(`[Sidecar] Invalid ${envVar}="${envValue}", using default ${defaultPort}`);
  } else {
    console.log(`[Sidecar] ${envVar} not set, using default ${defaultPort}`);
  }
  return defaultPort;
}

const TOWER_PORT = getPortFromEnv('TOWER_PORT', 3701);
const STATE_PORT = getPortFromEnv('STATE_PORT', 3702);

// =============================================================================
// Tower MCP Server (Task 06)
// =============================================================================

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
// State MCP Server (Task 07)
// =============================================================================

let stateMcpServer: StateMcpServer | null = null;

/**
 * 初始化 State MCP Server
 */
async function initializeStateMcp(): Promise<void> {
  try {
    stateMcpServer = await startStateMcpServer(ipcClient, {
      preferredPort: STATE_PORT,
    });
    console.log(
      `[Sidecar] State MCP Server started on port ${stateMcpServer.actualPort}`
    );
  } catch (err) {
    console.error('[Sidecar] Failed to start State MCP Server:', err);
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
 *
 * NOTE: agent:* 指令由 AgentManager 內部處理（它自己監聽 ipcClient.on('command')）
 *       這裡只處理 hitl:response
 */
function handleCommand(command: RustCommand): void {
  switch (command.type) {
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

    // agent:* 指令由 AgentManager 處理，這裡不需要 case
    default:
      // 其他指令（包括 agent:*）會被 AgentManager 處理
      break;
  }
}

// =============================================================================
// Startup
// =============================================================================

async function startup(): Promise<void> {
  // 初始化 AgentManager（偵測 CLI 路徑）
  await agentManager.initialize();

  // 啟動 Tower MCP Server
  await initializeTowerMcp();

  // 啟動 State MCP Server
  await initializeStateMcp();

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

  // 關閉所有 Agent
  await agentManager.shutdown();

  // 關閉 Tower MCP Server
  if (towerMcpServer) {
    await towerMcpServer.shutdown();
    towerMcpServer = null;
  }

  // 關閉 State MCP Server
  if (stateMcpServer) {
    await stateMcpServer.shutdown();
    stateMcpServer = null;
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
