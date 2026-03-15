/**
 * HITL Risk Classifier - Task 09
 *
 * 工具呼叫風險分類引擎，用於決定是否需要人類審批。
 *
 * 風險等級定義：
 * - critical: 毀滅性操作（rm/delete/drop/format/truncate/unlink）→ 暫停所有 agents
 * - high: 敏感檔案寫入（.env/.key/.pem/.secret）
 * - medium: 一般寫入操作（Write/Edit/Bash，非以上）
 * - low: 唯讀操作（Read/Glob/Grep）→ 自動批准
 *
 * 增強功能（相對於 Task 06 基礎版本）：
 * - 引號感知：防止 echo 'rm' 誤判為 critical
 * - 大小寫不敏感：rM -rf 仍為 critical
 * - 新增 unlink 模式
 */

import type { RiskLevel } from '../mcp-servers/tower/types.js';

/** 唯讀工具，自動批准 */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/**
 * 毀滅性指令的正則表達式
 * 注意：這些會在 isInQuotes 檢查後才套用
 */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; keyword: string }> = [
  // rm 指令（含各種 flags）
  { pattern: /\brm\s+/i, keyword: 'rm' },
  // delete 關鍵字（SQL 或其他）
  { pattern: /\bdelete\b/i, keyword: 'delete' },
  // drop 關鍵字（SQL）
  { pattern: /\bdrop\b/i, keyword: 'drop' },
  // format 關鍵字
  { pattern: /\bformat\b/i, keyword: 'format' },
  // truncate 關鍵字（SQL 或檔案）
  { pattern: /\btruncate\b/i, keyword: 'truncate' },
  // unlink 關鍵字（檔案刪除）
  { pattern: /\bunlink\s+/i, keyword: 'unlink' },
  // rmdir 指令
  { pattern: /\brmdir\b/i, keyword: 'rmdir' },
  // git reset --hard
  { pattern: /\bgit\s+reset\s+--hard\b/i, keyword: 'git reset --hard' },
  // dd 指令（可能毀掉磁碟）
  { pattern: /\bdd\s+if=/i, keyword: 'dd' },
  // mkfs 指令
  { pattern: /\bmkfs\b/i, keyword: 'mkfs' },
];

/** 敏感檔案副檔名 */
const SENSITIVE_EXTENSIONS = [
  '.env',
  '.key',
  '.pem',
  '.secret',
  '.credential',
  '.credentials',
  '.token',
  '.tokens',
  '.password',
  '.passwords',
];

/** 敏感檔案名稱模式 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /\.env(\.|$)/i,
  /\.env\.local/i,
  /\.env\.production/i,
  /secrets?\./i,
  /credentials?\./i,
  /private.*key/i,
  /id_rsa/i,
  /id_ed25519/i,
  // 檔案名稱含敏感關鍵字（Spec v2 要求）
  /password/i,
  /token/i,
  /api[_-]?key/i,
];

/**
 * 檢查指令中的匹配位置是否在引號內
 *
 * @param cmd - 完整指令字串
 * @param matchIndex - 匹配的起始位置
 * @returns true 如果匹配位置在引號內（應忽略）
 */
export function isInQuotes(cmd: string, matchIndex: number): boolean {
  const before = cmd.substring(0, matchIndex);

  // 計算未轉義的單引號數量
  let singleQuoteCount = 0;
  let doubleQuoteCount = 0;

  for (let i = 0; i < before.length; i++) {
    const char = before[i];
    const prevChar = i > 0 ? before[i - 1] : '';

    // 跳過轉義的引號
    if (prevChar === '\\') {
      continue;
    }

    if (char === "'") {
      // 單引號不能嵌套，直接計數
      singleQuoteCount++;
    } else if (char === '"') {
      // 雙引號也直接計數（不考慮在單引號內的情況，簡化處理）
      doubleQuoteCount++;
    }
  }

  // 如果單引號或雙引號數量為奇數，表示我們在引號內
  return singleQuoteCount % 2 === 1 || doubleQuoteCount % 2 === 1;
}

/**
 * 檢查 Bash 指令是否包含毀滅性操作（不在引號內）
 *
 * @param command - Bash 指令字串
 * @returns true 如果包含毀滅性操作
 */
export function containsCriticalPattern(command: string): boolean {
  for (const { pattern } of CRITICAL_PATTERNS) {
    const match = pattern.exec(command);
    if (match && !isInQuotes(command, match.index)) {
      return true;
    }
  }
  return false;
}

/**
 * 分類工具呼叫的風險等級
 *
 * @param toolName - 工具名稱（Read/Write/Edit/Bash/Glob/Grep）
 * @param input - 工具輸入參數
 * @returns 風險等級
 */
export function classifyRisk(
  toolName: string,
  input: Record<string, unknown>
): RiskLevel {
  // 1. 唯讀工具 → low（自動批准）
  if (READ_ONLY_TOOLS.has(toolName)) {
    return 'low';
  }

  // 提取可能的指令或檔案路徑
  const command = typeof input.command === 'string' ? input.command : '';
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const content = typeof input.content === 'string' ? input.content : '';

  // 2. 檢查毀滅性指令 → critical
  if (toolName === 'Bash' && command) {
    if (containsCriticalPattern(command)) {
      return 'critical';
    }
  }

  // 3. 檢查敏感檔案寫入 → high
  if (toolName === 'Write' || toolName === 'Edit') {
    // 檢查副檔名
    for (const ext of SENSITIVE_EXTENSIONS) {
      if (filePath.toLowerCase().endsWith(ext)) {
        return 'high';
      }
    }

    // 檢查檔案名稱模式
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(filePath)) {
        return 'high';
      }
    }

    // 檢查內容是否包含敏感關鍵字（如密碼、API key）
    const sensitiveContentPatterns = [
      /api[_-]?key\s*[:=]/i,
      /secret[_-]?key\s*[:=]/i,
      /password\s*[:=]/i,
      /private[_-]?key/i,
    ];
    for (const pattern of sensitiveContentPatterns) {
      if (pattern.test(content)) {
        return 'high';
      }
    }
  }

  // 4. 其他 Write/Edit/Bash → medium
  if (['Write', 'Edit', 'Bash'].includes(toolName)) {
    return 'medium';
  }

  // 5. 未知工具 → medium（保守處理）
  return 'medium';
}

/**
 * 判斷風險等級是否需要人類審批
 *
 * @param riskLevel - 風險等級
 * @returns true 如果需要人類審批
 */
export function requiresHumanApproval(riskLevel: RiskLevel): boolean {
  // 只有 low 等級自動批准，其他都需要人類審批
  return riskLevel !== 'low';
}
