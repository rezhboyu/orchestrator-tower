/**
 * Risk Classifier - 工具呼叫風險分類（基礎版本）
 *
 * Task 06 的基礎風險分類器。Task 09 會實作更完整的分類引擎。
 *
 * 風險等級定義：
 * - critical: 毀滅性操作（rm/delete/drop/format/truncate）→ 暫停所有 agents
 * - high: 敏感檔案寫入（.env/.key/.pem/.secret）
 * - medium: 一般寫入操作（Write/Edit/Bash，非以上）
 * - low: 唯讀操作（Read/Glob/Grep）→ 自動批准
 */

import type { RiskLevel } from './types.js';

/** 唯讀工具，自動批准 */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/** 毀滅性指令的正則表達式 */
const CRITICAL_PATTERNS: RegExp[] = [
  // rm 指令（含各種 flags）
  /\brm\s+(-[rRfivI]*\s+)*[^|&;]+/,
  // delete 關鍵字
  /\bdelete\b/i,
  // drop 關鍵字（SQL）
  /\bdrop\b/i,
  // format 關鍵字
  /\bformat\b/i,
  // truncate 關鍵字（SQL）
  /\btruncate\b/i,
  // rmdir 指令
  /\brmdir\b/i,
  // git reset --hard
  /\bgit\s+reset\s+--hard\b/i,
  // dd 指令（可能毀掉磁碟）
  /\bdd\s+if=/i,
  // mkfs 指令
  /\bmkfs\b/i,
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
];

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
    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(command)) {
        return 'critical';
      }
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
