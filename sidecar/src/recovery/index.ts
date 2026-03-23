/**
 * Recovery Module - 崩潰恢復模組
 *
 * 匯出 TaskState 讀寫和 Session Resume 功能。
 *
 * 架構原則：
 * - Node.js 層只負責 TaskState JSON 讀寫和 CLI 參數注入
 * - 恢復流程的編排由 Rust 驅動
 * - Node.js 不持有業務狀態
 */

// TaskState 持久化
export {
  type TaskState,
  writeTaskState,
  readTaskState,
  listTaskStates,
  deleteTaskState,
  getTaskStatePath,
  getOrchestratorHome,
} from './task-state.js';

// Session Resume 參數注入
export {
  injectResumeParam,
  removeResumeParam,
  hasResumeParam,
  getResumeSessionId,
} from './session-resume.js';
