/**
 * Quota Module - 配額管理模組
 *
 * 提供集中式配額調度功能：
 * - QuotaManager: Bottleneck 包裝器，控制 API 呼叫併發和速率
 * - RateLimitDetector: Rate Limit 三態偵測邏輯
 */

export { QuotaManager, type QuotaManagerOptions, type ScheduleOptions } from './manager.js';
export { RateLimitDetector, type RateLimitState, type RateLimitResult } from './rate-limit.js';
