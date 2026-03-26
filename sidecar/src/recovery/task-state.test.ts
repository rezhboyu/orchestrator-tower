/**
 * Task State Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  TaskState,
  getTaskStatePath,
  writeTaskState,
  readTaskState,
  deleteTaskState,
  listTaskStates,
  createTaskState,
  getTasksDir,
} from './task-state.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_PROJECT_ID = 'test-project-123';
const TEST_TASK_ID = 'test-task-456';

function createTestTaskState(): TaskState {
  return createTaskState({
    taskId: TEST_TASK_ID,
    agentId: 'agent-001',
    projectId: TEST_PROJECT_ID,
    prompt: 'Test prompt',
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('TaskState', () => {
  // 清理測試目錄
  beforeEach(async () => {
    const dir = getTasksDir(TEST_PROJECT_ID);
    try {
      await fs.rm(dir, { recursive: true });
    } catch {
      // 目錄不存在，忽略
    }
  });

  afterEach(async () => {
    const dir = getTasksDir(TEST_PROJECT_ID);
    try {
      await fs.rm(dir, { recursive: true });
    } catch {
      // 目錄不存在，忽略
    }
  });

  describe('getTaskStatePath', () => {
    it('TaskState JSON 路徑符合規範', () => {
      const filePath = getTaskStatePath('proj1', 'task-42');
      expect(filePath).toMatch(/\.orchestrator[/\\]projects[/\\]proj1[/\\]tasks[/\\]task-42\.json$/);
    });

    it('路徑包含 home 目錄', () => {
      const filePath = getTaskStatePath('proj1', 'task-42');
      expect(filePath.startsWith(os.homedir())).toBe(true);
    });
  });

  describe('writeTaskState', () => {
    it('每個節點完成後 100ms 內寫入 JSON', async () => {
      const state = createTestTaskState();

      const start = Date.now();
      await writeTaskState(state);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('自動建立目錄結構', async () => {
      const state = createTestTaskState();

      await writeTaskState(state);

      const dir = getTasksDir(TEST_PROJECT_ID);
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('寫入的 JSON 可以被正確讀取', async () => {
      const state = createTestTaskState();
      state.lastCompletedNodeId = 'node-123';
      state.lastGitSha = 'abc123';

      await writeTaskState(state);
      const read = await readTaskState(TEST_PROJECT_ID, TEST_TASK_ID);

      expect(read).not.toBeNull();
      expect(read!.taskId).toBe(TEST_TASK_ID);
      expect(read!.lastCompletedNodeId).toBe('node-123');
      expect(read!.lastGitSha).toBe('abc123');
    });

    it('更新 updatedAt 時間戳', async () => {
      const state = createTestTaskState();
      const originalUpdatedAt = state.updatedAt;

      // 等待一小段時間確保時間戳不同
      await new Promise((resolve) => setTimeout(resolve, 10));

      await writeTaskState(state);
      const read = await readTaskState(TEST_PROJECT_ID, TEST_TASK_ID);

      expect(read!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });
  });

  describe('readTaskState', () => {
    it('讀取不存在的 TaskState 回傳 null', async () => {
      const state = await readTaskState('nonexistent-project', 'nonexistent-task');
      expect(state).toBeNull();
    });

    it('正確讀取已存在的 TaskState', async () => {
      const state = createTestTaskState();
      await writeTaskState(state);

      const read = await readTaskState(TEST_PROJECT_ID, TEST_TASK_ID);

      expect(read).not.toBeNull();
      expect(read!.version).toBe(1);
      expect(read!.taskId).toBe(TEST_TASK_ID);
      expect(read!.agentId).toBe('agent-001');
      expect(read!.projectId).toBe(TEST_PROJECT_ID);
    });
  });

  describe('deleteTaskState', () => {
    it('刪除存在的 TaskState', async () => {
      const state = createTestTaskState();
      await writeTaskState(state);

      // 確認存在
      let read = await readTaskState(TEST_PROJECT_ID, TEST_TASK_ID);
      expect(read).not.toBeNull();

      // 刪除
      await deleteTaskState(TEST_PROJECT_ID, TEST_TASK_ID);

      // 確認已刪除
      read = await readTaskState(TEST_PROJECT_ID, TEST_TASK_ID);
      expect(read).toBeNull();
    });

    it('刪除不存在的 TaskState 不報錯', async () => {
      await expect(
        deleteTaskState('nonexistent-project', 'nonexistent-task')
      ).resolves.not.toThrow();
    });
  });

  describe('listTaskStates', () => {
    it('列出空專案回傳空陣列', async () => {
      const states = await listTaskStates('nonexistent-project');
      expect(states).toEqual([]);
    });

    it('列出專案所有 TaskState', async () => {
      // 建立多個 TaskState
      const state1 = createTaskState({
        taskId: 'task-1',
        agentId: 'agent-1',
        projectId: TEST_PROJECT_ID,
        prompt: 'Prompt 1',
      });
      const state2 = createTaskState({
        taskId: 'task-2',
        agentId: 'agent-2',
        projectId: TEST_PROJECT_ID,
        prompt: 'Prompt 2',
      });

      await writeTaskState(state1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeTaskState(state2);

      const states = await listTaskStates(TEST_PROJECT_ID);

      expect(states.length).toBe(2);
    });

    it('按 updatedAt 降序排列', async () => {
      const state1 = createTaskState({
        taskId: 'task-old',
        agentId: 'agent-1',
        projectId: TEST_PROJECT_ID,
        prompt: 'Old',
      });
      await writeTaskState(state1);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const state2 = createTaskState({
        taskId: 'task-new',
        agentId: 'agent-2',
        projectId: TEST_PROJECT_ID,
        prompt: 'New',
      });
      await writeTaskState(state2);

      const states = await listTaskStates(TEST_PROJECT_ID);

      expect(states.length).toBe(2);
      expect(states[0].taskId).toBe('task-new'); // 最新的在前
      expect(states[1].taskId).toBe('task-old');
    });
  });

  describe('createTaskState', () => {
    it('建立正確的初始 TaskState', () => {
      const before = Date.now();
      const state = createTaskState({
        taskId: 'new-task',
        agentId: 'new-agent',
        projectId: 'new-project',
        prompt: 'New prompt',
      });
      const after = Date.now();

      expect(state.version).toBe(1);
      expect(state.taskId).toBe('new-task');
      expect(state.agentId).toBe('new-agent');
      expect(state.projectId).toBe('new-project');
      expect(state.prompt).toBe('New prompt');
      expect(state.lastCompletedNodeId).toBeNull();
      expect(state.lastGitSha).toBeNull();
      expect(state.lastSessionId).toBeNull();
      expect(state.startedAt).toBeGreaterThanOrEqual(before);
      expect(state.startedAt).toBeLessThanOrEqual(after);
      expect(state.updatedAt).toEqual(state.startedAt);
    });
  });
});
