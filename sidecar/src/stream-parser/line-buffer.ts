/**
 * LineBuffer - Handles NDJSON line splitting across chunks
 *
 * Pattern from IpcClient.handleData() - reusable for stream parsing.
 * Accumulates partial lines until a complete line (ending with \n) is received.
 */

export class LineBuffer {
  private buffer = '';

  /**
   * Add data and return complete lines.
   *
   * @param chunk - Raw string data from stream
   * @returns Array of complete lines (without trailing newlines)
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line
    return lines.filter((line) => line.trim().length > 0);
  }

  /**
   * Get any remaining content (for stream end).
   * Call this when the stream ends to process any final incomplete line.
   *
   * @returns Remaining content or null if empty
   */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }

  /**
   * Reset buffer to empty state.
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Check if buffer has pending data.
   */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }
}
