/**
 * ClaudeStreamParser - Parses Claude Code stream-json output
 *
 * Handles the --print --output-format stream-json protocol.
 * Converts Claude-specific messages to unified NormalizedEvent format.
 */

import { EventEmitter } from 'node:events';
import { LineBuffer } from './line-buffer.js';
import type {
  ClaudeContent,
  ClaudeToolUseContent,
  ClaudeToolResultContent,
} from './types-claude.js';
import {
  isClaudeSystemInit,
  isClaudeAssistant,
  isClaudeUser,
  isClaudeStreamEvent,
  isClaudeResult,
} from './types-claude.js';
import type { NormalizedEvent } from './normalize.js';
import {
  createSessionStart,
  createTextDelta,
  createToolCall,
  createToolResult,
  createSessionEnd,
} from './normalize.js';

// =============================================================================
// Types
// =============================================================================

export interface ClaudeParserEvents {
  event: [NormalizedEvent];
  error: [Error];
  result: []; // Signals stream end for hang protection
}

// =============================================================================
// ClaudeStreamParser
// =============================================================================

export class ClaudeStreamParser extends EventEmitter<ClaudeParserEvents> {
  private lineBuffer = new LineBuffer();
  private currentSessionId: string | null = null;

  /**
   * Feed raw stdout data from Claude Code process.
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
    // System init - session start
    if (isClaudeSystemInit(msg)) {
      this.currentSessionId = msg.session_id;
      this.emit('event', createSessionStart(msg.session_id));
      return;
    }

    // Assistant message - may contain text and/or tool_use
    if (isClaudeAssistant(msg)) {
      this.processContent(msg.message.content, 'assistant');
      return;
    }

    // User message - may contain tool_result
    if (isClaudeUser(msg)) {
      this.processContent(msg.message.content, 'user');
      return;
    }

    // Stream event - text delta for typing effect
    if (isClaudeStreamEvent(msg)) {
      if (msg.event.delta?.type === 'text_delta' && msg.event.delta.text) {
        this.emit('event', createTextDelta(msg.event.delta.text));
      }
      return;
    }

    // Result - session end
    if (isClaudeResult(msg)) {
      const success = msg.subtype === 'success';
      this.emit(
        'event',
        createSessionEnd(success, {
          errorType: success ? undefined : msg.subtype,
          costUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        })
      );
      this.emit('result'); // Trigger hang protection
      return;
    }
  }

  private processContent(
    contents: ClaudeContent[],
    source: 'assistant' | 'user'
  ): void {
    for (const content of contents) {
      if (content.type === 'text') {
        // Full text from assistant (not delta)
        this.emit('event', createTextDelta(content.text));
      } else if (content.type === 'tool_use' && source === 'assistant') {
        // Tool call from assistant
        const toolUse = content as ClaudeToolUseContent;
        this.emit(
          'event',
          createToolCall(toolUse.name, toolUse.id, toolUse.input)
        );
      } else if (content.type === 'tool_result' && source === 'user') {
        // Tool result in user message
        const toolResult = content as ClaudeToolResultContent;
        this.emit(
          'event',
          createToolResult(
            toolResult.tool_use_id,
            !toolResult.is_error,
            toolResult.content
          )
        );
      }
    }
  }
}
