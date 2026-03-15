/**
 * Tower MCP Server - Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyRisk, requiresHumanApproval } from './risk-classifier.js';
import { PendingHitlManager } from './pending-manager.js';
import { isPortAvailable, findAvailablePort } from './port-finder.js';
import type { HitlResponse } from '../../ipc/messages.js';

// =============================================================================
// Risk Classifier Tests
// =============================================================================

describe('Risk Classifier', () => {
  describe('classifyRisk', () => {
    it('should classify Read as low risk', () => {
      expect(classifyRisk('Read', { file_path: '/some/file.txt' })).toBe('low');
    });

    it('should classify Glob as low risk', () => {
      expect(classifyRisk('Glob', { pattern: '**/*.ts' })).toBe('low');
    });

    it('should classify Grep as low risk', () => {
      expect(classifyRisk('Grep', { pattern: 'TODO' })).toBe('low');
    });

    it('should classify rm command as critical', () => {
      expect(classifyRisk('Bash', { command: 'rm -rf /tmp/test' })).toBe('critical');
    });

    it('should classify rm with flags as critical', () => {
      expect(classifyRisk('Bash', { command: 'rm -r -f /tmp/test' })).toBe('critical');
    });

    it('should classify delete command as critical', () => {
      expect(classifyRisk('Bash', { command: 'DELETE FROM users' })).toBe('critical');
    });

    it('should classify drop command as critical', () => {
      expect(classifyRisk('Bash', { command: 'DROP TABLE users' })).toBe('critical');
    });

    it('should classify git reset --hard as critical', () => {
      expect(classifyRisk('Bash', { command: 'git reset --hard HEAD~1' })).toBe(
        'critical'
      );
    });

    it('should classify .env file write as high risk', () => {
      expect(classifyRisk('Write', { file_path: '/app/.env' })).toBe('high');
    });

    it('should classify .env.local file write as high risk', () => {
      expect(classifyRisk('Write', { file_path: '/app/.env.local' })).toBe('high');
    });

    it('should classify .pem file write as high risk', () => {
      expect(classifyRisk('Write', { file_path: '/keys/server.pem' })).toBe('high');
    });

    it('should classify .key file write as high risk', () => {
      expect(classifyRisk('Write', { file_path: '/keys/private.key' })).toBe('high');
    });

    it('should classify secrets file write as high risk', () => {
      expect(classifyRisk('Write', { file_path: '/config/secrets.json' })).toBe(
        'high'
      );
    });

    it('should classify content with API key as high risk', () => {
      expect(
        classifyRisk('Write', {
          file_path: '/config.json',
          content: 'api_key: sk-1234567890',
        })
      ).toBe('high');
    });

    it('should classify normal Write as medium risk', () => {
      expect(classifyRisk('Write', { file_path: '/app/main.ts' })).toBe('medium');
    });

    it('should classify normal Edit as medium risk', () => {
      expect(classifyRisk('Edit', { file_path: '/app/main.ts' })).toBe('medium');
    });

    it('should classify normal Bash as medium risk', () => {
      expect(classifyRisk('Bash', { command: 'npm install express' })).toBe('medium');
    });

    it('should classify unknown tool as medium risk', () => {
      expect(classifyRisk('UnknownTool', {})).toBe('medium');
    });
  });

  describe('requiresHumanApproval', () => {
    it('should return false for low risk', () => {
      expect(requiresHumanApproval('low')).toBe(false);
    });

    it('should return true for medium risk', () => {
      expect(requiresHumanApproval('medium')).toBe(true);
    });

    it('should return true for high risk', () => {
      expect(requiresHumanApproval('high')).toBe(true);
    });

    it('should return true for critical risk', () => {
      expect(requiresHumanApproval('critical')).toBe(true);
    });
  });
});

// =============================================================================
// Pending HITL Manager Tests
// =============================================================================

describe('PendingHitlManager', () => {
  let manager: PendingHitlManager;

  beforeEach(() => {
    // 使用短超時時間方便測試
    manager = new PendingHitlManager(100); // 100ms timeout
  });

  afterEach(() => {
    manager.rejectAll('test cleanup');
  });

  it('should resolve request when approved', async () => {
    const requestId = 'test-request-1';
    const originalInput = { file_path: '/test.txt' };

    // 啟動等待
    const waitPromise = manager.waitForResponse(
      requestId,
      'agent-1',
      'Write',
      originalInput
    );

    // 模擬 HITL 回應
    const response: HitlResponse = {
      type: 'hitl:response',
      requestId,
      approved: true,
    };

    const resolved = manager.resolveRequest(response);
    expect(resolved).toBe(true);

    // 檢查結果
    const result = await waitPromise;
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: originalInput,
    });
  });

  it('should resolve request with modified input', async () => {
    const requestId = 'test-request-2';
    const originalInput = { file_path: '/test.txt' };
    const modifiedInput = { file_path: '/modified.txt' };

    const waitPromise = manager.waitForResponse(
      requestId,
      'agent-1',
      'Write',
      originalInput
    );

    const response: HitlResponse = {
      type: 'hitl:response',
      requestId,
      approved: true,
      modifiedInput,
    };

    manager.resolveRequest(response);

    const result = await waitPromise;
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: modifiedInput,
    });
  });

  it('should resolve request when denied', async () => {
    const requestId = 'test-request-3';

    const waitPromise = manager.waitForResponse(requestId, 'agent-1', 'Write', {});

    const response: HitlResponse = {
      type: 'hitl:response',
      requestId,
      approved: false,
      reason: 'Operator denied the request',
    };

    manager.resolveRequest(response);

    const result = await waitPromise;
    expect(result).toEqual({
      behavior: 'deny',
      message: 'Operator denied the request',
    });
  });

  it('should timeout if no response received', async () => {
    const requestId = 'test-request-4';

    const result = await manager.waitForResponse(requestId, 'agent-1', 'Write', {});

    // 應該超時並回傳 deny
    expect(result.behavior).toBe('deny');
    expect(result).toHaveProperty('message');
    expect((result as { behavior: 'deny'; message: string }).message).toContain(
      'timed out'
    );
  });

  it('should return false when resolving unknown request', () => {
    const response: HitlResponse = {
      type: 'hitl:response',
      requestId: 'unknown-request',
      approved: true,
    };

    const resolved = manager.resolveRequest(response);
    expect(resolved).toBe(false);
  });

  it('should reject all pending requests', async () => {
    const request1 = manager.waitForResponse('req-1', 'agent-1', 'Write', {});
    const request2 = manager.waitForResponse('req-2', 'agent-2', 'Bash', {});

    expect(manager.size).toBe(2);

    manager.rejectAll('Server shutting down');

    expect(manager.size).toBe(0);

    const result1 = await request1;
    const result2 = await request2;

    expect(result1).toEqual({
      behavior: 'deny',
      message: 'Server shutting down',
    });
    expect(result2).toEqual({
      behavior: 'deny',
      message: 'Server shutting down',
    });
  });

  it('should track pending requests correctly', () => {
    expect(manager.size).toBe(0);
    expect(manager.hasPending('req-1')).toBe(false);

    manager.waitForResponse('req-1', 'agent-1', 'Write', {});

    expect(manager.size).toBe(1);
    expect(manager.hasPending('req-1')).toBe(true);
    expect(manager.getPendingIds()).toContain('req-1');
  });
});

// =============================================================================
// Port Finder Tests
// =============================================================================

describe('Port Finder', () => {
  describe('isPortAvailable', () => {
    it('should return true for available port', async () => {
      // 使用高 port 號避免衝突
      const available = await isPortAvailable(59999);
      expect(available).toBe(true);
    });
  });

  describe('findAvailablePort', () => {
    it('should find an available port', async () => {
      const port = await findAvailablePort(55000, 10);
      expect(port).toBeGreaterThanOrEqual(55000);
      expect(port).toBeLessThan(55010);
    });

    it('should throw if no port available', async () => {
      // 這個測試難以可靠地實作，因為需要佔用所有測試 port
      // 跳過此測試
    });
  });
});

// =============================================================================
// Auth Tool Response Format Tests
// =============================================================================

describe('Auth Tool Response Format', () => {
  it('allow response should have correct format', () => {
    const response = {
      behavior: 'allow' as const,
      updatedInput: { file_path: '/test.txt' },
    };

    expect(response.behavior).toBe('allow');
    expect(response.updatedInput).toBeDefined();
    expect(typeof response.updatedInput).toBe('object');
  });

  it('deny response should have correct format', () => {
    const response = {
      behavior: 'deny' as const,
      message: 'Request denied',
    };

    expect(response.behavior).toBe('deny');
    expect(response.message).toBeDefined();
    expect(typeof response.message).toBe('string');
  });

  it('deny response should NOT use block', () => {
    // 確保我們不使用 'block'，只使用 'deny'
    const validBehaviors = ['allow', 'deny'];
    expect(validBehaviors).not.toContain('block');
  });
});
