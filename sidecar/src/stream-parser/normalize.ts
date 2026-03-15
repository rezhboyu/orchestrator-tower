/**
 * NormalizedEvent - Protocol-agnostic internal event format
 *
 * This is the unified format output by both parsers.
 * AgentManager (Task 05) wraps these with agentId to create SidecarEvent.
 */

export interface SessionStartEvent {
  kind: 'session_start';
  sessionId: string;
}

export interface TextDeltaEvent {
  kind: 'text_delta';
  text: string;
}

export interface ToolCallEvent {
  kind: 'tool_call';
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  kind: 'tool_result';
  toolId: string;
  success: boolean;
  output: string;
}

export interface SessionEndEvent {
  kind: 'session_end';
  success: boolean;
  errorType?: string;
  costUsd?: number; // Claude: total_cost_usd; Gemini: undefined
  numTurns?: number;
}

export interface PermissionRequestEvent {
  kind: 'permission_request';
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type NormalizedEvent =
  | SessionStartEvent
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionEndEvent
  | PermissionRequestEvent;

// =============================================================================
// Helper Functions
// =============================================================================

export function createSessionStart(sessionId: string): SessionStartEvent {
  return { kind: 'session_start', sessionId };
}

export function createTextDelta(text: string): TextDeltaEvent {
  return { kind: 'text_delta', text };
}

export function createToolCall(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>
): ToolCallEvent {
  return { kind: 'tool_call', toolName, toolId, input };
}

export function createToolResult(
  toolId: string,
  success: boolean,
  output: string
): ToolResultEvent {
  return { kind: 'tool_result', toolId, success, output };
}

export function createSessionEnd(
  success: boolean,
  options?: { errorType?: string; costUsd?: number; numTurns?: number }
): SessionEndEvent {
  return {
    kind: 'session_end',
    success,
    ...options,
  };
}

export function createPermissionRequest(
  requestId: string,
  toolName: string,
  input: Record<string, unknown>
): PermissionRequestEvent {
  return { kind: 'permission_request', requestId, toolName, input };
}
