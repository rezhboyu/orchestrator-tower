// Mirror Rust SidecarEvent types for TypeScript

export type AgentStatus = 'idle' | 'running' | 'waiting_hitl' | 'error' | 'frozen';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface AgentSessionStartEvent {
  type: 'agent:session_start';
  agentId: string;
  sessionId: string;
  model: string;
}

export interface AgentTextEvent {
  type: 'agent:text';
  agentId: string;
  text: string;
}

export interface AgentToolUseEvent {
  type: 'agent:tool_use';
  agentId: string;
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AgentToolResultEvent {
  type: 'agent:tool_result';
  agentId: string;
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface AgentSessionEndEvent {
  type: 'agent:session_end';
  agentId: string;
  subtype: string;
  numTurns: number;
  totalCostUsd: number;
}

export interface AgentStreamDeltaEvent {
  type: 'agent:stream_delta';
  agentId: string;
  text: string;
}

export interface AgentCrashEvent {
  type: 'agent:crash';
  agentId: string;
  exitCode?: number;
  signal?: string;
  lastSessionId?: string;
  lastToolUse?: Record<string, unknown>;
}

export interface HitlRequestEvent {
  type: 'hitl:request';
  agentId: string;
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
  source: 'tower-mcp' | 'acp-permission';
}

export type TauriAgentEvent =
  | AgentSessionStartEvent
  | AgentTextEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentSessionEndEvent
  | AgentStreamDeltaEvent
  | AgentCrashEvent
  | HitlRequestEvent;
