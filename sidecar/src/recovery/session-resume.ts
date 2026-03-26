/**
 * Session Resume - Claude Code --resume 參數注入
 *
 * 負責在 Worker Agent 啟動時注入 --resume {sessionId} 參數，
 * 以恢復先前的對話上下文。
 *
 * 架構原則：
 * - 只修改 CLI 啟動參數，不持有狀態
 * - session_id 由 Rust 透過 IPC 提供
 */

// =============================================================================
// Resume Parameter Injection
// =============================================================================

/**
 * 在 CLI 參數中注入 --resume {sessionId}
 *
 * 如果 sessionId 為 undefined/null，回傳原始參數不修改。
 *
 * @param args - 原始 CLI 參數陣列
 * @param sessionId - 要恢復的 session ID
 * @returns 修改後的參數陣列
 */
export function injectResumeParam(
  args: string[],
  sessionId?: string | null
): string[] {
  if (!sessionId) {
    return args;
  }

  // 檢查是否已經有 --resume 參數
  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1) {
    // 已存在 --resume，更新其值
    const newArgs = [...args];
    if (resumeIndex + 1 < newArgs.length) {
      newArgs[resumeIndex + 1] = sessionId;
    } else {
      newArgs.push(sessionId);
    }
    return newArgs;
  }

  // 在末尾但 prompt 之前插入 --resume
  // CLI 格式：claude [flags] "{TASK_PROMPT}"
  // --resume 應該在 prompt（最後一個參數）之前
  const newArgs = [...args];

  if (newArgs.length > 0) {
    const lastArg = newArgs[newArgs.length - 1];
    // 如果最後一個參數看起來是 prompt（不以 -- 開頭的非 flag 值）
    if (!lastArg.startsWith('--') && !lastArg.startsWith('-')) {
      // 在 prompt 之前插入
      newArgs.splice(newArgs.length - 1, 0, '--resume', sessionId);
      return newArgs;
    }
  }

  // 否則直接追加
  newArgs.push('--resume', sessionId);
  return newArgs;
}

/**
 * 從 CLI 參數中移除 --resume 參數
 *
 * @param args - CLI 參數陣列
 * @returns 移除 --resume 後的參數陣列
 */
export function removeResumeParam(args: string[]): string[] {
  const newArgs: string[] = [];
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === '--resume') {
      skipNext = true;
      continue;
    }
    newArgs.push(arg);
  }

  return newArgs;
}

/**
 * 檢查 CLI 參數中是否包含 --resume
 */
export function hasResumeParam(args: string[]): boolean {
  return args.includes('--resume');
}

/**
 * 從 CLI 參數中提取 --resume 的值
 *
 * @returns sessionId 或 null
 */
export function getResumeSessionId(args: string[]): string | null {
  const index = args.indexOf('--resume');
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }
  return args[index + 1];
}
