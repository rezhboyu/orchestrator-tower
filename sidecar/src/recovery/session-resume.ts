/**
 * Session Resume - Claude Code --resume 參數注入
 *
 * 當 Sidecar 崩潰恢復時，注入 --resume 參數以恢復上次 session。
 */

// =============================================================================
// Resume Arguments Builder
// =============================================================================

/**
 * 建構 --resume 參數陣列
 *
 * @param sessionId 上次 session ID，若為 null 則不注入
 * @returns 參數陣列，例如 ['--resume', 'session-123']
 */
export function buildResumeArgs(sessionId: string | null): string[] {
  if (!sessionId || sessionId.trim() === '') {
    return [];
  }
  return ['--resume', sessionId];
}
