/**
 * State MCP Server - Type Definitions
 *
 * 定義 8 個工具的輸入輸出型別、伺服器介面及配置。
 * 這些工具供 Master Orchestrator 查詢與控制 Worker Agents。
 */

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * 通用成功回應
 */
export interface SuccessResult {
  success: true;
}

/**
 * HITL 操作結果（可能成功或被 B mode 阻擋）
 */
export interface HitlOperationResult {
  success?: boolean;
  status?: number;
  error?: string;
}

/**
 * Worker 狀態（從 Rust 回傳）
 */
export interface WorkerStatusResult {
  id: string;
  status: 'idle' | 'running' | 'waiting_hitl' | 'error' | 'frozen';
  sessionId?: string;
  model: string;
  projectId: string;
  priority: number;
}

/**
 * 配額狀態（從 Rust 回傳）
 */
export interface QuotaStatusResult {
  tier1_available: number;
  tier2_available: number;
  tier3_available: number;
}

/**
 * Git 快照資訊（從 Rust 回傳）
 */
export interface GitSnapshotResult {
  sha?: string;
  timestamp?: number;
  nodeId?: string;
}

/**
 * B mode 狀態（從 Rust 回傳）
 */
export interface BModeStatusResult {
  enabled: boolean;
}

// =============================================================================
// State MCP Server Interface
// =============================================================================

/**
 * State MCP Server 公開介面
 */
export interface StateMcpServer {
  /** 實際監聽的 port（可能與請求的 port 不同） */
  actualPort: number;

  /**
   * 關閉 MCP Server
   */
  shutdown(): Promise<void>;
}

/**
 * State MCP Server 配置
 */
export interface StateMcpServerConfig {
  /** 偏好的 port（預設 3702） */
  preferredPort: number;
  /** port 探測最大嘗試次數 */
  maxPortAttempts?: number;
}

// =============================================================================
// MCP Session Types
// =============================================================================

/**
 * MCP Session 資訊
 * Master Orchestrator 的 session
 */
export interface StateSession {
  sessionId: string;
  createdAt: number;
}
