/**
 * IPC Client - Node.js Sidecar 端的 IPC 客戶端
 *
 * 負責與 Rust Core 建立雙向通訊通道：
 * - 發送 SidecarEvent 至 Rust
 * - 接收 RustCommand 從 Rust
 * - 維持心跳機制
 * - 處理 IPC 查詢請求/回應配對
 */

import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { getServerSocketPath } from './platform.js';
import type {
  SidecarEvent,
  RustCommand,
  IpcRequest,
  IpcResponse,
  IpcQueryType,
  Heartbeat,
} from './messages.js';
import { isRustCommand, isIpcResponse } from './messages.js';

// =============================================================================
// Types
// =============================================================================

export interface IpcClientOptions {
  /** 重連間隔（毫秒），預設 1000 */
  reconnectInterval?: number;
  /** 心跳間隔（毫秒），預設 1000 */
  heartbeatInterval?: number;
  /** IPC 查詢逾時（毫秒），預設 10000 */
  queryTimeout?: number;
  /** 最大重連次數，預設 10 */
  maxReconnectAttempts?: number;
}

interface PendingQuery {
  resolve: (response: IpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface IpcClientEvents {
  connect: [];
  disconnect: [];
  error: [error: Error];
  command: [command: RustCommand];
  reconnecting: [attempt: number];
}

// =============================================================================
// IpcClient
// =============================================================================

export class IpcClient extends EventEmitter<IpcClientEvents> {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private buffer = '';

  private readonly options: Required<IpcClientOptions>;
  private readonly pendingIpc = new Map<string, PendingQuery>();

  constructor(options: IpcClientOptions = {}) {
    super();

    this.options = {
      reconnectInterval: options.reconnectInterval ?? 1000,
      heartbeatInterval: options.heartbeatInterval ?? 1000,
      queryTimeout: options.queryTimeout ?? 10000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    };

    this.socketPath = getServerSocketPath();
  }

  /**
   * 連線至 Rust IPC Server
   */
  connect(): void {
    if (this.connected || this.socket) {
      return;
    }

    this.socket = net.createConnection(this.socketPath);

    this.socket.on('connect', () => {
      console.log('[IPC] Connected to Rust IPC server');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('connect');
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('close', () => {
      console.log('[IPC] Connection closed');
      this.handleDisconnect();
    });

    this.socket.on('error', (err) => {
      console.error('[IPC] Connection error:', err.message);
      this.emit('error', err);
      this.handleDisconnect();
    });
  }

  /**
   * 斷開連線
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.stopReconnect();

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connected = false;
    this.rejectAllPending(new Error('IPC client disconnected'));
  }

  /**
   * 發送事件至 Rust
   */
  send(event: SidecarEvent): boolean {
    if (!this.connected || !this.socket) {
      console.warn('[IPC] Cannot send: not connected');
      return false;
    }

    try {
      const json = JSON.stringify(event);
      this.socket.write(json + '\n');
      return true;
    } catch (err) {
      console.error('[IPC] Send error:', err);
      return false;
    }
  }

  /**
   * 發送 IPC 查詢並等待回應
   */
  query(
    queryType: IpcQueryType,
    params: Record<string, unknown> = {}
  ): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error('IPC client not connected'));
        return;
      }

      const ipcRequestId = crypto.randomUUID();
      const request: IpcRequest = {
        type: 'ipc:query',
        ipcRequestId,
        query: queryType,
        params,
      };

      // 設定逾時
      const timer = setTimeout(() => {
        this.pendingIpc.delete(ipcRequestId);
        reject(new Error(`IPC query timeout: ${queryType}`));
      }, this.options.queryTimeout);

      // 儲存 pending 查詢
      this.pendingIpc.set(ipcRequestId, { resolve, reject, timer });

      // 發送查詢
      try {
        const json = JSON.stringify(request);
        this.socket.write(json + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingIpc.delete(ipcRequestId);
        reject(err);
      }
    });
  }

  /**
   * 檢查是否已連線
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // 處理 NDJSON（每行一個 JSON）
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留不完整的最後一行

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[IPC] Failed to parse message:', line, err);
      }
    }
  }

  private handleMessage(msg: unknown): void {
    // 檢查是否為 IPC 查詢回應
    if (isIpcResponse(msg)) {
      const pending = this.pendingIpc.get(msg.ipcRequestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingIpc.delete(msg.ipcRequestId);
        pending.resolve(msg);
      }
      return;
    }

    // 檢查是否為 Rust 指令
    if (isRustCommand(msg)) {
      this.emit('command', msg);
      return;
    }

    console.warn('[IPC] Unknown message type:', msg);
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.connected = false;

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.emit('disconnect');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('[IPC] Max reconnect attempts reached');
      this.rejectAllPending(new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[IPC] Reconnecting in ${this.options.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`
    );

    this.emit('reconnecting', this.reconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectInterval);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const heartbeat: Heartbeat = { type: 'heartbeat' };
      this.send(heartbeat);
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingIpc) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingIpc.clear();
  }
}
