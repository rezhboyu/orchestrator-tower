/**
 * Gemini CLI ACP (--experimental-acp) JSON-RPC protocol types
 * Protocol version: 1
 */

// =============================================================================
// Base JSON-RPC Types
// =============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// =============================================================================
// Session Update Content Types
// =============================================================================

export interface AcpTextContent {
  type: 'text';
  text: string;
  delta?: boolean; // true = streaming token
}

export interface AcpToolUseContent {
  type: 'tool_use';
  tool_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

export interface AcpToolResultContent {
  type: 'tool_result';
  tool_id: string;
  output: string;
  is_error?: boolean;
}

export type AcpContent = AcpTextContent | AcpToolUseContent | AcpToolResultContent;

// =============================================================================
// Notifications from Gemini (stdout)
// =============================================================================

export interface AcpSessionUpdate {
  jsonrpc: '2.0';
  method: 'session/update';
  params: {
    sessionId: string;
    content: AcpContent[];
  };
}

export interface AcpPermissionRequest {
  jsonrpc: '2.0';
  method: 'session/request_permission';
  params: {
    sessionId: string;
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
  };
}

// =============================================================================
// Responses from Gemini (stdout)
// =============================================================================

export interface AcpInitializeResponse {
  jsonrpc: '2.0';
  id: number;
  result: {
    protocolVersion: 1;
    authMethods: unknown[];
  };
}

export interface AcpSessionNewResponse {
  jsonrpc: '2.0';
  id: number;
  result: {
    sessionId: string;
  };
}

export interface AcpSessionPromptResponse {
  jsonrpc: '2.0';
  id: number;
  result: {
    stopReason: 'end_turn' | 'cancelled';
  };
}

export type AcpNotification = AcpSessionUpdate | AcpPermissionRequest;
export type AcpResponse =
  | AcpInitializeResponse
  | AcpSessionNewResponse
  | AcpSessionPromptResponse;
export type AcpMessage = AcpNotification | AcpResponse | JsonRpcResponse;

// =============================================================================
// Type Guards
// =============================================================================

export function isAcpSessionUpdate(msg: unknown): msg is AcpSessionUpdate {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as AcpSessionUpdate).jsonrpc === '2.0' &&
    (msg as AcpSessionUpdate).method === 'session/update'
  );
}

export function isAcpPermissionRequest(msg: unknown): msg is AcpPermissionRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as AcpPermissionRequest).jsonrpc === '2.0' &&
    (msg as AcpPermissionRequest).method === 'session/request_permission'
  );
}

export function isAcpResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as JsonRpcResponse).jsonrpc === '2.0' &&
    'id' in (msg as object)
  );
}

export function isAcpSessionPromptResponse(
  msg: unknown
): msg is AcpSessionPromptResponse {
  if (!isAcpResponse(msg)) return false;
  const result = (msg as AcpSessionPromptResponse).result;
  return (
    typeof result === 'object' &&
    result !== null &&
    'stopReason' in result
  );
}

export function isAcpSessionNewResponse(
  msg: unknown
): msg is AcpSessionNewResponse {
  if (!isAcpResponse(msg)) return false;
  const result = (msg as AcpSessionNewResponse).result;
  return (
    typeof result === 'object' &&
    result !== null &&
    'sessionId' in result
  );
}

// =============================================================================
// Content Type Guards
// =============================================================================

export function isAcpTextContent(content: AcpContent): content is AcpTextContent {
  return content.type === 'text';
}

export function isAcpToolUseContent(
  content: AcpContent
): content is AcpToolUseContent {
  return content.type === 'tool_use';
}

export function isAcpToolResultContent(
  content: AcpContent
): content is AcpToolResultContent {
  return content.type === 'tool_result';
}
