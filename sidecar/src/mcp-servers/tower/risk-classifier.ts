/**
 * Risk Classifier - 向後相容性 re-export
 *
 * @deprecated 此檔案為向後相容保留。請直接使用 '../../hitl/index.js'
 *
 * Task 09 已將風險分類器移至 sidecar/src/hitl/ 目錄。
 * 本檔案僅為 re-export，確保舊的 import 路徑仍可使用。
 */

// Re-export from the new location (Task 09 implementation)
export { classifyRisk, requiresHumanApproval } from '../../hitl/index.js';
