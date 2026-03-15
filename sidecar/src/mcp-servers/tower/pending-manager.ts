/**
 * Pending HITL Manager - 管理等待中的 HITL 請求
 *
 * 負責追蹤從 auth tool 發出的 HITL 請求，並在收到 Rust 的回應後
 * resolve 對應的 Promise。包含 5 分鐘超時機制。
 */

import type { HitlResponse } from '../../ipc/messages.js';
import type { AuthToolResponse, PendingRequest } from './types.js';

/** 預設 HITL 超時時間：5 分鐘 */
const DEFAULT_HITL_TIMEOUT = 5 * 60 * 1000;

/**
 * Pending HITL 請求管理器
 */
export class PendingHitlManager {
  private pending = new Map<string, PendingRequest>();
  private readonly timeout: number;

  constructor(timeout = DEFAULT_HITL_TIMEOUT) {
    this.timeout = timeout;
  }

  /**
   * 等待 HITL 回應
   *
   * @param requestId - 請求 ID（UUID）
   * @param agentId - Agent ID
   * @param toolName - 工具名稱
   * @param originalInput - 原始工具輸入
   * @returns Promise 在收到回應或超時時 resolve/reject
   */
  waitForResponse(
    requestId: string,
    agentId: string,
    toolName: string,
    originalInput: Record<string, unknown>
  ): Promise<AuthToolResponse> {
    return new Promise((resolve, reject) => {
      // 設定超時計時器
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // 超時回傳 deny 而非 reject，讓 Claude Code 知道原因
        resolve({
          behavior: 'deny',
          message: `HITL request timed out after ${this.timeout / 1000} seconds`,
        });
      }, this.timeout);

      // 儲存 pending request
      this.pending.set(requestId, {
        requestId,
        agentId,
        toolName,
        originalInput,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * 處理來自 Rust 的 HITL 回應
   *
   * @param response - HitlResponse from Rust
   * @returns true 如果找到對應的 pending request
   */
  resolveRequest(response: HitlResponse): boolean {
    const pending = this.pending.get(response.requestId);

    if (!pending) {
      // 請求可能已超時或被其他原因移除
      console.warn(
        `[PendingHitlManager] No pending request found for ${response.requestId}`
      );
      return false;
    }

    // 清除超時計時器
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);

    // 根據審批結果 resolve
    if (response.approved) {
      // 允許：回傳 allow response
      // 使用 modifiedInput 如果有，否則用原始 input
      const updatedInput =
        (response.modifiedInput as Record<string, unknown> | undefined) ??
        pending.originalInput;

      pending.resolve({
        behavior: 'allow',
        updatedInput,
      });
    } else {
      // 拒絕：回傳 deny response
      pending.resolve({
        behavior: 'deny',
        message: response.reason ?? 'Request denied by operator',
      });
    }

    return true;
  }

  /**
   * Reject 所有 pending requests
   * 用於 IPC 斷線或 server 關閉時
   *
   * @param reason - 拒絕原因
   */
  rejectAll(reason: string): void {
    for (const [_requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      // 使用 deny response 而非 reject，讓 Claude Code 知道原因
      pending.resolve({
        behavior: 'deny',
        message: reason,
      });
    }
    this.pending.clear();
  }

  /**
   * 取得目前 pending requests 數量
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * 檢查是否有特定的 pending request
   */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * 取得所有 pending request IDs（用於除錯）
   */
  getPendingIds(): string[] {
    return Array.from(this.pending.keys());
  }
}
