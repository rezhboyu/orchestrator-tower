/**
 * State MCP Server - Unit Tests
 *
 * 測試 8 個工具的 IPC 代理行為和 B mode 門控邏輯。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tools from './tools.js';
import type { IpcClient } from '../../ipc/client.js';

// =============================================================================
// Mock IPC Client
// =============================================================================

function createMockIpcClient() {
  return {
    send: vi.fn().mockReturnValue(true),
    query: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as IpcClient;
}

// =============================================================================
// Tool Handler Tests
// =============================================================================

describe('State MCP tools', () => {
  let mockIpcClient: ReturnType<typeof createMockIpcClient>;

  beforeEach(() => {
    mockIpcClient = createMockIpcClient();
    vi.clearAllMocks();
  });

  describe('get_worker_status', () => {
    it('should proxy to Rust via IPC query', async () => {
      const mockStatus = {
        id: 'a1',
        status: 'running',
        model: 'claude-sonnet-4',
        projectId: 'p1',
        priority: 0,
      };
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: true,
        data: mockStatus,
      });

      const result = await tools.getWorkerStatus(
        { agentId: 'a1' },
        mockIpcClient
      );

      expect(mockIpcClient.query).toHaveBeenCalledWith('get_worker_status', {
        agentId: 'a1',
      });
      expect(result).toEqual(mockStatus);
    });

    it('should throw error when IPC query fails', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: false,
        error: 'Agent not found',
      });

      await expect(
        tools.getWorkerStatus({ agentId: 'nonexistent' }, mockIpcClient)
      ).rejects.toThrow('Agent not found');
    });
  });

  describe('assign_task', () => {
    it('should send assign_task IPC query', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.assignTask(
        { agentId: 'a1', prompt: 'do something', maxTurns: 10 },
        mockIpcClient
      );

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'assign_task',
        expect.objectContaining({
          agentId: 'a1',
          prompt: 'do something',
          maxTurns: 10,
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('pause_worker', () => {
    it('should send pause_worker IPC query with reason:orchestrator and immediate:true', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.pauseWorker({ agentId: 'a1' }, mockIpcClient);

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'pause_worker',
        expect.objectContaining({
          agentId: 'a1',
          reason: 'orchestrator',
          immediate: true,
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('resume_worker', () => {
    it('should send resume_worker IPC query with reason:orchestrator', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.resumeWorker({ agentId: 'a1' }, mockIpcClient);

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'resume_worker',
        expect.objectContaining({
          agentId: 'a1',
          reason: 'orchestrator',
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('approve_hitl', () => {
    it('should return 403 when B mode is disabled', async () => {
      const result = await tools.approveHitl(
        { requestId: 'r1' },
        mockIpcClient,
        false
      );

      expect(result.status).toBe(403);
      expect(result.error).toContain('B mode is disabled');
      expect(mockIpcClient.query).not.toHaveBeenCalledWith('approve_hitl', expect.anything());
    });

    it('should send approve_hitl IPC query when B mode is enabled', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.approveHitl(
        { requestId: 'r1', modifiedInput: { foo: 'bar' } },
        mockIpcClient,
        true
      );

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'approve_hitl',
        expect.objectContaining({
          requestId: 'r1',
          approved: true,
          modifiedInput: { foo: 'bar' },
        })
      );
      expect(result.success).toBe(true);
    });

    it('should send approve_hitl without modifiedInput when not provided', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.approveHitl(
        { requestId: 'r1' },
        mockIpcClient,
        true
      );

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'approve_hitl',
        expect.objectContaining({
          requestId: 'r1',
          approved: true,
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('deny_hitl', () => {
    it('should return 403 when B mode is disabled', async () => {
      const result = await tools.denyHitl(
        { requestId: 'r1', reason: 'test' },
        mockIpcClient,
        false
      );

      expect(result.status).toBe(403);
      expect(result.error).toContain('B mode is disabled');
      expect(mockIpcClient.query).not.toHaveBeenCalledWith('deny_hitl', expect.anything());
    });

    it('should send deny_hitl IPC query when B mode is enabled', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({ ok: true });

      const result = await tools.denyHitl(
        { requestId: 'r1', reason: 'not allowed' },
        mockIpcClient,
        true
      );

      expect(mockIpcClient.query).toHaveBeenCalledWith(
        'deny_hitl',
        expect.objectContaining({
          requestId: 'r1',
          approved: false,
          reason: 'not allowed',
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('get_quota_status', () => {
    it('should proxy to Rust via IPC query', async () => {
      const mockQuota = {
        tier1_available: 10,
        tier2_available: 50,
        tier3_available: 100,
      };
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: true,
        data: mockQuota,
      });

      const result = await tools.getQuotaStatus({}, mockIpcClient);

      expect(mockIpcClient.query).toHaveBeenCalledWith('get_quota_status', {});
      expect(result).toEqual(mockQuota);
    });

    it('should throw error when IPC query fails', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: false,
        error: 'Quota service unavailable',
      });

      await expect(tools.getQuotaStatus({}, mockIpcClient)).rejects.toThrow(
        'Quota service unavailable'
      );
    });
  });

  describe('get_git_snapshot', () => {
    it('should proxy to Rust via IPC query', async () => {
      const mockSnapshot = {
        sha: 'abc123def456',
        timestamp: 1700000000,
        nodeId: 'node-1',
      };
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: true,
        data: mockSnapshot,
      });

      const result = await tools.getGitSnapshot({ agentId: 'a1' }, mockIpcClient);

      expect(mockIpcClient.query).toHaveBeenCalledWith('get_git_snapshot', {
        agentId: 'a1',
      });
      expect(result).toEqual(mockSnapshot);
    });

    it('should throw error when IPC query fails', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: false,
        error: 'No snapshot found',
      });

      await expect(
        tools.getGitSnapshot({ agentId: 'a1' }, mockIpcClient)
      ).rejects.toThrow('No snapshot found');
    });
  });

  describe('getBModeStatus', () => {
    it('should return enabled status from Rust', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: true,
        data: { enabled: true },
      });

      const result = await tools.getBModeStatus(mockIpcClient);

      expect(mockIpcClient.query).toHaveBeenCalledWith('get_b_mode_status', {});
      expect(result.enabled).toBe(true);
    });

    it('should return disabled (safe default) when IPC fails', async () => {
      mockIpcClient.query = vi.fn().mockResolvedValue({
        ok: false,
        error: 'IPC error',
      });

      const result = await tools.getBModeStatus(mockIpcClient);

      expect(result.enabled).toBe(false);
    });
  });
});

// =============================================================================
// Zod Schema Tests
// =============================================================================

describe('Zod Schemas', () => {
  describe('GetWorkerStatusSchema', () => {
    it('should validate valid input', () => {
      const result = tools.GetWorkerStatusSchema.safeParse({ agentId: 'a1' });
      expect(result.success).toBe(true);
    });

    it('should reject missing agentId', () => {
      const result = tools.GetWorkerStatusSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('AssignTaskSchema', () => {
    it('should validate valid input', () => {
      const result = tools.AssignTaskSchema.safeParse({
        agentId: 'a1',
        prompt: 'do something',
        maxTurns: 10,
      });
      expect(result.success).toBe(true);
    });

    it('should reject negative maxTurns', () => {
      const result = tools.AssignTaskSchema.safeParse({
        agentId: 'a1',
        prompt: 'do something',
        maxTurns: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ApproveHitlSchema', () => {
    it('should validate with requestId only', () => {
      const result = tools.ApproveHitlSchema.safeParse({ requestId: 'r1' });
      expect(result.success).toBe(true);
    });

    it('should validate with modifiedInput', () => {
      const result = tools.ApproveHitlSchema.safeParse({
        requestId: 'r1',
        modifiedInput: { key: 'value' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('DenyHitlSchema', () => {
    it('should validate valid input', () => {
      const result = tools.DenyHitlSchema.safeParse({
        requestId: 'r1',
        reason: 'not allowed',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing reason', () => {
      const result = tools.DenyHitlSchema.safeParse({ requestId: 'r1' });
      expect(result.success).toBe(false);
    });
  });
});
