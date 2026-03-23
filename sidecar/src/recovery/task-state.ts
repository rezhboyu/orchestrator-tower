/**
 * TaskState - 任務狀態持久化
 *
 * 負責將任務狀態寫入 JSON 檔案，用於崩潰後恢復。
 *
 * 路徑：~/.orchestrator/projects/{projectId}/tasks/{taskId}.json
 *
 * 效能要求：寫入 < 100ms（使用 atomic write: temp + rename）
 *
 * 架構原則：
 * - Node.js 只負責 JSON 讀寫，不持有業務狀態
 * - 實際的恢復邏輯由 Rust 驅動
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// =============================================================================
// Types
// =============================================================================

export interface TaskState {
  /** Task 唯一識別碼 */
  taskId: string;
  /** Agent 識別碼 */
  agentId: string;
  /** 專案識別碼 */
  projectId: string;
  /** 原始任務提示 */
  prompt: string;
  /** 最後完成的推理節點 ID */
  lastCompletedNodeId: string | null;
  /** 最後的 Git 快照 SHA */
  lastGitSha: string | null;
  /** 任務開始時間（Unix ms） */
  startedAt: number;
  /** 最後更新時間（Unix ms） */
  updatedAt: number;
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * 取得 orchestrator 根目錄
 *
 * 預設：~/.orchestrator/
 * 可透過 ORCHESTRATOR_HOME 環境變數覆蓋
 */
export function getOrchestratorHome(): string {
  return process.env.ORCHESTRATOR_HOME ?? path.join(os.homedir(), '.orchestrator');
}

/**
 * 取得 TaskState JSON 檔案路徑
 *
 * @returns ~/.orchestrator/projects/{projectId}/tasks/{taskId}.json
 */
export function getTaskStatePath(projectId: string, taskId: string): string {
  return path.join(
    getOrchestratorHome(),
    'projects',
    projectId,
    'tasks',
    `${taskId}.json`
  );
}

// =============================================================================
// Read/Write Operations
// =============================================================================

/**
 * 寫入 TaskState（原子寫入）
 *
 * 使用 temp file + rename 確保原子性：
 * 1. 寫入 {path}.tmp.{random}
 * 2. rename 到目標路徑
 *
 * 效能目標：< 100ms
 */
export async function writeTaskState(state: TaskState): Promise<void> {
  const filePath = getTaskStatePath(state.projectId, state.taskId);

  // 確保父目錄存在
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  // 更新時間戳
  state.updatedAt = Date.now();

  // Atomic write: temp file + rename
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const content = JSON.stringify(state, null, 2);

  await fs.promises.writeFile(tmpPath, content, 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * 讀取 TaskState
 *
 * @returns TaskState 或 null（檔案不存在時）
 */
export async function readTaskState(
  projectId: string,
  taskId: string
): Promise<TaskState | null> {
  const filePath = getTaskStatePath(projectId, taskId);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as TaskState;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * 列出專案下所有 TaskState
 */
export async function listTaskStates(projectId: string): Promise<TaskState[]> {
  const tasksDir = path.join(getOrchestratorHome(), 'projects', projectId, 'tasks');

  try {
    const files = await fs.promises.readdir(tasksDir);
    const states: TaskState[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.promises.readFile(path.join(tasksDir, file), 'utf-8');
        states.push(JSON.parse(content) as TaskState);
      } catch {
        // 跳過無法解析的檔案
      }
    }

    return states;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * 刪除 TaskState
 */
export async function deleteTaskState(
  projectId: string,
  taskId: string
): Promise<boolean> {
  const filePath = getTaskStatePath(projectId, taskId);

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
