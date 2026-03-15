/**
 * HITL Risk Classifier Tests - Task 09
 *
 * 測試風險分類器的所有邊界條件，包括：
 * - critical: 毀滅性操作
 * - high: 敏感檔案寫入
 * - medium: 一般寫入操作
 * - low: 唯讀操作
 * - bypass: 防止繞過攻擊（引號內的指令不應觸發 critical）
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRisk,
  requiresHumanApproval,
  isInQuotes,
  containsCriticalPattern,
} from './classifier.js';

// =============================================================================
// isInQuotes Helper Tests
// =============================================================================

describe('isInQuotes', () => {
  it('should return false when not in quotes', () => {
    expect(isInQuotes('rm -rf /tmp', 0)).toBe(false);
    expect(isInQuotes('echo hello', 0)).toBe(false);
  });

  it('should return true when inside single quotes', () => {
    // "echo 'rm -rf' test" - rm 在單引號內
    const cmd = "echo 'rm -rf' test";
    const rmIndex = cmd.indexOf('rm');
    expect(isInQuotes(cmd, rmIndex)).toBe(true);
  });

  it('should return true when inside double quotes', () => {
    // 'echo "rm -rf" test' - rm 在雙引號內
    const cmd = 'echo "rm -rf" test';
    const rmIndex = cmd.indexOf('rm');
    expect(isInQuotes(cmd, rmIndex)).toBe(true);
  });

  it('should return false when after closing quote', () => {
    // "echo 'safe' rm -rf" - rm 在引號外
    const cmd = "echo 'safe' rm -rf";
    const rmIndex = cmd.lastIndexOf('rm');
    expect(isInQuotes(cmd, rmIndex)).toBe(false);
  });

  it('should handle escaped quotes correctly', () => {
    // 'echo \'hello\' rm' - 轉義引號不算開啟引號
    const cmd = "echo \\'hello\\' rm";
    const rmIndex = cmd.indexOf('rm');
    expect(isInQuotes(cmd, rmIndex)).toBe(false);
  });
});

// =============================================================================
// containsCriticalPattern Tests
// =============================================================================

describe('containsCriticalPattern', () => {
  it('should detect rm command', () => {
    expect(containsCriticalPattern('rm -rf /tmp')).toBe(true);
    expect(containsCriticalPattern('rm file.txt')).toBe(true);
  });

  it('should detect delete keyword', () => {
    expect(containsCriticalPattern('delete from users')).toBe(true);
  });

  it('should detect drop keyword', () => {
    expect(containsCriticalPattern('drop table users')).toBe(true);
  });

  it('should detect format keyword', () => {
    expect(containsCriticalPattern('format c:')).toBe(true);
  });

  it('should detect truncate keyword', () => {
    expect(containsCriticalPattern('truncate -s 0 file.txt')).toBe(true);
    expect(containsCriticalPattern('truncate table logs')).toBe(true);
  });

  it('should detect unlink command', () => {
    expect(containsCriticalPattern('unlink file.txt')).toBe(true);
  });

  it('should NOT detect quoted commands', () => {
    expect(containsCriticalPattern("echo 'rm is safe'")).toBe(false);
    expect(containsCriticalPattern('echo "rm -rf" is dangerous')).toBe(false);
    expect(containsCriticalPattern("echo 'delete this' text")).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(containsCriticalPattern('RM -rf /tmp')).toBe(true);
    expect(containsCriticalPattern('rM -rf /tmp')).toBe(true);
    expect(containsCriticalPattern('DELETE from users')).toBe(true);
  });
});

// =============================================================================
// classifyRisk - Critical Level Tests
// =============================================================================

describe('classifyRisk - critical', () => {
  it.each([
    ['Bash', { command: 'rm -rf /tmp' }],
    ['Bash', { command: 'rm file.txt' }],
    ['Bash', { command: 'delete from users' }],
    ['Bash', { command: 'DROP TABLE users' }],
    ['Bash', { command: 'format c:' }],
    ['Bash', { command: 'truncate -s 0 file.txt' }],
    ['Bash', { command: 'unlink important.dat' }],
    ['Bash', { command: 'rmdir /s /q folder' }],
    ['Bash', { command: 'git reset --hard HEAD~5' }],
    ['Bash', { command: 'dd if=/dev/zero of=/dev/sda' }],
    ['Bash', { command: 'mkfs.ext4 /dev/sdb1' }],
  ])('%s with %j should be critical', (tool, input) => {
    expect(classifyRisk(tool, input as Record<string, unknown>)).toBe('critical');
  });

  // Case-insensitive bypass tests
  it('should classify rM -rf as critical (case-insensitive)', () => {
    expect(classifyRisk('Bash', { command: 'rM -rf /tmp' })).toBe('critical');
  });

  it('should classify RM -RF as critical (all caps)', () => {
    expect(classifyRisk('Bash', { command: 'RM -RF /tmp' })).toBe('critical');
  });
});

// =============================================================================
// classifyRisk - Bypass Prevention Tests (CRITICAL)
// =============================================================================

describe('classifyRisk - bypass prevention', () => {
  it("should NOT classify echo 'rm' as critical (single quotes)", () => {
    expect(classifyRisk('Bash', { command: "echo 'rm is a command'" })).toBe('medium');
  });

  it('should NOT classify echo "rm -rf" as critical (double quotes)', () => {
    expect(classifyRisk('Bash', { command: 'echo "rm -rf"' })).toBe('medium');
  });

  it("should NOT classify echo 'delete from users' as critical", () => {
    expect(classifyRisk('Bash', { command: "echo 'delete from users'" })).toBe('medium');
  });

  it('should classify actual rm after quoted text as critical', () => {
    // "echo 'safe' && rm -rf /tmp" - rm 不在引號內
    expect(classifyRisk('Bash', { command: "echo 'safe' && rm -rf /tmp" })).toBe('critical');
  });
});

// =============================================================================
// classifyRisk - High Level Tests
// =============================================================================

describe('classifyRisk - high', () => {
  it.each([
    ['Write', { file_path: '.env' }],
    ['Write', { file_path: '/app/.env' }],
    ['Write', { file_path: '.env.local' }],
    ['Write', { file_path: '.env.production' }],
    ['Edit', { file_path: 'config.key' }],
    ['Write', { file_path: 'secrets/api.pem' }],
    ['Write', { file_path: 'private.key' }],
    ['Edit', { file_path: 'id_rsa' }],
    ['Write', { file_path: 'id_ed25519' }],
    ['Write', { file_path: 'password_store.txt' }],
    ['Write', { file_path: 'my.secret' }],
    ['Write', { file_path: 'credentials.json' }],
  ])('%s with %j should be high', (tool, input) => {
    expect(classifyRisk(tool, input as Record<string, unknown>)).toBe('high');
  });

  // Content-based detection
  it('should classify content with api_key as high', () => {
    expect(
      classifyRisk('Write', {
        file_path: 'config.ts',
        content: 'const api_key = "sk-xxx"',
      })
    ).toBe('high');
  });

  it('should classify content with password as high', () => {
    expect(
      classifyRisk('Write', {
        file_path: 'config.ts',
        content: 'password: "secret123"',
      })
    ).toBe('high');
  });
});

// =============================================================================
// classifyRisk - Medium Level Tests
// =============================================================================

describe('classifyRisk - medium', () => {
  it.each([
    ['Write', { file_path: 'src/index.ts' }],
    ['Write', { file_path: 'README.md' }],
    ['Edit', { file_path: 'package.json' }],
    ['Bash', { command: 'ls -la' }],
    ['Bash', { command: 'npm install' }],
    ['Bash', { command: 'git status' }],
    ['Bash', { command: 'cat file.txt' }],
  ])('%s with %j should be medium', (tool, input) => {
    expect(classifyRisk(tool, input as Record<string, unknown>)).toBe('medium');
  });

  it('should classify unknown tools as medium (conservative)', () => {
    expect(classifyRisk('UnknownTool', { any: 'input' })).toBe('medium');
  });
});

// =============================================================================
// classifyRisk - Low Level Tests
// =============================================================================

describe('classifyRisk - low', () => {
  it.each([
    ['Read', { file_path: 'any.txt' }],
    ['Read', { file_path: '.env' }], // Read is always low
    ['Glob', { pattern: '**/*.ts' }],
    ['Glob', { pattern: '**/secret*' }],
    ['Grep', { pattern: 'TODO' }],
    ['Grep', { pattern: 'password' }], // Grep for password is still low (read-only)
  ])('%s with %j should be low', (tool, input) => {
    expect(classifyRisk(tool, input as Record<string, unknown>)).toBe('low');
  });
});

// =============================================================================
// requiresHumanApproval Tests
// =============================================================================

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
