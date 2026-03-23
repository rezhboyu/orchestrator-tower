/**
 * TaskState Tests
 *
 * 測試 TaskState JSON 讀寫、原子寫入、效能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeTaskState,
  readTaskState,
  listTaskStates,
  deleteTaskState,
  getTaskStatePath,
  type TaskState,
} from './task-state.js';

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;

function makeTaskState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    projectId: 'project-1',
    prompt: 'Write a hello world program',
    lastCompletedNodeId: null,
    lastGitSha: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-state-test-'));
  process.env.ORCHESTRATOR_HOME = testDir;
});

afterEach(() => {
  delete process.env.ORCHESTRATOR_HOME;
  fs.rmSync(testDir, { recursive: true, force: true });
});

// =============================================================================
// Tests
// =============================================================================

describe('TaskState', () => {
  describe('getTaskStatePath', () => {
    it('回傳正確的路徑格式', () => {
      const p = getTaskStatePath('proj-1', 'task-42');
      expect(p).toContain('projects');
      expect(p).toContain('proj-1');
      expect(p).toContain('tasks');
      expect(p).toContain('task-42.json');
    });
  });

  describe('writeTaskState', () => {
    it('寫入 JSON 檔案', async () => {
      const state = makeTaskState();
      await writeTaskState(state);

      const filePath = getTaskStatePath('project-1', 'task-1');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.taskId).toBe('task-1');
      expect(content.agentId).toBe('agent-1');
    });

    it('自動建立父目錄', async () => {
      const state = makeTaskState({ projectId: 'new-project' });
      await writeTaskState(state);

      const filePath = getTaskStatePath('new-project', 'task-1');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('覆寫已存在的檔案', async () => {
      const state1 = makeTaskState({ lastCompletedNodeId: 'node-1' });
      await writeTaskState(state1);

      const state2 = makeTaskState({ lastCompletedNodeId: 'node-5' });
      await writeTaskState(state2);

      const result = await readTaskState('project-1', 'task-1');
      expect(result?.lastCompletedNodeId).toBe('node-5');
    });

    it('更新 updatedAt 時間戳', async () => {
      const state = makeTaskState({ updatedAt: 0 });
      await writeTaskState(state);

      const result = await readTaskState('project-1', 'task-1');
      expect(result?.updatedAt).toBeGreaterThan(0);
    });

    it('寫入在 100ms 內完成', async () => {
      const state = makeTaskState();
      const start = Date.now();
      await writeTaskState(state);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('readTaskState', () => {
    it('讀取已存在的 TaskState', async () => {
      const state = makeTaskState({
        lastCompletedNodeId: 'node-3',
        lastGitSha: 'abc123def456',
      });
      await writeTaskState(state);

      const result = await readTaskState('project-1', 'task-1');
      expect(result).not.toBeNull();
      expect(result!.taskId).toBe('task-1');
      expect(result!.lastCompletedNodeId).toBe('node-3');
      expect(result!.lastGitSha).toBe('abc123def456');
    });

    it('不存在的檔案回傳 null', async () => {
      const result = await readTaskState('nonexistent', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listTaskStates', () => {
    it('列出所有 TaskState', async () => {
      for (let i = 1; i <= 3; i++) {
        await writeTaskState(makeTaskState({ taskId: `task-${i}` }));
      }

      const states = await listTaskStates('project-1');
      expect(states.length).toBe(3);
    });

    it('空專案回傳空陣列', async () => {
      const states = await listTaskStates('empty-project');
      expect(states).toEqual([]);
    });
  });

  describe('deleteTaskState', () => {
    it('刪除已存在的 TaskState', async () => {
      await writeTaskState(makeTaskState());
      const deleted = await deleteTaskState('project-1', 'task-1');
      expect(deleted).toBe(true);

      const result = await readTaskState('project-1', 'task-1');
      expect(result).toBeNull();
    });

    it('刪除不存在的 TaskState 回傳 false', async () => {
      const deleted = await deleteTaskState('nonexistent', 'nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('concurrent writes', () => {
    it('5 個並發寫入不會損壞檔案', async () => {
      const writes = Array.from({ length: 5 }, (_, i) =>
        writeTaskState(
          makeTaskState({
            taskId: `task-${i}`,
            prompt: `Task ${i} prompt`,
          })
        )
      );

      await Promise.all(writes);

      // 驗證所有檔案存在且可解析
      for (let i = 0; i < 5; i++) {
        const result = await readTaskState('project-1', `task-${i}`);
        expect(result).not.toBeNull();
        expect(result!.taskId).toBe(`task-${i}`);
      }
    });
  });
});
