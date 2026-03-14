/**
 * IPC Client Tests
 *
 * 測試 IPC 訊息型別和平台路徑選擇
 */

import { describe, it, expect } from 'vitest';
import { getSocketPath, getServerSocketPath } from './platform.js';
import type { SidecarEvent, AgentCrash } from './messages.js';

describe('IpcClient', () => {
  describe('platform.ts', () => {
    it('在 Linux 回傳 Unix socket 路徑', () => {
      const path = getSocketPath('agent-1', 'linux');
      expect(path).toBe('/tmp/orchestrator-agent-1.sock');
    });

    it('在 Windows 回傳 Named Pipe 路徑', () => {
      const path = getSocketPath('agent-1', 'win32');
      expect(path).toBe('\\\\.\\pipe\\orchestrator-agent-1');
    });

    it('在 macOS 回傳 Unix socket 路徑', () => {
      const path = getSocketPath('agent-1', 'darwin');
      expect(path).toBe('/tmp/orchestrator-agent-1.sock');
    });

    it('getServerSocketPath 在 Linux 回傳正確路徑', () => {
      const path = getServerSocketPath('linux');
      expect(path).toBe('/tmp/orchestrator-tower-ipc.sock');
    });

    it('getServerSocketPath 在 Windows 回傳正確路徑', () => {
      const path = getServerSocketPath('win32');
      expect(path).toBe('\\\\.\\pipe\\orchestrator-tower-ipc');
    });
  });

  describe('messages.ts', () => {
    it('SidecarEvent 序列化後含正確 type 欄位', () => {
      const event: SidecarEvent = {
        type: 'agent:session_start',
        agentId: 'a1',
        sessionId: 's1',
        model: 'claude-opus-4-6',
      };
      const json = JSON.stringify(event);
      expect(json).toContain('"type":"agent:session_start"');
      expect(json).toContain('"agentId":"a1"');
      expect(json).toContain('"sessionId":"s1"');
      expect(json).toContain('"model":"claude-opus-4-6"');
    });

    it('agent:crash 事件包含所有必要欄位', () => {
      const event: AgentCrash = {
        type: 'agent:crash',
        agentId: 'a1',
        exitCode: 1,
        signal: null,
        lastSessionId: null,
        lastToolUse: null,
      };
      expect(event).toHaveProperty('type', 'agent:crash');
      expect(event).toHaveProperty('agentId');
      expect(event).toHaveProperty('exitCode');
      expect(event).toHaveProperty('signal');
      expect(event).toHaveProperty('lastSessionId');
      expect(event).toHaveProperty('lastToolUse');
    });

    it('agent:crash 事件可包含完整資訊', () => {
      const event: AgentCrash = {
        type: 'agent:crash',
        agentId: 'a1',
        exitCode: 137,
        signal: 'SIGKILL',
        lastSessionId: 'session-123',
        lastToolUse: { toolName: 'Bash', input: { command: 'ls' } },
      };

      const json = JSON.stringify(event);
      expect(json).toContain('"exitCode":137');
      expect(json).toContain('"signal":"SIGKILL"');
      expect(json).toContain('"lastSessionId":"session-123"');
    });

    it('hitl:request 事件包含風險等級和來源', () => {
      const event: SidecarEvent = {
        type: 'hitl:request',
        agentId: 'a1',
        requestId: 'req-1',
        toolName: 'Bash',
        input: { command: 'rm -rf /' },
        riskLevel: 'critical',
        source: 'tower-mcp',
      };

      const json = JSON.stringify(event);
      expect(json).toContain('"riskLevel":"critical"');
      expect(json).toContain('"source":"tower-mcp"');
    });

    it('heartbeat 事件只有 type 欄位', () => {
      const event: SidecarEvent = { type: 'heartbeat' };
      const json = JSON.stringify(event);
      expect(json).toBe('{"type":"heartbeat"}');
    });
  });
});
