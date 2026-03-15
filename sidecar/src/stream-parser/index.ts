/**
 * Stream Parser Module
 *
 * Provides parsers for converting CLI stdout to NormalizedEvent.
 */

// =============================================================================
// NormalizedEvent Types and Helpers
// =============================================================================

export type {
  NormalizedEvent,
  SessionStartEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  SessionEndEvent,
  PermissionRequestEvent,
} from './normalize.js';

export {
  createSessionStart,
  createTextDelta,
  createToolCall,
  createToolResult,
  createSessionEnd,
  createPermissionRequest,
} from './normalize.js';

// =============================================================================
// Parsers
// =============================================================================

export { ClaudeStreamParser } from './claude-parser.js';
export type { ClaudeParserEvents } from './claude-parser.js';

export { GeminiAcpParser } from './gemini-acp-parser.js';
export type { GeminiParserEvents } from './gemini-acp-parser.js';

// =============================================================================
// Utilities
// =============================================================================

export { LineBuffer } from './line-buffer.js';
export { handleProcessEnd, createExitedFlag } from './process-guard.js';
export type { ProcessGuardOptions, ExitedFlag } from './process-guard.js';

// =============================================================================
// Protocol Types (for advanced usage)
// =============================================================================

// Claude Code types
export type {
  ClaudeStreamMessage,
  ClaudeSystemInit,
  ClaudeAssistantMessage,
  ClaudeUserMessage,
  ClaudeStreamEvent,
  ClaudeResultMessage,
  ClaudeContent,
  ClaudeTextContent,
  ClaudeToolUseContent,
  ClaudeToolResultContent,
  ClaudeResultSubtype,
} from './types-claude.js';

export {
  isClaudeSystemInit,
  isClaudeAssistant,
  isClaudeUser,
  isClaudeStreamEvent,
  isClaudeResult,
  isClaudeTextContent,
  isClaudeToolUseContent,
  isClaudeToolResultContent,
} from './types-claude.js';

// Gemini ACP types
export type {
  AcpMessage,
  AcpNotification,
  AcpResponse,
  AcpSessionUpdate,
  AcpPermissionRequest,
  AcpInitializeResponse,
  AcpSessionNewResponse,
  AcpSessionPromptResponse,
  AcpContent,
  AcpTextContent,
  AcpToolUseContent,
  AcpToolResultContent,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
} from './types-gemini-acp.js';

export {
  isAcpSessionUpdate,
  isAcpPermissionRequest,
  isAcpResponse,
  isAcpSessionPromptResponse,
  isAcpSessionNewResponse,
  isAcpTextContent,
  isAcpToolUseContent,
  isAcpToolResultContent,
} from './types-gemini-acp.js';
