/**
 * Tower MCP Server - 模組入口
 *
 * 暴露 startTowerMcpServer 函數用於啟動 Tower MCP Server。
 * Tower MCP Server 是 Worker Agent (Claude Code) 的 HITL 閘道。
 */

import type { IpcClient } from '../../ipc/client.js';
import type { HitlResponse } from '../../ipc/messages.js';
import type { TowerMcpServer, TowerMcpServerConfig } from './types.js';
import { findAvailablePort } from './port-finder.js';
import { PendingHitlManager } from './pending-manager.js';
import { TowerHttpServer } from './server.js';

// Re-export types
export type { TowerMcpServer, TowerMcpServerConfig } from './types.js';
export type { RiskLevel, AuthToolResponse } from './types.js';

// Re-export utilities for testing
export { classifyRisk, requiresHumanApproval } from './risk-classifier.js';
export { PendingHitlManager } from './pending-manager.js';
export { findAvailablePort, isPortAvailable } from './port-finder.js';

/** 預設 Tower MCP Server port */
const DEFAULT_TOWER_PORT = 3701;

/** 預設最大 port 嘗試次數 */
const DEFAULT_MAX_PORT_ATTEMPTS = 10;

/** 預設 HITL 超時時間（5 分鐘） */
const DEFAULT_HITL_TIMEOUT = 5 * 60 * 1000;

/**
 * Tower MCP Server 實作
 */
class TowerMcpServerImpl implements TowerMcpServer {
  private httpServer: TowerHttpServer;
  private pendingManager: PendingHitlManager;
  private _actualPort: number;

  constructor(
    httpServer: TowerHttpServer,
    pendingManager: PendingHitlManager,
    actualPort: number
  ) {
    this.httpServer = httpServer;
    this.pendingManager = pendingManager;
    this._actualPort = actualPort;
  }

  get actualPort(): number {
    return this._actualPort;
  }

  handleHitlResponse(response: HitlResponse): void {
    const resolved = this.pendingManager.resolveRequest(response);
    if (!resolved) {
      console.warn(
        `[Tower MCP] HITL response for unknown request: ${response.requestId}`
      );
    }
  }

  async shutdown(): Promise<void> {
    // Reject 所有 pending requests
    this.pendingManager.rejectAll('Tower MCP Server shutting down');

    // 關閉 HTTP server
    await this.httpServer.shutdown();
  }
}

/**
 * 啟動 Tower MCP Server
 *
 * @param config - Server 配置（可選）
 * @param ipcClient - IPC 客戶端用於發送 HITL 請求
 * @returns TowerMcpServer 實例
 */
export async function startTowerMcpServer(
  ipcClient: IpcClient,
  config: Partial<TowerMcpServerConfig> = {}
): Promise<TowerMcpServer> {
  const preferredPort = config.preferredPort ?? DEFAULT_TOWER_PORT;
  const maxPortAttempts = config.maxPortAttempts ?? DEFAULT_MAX_PORT_ATTEMPTS;
  const hitlTimeout = config.hitlTimeout ?? DEFAULT_HITL_TIMEOUT;

  console.log(
    `[Tower MCP] Starting server (preferred port: ${preferredPort}, timeout: ${hitlTimeout}ms)`
  );

  // 找到可用的 port
  const actualPort = await findAvailablePort(preferredPort, maxPortAttempts);

  if (actualPort !== preferredPort) {
    console.log(
      `[Tower MCP] Port ${preferredPort} unavailable, using ${actualPort}`
    );
  }

  // 建立 pending manager
  const pendingManager = new PendingHitlManager(hitlTimeout);

  // 建立並啟動 HTTP server
  const httpServer = new TowerHttpServer(ipcClient, pendingManager);
  await httpServer.start(actualPort);

  // 建立 server wrapper
  const server = new TowerMcpServerImpl(httpServer, pendingManager, actualPort);

  console.log(`[Tower MCP] Server started successfully on port ${actualPort}`);

  return server;
}
