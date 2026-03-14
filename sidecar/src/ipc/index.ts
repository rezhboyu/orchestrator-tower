/**
 * IPC Module - Node.js ↔ Rust 雙向通訊
 *
 * @module ipc
 */

// Client
export { IpcClient } from './client.js';
export type { IpcClientOptions, IpcClientEvents } from './client.js';

// Messages
export type {
  // Node.js → Rust
  SidecarEvent,
  AgentSessionStart,
  AgentText,
  AgentToolUse,
  AgentToolResult,
  AgentSessionEnd,
  AgentStreamDelta,
  AgentCrash,
  HitlRequest,
  Heartbeat,
  // Rust → Node.js
  RustCommand,
  AgentStart,
  AgentStop,
  AgentAssign,
  AgentFreeze,
  AgentUnfreeze,
  HitlResponse,
  // IPC Query
  IpcRequest,
  IpcResponse,
  IpcQueryType,
} from './messages.js';

export {
  isSidecarEvent,
  isRustCommand,
  isIpcResponse,
} from './messages.js';

// Platform
export {
  getSocketPath,
  getServerSocketPath,
  isWindows,
  isUnixLike,
} from './platform.js';
export type { Platform } from './platform.js';
