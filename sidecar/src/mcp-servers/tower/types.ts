/**
 * Tower MCP Server - Type Definitions
 *
 * 定義 auth tool 的輸入輸出型別、風險等級、以及內部狀態管理介面。
 * 這些型別嚴格遵循 Claude Code 2.1.74 的 HITL 協議要求。
 */

import type { HitlResponse } from '../../ipc/messages.js';

// =============================================================================
// Auth Tool Types (Claude Code HITL Protocol)
// =============================================================================

/**
 * Auth Tool 輸入（Claude Code 透過 --permission-prompt-tool 傳入）
 */
export interface AuthToolInput {
  tool_name: string;
  tool_use_id: string;
  input: Record<string, unknown>;
}

/**
 * Auth Tool 允許回應
 * 注意：updatedInput 必填，即使沒有修改也要傳回原始 input
 */
export interface AuthAllowResponse {
  behavior: 'allow';
  updatedInput: Record<string, unknown>;
}

/**
 * Auth Tool 拒絕回應
 * 注意：是 'deny' 不是 'block'，否則 Claude Code 會報 invalid_union 錯誤
 */
export interface AuthDenyResponse {
  behavior: 'deny';
  message: string;
}

/**
 * Auth Tool 回應（聯合型別）
 */
export type AuthToolResponse = AuthAllowResponse | AuthDenyResponse;

// =============================================================================
// Risk Classification
// =============================================================================

/**
 * 風險等級
 * - critical: 毀滅性操作（rm/delete/drop/format/truncate）
 * - high: 敏感檔案寫入（.env/.key/.pem/.secret）
 * - medium: 一般寫入操作（Write/Edit/Bash）
 * - low: 唯讀操作（Read/Glob/Grep）→ 自動批准
 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// =============================================================================
// Pending HITL Request Management
// =============================================================================

/**
 * 等待中的 HITL 請求
 */
export interface PendingRequest {
  requestId: string;
  agentId: string;
  toolName: string;
  originalInput: Record<string, unknown>;
  resolve: (response: AuthToolResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

// =============================================================================
// Tower MCP Server Interface
// =============================================================================

/**
 * Tower MCP Server 公開介面
 */
export interface TowerMcpServer {
  /** 實際監聽的 port（可能與請求的 port 不同） */
  actualPort: number;

  /**
   * 處理來自 Rust 的 HITL 回應
   * 路由至對應的 pending request 並 resolve Promise
   */
  handleHitlResponse(response: HitlResponse): void;

  /**
   * 關閉 MCP Server
   * 會 reject 所有 pending requests
   */
  shutdown(): Promise<void>;
}

/**
 * Tower MCP Server 配置
 */
export interface TowerMcpServerConfig {
  /** 偏好的 port（預設 3701） */
  preferredPort: number;
  /** port 探測最大嘗試次數 */
  maxPortAttempts?: number;
  /** HITL 請求超時時間（毫秒，預設 5 分鐘） */
  hitlTimeout?: number;
}

// =============================================================================
// MCP Session Types
// =============================================================================

/**
 * MCP Session 資訊
 * 每個連線的 Claude Code Worker 有獨立的 session
 */
export interface TowerSession {
  sessionId: string;
  agentId: string;
  createdAt: number;
}
