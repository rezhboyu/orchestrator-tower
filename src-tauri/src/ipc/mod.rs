//! IPC Server - Rust 端 IPC 伺服器
//!
//! 負責：
//! - 監聽 Unix Socket / Named Pipe
//! - 接收 SidecarEvent 從 Node.js
//! - 發送 RustCommand 至 Node.js
//! - 處理 IPC 查詢並回傳結果（Task 07）
//! - 心跳超時偵測（3s 未收到 → Sidecar 崩潰）

pub mod handler;
pub mod messages;

use crate::state::AppState;
use handler::handle_query;
use messages::{IncomingMessage, IpcResponse, RustCommand, SidecarEvent};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::time::{Duration, Instant};

#[cfg(unix)]
use tokio::net::UnixListener;

#[cfg(windows)]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

// =============================================================================
// Constants
// =============================================================================

/// 心跳超時（秒）
const HEARTBEAT_TIMEOUT_SECS: u64 = 3;

/// IPC Server socket 路徑
#[cfg(unix)]
const SOCKET_PATH: &str = "/tmp/orchestrator-tower-ipc.sock";

#[cfg(windows)]
const PIPE_NAME: &str = r"\\.\pipe\orchestrator-tower-ipc";

// =============================================================================
// Types
// =============================================================================

/// IPC Server 錯誤類型
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Heartbeat timeout")]
    HeartbeatTimeout,

    #[error("Channel closed")]
    ChannelClosed,
}

/// IPC Server 狀態
pub struct IpcServerState {
    /// 最後收到心跳的時間
    last_heartbeat: RwLock<Instant>,
    /// 是否已連線
    connected: RwLock<bool>,
}

impl IpcServerState {
    pub fn new() -> Self {
        Self {
            last_heartbeat: RwLock::new(Instant::now()),
            connected: RwLock::new(false),
        }
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }

    pub async fn set_connected(&self, connected: bool) {
        *self.connected.write().await = connected;
    }

    pub async fn update_heartbeat(&self) {
        *self.last_heartbeat.write().await = Instant::now();
    }

    pub async fn check_heartbeat(&self) -> bool {
        let last = *self.last_heartbeat.read().await;
        last.elapsed() < Duration::from_secs(HEARTBEAT_TIMEOUT_SECS)
    }
}

impl Default for IpcServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// IPC Server Handle - 用於與 IPC Server 互動
#[derive(Clone)]
pub struct IpcServerHandle {
    /// 發送指令至 Node.js
    command_tx: mpsc::Sender<RustCommand>,
    /// 訂閱來自 Node.js 的事件
    event_tx: broadcast::Sender<SidecarEvent>,
    /// Server 狀態
    state: Arc<IpcServerState>,
    /// 應用程式狀態（用於 IPC 查詢）
    app_state: Arc<AppState>,
}

impl IpcServerHandle {
    /// 發送指令至 Node.js
    pub async fn send_command(&self, cmd: RustCommand) -> Result<(), IpcError> {
        self.command_tx
            .send(cmd)
            .await
            .map_err(|_| IpcError::ChannelClosed)
    }

    /// 訂閱事件
    pub fn subscribe(&self) -> broadcast::Receiver<SidecarEvent> {
        self.event_tx.subscribe()
    }

    /// 檢查是否已連線
    pub async fn is_connected(&self) -> bool {
        self.state.is_connected().await
    }

    /// 檢查心跳是否正常
    pub async fn is_heartbeat_ok(&self) -> bool {
        self.state.check_heartbeat().await
    }
}

// =============================================================================
// IPC Server
// =============================================================================

/// 啟動 IPC Server
///
/// # Arguments
/// * `app_state` - 應用程式狀態，用於處理 IPC 查詢
///
/// # Returns
/// * `IpcServerHandle` 用於與 Server 互動
pub async fn start_ipc_server(app_state: Arc<AppState>) -> Result<IpcServerHandle, IpcError> {
    let state = Arc::new(IpcServerState::new());
    let (command_tx, command_rx) = mpsc::channel::<RustCommand>(100);
    let (event_tx, _) = broadcast::channel::<SidecarEvent>(100);

    let handle = IpcServerHandle {
        command_tx: command_tx.clone(),
        event_tx: event_tx.clone(),
        state: state.clone(),
        app_state: app_state.clone(),
    };

    // 啟動 Server 任務
    tokio::spawn(run_server(state, command_tx, command_rx, event_tx, app_state));

    Ok(handle)
}

#[cfg(unix)]
async fn run_server(
    state: Arc<IpcServerState>,
    command_tx: mpsc::Sender<RustCommand>,
    mut command_rx: mpsc::Receiver<RustCommand>,
    event_tx: broadcast::Sender<SidecarEvent>,
    app_state: Arc<AppState>,
) {
    // 移除舊的 socket 檔案
    let _ = std::fs::remove_file(SOCKET_PATH);

    let listener = match UnixListener::bind(SOCKET_PATH) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[IPC] Failed to bind Unix socket: {}", e);
            return;
        }
    };

    println!("[IPC] Server listening on {}", SOCKET_PATH);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                println!("[IPC] Client connected");
                state.set_connected(true).await;
                state.update_heartbeat().await;

                let (reader, mut writer) = stream.into_split();
                let mut reader = BufReader::new(reader);
                let mut line = String::new();

                // 處理連線
                loop {
                    tokio::select! {
                        // 讀取來自 Node.js 的訊息
                        result = reader.read_line(&mut line) => {
                            match result {
                                Ok(0) => {
                                    println!("[IPC] Client disconnected");
                                    break;
                                }
                                Ok(_) => {
                                    if let Some(response) = handle_incoming_message(
                                        &line,
                                        &state,
                                        &event_tx,
                                        &app_state,
                                        &command_tx
                                    ).await {
                                        // 發送 IPC 查詢回應
                                        if let Err(e) = send_response(&mut writer, &response).await {
                                            eprintln!("[IPC] Error sending response: {}", e);
                                        }
                                    }
                                    line.clear();
                                }
                                Err(e) => {
                                    eprintln!("[IPC] Read error: {}", e);
                                    break;
                                }
                            }
                        }

                        // 發送指令至 Node.js
                        Some(cmd) = command_rx.recv() => {
                            if let Err(e) = send_command(&mut writer, &cmd).await {
                                eprintln!("[IPC] Error sending command: {}", e);
                            }
                        }
                    }
                }

                state.set_connected(false).await;
            }
            Err(e) => {
                eprintln!("[IPC] Accept error: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn run_server(
    state: Arc<IpcServerState>,
    command_tx: mpsc::Sender<RustCommand>,
    mut command_rx: mpsc::Receiver<RustCommand>,
    event_tx: broadcast::Sender<SidecarEvent>,
    app_state: Arc<AppState>,
) {
    println!("[IPC] Server starting on {}", PIPE_NAME);

    loop {
        // 建立新的 Named Pipe Server
        let server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(PIPE_NAME)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[IPC] Failed to create named pipe: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        println!("[IPC] Waiting for client connection...");

        // 等待客戶端連接
        if let Err(e) = server.connect().await {
            eprintln!("[IPC] Connect error: {}", e);
            continue;
        }

        println!("[IPC] Client connected");
        state.set_connected(true).await;
        state.update_heartbeat().await;

        // 處理連線
        handle_windows_connection(
            server,
            &state,
            &command_tx,
            &mut command_rx,
            &event_tx,
            &app_state,
        )
        .await;

        state.set_connected(false).await;
        println!("[IPC] Client disconnected");
    }
}

#[cfg(windows)]
async fn handle_windows_connection(
    server: NamedPipeServer,
    state: &Arc<IpcServerState>,
    command_tx: &mpsc::Sender<RustCommand>,
    command_rx: &mut mpsc::Receiver<RustCommand>,
    event_tx: &broadcast::Sender<SidecarEvent>,
    app_state: &Arc<AppState>,
) {
    let (reader, mut writer) = tokio::io::split(server);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        tokio::select! {
            result = reader.read_line(&mut line) => {
                match result {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(response) = handle_incoming_message(
                            &line,
                            state,
                            event_tx,
                            app_state,
                            command_tx
                        ).await {
                            // 發送 IPC 查詢回應
                            if let Err(e) = send_response(&mut writer, &response).await {
                                eprintln!("[IPC] Error sending response: {}", e);
                            }
                        }
                        line.clear();
                    }
                    Err(e) => {
                        eprintln!("[IPC] Read error: {}", e);
                        break;
                    }
                }
            }

            Some(cmd) = command_rx.recv() => {
                if let Err(e) = send_command(&mut writer, &cmd).await {
                    eprintln!("[IPC] Error sending command: {}", e);
                }
            }
        }
    }
}

/// 處理來自 Node.js 的訊息
///
/// 如果訊息是 IPC 查詢，回傳 Some(IpcResponse)；否則回傳 None
async fn handle_incoming_message(
    line: &str,
    state: &Arc<IpcServerState>,
    event_tx: &broadcast::Sender<SidecarEvent>,
    app_state: &Arc<AppState>,
    command_tx: &mpsc::Sender<RustCommand>,
) -> Option<IpcResponse> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let msg: IncomingMessage = match serde_json::from_str(trimmed) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[IPC] Failed to parse message: {}", e);
            return None;
        }
    };

    match msg {
        IncomingMessage::Event(event) => {
            // 更新心跳時間（任何事件都視為心跳）
            state.update_heartbeat().await;

            // 特別處理心跳事件（不需要廣播）
            if matches!(event, SidecarEvent::Heartbeat) {
                return None;
            }

            // 廣播事件
            let _ = event_tx.send(event);
            None
        }
        IncomingMessage::Query(request) => {
            // 處理 IPC 查詢（Task 07）
            let response = handle_query(&request, app_state, command_tx).await;
            Some(response)
        }
    }
}

/// 發送指令至 Node.js
async fn send_command<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    cmd: &RustCommand,
) -> Result<(), IpcError> {
    let json = serde_json::to_string(cmd)?;
    writer.write_all(json.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

/// 發送 IPC 回應至 Node.js
async fn send_response<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    response: &IpcResponse,
) -> Result<(), IpcError> {
    let json = serde_json::to_string(response)?;
    writer.write_all(json.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_server_state_default() {
        let state = IpcServerState::new();
        // 初始狀態應該是未連線
        assert!(!tokio_test::block_on(state.is_connected()));
    }

    #[tokio::test]
    async fn ipc_server_state_heartbeat() {
        let state = IpcServerState::new();

        // 更新心跳
        state.update_heartbeat().await;

        // 應該在超時範圍內
        assert!(state.check_heartbeat().await);
    }
}
