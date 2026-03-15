/**
 * IPC Messages - Node.js ↔ Rust 訊息型別定義
 *
 * 這是 Node.js Sidecar 與 Rust Core 之間的通訊協議。
 * Rust 端對應型別在 src-tauri/src/ipc/messages.rs
 */

// =============================================================================
// Node.js → Rust（上報事件）
// =============================================================================

export interface AgentSessionStart {
  type: 'agent:session_start';
  agentId: string;
  sessionId: string;
  model: string;
}

export interface AgentText {
  type: 'agent:text';
  agentId: string;
  text: string;
}

export interface AgentToolUse {
  type: 'agent:tool_use';
  agentId: string;
  toolId: string;
  toolName: string;
  input: unknown;
}

export interface AgentToolResult {
  type: 'agent:tool_result';
  agentId: string;
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface AgentSessionEnd {
  type: 'agent:session_end';
  agentId: string;
  subtype: string;
  numTurns: number;
  totalCostUsd: number;
  usage: Record<string, unknown>;
}

export interface AgentStreamDelta {
  type: 'agent:stream_delta';
  agentId: string;
  text: string;
}

export interface AgentCrash {
  type: 'agent:crash';
  agentId: string;
  exitCode: number | null;
  signal: string | null;
  lastSessionId: string | null;
  lastToolUse: unknown | null;
}

export interface HitlRequest {
  type: 'hitl:request';
  agentId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  source: 'tower-mcp' | 'acp-permission';
  // source='tower-mcp'：Worker（Claude Code）透過 --permission-prompt-tool → Tower MCP 3701 → IPC
  // source='acp-permission'：Master（Gemini CLI）透過 session/request_permission ACP 回調 → IPC
}

export interface Heartbeat {
  type: 'heartbeat';
}

export type SidecarEvent =
  | AgentSessionStart
  | AgentText
  | AgentToolUse
  | AgentToolResult
  | AgentSessionEnd
  | AgentStreamDelta
  | AgentCrash
  | HitlRequest
  | Heartbeat;

// =============================================================================
// Rust → Node.js（指令）
// =============================================================================

export interface AgentStart {
  type: 'agent:start';
  agentId: string;
  prompt: string;
  model: string;
  maxTurns: number;
  towerPort: number;
  worktreePath: string;
}

export interface AgentStop {
  type: 'agent:stop';
  agentId: string;
}

export interface AgentAssign {
  type: 'agent:assign';
  agentId: string;
  prompt: string;
  maxTurns: number;
}

export interface AgentFreeze {
  type: 'agent:freeze';
  agentId: string;
  reason: 'quota' | 'orchestrator' | 'human';
  immediate: boolean;
}

export interface AgentUnfreeze {
  type: 'agent:unfreeze';
  agentId: string;
  reason: 'quota' | 'orchestrator' | 'human';
}

export interface HitlResponse {
  type: 'hitl:response';
  requestId: string;
  approved: boolean;
  modifiedInput?: unknown;
  reason?: string;
}

export type RustCommand =
  | AgentStart
  | AgentStop
  | AgentAssign
  | AgentFreeze
  | AgentUnfreeze
  | HitlResponse;

// =============================================================================
// IPC Request/Response 配對機制（用於查詢類操作）
// =============================================================================

export type IpcQueryType =
  | 'get_worker_status'
  | 'get_quota_status'
  | 'get_git_snapshot'
  | 'get_b_mode_status'
  // State MCP 控制操作（透過 query 請求 Rust 執行）
  | 'assign_task'
  | 'pause_worker'
  | 'resume_worker'
  | 'approve_hitl'
  | 'deny_hitl';

export interface IpcRequest {
  type: 'ipc:query';
  ipcRequestId: string; // UUID v4，由 Node.js 生成
  query: IpcQueryType;
  params: Record<string, unknown>;
}

export interface IpcResponse {
  type: 'ipc:response';
  ipcRequestId: string; // 對應 IpcRequest.ipcRequestId
  ok: boolean;
  data?: unknown;
  error?: string;
}

// =============================================================================
// Type Guards
// =============================================================================

export function isSidecarEvent(msg: unknown): msg is SidecarEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;

  const validTypes = [
    'agent:session_start',
    'agent:text',
    'agent:tool_use',
    'agent:tool_result',
    'agent:session_end',
    'agent:stream_delta',
    'agent:crash',
    'hitl:request',
    'heartbeat',
  ];

  return validTypes.includes(obj.type);
}

export function isRustCommand(msg: unknown): msg is RustCommand {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;

  const validTypes = [
    'agent:start',
    'agent:stop',
    'agent:assign',
    'agent:freeze',
    'agent:unfreeze',
    'hitl:response',
  ];

  return validTypes.includes(obj.type);
}

export function isIpcResponse(msg: unknown): msg is IpcResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.type === 'ipc:response' && typeof obj.ipcRequestId === 'string';
}
