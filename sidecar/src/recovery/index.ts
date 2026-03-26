/**
 * Recovery Module - 崩潰恢復與 Session 恢復
 *
 * 架構原則：
 * - Node.js 層只負責 TaskState JSON 讀寫和 CLI 參數注入
 * - 恢復流程的編排由 Rust 驅動
 * - Node.js 不持有業務狀態
 */

// TaskState 持久化
export {
  type TaskState,
  getOrchestratorDir,
  getTasksDir,
  getTaskStatePath,
  writeTaskState,
  readTaskState,
  deleteTaskState,
  listTaskStates,
  createTaskState,
} from './task-state.js';

// Session Resume 參數注入
export {
  injectResumeParam,
  removeResumeParam,
  hasResumeParam,
  getResumeSessionId,
  buildResumeArgs,
} from './session-resume.js';
