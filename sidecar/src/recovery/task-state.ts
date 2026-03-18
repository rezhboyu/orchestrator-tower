/**
 * Task State - 任務狀態 JSON 讀寫
 *
 * 用於崩潰恢復時持久化任務狀態。
 * 路徑：~/.orchestrator/projects/{projectId}/tasks/{taskId}.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// =============================================================================
// Types
// =============================================================================

export interface TaskState {
  version: 1;
  taskId: string;
  agentId: string;
  projectId: string;
  prompt: string;
  lastCompletedNodeId: string | null;
  lastGitSha: string | null;
  lastSessionId: string | null;
  startedAt: number;
  updatedAt: number;
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * 取得 ~/.orchestrator 目錄路徑
 */
export function getOrchestratorDir(): string {
  return path.join(os.homedir(), '.orchestrator');
}

/**
 * 取得專案 tasks 目錄路徑
 * @param projectId 專案 ID
 */
export function getTasksDir(projectId: string): string {
  return path.join(getOrchestratorDir(), 'projects', projectId, 'tasks');
}

/**
 * 取得 TaskState JSON 檔案路徑
 * @param projectId 專案 ID
 * @param taskId 任務 ID
 */
export function getTaskStatePath(projectId: string, taskId: string): string {
  return path.join(getTasksDir(projectId), `${taskId}.json`);
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * 寫入 TaskState JSON
 *
 * 使用 write + rename 確保原子性寫入。
 * 完成條件：< 100ms
 *
 * @param state TaskState 物件
 */
export async function writeTaskState(state: TaskState): Promise<void> {
  const filePath = getTaskStatePath(state.projectId, state.taskId);
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp`;

  // 確保目錄存在
  await fs.mkdir(dir, { recursive: true });

  // 更新 updatedAt
  const stateWithTimestamp: TaskState = {
    ...state,
    updatedAt: Date.now(),
  };

  // 寫入臨時檔案
  const json = JSON.stringify(stateWithTimestamp, null, 2);
  await fs.writeFile(tmpPath, json, 'utf8');

  // 原子性 rename
  await fs.rename(tmpPath, filePath);
}

/**
 * 讀取 TaskState JSON
 *
 * @param projectId 專案 ID
 * @param taskId 任務 ID
 * @returns TaskState 物件，若不存在則回傳 null
 */
export async function readTaskState(
  projectId: string,
  taskId: string
): Promise<TaskState | null> {
  const filePath = getTaskStatePath(projectId, taskId);

  try {
    const json = await fs.readFile(filePath, 'utf8');
    const state = JSON.parse(json) as TaskState;

    // 版本檢查
    if (state.version !== 1) {
      console.warn(`[TaskState] Unknown version: ${state.version}, file: ${filePath}`);
      return null;
    }

    return state;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * 刪除 TaskState JSON
 *
 * @param projectId 專案 ID
 * @param taskId 任務 ID
 */
export async function deleteTaskState(
  projectId: string,
  taskId: string
): Promise<void> {
  const filePath = getTaskStatePath(projectId, taskId);

  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // 檔案不存在，視為成功
  }
}

/**
 * 列出專案所有 TaskState
 *
 * @param projectId 專案 ID
 * @returns TaskState 陣列，按 updatedAt 降序排列
 */
export async function listTaskStates(projectId: string): Promise<TaskState[]> {
  const dir = getTasksDir(projectId);

  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const states: TaskState[] = [];

    for (const file of jsonFiles) {
      const taskId = file.replace('.json', '');
      const state = await readTaskState(projectId, taskId);
      if (state) {
        states.push(state);
      }
    }

    // 按 updatedAt 降序排列（最近更新的優先恢復）
    states.sort((a, b) => b.updatedAt - a.updatedAt);

    return states;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * 建立新的 TaskState
 *
 * @param params 初始化參數
 */
export function createTaskState(params: {
  taskId: string;
  agentId: string;
  projectId: string;
  prompt: string;
}): TaskState {
  const now = Date.now();
  return {
    version: 1,
    taskId: params.taskId,
    agentId: params.agentId,
    projectId: params.projectId,
    prompt: params.prompt,
    lastCompletedNodeId: null,
    lastGitSha: null,
    lastSessionId: null,
    startedAt: now,
    updatedAt: now,
  };
}
