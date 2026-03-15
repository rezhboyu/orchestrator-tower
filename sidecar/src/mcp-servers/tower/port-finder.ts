/**
 * Port Finder - 探測可用 port
 *
 * 從指定的 port 開始嘗試，如果被佔用則遞增直到找到可用 port。
 */

import * as net from 'node:net';

/**
 * 檢查指定 port 是否可用
 * 透過嘗試建立 TCP server 來測試
 */
export function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        // 其他錯誤也視為不可用
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

/**
 * 找到可用的 port
 *
 * @param startPort - 起始 port（預設 3701）
 * @param maxAttempts - 最大嘗試次數（預設 10）
 * @param host - 綁定的 host（預設 127.0.0.1）
 * @returns 可用的 port
 * @throws 如果所有嘗試都失敗
 */
export async function findAvailablePort(
  startPort = 3701,
  maxAttempts = 10,
  host = '127.0.0.1'
): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;
    const available = await isPortAvailable(port, host);

    if (available) {
      return port;
    }
  }

  throw new Error(
    `No available port found after ${maxAttempts} attempts starting from ${startPort}`
  );
}
