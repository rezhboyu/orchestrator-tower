/**
 * Stream Parser Tests
 *
 * Tests all 11 required cases from Task 04 spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeStreamParser } from './claude-parser.js';
import { GeminiAcpParser } from './gemini-acp-parser.js';
import { LineBuffer } from './line-buffer.js';
import { handleProcessEnd, createExitedFlag } from './process-guard.js';
import type { NormalizedEvent, SessionEndEvent } from './normalize.js';
import { EventEmitter } from 'node:events';

// =============================================================================
// Claude Code Parser Tests (Cases 1-5)
// =============================================================================

describe('ClaudeStreamParser', () => {
  let parser: ClaudeStreamParser;
  let events: NormalizedEvent[];

  beforeEach(() => {
    parser = new ClaudeStreamParser();
    events = [];
    parser.on('event', (event) => events.push(event));
  });

  // Case 1: Normal sequence (system -> assistant -> user -> result)
  it('Case 1: parses normal sequence correctly', () => {
    const messages = [
      '{"type":"system","subtype":"init","session_id":"sess-123","tools":["Read","Write"]}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]},"session_id":"sess-123"}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"ok"}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-123","is_error":false,"duration_ms":1000,"num_turns":2,"result":"Done","total_cost_usd":0.005}',
    ];

    for (const msg of messages) {
      parser.write(msg + '\n');
    }

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ kind: 'session_start', sessionId: 'sess-123' });
    expect(events[1]).toEqual({ kind: 'text_delta', text: 'Hello' });
    expect(events[2]).toEqual({
      kind: 'tool_result',
      toolId: 'tool-1',
      success: true,
      output: 'ok',
    });
    expect(events[3]).toMatchObject({
      kind: 'session_end',
      success: true,
      costUsd: 0.005,
    });
  });

  // Case 2: tool_use extracted from assistant.message.content
  it('Case 2: extracts tool_use from assistant message content', () => {
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me run that' },
          { type: 'tool_use', id: 'tu-123', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      session_id: 'sess-1',
    });

    parser.write(msg + '\n');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'text_delta', text: 'Let me run that' });
    expect(events[1]).toEqual({
      kind: 'tool_call',
      toolName: 'Bash',
      toolId: 'tu-123',
      input: { command: 'ls' },
    });
  });

  // Case 3: tool_result extracted from user.message.content
  it('Case 3: extracts tool_result from user message content', () => {
    const msg = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-456',
            content: 'file1.txt\nfile2.txt',
          },
        ],
      },
    });

    parser.write(msg + '\n');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'tool_result',
      toolId: 'tu-456',
      success: true,
      output: 'file1.txt\nfile2.txt',
    });
  });

  // Case 4: All 5 result.subtype error types
  it('Case 4: parses all 5 result subtype error types', () => {
    const subtypes = [
      'success',
      'error_max_turns',
      'error_during_execution',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ] as const;

    for (const subtype of subtypes) {
      const localParser = new ClaudeStreamParser();
      const localEvents: NormalizedEvent[] = [];
      localParser.on('event', (e) => localEvents.push(e));

      const msg = JSON.stringify({
        type: 'result',
        subtype,
        session_id: 'sess-1',
        is_error: subtype !== 'success',
        duration_ms: 100,
        num_turns: 1,
        result: '',
        total_cost_usd: 0.001,
      });

      localParser.write(msg + '\n');

      expect(localEvents).toHaveLength(1);
      expect(localEvents[0].kind).toBe('session_end');

      const sessionEnd = localEvents[0] as SessionEndEvent;
      if (subtype === 'success') {
        expect(sessionEnd.success).toBe(true);
        expect(sessionEnd.errorType).toBeUndefined();
      } else {
        expect(sessionEnd.success).toBe(false);
        expect(sessionEnd.errorType).toBe(subtype);
      }
    }
  });

  // Case 5: stream_event text_delta extraction
  it('Case 5: extracts text_delta from stream_event', () => {
    const msg = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello ' },
      },
    });

    parser.write(msg + '\n');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'text_delta', text: 'Hello ' });
  });
});

// =============================================================================
// Gemini CLI ACP Parser Tests (Cases 6-8)
// =============================================================================

describe('GeminiAcpParser', () => {
  let parser: GeminiAcpParser;
  let events: NormalizedEvent[];

  beforeEach(() => {
    parser = new GeminiAcpParser();
    events = [];
    parser.on('event', (event) => events.push(event));
  });

  // Case 6: Normal sequence
  it('Case 6: parses normal sequence correctly', () => {
    const messages = [
      // First session/update triggers session_start
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"gem-123","content":[{"type":"text","text":"Hello"}]}}',
      // Tool use
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"gem-123","content":[{"type":"tool_use","tool_id":"t1","tool_name":"Read","input":{"path":"file.txt"}}]}}',
      // Tool result
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"gem-123","content":[{"type":"tool_result","tool_id":"t1","output":"content","is_error":false}]}}',
      // Final message
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"gem-123","content":[{"type":"text","text":"Done"}]}}',
      // Result
      '{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}',
    ];

    for (const msg of messages) {
      parser.write(msg + '\n');
    }

    expect(events).toHaveLength(6);
    expect(events[0]).toEqual({ kind: 'session_start', sessionId: 'gem-123' });
    expect(events[1]).toEqual({ kind: 'text_delta', text: 'Hello' });
    expect(events[2]).toEqual({
      kind: 'tool_call',
      toolName: 'Read',
      toolId: 't1',
      input: { path: 'file.txt' },
    });
    expect(events[3]).toEqual({
      kind: 'tool_result',
      toolId: 't1',
      success: true,
      output: 'content',
    });
    expect(events[4]).toEqual({ kind: 'text_delta', text: 'Done' });
    expect(events[5]).toMatchObject({
      kind: 'session_end',
      success: true,
      costUsd: undefined,
    });
  });

  // Case 7: delta:true message identified as streaming token
  it('Case 7: identifies delta:true as streaming token', () => {
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'gem-123',
        content: [{ type: 'text', text: 'stream', delta: true }],
      },
    });

    parser.write(msg + '\n');

    // Should emit session_start + text_delta
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'session_start', sessionId: 'gem-123' });
    expect(events[1]).toEqual({ kind: 'text_delta', text: 'stream' });
  });

  // Case 8: tool_use/tool_result paired by tool_id
  it('Case 8: pairs tool_use and tool_result by tool_id', () => {
    const messages = [
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","content":[{"type":"tool_use","tool_id":"ABC","tool_name":"Write","input":{"path":"x"}}]}}',
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","content":[{"type":"tool_result","tool_id":"ABC","output":"written","is_error":false}]}}',
    ];

    for (const msg of messages) {
      parser.write(msg + '\n');
    }

    // session_start + tool_call + tool_result
    const toolCall = events.find((e) => e.kind === 'tool_call');
    const toolResult = events.find((e) => e.kind === 'tool_result');

    expect(toolCall).toBeDefined();
    expect(toolResult).toBeDefined();
    expect((toolCall as { toolId: string }).toolId).toBe('ABC');
    expect((toolResult as { toolId: string }).toolId).toBe('ABC');
  });
});

// =============================================================================
// Shared Tests (Cases 9-11)
// =============================================================================

describe('Shared Parser Behavior', () => {
  // Case 9: Non-JSON lines ignored (no error thrown)
  it('Case 9: ignores non-JSON lines without error', () => {
    const claudeParser = new ClaudeStreamParser();
    const geminiParser = new GeminiAcpParser();
    const claudeEvents: NormalizedEvent[] = [];
    const geminiEvents: NormalizedEvent[] = [];

    claudeParser.on('event', (e) => claudeEvents.push(e));
    geminiParser.on('event', (e) => geminiEvents.push(e));

    // Mix of valid and invalid lines (each line ends with \n)
    const input = [
      'Not JSON at all',
      '{"type":"system","subtype":"init","session_id":"s1","tools":[]}',
      '',
      '   ',
      'Another invalid line',
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"g1","content":[]}}',
    ].join('\n') + '\n'; // Add trailing newline to ensure last line is parsed

    // Should not throw
    expect(() => claudeParser.write(input)).not.toThrow();
    expect(() => geminiParser.write(input)).not.toThrow();

    // Should have parsed valid lines
    expect(claudeEvents).toHaveLength(1);
    expect(geminiEvents).toHaveLength(1); // session_start from first update
  });

  // Case 10: Buffer handles cross-chunk line splitting
  it('Case 10: handles cross-chunk line splitting', () => {
    const parser = new ClaudeStreamParser();
    const events: NormalizedEvent[] = [];
    parser.on('event', (e) => events.push(e));

    const fullLine =
      '{"type":"system","subtype":"init","session_id":"s1","tools":[]}';

    // Split line across multiple chunks
    parser.write(fullLine.slice(0, 20));
    expect(events).toHaveLength(0);

    parser.write(fullLine.slice(20, 40));
    expect(events).toHaveLength(0);

    parser.write(fullLine.slice(40) + '\n');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('session_start');
  });

  // Case 11: Both parsers output consistent NormalizedEvent format
  it('Case 11: produces consistent NormalizedEvent format from both parsers', () => {
    const claudeParser = new ClaudeStreamParser();
    const geminiParser = new GeminiAcpParser();
    const claudeEvents: NormalizedEvent[] = [];
    const geminiEvents: NormalizedEvent[] = [];

    claudeParser.on('event', (e) => claudeEvents.push(e));
    geminiParser.on('event', (e) => geminiEvents.push(e));

    // Claude session start
    claudeParser.write(
      '{"type":"system","subtype":"init","session_id":"c1","tools":[]}\n'
    );

    // Gemini session start (via first update)
    geminiParser.write(
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"g1","content":[]}}\n'
    );

    // Both should have session_start events with same structure
    expect(claudeEvents[0].kind).toBe('session_start');
    expect(geminiEvents[0].kind).toBe('session_start');
    expect(Object.keys(claudeEvents[0]).sort()).toEqual(
      Object.keys(geminiEvents[0]).sort()
    );
  });
});

// =============================================================================
// Additional Tests from Spec
// =============================================================================

describe('Normalize Helpers', () => {
  it('Claude session_end includes costUsd', () => {
    const parser = new ClaudeStreamParser();
    const events: NormalizedEvent[] = [];
    parser.on('event', (e) => events.push(e));

    parser.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        is_error: false,
        duration_ms: 100,
        num_turns: 1,
        result: '',
        total_cost_usd: 0.005,
      }) + '\n'
    );

    expect(events[0].kind).toBe('session_end');
    expect((events[0] as SessionEndEvent).costUsd).toBe(0.005);
  });

  it('Gemini session_end has costUsd undefined', () => {
    const parser = new GeminiAcpParser();
    const events: NormalizedEvent[] = [];
    parser.on('event', (e) => events.push(e));

    parser.write(
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"g1","content":[]}}\n'
    );
    parser.write('{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}\n');

    const sessionEnd = events.find((e) => e.kind === 'session_end');
    expect(sessionEnd).toBeDefined();
    expect((sessionEnd as SessionEndEvent).costUsd).toBeUndefined();
  });
});

describe('ProcessGuard', () => {
  it('exited flag prevents SIGTERM on naturally exited process', async () => {
    // Mock process
    const mockProc = new EventEmitter() as EventEmitter & {
      kill: (signal: string) => void;
    };
    const killSpy = vi.fn();
    mockProc.kill = killSpy;

    const exited = createExitedFlag(mockProc as unknown as import('node:child_process').ChildProcess);

    // Simulate process exits immediately
    mockProc.emit('exit', 0, null);

    // Run guard with short timeouts
    await handleProcessEnd(
      mockProc as unknown as import('node:child_process').ChildProcess,
      exited,
      {
        gracePeriod: 50,
        killTimeout: 50,
      }
    );

    // Should not have called kill
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('sends SIGTERM then SIGKILL for hung process', async () => {
    const mockProc = new EventEmitter() as EventEmitter & {
      kill: (signal: string) => void;
    };
    const killSpy = vi.fn();
    mockProc.kill = killSpy;

    const exited = { value: false };

    await handleProcessEnd(
      mockProc as unknown as import('node:child_process').ChildProcess,
      exited,
      {
        gracePeriod: 50,
        killTimeout: 50,
      }
    );

    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(killSpy).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(killSpy).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });
});

describe('LineBuffer', () => {
  it('handles multiple lines in single push', () => {
    const buffer = new LineBuffer();
    const lines = buffer.push('line1\nline2\nline3\n');

    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('buffers incomplete line', () => {
    const buffer = new LineBuffer();

    let lines = buffer.push('partial');
    expect(lines).toEqual([]);

    lines = buffer.push(' line\n');
    expect(lines).toEqual(['partial line']);
  });

  it('flush returns remaining content', () => {
    const buffer = new LineBuffer();
    buffer.push('incomplete');

    const remaining = buffer.flush();
    expect(remaining).toBe('incomplete');

    // Second flush should be null
    expect(buffer.flush()).toBeNull();
  });

  it('hasPending returns correct state', () => {
    const buffer = new LineBuffer();
    expect(buffer.hasPending()).toBe(false);

    buffer.push('partial');
    expect(buffer.hasPending()).toBe(true);

    buffer.push('\n');
    expect(buffer.hasPending()).toBe(false);
  });
});
