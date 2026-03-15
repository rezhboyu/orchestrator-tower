/**
 * State MCP Server - Express + MCP SDK 整合
 *
 * 提供 HTTP MCP Server 端點給 Master Orchestrator。
 * 使用單一 /mcp 端點（不像 Tower MCP 的 /mcp/:agentId）。
 */

import express, { type Express, type Request, type Response } from 'express';
import { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IpcClient } from '../../ipc/client.js';
import type { StateSession } from './types.js';
import * as tools from './tools.js';

/**
 * State HTTP Server
 *
 * 管理 Express 應用和 MCP sessions
 */
export class StateHttpServer {
  private app: Express;
  private httpServer: HttpServer | null = null;
  private sessions = new Map<string, StateSession>();
  private transports = new Map<string, StreamableHTTPServerTransport>();
  private ipcClient: IpcClient;
  private _actualPort = 0;

  constructor(ipcClient: IpcClient) {
    this.ipcClient = ipcClient;
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
        server: 'state-mcp',
        sessions: this.sessions.size,
      });
    });

    // MCP 端點：單一端點（無 :agentId）
    app.all('/mcp', async (req: Request, res: Response) => {
      try {
        await this.handleMcpRequest(req, res);
      } catch (err) {
        console.error('[State MCP] Error handling request:', err);
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
        hint: 'Use /mcp for MCP requests',
      });
    });

    return app;
  }

  /**
   * 處理 MCP 請求
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    // 取得或建立 session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? this.transports.get(sessionId) : undefined;

    if (!transport) {
      // 建立新的 MCP server 和 transport
      const server = this.createMcpServer();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          const newSessionId = randomUUID();
          console.log(`[State MCP] New session: ${newSessionId}`);

          // 記錄 session
          this.sessions.set(newSessionId, {
            sessionId: newSessionId,
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
          console.log(`[State MCP] Session closed: ${sid}`);
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
   * 建立 MCP Server 並註冊所有工具
   */
  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: 'state',
      version: '1.0.0',
    });

    this.registerTools(server);
    return server;
  }

  /**
   * 註冊所有 8 個工具
   */
  private registerTools(server: McpServer): void {
    const ipcClient = this.ipcClient;

    // get_worker_status
    server.tool(
      'get_worker_status',
      'Get the current status of a worker agent',
      tools.GetWorkerStatusSchema.shape,
      async (args) => {
        try {
          const result = await tools.getWorkerStatus(
            args as z.infer<typeof tools.GetWorkerStatusSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // assign_task
    server.tool(
      'assign_task',
      'Assign a new task to a worker agent',
      tools.AssignTaskSchema.shape,
      async (args) => {
        try {
          const result = await tools.assignTask(
            args as z.infer<typeof tools.AssignTaskSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // pause_worker
    server.tool(
      'pause_worker',
      'Pause a worker agent (freeze with reason: orchestrator)',
      tools.PauseWorkerSchema.shape,
      async (args) => {
        try {
          const result = await tools.pauseWorker(
            args as z.infer<typeof tools.PauseWorkerSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // resume_worker
    server.tool(
      'resume_worker',
      'Resume a paused worker agent (unfreeze with reason: orchestrator)',
      tools.ResumeWorkerSchema.shape,
      async (args) => {
        try {
          const result = await tools.resumeWorker(
            args as z.infer<typeof tools.ResumeWorkerSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // approve_hitl (B mode gated)
    server.tool(
      'approve_hitl',
      'Approve a pending HITL request (requires B mode enabled)',
      tools.ApproveHitlSchema.shape,
      async (args) => {
        try {
          // 查詢 B mode 狀態
          const bModeStatus = await tools.getBModeStatus(ipcClient);
          const result = await tools.approveHitl(
            args as z.infer<typeof tools.ApproveHitlSchema>,
            ipcClient,
            bModeStatus.enabled
          );

          if (result.status === 403) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: result.error,
                    status: 403,
                  }),
                },
              ],
              isError: true,
            };
          }

          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // deny_hitl (B mode gated)
    server.tool(
      'deny_hitl',
      'Deny a pending HITL request (requires B mode enabled)',
      tools.DenyHitlSchema.shape,
      async (args) => {
        try {
          // 查詢 B mode 狀態
          const bModeStatus = await tools.getBModeStatus(ipcClient);
          const result = await tools.denyHitl(
            args as z.infer<typeof tools.DenyHitlSchema>,
            ipcClient,
            bModeStatus.enabled
          );

          if (result.status === 403) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: result.error,
                    status: 403,
                  }),
                },
              ],
              isError: true,
            };
          }

          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // get_quota_status
    server.tool(
      'get_quota_status',
      'Get the current quota status',
      tools.GetQuotaStatusSchema.shape,
      async (args) => {
        try {
          const result = await tools.getQuotaStatus(
            args as z.infer<typeof tools.GetQuotaStatusSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );

    // get_git_snapshot
    server.tool(
      'get_git_snapshot',
      'Get the latest git snapshot SHA for a worker agent',
      tools.GetGitSnapshotSchema.shape,
      async (args) => {
        try {
          const result = await tools.getGitSnapshot(
            args as z.infer<typeof tools.GetGitSnapshotSchema>,
            ipcClient
          );
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      }
    );
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
        console.log(
          `[State MCP] HTTP Server listening on http://127.0.0.1:${port}`
        );
        resolve();
      });

      this.httpServer.on('error', (err) => {
        console.error('[State MCP] HTTP Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * 關閉 HTTP Server
   */
  async shutdown(): Promise<void> {
    console.log('[State MCP] Shutting down...');

    // 關閉所有 transports
    for (const [sessionId, transport] of this.transports) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`[State MCP] Error closing transport ${sessionId}:`, err);
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

    console.log('[State MCP] Shutdown complete');
  }

  /**
   * 取得所有 active sessions
   */
  getActiveSessions(): StateSession[] {
    return Array.from(this.sessions.values());
  }
}
