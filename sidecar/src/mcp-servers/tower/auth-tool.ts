/**
 * Auth Tool - mcp__tower__auth 工具實作
 *
 * 這是 Tower MCP Server 暴露給 Claude Code 的唯一工具。
 * 當 Claude Code 使用 --permission-prompt-tool 執行工具時，
 * 會先呼叫此 auth tool 進行權限檢查。
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IpcClient } from '../../ipc/client.js';
import type { HitlRequest } from '../../ipc/messages.js';
import type { AuthToolResponse } from './types.js';
import { PendingHitlManager } from './pending-manager.js';
import { classifyRisk, requiresHumanApproval } from './risk-classifier.js';

/**
 * Auth Tool 輸入 Schema
 *
 * 關鍵：必須使用 z.record(z.string(), z.unknown()) 而非 z.record(z.unknown())
 * 否則 Claude Code 會報 invalid_union 錯誤
 */
export const AuthToolInputSchema = z.object({
  tool_name: z.string().describe('The name of the tool being called'),
  tool_use_id: z.string().describe('Unique identifier for this tool invocation'),
  input: z
    .record(z.string(), z.unknown())
    .describe('The original input arguments for the tool'),
});

/**
 * 建立 auth tool handler
 *
 * @param agentId - 當前 Agent ID（從 URL 路徑提取）
 * @param ipcClient - IPC 客戶端用於發送 HITL 請求
 * @param pendingManager - Pending HITL 管理器
 * @returns Tool handler function
 */
export function createAuthToolHandler(
  agentId: string,
  ipcClient: IpcClient,
  pendingManager: PendingHitlManager
): (args: z.infer<typeof AuthToolInputSchema>) => Promise<AuthToolResponse> {
  return async (args: z.infer<typeof AuthToolInputSchema>): Promise<AuthToolResponse> => {
    const { tool_name, tool_use_id: _tool_use_id, input } = args;

    console.log(
      `[Tower MCP] Auth request for tool '${tool_name}' from agent '${agentId}'`
    );

    // 分類風險等級
    const riskLevel = classifyRisk(tool_name, input);
    console.log(`[Tower MCP] Risk level: ${riskLevel}`);

    // 低風險：自動批准
    if (!requiresHumanApproval(riskLevel)) {
      console.log(`[Tower MCP] Auto-approving low-risk tool: ${tool_name}`);
      return {
        behavior: 'allow',
        updatedInput: input,
      };
    }

    // 高風險：需要人類審批
    const requestId = randomUUID();
    console.log(
      `[Tower MCP] Requesting human approval for ${tool_name} (requestId: ${requestId})`
    );

    // 發送 HITL 請求給 Rust
    const hitlRequest: HitlRequest = {
      type: 'hitl:request',
      agentId,
      requestId,
      toolName: tool_name,
      input,
      riskLevel,
      source: 'tower-mcp',
    };

    const sent = ipcClient.send(hitlRequest);
    if (!sent) {
      console.error('[Tower MCP] Failed to send HITL request via IPC');
      return {
        behavior: 'deny',
        message: 'Internal error: IPC connection unavailable',
      };
    }

    // 等待 HITL 回應（會阻塞直到收到回應或超時）
    const response = await pendingManager.waitForResponse(
      requestId,
      agentId,
      tool_name,
      input
    );

    console.log(
      `[Tower MCP] HITL response for ${requestId}: ${response.behavior}`
    );

    return response;
  };
}

/**
 * 註冊 auth tool 到 MCP Server
 *
 * @param server - MCP Server 實例
 * @param agentId - Agent ID
 * @param ipcClient - IPC 客戶端
 * @param pendingManager - Pending HITL 管理器
 */
export function registerAuthTool(
  server: McpServer,
  agentId: string,
  ipcClient: IpcClient,
  pendingManager: PendingHitlManager
): void {
  const handler = createAuthToolHandler(agentId, ipcClient, pendingManager);

  // 註冊 tool
  // 注意：MCP SDK 的 tool 方法簽名可能需要調整
  server.tool(
    'auth',
    'Authorize tool execution for HITL (Human-In-The-Loop) approval',
    AuthToolInputSchema.shape,
    async (args) => {
      const response = await handler(args as z.infer<typeof AuthToolInputSchema>);

      // MCP tool 回傳格式
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response),
          },
        ],
      };
    }
  );
}
