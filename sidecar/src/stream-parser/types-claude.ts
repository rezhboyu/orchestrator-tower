/**
 * Claude Code stream-json protocol types
 * Reference: --print --output-format stream-json
 */

// =============================================================================
// Content Types
// =============================================================================

export interface ClaudeTextContent {
  type: 'text';
  text: string;
}

export interface ClaudeToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ClaudeContent =
  | ClaudeTextContent
  | ClaudeToolUseContent
  | ClaudeToolResultContent;

// =============================================================================
// Result Subtypes (5 types per spec)
// =============================================================================

export type ClaudeResultSubtype =
  | 'success'
  | 'error_max_turns'
  | 'error_during_execution'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries';

// =============================================================================
// Stream Message Types
// =============================================================================

export interface ClaudeSystemInit {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
}

export interface ClaudeAssistantMessage {
  type: 'assistant';
  message: {
    content: ClaudeContent[];
  };
  session_id: string;
}

export interface ClaudeUserMessage {
  type: 'user';
  message: {
    content: ClaudeContent[];
  };
}

export interface ClaudeStreamEvent {
  type: 'stream_event';
  event: {
    type: string;
    delta?: {
      type: string;
      text?: string;
    };
  };
}

export interface ClaudeResultMessage {
  type: 'result';
  subtype: ClaudeResultSubtype;
  session_id: string;
  is_error: boolean;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
}

export type ClaudeStreamMessage =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeStreamEvent
  | ClaudeResultMessage;

// =============================================================================
// Type Guards
// =============================================================================

export function isClaudeSystemInit(msg: unknown): msg is ClaudeSystemInit {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ClaudeSystemInit).type === 'system' &&
    (msg as ClaudeSystemInit).subtype === 'init'
  );
}

export function isClaudeAssistant(msg: unknown): msg is ClaudeAssistantMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ClaudeAssistantMessage).type === 'assistant'
  );
}

export function isClaudeUser(msg: unknown): msg is ClaudeUserMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ClaudeUserMessage).type === 'user'
  );
}

export function isClaudeStreamEvent(msg: unknown): msg is ClaudeStreamEvent {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ClaudeStreamEvent).type === 'stream_event'
  );
}

export function isClaudeResult(msg: unknown): msg is ClaudeResultMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ClaudeResultMessage).type === 'result'
  );
}

// =============================================================================
// Content Type Guards
// =============================================================================

export function isClaudeTextContent(
  content: ClaudeContent
): content is ClaudeTextContent {
  return content.type === 'text';
}

export function isClaudeToolUseContent(
  content: ClaudeContent
): content is ClaudeToolUseContent {
  return content.type === 'tool_use';
}

export function isClaudeToolResultContent(
  content: ClaudeContent
): content is ClaudeToolResultContent {
  return content.type === 'tool_result';
}
