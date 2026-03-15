/**
 * GeminiAcpParser - Parses Gemini CLI ACP JSON-RPC output
 *
 * Handles the --experimental-acp protocol (JSON-RPC NDJSON).
 * Converts Gemini-specific messages to unified NormalizedEvent format.
 */

import { EventEmitter } from 'node:events';
import { LineBuffer } from './line-buffer.js';
import type {
  AcpSessionUpdate,
  AcpPermissionRequest,
  AcpContent,
  AcpTextContent,
  AcpToolUseContent,
  AcpToolResultContent,
} from './types-gemini-acp.js';
import {
  isAcpSessionUpdate,
  isAcpPermissionRequest,
  isAcpSessionPromptResponse,
  isAcpSessionNewResponse,
} from './types-gemini-acp.js';
import type { NormalizedEvent } from './normalize.js';
import {
  createSessionStart,
  createTextDelta,
  createToolCall,
  createToolResult,
  createSessionEnd,
  createPermissionRequest,
} from './normalize.js';

// =============================================================================
// Types
// =============================================================================

export interface GeminiParserEvents {
  event: [NormalizedEvent];
  error: [Error];
  result: []; // Signals stream end for hang protection
}

// =============================================================================
// GeminiAcpParser
// =============================================================================

export class GeminiAcpParser extends EventEmitter<GeminiParserEvents> {
  private lineBuffer = new LineBuffer();
  private currentSessionId: string | null = null;
  private sessionStarted = false;

  /**
   * Feed raw stdout data from Gemini CLI process.
   *
   * @param chunk - Raw string data from stdout
   */
  write(chunk: string): void {
    const lines = this.lineBuffer.push(chunk);
    for (const line of lines) {
      this.parseLine(line);
    }
  }

  /**
   * Signal end of stream.
   * Call this when the process stdout closes.
   */
  end(): void {
    const remaining = this.lineBuffer.flush();
    if (remaining) {
      this.parseLine(remaining);
    }
  }

  /**
   * Get current session ID.
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Reset parser state.
   */
  reset(): void {
    this.lineBuffer.clear();
    this.currentSessionId = null;
    this.sessionStarted = false;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private parseLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Non-JSON line - ignore silently (test case #9)
      return;
    }

    this.handleMessage(parsed);
  }

  private handleMessage(msg: unknown): void {
    // Session new response - provides sessionId
    if (isAcpSessionNewResponse(msg)) {
      this.currentSessionId = msg.result.sessionId;
      // Don't emit session_start here - wait for first update
      return;
    }

    // Session update notification
    if (isAcpSessionUpdate(msg)) {
      const update = msg as AcpSessionUpdate;

      // First session/update implies session start
      if (!this.sessionStarted) {
        this.currentSessionId = update.params.sessionId;
        this.sessionStarted = true;
        this.emit('event', createSessionStart(update.params.sessionId));
      }

      this.processContent(update.params.content);
      return;
    }

    // Permission request (Gemini HITL)
    if (isAcpPermissionRequest(msg)) {
      const req = msg as AcpPermissionRequest;
      this.emit(
        'event',
        createPermissionRequest(
          req.params.requestId,
          req.params.toolName,
          req.params.input
        )
      );
      return;
    }

    // Session prompt response - session end
    if (isAcpSessionPromptResponse(msg)) {
      const success = msg.result.stopReason === 'end_turn';
      this.emit(
        'event',
        createSessionEnd(success, {
          errorType: success ? undefined : msg.result.stopReason,
          // Gemini CLI does not provide cost data
          costUsd: undefined,
        })
      );
      this.emit('result'); // Trigger hang protection
      return;
    }
  }

  private processContent(contents: AcpContent[]): void {
    for (const content of contents) {
      if (content.type === 'text') {
        const textContent = content as AcpTextContent;
        // delta:true means streaming token (test case #7)
        // Both delta and non-delta text emit as text_delta
        this.emit('event', createTextDelta(textContent.text));
      } else if (content.type === 'tool_use') {
        const toolUse = content as AcpToolUseContent;
        this.emit(
          'event',
          createToolCall(toolUse.tool_name, toolUse.tool_id, toolUse.input)
        );
      } else if (content.type === 'tool_result') {
        const toolResult = content as AcpToolResultContent;
        this.emit(
          'event',
          createToolResult(
            toolResult.tool_id,
            !toolResult.is_error,
            toolResult.output
          )
        );
      }
    }
  }
}
