/**
 * Rate Limit 三態偵測邏輯
 *
 * 狀態機：
 *
 *  Rate Limit 錯誤
 *        │
 *        ▼
 *   等待 60-90 秒（隨機退避）
 *        │
 *        ▼
 *     重試一次
 *        │
 *    ┌───┴───┐
 *    │       │
 *  成功     失敗
 *    │       │
 *    ▼       ▼
 *  繼續    凍結所有 Agent（配額耗盡）
 *
 *  非 Rate Limit 錯誤 → 只記 log，不處理
 */

export type RateLimitState = 'ok' | 'retrying' | 'exhausted';

export interface RateLimitResult {
  state: RateLimitState;
  shouldFreeze: boolean;
  waitMs?: number;
}

/**
 * Rate Limit 錯誤的型別擴展
 */
interface RateLimitError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Rate Limit 偵測器
 *
 * 實作三態偵測邏輯：
 * 1. 偵測是否為 rate limit 錯誤
 * 2. 計算隨機退避時間（60-90秒）
 * 3. 管理重試狀態
 */
export class RateLimitDetector {
  // 最小退避時間（60秒）
  private static readonly MIN_BACKOFF_MS = 60000;
  // 最大退避時間（90秒）
  private static readonly MAX_BACKOFF_MS = 90000;

  // 上次重試時間
  private lastRetryTime: number | null = null;
  // 是否正在重試中
  private retryInProgress = false;

  /**
   * 檢查錯誤是否為 rate limit 錯誤
   *
   * 偵測模式：
   * - HTTP 429 狀態碼
   * - 錯誤訊息包含 "rate limit"
   * - 錯誤訊息包含 "quota exceeded"
   * - 錯誤訊息包含 "too many requests"
   * - 錯誤訊息包含 "throttl"
   */
  isRateLimitError(error: Error | unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const err = error as RateLimitError;

    // 檢查 HTTP 狀態碼
    if (err.status === 429 || err.statusCode === 429) {
      return true;
    }

    // 檢查錯誤碼
    if (err.code === 'RATE_LIMIT' || err.code === 'QUOTA_EXCEEDED') {
      return true;
    }

    // 檢查錯誤訊息（不區分大小寫）
    const message = err.message.toLowerCase();
    const patterns = [
      'rate limit',
      'ratelimit',
      'quota exceeded',
      'too many requests',
      'throttl',  // 匹配 throttle, throttled, throttling
    ];

    return patterns.some(pattern => message.includes(pattern));
  }

  /**
   * 計算隨機退避時間（60-90秒）
   *
   * @returns 退避時間（毫秒）
   */
  calculateBackoff(): number {
    const range = RateLimitDetector.MAX_BACKOFF_MS - RateLimitDetector.MIN_BACKOFF_MS;
    return RateLimitDetector.MIN_BACKOFF_MS + Math.random() * range;
  }

  /**
   * 開始重試流程
   *
   * @returns RateLimitResult 包含等待時間
   */
  startRetry(): RateLimitResult {
    if (this.retryInProgress) {
      // 已經在重試中，返回等待狀態
      return {
        state: 'retrying',
        shouldFreeze: false,
      };
    }

    this.retryInProgress = true;
    this.lastRetryTime = Date.now();
    const waitMs = this.calculateBackoff();

    return {
      state: 'retrying',
      shouldFreeze: false,
      waitMs,
    };
  }

  /**
   * 報告重試成功 - 重置狀態
   */
  reportSuccess(): RateLimitResult {
    this.retryInProgress = false;
    this.lastRetryTime = null;

    return {
      state: 'ok',
      shouldFreeze: false,
    };
  }

  /**
   * 報告重試失敗 - 配額耗盡
   */
  reportFailure(): RateLimitResult {
    this.retryInProgress = false;

    return {
      state: 'exhausted',
      shouldFreeze: true,
    };
  }

  /**
   * 檢查是否正在重試中
   */
  isRetrying(): boolean {
    return this.retryInProgress;
  }

  /**
   * 取得上次重試時間
   */
  getLastRetryTime(): number | null {
    return this.lastRetryTime;
  }

  /**
   * 重置所有狀態
   */
  reset(): void {
    this.retryInProgress = false;
    this.lastRetryTime = null;
  }
}