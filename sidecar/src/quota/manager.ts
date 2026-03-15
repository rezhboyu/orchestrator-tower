/**
 * QuotaManager - 配額管理器
 *
 * 使用 Bottleneck 實作集中式配額調度：
 * - 控制 API 呼叫併發數和速率
 * - 優先級排程（Master priority=0，Worker priority=1..N）
 * - Rate Limit 三態偵測與自動凍結
 *
 * 架構原則：
 * - Node.js 不持有業務狀態（只管排程）
 * - 凍結/解凍由 Rust 統一管理
 * - 使用 IPC 發送 freeze_all_agents 指令
 */

import Bottleneck from 'bottleneck';
import type { IpcClient } from '../ipc/index.js';
import { RateLimitDetector } from './rate-limit.js';

// =============================================================================
// Types
// =============================================================================

export interface QuotaManagerOptions {
  /** 最大併發數（預設 2） */
  maxConcurrent?: number;
  /** 最小間隔時間（毫秒，預設 2000） */
  minTime?: number;
  /** 配額池大小（預設 100） */
  reservoir?: number;
  /** 配額重置數量（預設 100） */
  reservoirRefreshAmount?: number;
  /** 配額重置間隔（毫秒，預設 5 小時） */
  reservoirRefreshInterval?: number;
  /** 高水位標記（預設 20） */
  highWater?: number;
}

export interface ScheduleOptions {
  /** Agent ID */
  agentId: string;
  /** Agent 角色 */
  role: 'master' | 'worker';
  /** 顯式優先級覆寫 */
  priority?: number;
}

// =============================================================================
// QuotaManager Class
// =============================================================================

export class QuotaManager {
  private limiter: Bottleneck;
  private ipc: IpcClient;
  private rateLimitDetector: RateLimitDetector;

  // Agent 優先級映射
  private agentPriorityMap: Map<string, number> = new Map();
  // 下一個 Worker 優先級（從 1 開始遞增）
  private nextWorkerPriority = 1;

  // 是否已觸發凍結（防止重複凍結）
  private freezeTriggered = false;

  constructor(ipc: IpcClient, options?: QuotaManagerOptions) {
    this.ipc = ipc;
    this.rateLimitDetector = new RateLimitDetector();

    // 初始化 Bottleneck
    // 使用 OVERFLOW_PRIORITY 策略：優先處理低數值優先級的任務
    this.limiter = new Bottleneck({
      maxConcurrent: options?.maxConcurrent ?? 2,
      minTime: options?.minTime ?? 2000,
      reservoir: options?.reservoir ?? 100,
      reservoirRefreshAmount: options?.reservoirRefreshAmount ?? 100,
      reservoirRefreshInterval: options?.reservoirRefreshInterval ?? 5 * 60 * 60 * 1000,
      highWater: options?.highWater ?? 20,
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
    });

    // 監聽 Bottleneck 錯誤
    this.limiter.on('error', (error) => {
      console.error('[QuotaManager] Bottleneck error:', error);
    });

    console.log('[QuotaManager] Initialized with options:', {
      maxConcurrent: options?.maxConcurrent ?? 2,
      minTime: options?.minTime ?? 2000,
      reservoir: options?.reservoir ?? 100,
    });
  }

  // ===========================================================================
  // Agent Registration
  // ===========================================================================

  /**
   * 註冊 Agent 並分配優先級
   *
   * - Master: priority = 0（最高）
   * - Worker: priority = 1, 2, 3...（依建立順序）
   *
   * @param agentId Agent ID
   * @param role Agent 角色
   * @returns 分配的優先級
   */
  registerAgent(agentId: string, role: 'master' | 'worker'): number {
    // 檢查是否已註冊
    const existing = this.agentPriorityMap.get(agentId);
    if (existing !== undefined) {
      console.log(`[QuotaManager] Agent ${agentId} already registered with priority ${existing}`);
      return existing;
    }

    let priority: number;
    if (role === 'master') {
      priority = 0;
    } else {
      priority = this.nextWorkerPriority++;
    }

    this.agentPriorityMap.set(agentId, priority);
    console.log(`[QuotaManager] Registered agent ${agentId} (${role}) with priority ${priority}`);

    return priority;
  }

  /**
   * 取消註冊 Agent
   *
   * @param agentId Agent ID
   */
  unregisterAgent(agentId: string): void {
    if (this.agentPriorityMap.has(agentId)) {
      this.agentPriorityMap.delete(agentId);
      console.log(`[QuotaManager] Unregistered agent ${agentId}`);
    }
  }

  /**
   * 取得 Agent 優先級
   *
   * @param agentId Agent ID
   * @returns 優先級（如果未註冊則返回 undefined）
   */
  getPriority(agentId: string): number | undefined {
    return this.agentPriorityMap.get(agentId);
  }

  // ===========================================================================
  // Scheduling
  // ===========================================================================

  /**
   * 排程執行非同步操作
   *
   * 透過 Bottleneck 控制併發和速率，並處理 rate limit 錯誤。
   *
   * @param fn 要執行的非同步函數
   * @param options Agent 資訊（用於優先級）
   * @returns Promise 解析為函數結果
   */
  async schedule<T>(
    fn: () => Promise<T>,
    options: ScheduleOptions
  ): Promise<T> {
    // 取得優先級（顯式覆寫 > 已註冊 > 依角色預設）
    let priority = options.priority;
    if (priority === undefined) {
      priority = this.agentPriorityMap.get(options.agentId);
    }
    if (priority === undefined) {
      priority = options.role === 'master' ? 0 : 10; // 未註冊 Worker 使用較低優先級
    }

    // 使用 Bottleneck 排程
    return this.limiter.schedule({ priority }, async () => {
      return this.executeWithRateLimitHandling(fn, options);
    });
  }

  /**
   * 執行函數並處理 rate limit 錯誤
   */
  private async executeWithRateLimitHandling<T>(
    fn: () => Promise<T>,
    options: ScheduleOptions
  ): Promise<T> {
    try {
      const result = await fn();
      // 成功，重置 rate limit 狀態
      if (this.rateLimitDetector.isRetrying()) {
        this.rateLimitDetector.reportSuccess();
        console.log(`[QuotaManager] Rate limit retry succeeded for agent ${options.agentId}`);
      }
      return result;
    } catch (error) {
      // 檢查是否為 rate limit 錯誤
      if (this.rateLimitDetector.isRateLimitError(error)) {
        return this.handleRateLimitError(fn, options, error as Error);
      }

      // 非 rate limit 錯誤，只記 log 並重新拋出
      console.error(`[QuotaManager] Non-rate-limit error for agent ${options.agentId}:`, error);
      throw error;
    }
  }

  /**
   * 處理 rate limit 錯誤
   *
   * 三態邏輯：
   * 1. 首次錯誤 → 等待 60-90 秒 → 重試
   * 2. 重試成功 → 繼續（突發限流）
   * 3. 重試失敗 → 凍結所有 Agent（配額耗盡）
   */
  private async handleRateLimitError<T>(
    fn: () => Promise<T>,
    options: ScheduleOptions,
    originalError: Error
  ): Promise<T> {
    // 如果已經在重試中，不要重複啟動重試
    if (this.rateLimitDetector.isRetrying()) {
      console.log(`[QuotaManager] Already retrying, rejecting request for agent ${options.agentId}`);
      throw originalError;
    }

    // 開始重試流程
    const retryResult = this.rateLimitDetector.startRetry();
    console.log(`[QuotaManager] Rate limit detected for agent ${options.agentId}, waiting ${retryResult.waitMs}ms before retry`);

    // 等待退避時間
    await this.sleep(retryResult.waitMs!);

    // 重試一次
    try {
      const result = await fn();
      // 重試成功
      this.rateLimitDetector.reportSuccess();
      console.log(`[QuotaManager] Retry succeeded for agent ${options.agentId} (burst limit detected)`);
      return result;
    } catch (retryError) {
      // 檢查重試錯誤是否仍為 rate limit
      if (this.rateLimitDetector.isRateLimitError(retryError)) {
        // 配額耗盡，凍結所有 Agent
        this.rateLimitDetector.reportFailure();
        console.error(`[QuotaManager] Retry failed for agent ${options.agentId}, quota exhausted`);

        // 觸發凍結所有 Agent
        await this.freezeAllAgents();

        throw retryError;
      }

      // 重試時發生非 rate limit 錯誤
      this.rateLimitDetector.reportSuccess(); // 重置狀態
      console.error(`[QuotaManager] Retry failed with non-rate-limit error:`, retryError);
      throw retryError;
    }
  }

  // ===========================================================================
  // Freeze All Agents
  // ===========================================================================

  /**
   * 凍結所有 Agent
   *
   * 透過 IPC 發送 freeze_all_agents 查詢至 Rust，
   * Rust 會對所有 Agent 發送 agent:freeze 指令。
   */
  private async freezeAllAgents(): Promise<void> {
    // 防止重複凍結
    if (this.freezeTriggered) {
      console.log('[QuotaManager] Freeze already triggered, skipping');
      return;
    }

    this.freezeTriggered = true;
    console.log('[QuotaManager] Triggering freeze_all_agents');

    try {
      // 發送 IPC 查詢至 Rust
      const response = await this.ipc.query('freeze_all_agents', {
        reason: 'quota',
        immediate: false, // 配額凍結等待當前 turn 完成
      });

      if (response.ok) {
        console.log('[QuotaManager] Successfully froze all agents');
      } else {
        console.error('[QuotaManager] Failed to freeze agents:', response.error);
      }
    } catch (error) {
      console.error('[QuotaManager] Error freezing agents:', error);
    }
  }

  /**
   * 重置凍結狀態（用於解凍後）
   */
  resetFreezeState(): void {
    this.freezeTriggered = false;
    this.rateLimitDetector.reset();
    console.log('[QuotaManager] Freeze state reset');
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * 取得限流器統計資訊
   */
  async getStats(): Promise<{
    running: number;
    queued: number;
    done: number;
    reservoir: number | null;
  }> {
    const counts = await this.limiter.counts();
    const reservoir = await this.limiter.currentReservoir();

    return {
      running: counts.RUNNING ?? 0,
      queued: counts.QUEUED ?? 0,
      done: counts.DONE ?? 0,
      reservoir,
    };
  }

  /**
   * 取得所有已註冊的 Agent
   */
  getRegisteredAgents(): Map<string, number> {
    return new Map(this.agentPriorityMap);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * 關閉配額管理器
   */
  async shutdown(): Promise<void> {
    console.log('[QuotaManager] Shutting down...');

    // 停止接受新任務
    await this.limiter.stop();

    // 清理狀態
    this.agentPriorityMap.clear();
    this.freezeTriggered = false;
    this.rateLimitDetector.reset();

    console.log('[QuotaManager] Shutdown complete');
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
