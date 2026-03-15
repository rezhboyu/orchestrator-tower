/**
 * Tower MCP Server - Express + MCP SDK 整合
 *
 * 提供 HTTP MCP Server 端點給 Claude Code Worker Agents。
 * 使用路徑式路由 /mcp/:agentId 來識別不同的 Agent。
 */

import express, { type Express, type Request, type Response } from 'express';
import { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { IpcClient } from '../../ipc/client.js';
import { PendingHitlManager } from './pending-manager.js';
import { registerAuthTool } from './auth-tool.js';
import type { TowerSession } from './types.js';

/**
 * 建立 MCP Server 實例
 *
 * @param agentId - Agent ID（用於 HITL 請求）
 * @param ipcClient - IPC 客戶端
 * @param pendingManager - Pending HITL 管理器
 * @returns McpServer 實例
 */
function createMcpServer(
  agentId: string,
  ipcClient: IpcClient,
  pendingManager: PendingHitlManager
): McpServer {
  const server = new McpServer({
    name: 'tower',
    version: '1.0.0',
  });

  // 註冊 auth tool
  registerAuthTool(server, agentId, ipcClient, pendingManager);

  return server;
}

/**
 * Tower HTTP Server
 *
 * 管理 Express 應用和 MCP sessions
 */
export class TowerHttpServer {
  private app: Express;
  private httpServer: HttpServer | null = null;
  private sessions = new Map<string, TowerSession>();
  private transports = new Map<string, StreamableHTTPServerTransport>();
  private ipcClient: IpcClient;
  private pendingManager: PendingHitlManager;
  private _actualPort = 0;

  constructor(ipcClient: IpcClient, pendingManager: PendingHitlManager) {
    this.ipcClient = ipcClient;
    this.pendingManager = pendingManager;
    this.app = this.createExpressApp();
  }

  /**
   * 取得實際監聽的 port
   */
  get actualPort(): number {
    return this._actualPort;
  }

  /**
   * 建立 Express 應用
   */
  private createExpressApp(): Express {
    const app = express();

    // 解析 JSON body
    app.use(express.json());

    // 健康檢查端點
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        server: 'tower-mcp',
        sessions: this.sessions.size,
        pendingHitl: this.pendingManager.size,
      });
    });

    // MCP 端點：路徑式路由
    app.all('/mcp/:agentId', async (req: Request, res: Response) => {
      const { agentId } = req.params;

      try {
        await this.handleMcpRequest(agentId, req, res);
      } catch (err) {
        console.error(`[Tower MCP] Error handling request for agent ${agentId}:`, err);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    });

    // 404 handler
    app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not found',
        hint: 'Use /mcp/:agentId for MCP requests',
      });
    });

    return app;
  }

  /**
   * 處理 MCP 請求
   */
  private async handleMcpRequest(
    agentId: string,
    req: Request,
    res: Response
  ): Promise<void> {
    // 取得或建立 session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? this.transports.get(sessionId) : undefined;

    if (!transport) {
      // 建立新的 MCP server 和 transport
      const server = createMcpServer(agentId, this.ipcClient, this.pendingManager);

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          const newSessionId = randomUUID();
          console.log(`[Tower MCP] New session: ${newSessionId} for agent ${agentId}`);

          // 記錄 session
          this.sessions.set(newSessionId, {
            sessionId: newSessionId,
            agentId,
            createdAt: Date.now(),
          });

          return newSessionId;
        },
        onsessioninitialized: (sid: string) => {
          this.transports.set(sid, transport!);
        },
      });

      // 設定 session 關閉回調
      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid) {
          console.log(`[Tower MCP] Session closed: ${sid}`);
          this.sessions.delete(sid);
          this.transports.delete(sid);
        }
      };

      // 連接 server 和 transport
      await server.connect(transport);
    }

    // 處理請求
    await transport.handleRequest(req, res, req.body);
  }

  /**
   * 啟動 HTTP Server
   *
   * @param port - 監聽的 port
   * @returns Promise 在 server 啟動後 resolve
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(port, '127.0.0.1', () => {
        this._actualPort = port;
        console.log(`[Tower MCP] HTTP Server listening on http://127.0.0.1:${port}`);
        resolve();
      });

      this.httpServer.on('error', (err) => {
        console.error('[Tower MCP] HTTP Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * 關閉 HTTP Server
   */
  async shutdown(): Promise<void> {
    console.log('[Tower MCP] Shutting down...');

    // 關閉所有 transports
    for (const [sessionId, transport] of this.transports) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`[Tower MCP] Error closing transport ${sessionId}:`, err);
      }
    }
    this.transports.clear();
    this.sessions.clear();

    // 關閉 HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      this.httpServer = null;
    }

    console.log('[Tower MCP] Shutdown complete');
  }

  /**
   * 取得所有 active sessions
   */
  getActiveSessions(): TowerSession[] {
    return Array.from(this.sessions.values());
  }
}
