/**
 * State MCP STDIO Proxy
 *
 * 橋接 STDIO MCP 協議到 HTTP MCP (port 3702)。
 * 用於 Gemini CLI ACP，因為它只支援 command/args 型式的 MCP server。
 *
 * Usage: node stdio-proxy.js --port=3702
 *
 * 生命週期：
 * 1. 連接到上游 HTTP MCP server
 * 2. 列出所有可用工具
 * 3. 開啟 STDIO MCP server 重新導出所有工具
 * 4. 輸出 "ready" 信號給父程序
 * 5. 等待 SIGTERM/SIGINT 關閉
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_PORT = 3702;

interface Tool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/**
 * 解析命令列參數
 */
function parseArgs(): { port: number } {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : DEFAULT_PORT;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`[STDIO Proxy] Invalid port: ${portArg}`);
    process.exit(1);
  }

  return { port };
}

/**
 * 主函數
 */
async function main(): Promise<void> {
  const { port } = parseArgs();
  const upstreamUrl = `http://127.0.0.1:${port}/mcp`;

  console.error(`[STDIO Proxy] Connecting to upstream: ${upstreamUrl}`);

  // 連接到上游 HTTP MCP server
  const upstream = new Client({ name: 'stdio-proxy', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(upstreamUrl));

  try {
    await upstream.connect(transport);
  } catch (err) {
    console.error(`[STDIO Proxy] Failed to connect to upstream: ${err}`);
    process.exit(1);
  }

  console.error('[STDIO Proxy] Connected to upstream');

  // 列出上游所有工具
  let upstreamTools: Tool[];
  try {
    const toolsResult = await upstream.listTools();
    upstreamTools = (toolsResult.tools || []) as Tool[];
    console.error(
      `[STDIO Proxy] Found ${upstreamTools.length} tools from upstream`
    );
  } catch (err) {
    console.error(`[STDIO Proxy] Failed to list tools: ${err}`);
    process.exit(1);
  }

  // 建立 STDIO MCP server
  const server = new McpServer({
    name: 'state-proxy',
    version: '1.0.0',
  });

  // 重新導出每個上游工具
  for (const tool of upstreamTools) {
    console.error(`[STDIO Proxy] Registering tool: ${tool.name}`);

    server.tool(
      tool.name,
      tool.description ?? '',
      tool.inputSchema as Record<string, unknown>,
      async (args) => {
        // 轉發到上游
        try {
          const result = await upstream.callTool({
            name: tool.name,
            arguments: args,
          });
          // 確保返回正確格式
          if ('content' in result) {
            return result as { content: Array<{ type: 'text'; text: string }> };
          }
          // 如果沒有 content，包裝 toolResult
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
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

  // 連接 STDIO transport
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  console.error('[STDIO Proxy] STDIO server started');

  // 輸出 ready 信號給父程序（寫到 stdout）
  console.log('ready');

  // 保持程序運行
  process.stdin.resume();
}

// 處理關閉信號
process.on('SIGTERM', () => {
  console.error('[STDIO Proxy] Received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[STDIO Proxy] Received SIGINT, shutting down');
  process.exit(0);
});

// 處理未捕獲的錯誤
process.on('uncaughtException', (err) => {
  console.error('[STDIO Proxy] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[STDIO Proxy] Unhandled rejection:', reason);
  process.exit(1);
});

// 執行主函數
main().catch((err) => {
  console.error(`[STDIO Proxy] Fatal error: ${err}`);
  process.exit(1);
});
