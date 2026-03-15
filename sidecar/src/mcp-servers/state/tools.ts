/**
 * State MCP Server - Tool Handlers
 *
 * 8 個工具的實作，全部透過 IPC 代理至 Rust AppState。
 * Node.js 層不持有任何業務狀態。
 */

import { z } from 'zod';
import type { IpcClient } from '../../ipc/client.js';
import type {
  WorkerStatusResult,
  QuotaStatusResult,
  GitSnapshotResult,
  HitlOperationResult,
  BModeStatusResult,
} from './types.js';

// =============================================================================
// Zod Schemas（工具輸入定義）
// =============================================================================

/**
 * get_worker_status - 取得 Worker Agent 狀態
 */
export const GetWorkerStatusSchema = z.object({
  agentId: z.string().describe('The ID of the worker agent'),
});

/**
 * assign_task - 指派新任務給 Worker Agent
 */
export const AssignTaskSchema = z.object({
  agentId: z.string().describe('The ID of the worker agent'),
  prompt: z.string().describe('The task prompt to assign'),
  maxTurns: z.number().int().positive().describe('Maximum turns for the task'),
});

/**
 * pause_worker - 暫停 Worker Agent
 */
export const PauseWorkerSchema = z.object({
  agentId: z.string().describe('The ID of the worker agent to pause'),
});

/**
 * resume_worker - 恢復 Worker Agent
 */
export const ResumeWorkerSchema = z.object({
  agentId: z.string().describe('The ID of the worker agent to resume'),
});

/**
 * approve_hitl - 批准 HITL 請求（需要 B mode 啟用）
 */
export const ApproveHitlSchema = z.object({
  requestId: z.string().describe('The HITL request ID'),
  modifiedInput: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional modified input to use'),
});

/**
 * deny_hitl - 拒絕 HITL 請求（需要 B mode 啟用）
 */
export const DenyHitlSchema = z.object({
  requestId: z.string().describe('The HITL request ID'),
  reason: z.string().describe('Reason for denial'),
});

/**
 * get_quota_status - 取得配額狀態
 */
export const GetQuotaStatusSchema = z.object({});

/**
 * get_git_snapshot - 取得 Git 快照資訊
 */
export const GetGitSnapshotSchema = z.object({
  agentId: z.string().describe('The ID of the worker agent'),
});

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * 取得 Worker Agent 狀態
 * 透過 IPC 查詢 Rust AppState
 */
export async function getWorkerStatus(
  args: z.infer<typeof GetWorkerStatusSchema>,
  ipcClient: IpcClient
): Promise<WorkerStatusResult> {
  const response = await ipcClient.query('get_worker_status', {
    agentId: args.agentId,
  });

  if (!response.ok) {
    throw new Error(response.error ?? 'Failed to get worker status');
  }

  return response.data as WorkerStatusResult;
}

/**
 * 指派新任務給 Worker Agent
 * 透過 IPC query 請求 Rust 執行 agent:assign
 */
export async function assignTask(
  args: z.infer<typeof AssignTaskSchema>,
  ipcClient: IpcClient
): Promise<{ success: boolean }> {
  const response = await ipcClient.query('assign_task', {
    agentId: args.agentId,
    prompt: args.prompt,
    maxTurns: args.maxTurns,
  });

  return { success: response.ok };
}

/**
 * 暫停 Worker Agent
 * 透過 IPC query 請求 Rust 執行 agent:freeze（reason: orchestrator, immediate: true）
 */
export async function pauseWorker(
  args: z.infer<typeof PauseWorkerSchema>,
  ipcClient: IpcClient
): Promise<{ success: boolean }> {
  const response = await ipcClient.query('pause_worker', {
    agentId: args.agentId,
    reason: 'orchestrator',
    immediate: true,
  });

  return { success: response.ok };
}

/**
 * 恢復 Worker Agent
 * 透過 IPC query 請求 Rust 執行 agent:unfreeze（reason: orchestrator）
 */
export async function resumeWorker(
  args: z.infer<typeof ResumeWorkerSchema>,
  ipcClient: IpcClient
): Promise<{ success: boolean }> {
  const response = await ipcClient.query('resume_worker', {
    agentId: args.agentId,
    reason: 'orchestrator',
  });

  return { success: response.ok };
}

/**
 * 批准 HITL 請求
 * B mode 關閉時回傳 403
 */
export async function approveHitl(
  args: z.infer<typeof ApproveHitlSchema>,
  ipcClient: IpcClient,
  bModeEnabled: boolean
): Promise<HitlOperationResult> {
  // B mode 檢查
  if (!bModeEnabled) {
    return {
      status: 403,
      error: 'B mode is disabled. HITL approval requires human intervention.',
    };
  }

  const response = await ipcClient.query('approve_hitl', {
    requestId: args.requestId,
    approved: true,
    modifiedInput: args.modifiedInput,
  });

  return { success: response.ok };
}

/**
 * 拒絕 HITL 請求
 * B mode 關閉時回傳 403
 */
export async function denyHitl(
  args: z.infer<typeof DenyHitlSchema>,
  ipcClient: IpcClient,
  bModeEnabled: boolean
): Promise<HitlOperationResult> {
  // B mode 檢查
  if (!bModeEnabled) {
    return {
      status: 403,
      error: 'B mode is disabled. HITL denial requires human intervention.',
    };
  }

  const response = await ipcClient.query('deny_hitl', {
    requestId: args.requestId,
    approved: false,
    reason: args.reason,
  });

  return { success: response.ok };
}

/**
 * 取得配額狀態
 * 透過 IPC 查詢 Rust AppState
 */
export async function getQuotaStatus(
  _args: z.infer<typeof GetQuotaStatusSchema>,
  ipcClient: IpcClient
): Promise<QuotaStatusResult> {
  const response = await ipcClient.query('get_quota_status', {});

  if (!response.ok) {
    throw new Error(response.error ?? 'Failed to get quota status');
  }

  return response.data as QuotaStatusResult;
}

/**
 * 取得 Git 快照資訊
 * 透過 IPC 查詢 Rust AppState
 */
export async function getGitSnapshot(
  args: z.infer<typeof GetGitSnapshotSchema>,
  ipcClient: IpcClient
): Promise<GitSnapshotResult> {
  const response = await ipcClient.query('get_git_snapshot', {
    agentId: args.agentId,
  });

  if (!response.ok) {
    throw new Error(response.error ?? 'Failed to get git snapshot');
  }

  return response.data as GitSnapshotResult;
}

/**
 * 取得 B mode 狀態
 * 透過 IPC 查詢 Rust AppState（內部使用）
 */
export async function getBModeStatus(
  ipcClient: IpcClient
): Promise<BModeStatusResult> {
  const response = await ipcClient.query('get_b_mode_status', {});

  if (!response.ok) {
    // 預設為關閉（安全預設）
    return { enabled: false };
  }

  return response.data as BModeStatusResult;
}
