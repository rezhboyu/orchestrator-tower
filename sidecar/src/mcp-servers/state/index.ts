/**
 * State MCP Server - 模組入口
 *
 * 暴露 startStateMcpServer 函數用於啟動 State MCP Server。
 * State MCP Server 是 Master Orchestrator 的狀態查詢與控制閘道。
 */

import type { IpcClient } from '../../ipc/client.js';
import type { StateMcpServer, StateMcpServerConfig } from './types.js';
import { findAvailablePort } from '../tower/port-finder.js';
import { StateHttpServer } from './server.js';

// Re-export types
export type { StateMcpServer, StateMcpServerConfig } from './types.js';
export type {
  WorkerStatusResult,
  QuotaStatusResult,
  GitSnapshotResult,
  HitlOperationResult,
  BModeStatusResult,
} from './types.js';

// Re-export tools for testing
export * as stateTools from './tools.js';

/** 預設 State MCP Server port */
const DEFAULT_STATE_PORT = 3702;

/** 預設最大 port 嘗試次數 */
const DEFAULT_MAX_PORT_ATTEMPTS = 10;

/**
 * State MCP Server 實作
 */
class StateMcpServerImpl implements StateMcpServer {
  private httpServer: StateHttpServer;
  private _actualPort: number;

  constructor(httpServer: StateHttpServer, actualPort: number) {
    this.httpServer = httpServer;
    this._actualPort = actualPort;
  }

  get actualPort(): number {
    return this._actualPort;
  }

  async shutdown(): Promise<void> {
    await this.httpServer.shutdown();
  }
}

/**
 * 啟動 State MCP Server
 *
 * @param ipcClient - IPC 客戶端用於查詢 Rust AppState
 * @param config - Server 配置（可選）
 * @returns StateMcpServer 實例
 */
export async function startStateMcpServer(
  ipcClient: IpcClient,
  config: Partial<StateMcpServerConfig> = {}
): Promise<StateMcpServer> {
  const preferredPort = config.preferredPort ?? DEFAULT_STATE_PORT;
  const maxPortAttempts = config.maxPortAttempts ?? DEFAULT_MAX_PORT_ATTEMPTS;

  console.log(
    `[State MCP] Starting server (preferred port: ${preferredPort})`
  );

  // 找到可用的 port
  const actualPort = await findAvailablePort(preferredPort, maxPortAttempts);

  if (actualPort !== preferredPort) {
    console.log(
      `[State MCP] Port ${preferredPort} unavailable, using ${actualPort}`
    );
  }

  // 建立並啟動 HTTP server
  const httpServer = new StateHttpServer(ipcClient);
  await httpServer.start(actualPort);

  // 建立 server wrapper
  const server = new StateMcpServerImpl(httpServer, actualPort);

  console.log(`[State MCP] Server started successfully on port ${actualPort}`);

  return server;
}
