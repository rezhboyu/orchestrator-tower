# Orchestrator Tower
## N+2 本地優先 AI 代理管理系統｜工程規格書 v2.0

> **v2 重構說明**：本版本分為兩個部分。  
> **Part A（設計文件）**：架構決策與技術選型，供人類工程師閱讀。  
> **Part B（任務規格）**：以 Claude Code 為執行者設計的可分配任務單元，每個任務包含明確前置條件、產出清單與驗證方式。

| 標記 | 說明 |
|------|------|
| `[TODO]` | 需後續決策，目前跳過 |
| `[CRITICAL]` | 阻礙性風險，必須先解決 |
| `[PERF]` | 效能敏感路徑，需量測 |

---

# Part A：設計文件

## A.1 系統定位

Orchestrator Tower 是一套**本地優先**的桌面端 AI 代理管理系統。核心使用場景：開發者在一個視覺化介面中同時管理 N 個執行不同任務的 Claude Code 代理，每個代理運行於獨立 Git Worktree，一個 AI 總代理（Master Orchestrator）負責任務分解與協調。

**N+2 角色：**
- **N 個 Worker Agent**：Claude Code CLI，各自在隔離 Worktree 執行具體任務
- **+1 Visual Control Tower**：Tauri 桌面應用，人類 UI
- **+1 Master Orchestrator**：Claude CLI 或 Gemini CLI，AI 總代理

**平台支援：** Windows 10+、Linux（Ubuntu 22.04+）

---

## A.2 架構決策

### 程序拓撲

```
┌──────────────────────────────────────────┐
│  Tauri Renderer（React）                  │
│  UI 只讀取狀態，不持有業務邏輯            │
└──────────────┬───────────────────────────┘
           Tauri IPC（invoke / emit）
┌──────────────▼───────────────────────────┐
│  Tauri Rust Core                          │
│  唯一狀態權威：AppState、QuotaManager、   │
│  Git Plumbing、SQLite 讀寫               │
└──────┬──────────────────┬────────────────┘
  Unix Socket /        MCP HTTP
  Named Pipe           (3702)
┌──────▼──────┐    ┌────▼────────────────┐
│ Node.js     │    │ State MCP Server     │
│ Sidecar     │    │ (HTTP, port 3702)    │
│ Worker 子   │    └────▲────────────────┘
│ 程序管理    │         │ HTTP
│ MCP(3701)   │    ┌────┴────────────────┐
└──────┬──────┘    │ stdio-proxy.ts       │
  ACP/stream-json  │ (per-session)        │
┌──────▼──────────────────────────────┐   │
│  Master Orchestrator                │   │
│  Gemini CLI (--experimental-acp) ───┼───┘
│  Claude Code (--print --i/o stream-json) │
└──────┬──────────────────────────────┘
  stdout/stdin (Claude Code, stream-json)
┌──────▼──────────────────────────────┐
│  Worker Agent 1..N                  │
│  Claude Code CLI，各自 Worktree      │
└─────────────────────────────────────┘
```

**關鍵設計原則：**
- Rust Core 是唯一狀態寫入方；Node.js Sidecar 無狀態，崩潰後可安全重啟
- Node.js 只上報事件至 Rust，不主動決策
- React 只透過 Tauri IPC 讀取 Rust 狀態，不直接呼叫 Node.js

### 選型理由摘要

| 決策 | 選擇 | 主要理由 |
|------|------|---------|
| 桌面框架 | Tauri 2.0 | 記憶體 30–50 MB vs Electron 150–300 MB |
| Worker 管理 | Node.js Sidecar | `@anthropic-ai/claude-code` SDK 只有 JS 版本 |
| 狀態管理 | Rust 記憶體 | 崩潰安全；Sidecar 無狀態可安全重啟 |
| Git 快照 | Plumbing 指令 | 比 Porcelain 快 2–3 倍，繞過 Hook |
| 配額調度 | Bottleneck | 唯一具備優先級 + reservoir 的成熟方案 |
| UI 面板 | react-mosaic-component | Bloomberg 開源，API 最簡單 |

---

## A.3 IPC 協議

### Tauri IPC（前端 ↔ Rust）

| 方向 | 機制 | 用途 |
|------|------|------|
| React → Rust | `invoke("command_name", args)` | 操作請求（啟動 Agent、審批、回滾） |
| Rust → React | `app.emit("event_name", payload)` | 狀態推播（Agent 狀態變更、HITL 請求） |

### Node.js ↔ Rust IPC

| 平台 | 機制 |
|------|------|
| Linux | Unix Domain Socket `/tmp/orchestrator-agent-{id}.sock` |
| Windows | Named Pipe `\\.\pipe\orchestrator-agent-{id}` |

訊息格式：換行分隔的 JSON 物件（NDJSON）。

---

## A.4 MCP Server 架構

兩個獨立 MCP Server，均跑在 Node.js Sidecar，HTTP Streamable transport。

| Server | Port（預設） | 允許存取者 | 功能 |
|--------|------------|-----------|------|
| Tower MCP | 3701 | Worker Agent | HITL 審批請求（`mcp__tower__auth`） |
| State MCP | 3702 | Master Orchestrator | 狀態查詢與 Worker 控制 |

Port 衝突時自動遞增，實際 port 寫入 Rust AppState，CLI 啟動時動態注入。

---

## A.5 Git 快照策略

每個推理節點完成後立即寫入 Shadow Branch micro-commit，使用 Plumbing 指令避免觸發 Hook：

- Shadow Branch：`refs/heads/__orch_shadow_{projectId}_{agentId}`（每個 Agent 獨立，對 `git log` 隱形）
- 理由：多 Agent 並發寫快照時各自維護獨立鏈，無競爭條件
- 快照 ref：`refs/orchestrator/{projectId}/node-{nodeId}`
- 保留策略：7 天，每晚 `git gc --aggressive` 清理

---

## A.6 HITL 風險分類

| 等級 | 觸發條件 | 行為 |
|------|----------|------|
| `critical` | `rm/delete/drop/format` 指令 | 暫停所有 Agent + OS 通知 + 強制人類審批 |
| `high` | `.env/secret/key/pem` 檔案寫入 | OS 通知 + 排入審批佇列 |
| `medium` | 一般寫入、Shell 指令 | OS 通知 + 排入審批佇列 |
| `low` | 讀取操作 | 自動批准 |

逾時：5 分鐘後自動拒絕。

---

## A.7 配額管理

| 使用率 | 動作 |
|--------|------|
| 0–60% | 正常 |
| 60–80% | 全部 Worker 切換至 Haiku |
| 80–90% | 暫停低優先級 Agent |
| 90–100% | 僅允許 critical HITL |
| 100% | 全部暫停 + OS 通知 |

Master Orchestrator priority: 0（最高）。Worker 依建立順序 1..N。

---

## A.8 資料分層

| 層 | 資料 | 儲存 |
|----|------|------|
| 熱 | Agent 狀態機 | Rust 記憶體 |
| 暖 | 推理節點歷史、HITL 記錄 | SQLite（WAL，每專案一個 DB） |
| 冷 | 完整日誌 | Claude Code 原生 JSONL |
| UI | 分頁/縮放/選中節點 | `tauri-plugin-store` |
| 設定 | CLI 路徑、計費模式 | `~/.orchestrator/config.json` |
| 憑證 | OAuth token / API Key | 系統 Keychain（`tauri-plugin-stronghold`） |
| 恢復 | 任務描述 + Git SHA | `~/.orchestrator/projects/{id}/tasks/{task-id}.json` |

---

## A.8.5 B 模式（Master Orchestrator 自動審批）

**定義：** B 模式開啟時，Master Orchestrator 可透過 State MCP（port 3702）的 `approve_hitl` / `deny_hitl` 工具自動審批 HITL 請求，無需人類介入。

**預設狀態：** 關閉。

**控制方式：** 使用者從 UI Toolbar 手動開啟/關閉，狀態存於 `tauri-plugin-store`（UI 設定層）並同步至 Rust `AppState.b_mode_enabled`。

**B 模式關閉時（預設）：**
- `approve_hitl` / `deny_hitl` 工具回傳 403 Forbidden
- 所有 HITL 請求必須由人類從 AgentPanel 審批
- Master Orchestrator 無法繞過人類審核

**B 模式開啟時：**
- Master Orchestrator 可呼叫 `approve_hitl` / `deny_hitl`
- SQLite `hitl_records.decided_by` 記錄為 `'orchestrator_b_mode'`（供審計追蹤）
- `critical` 等級操作即使 B 模式開啟，仍強制要求人類審批（黑名單不可縮減）

**安全邊界：**
```
B 模式開啟 + riskLevel=critical → 仍回傳 403，強制人類審批
B 模式開啟 + riskLevel=high/medium → Master Orchestrator 可自動審批
B 模式關閉 + 任何 riskLevel → 403，強制人類審批
```

---

## A.9 已知風險

| 風險 | 等級 | 對策 |
|------|------|------|
| Rate Limit 三態難以判別（訂閱制） | HIGH | 重試一次後判定為配額耗盡（保守策略） |
| Master Orchestrator B 模式誤判高風險操作 | HIGH | 審計日誌強制記錄；黑名單不可縮減 |
| Prompt Cache TTL 5 分鐘 | MEDIUM | 勿在系統提示放時間戳；勿中途改 allowedTools |
| Process Hang（CLI 已知 bug） | MEDIUM | 收到 `result` 後 2s 未退出即 SIGTERM，3s 後 SIGKILL |
| Git Worktree 大型倉庫效能 | LOW | `core.fsmonitor=true`；Sparse Checkout |

---

## A.10 版本釘定

| 套件 | 版本 |
|------|------|
| Node.js | 22.22.0 |
| `@tauri-apps/cli` | 2.10.1 |
| `@tauri-apps/plugin-store` | 2.4.2 |
| `@tauri-apps/plugin-stronghold` | 2.3.1 |
| `@tauri-apps/plugin-notification` | 2.3.3 |
| `@anthropic-ai/claude-code` | 2.1.74 |
| `@google/gemini-cli` | 0.21.2 |
| `@modelcontextprotocol/sdk` | 1.27.1 |
| `@xyflow/react` | 12.10.1 |
| `@dagrejs/dagre` | 2.0.4 |
| `react-mosaic-component` | 6.1.1 |
| `bottleneck` | 2.19.5 |
| `simple-git` | 3.32.3 |
| `@parcel/watcher` | 2.5.6 |
| `zustand` | 5.0.11 |
| `@yao-pkg/pkg` | 6.14.1（dev） |

---

## A.10.5 關閉流程

### 正常關閉（使用者點 X / Cmd+Q）

有 Agent 正在執行時，彈出對話框：

```
┌─────────────────────────────────────────┐
│  有 N 個 Agent 正在執行中               │
│                                         │
│  [等待完成後關閉]   [立即強制關閉]       │
└─────────────────────────────────────────┘
```

**選「等待完成後關閉」：**
```
1. 視窗保持開啟，所有面板鎖定（不可新增/刪除 Agent）
2. UI 顯示簡單文字提示：「正在等待 N 個 Agent 完成...」
3. 每個 Agent 完成 turn 後（收到 result 事件）計數遞減
4. 全部完成 → 執行關閉流程（同「立即強制關閉」的 graceful 路徑）
```

**選「立即強制關閉」：**
```
1. 透過 IPC 發 agent:stop 給所有 Agent
2. Node.js 對所有子程序發 SIGTERM
3. 2s 後 SIGKILL 未退出的子程序
4. Tauri 程序退出
```

**無 Agent 執行時：** 直接關閉，不彈對話框。

---

### 強制關閉（系統 kill / crash / 強制終止）

使用 **Process Group（Linux）/ Job Object（Windows）** 在 OS 層保證子程序跟著死：

**Linux 實作（Node.js Sidecar spawn 子程序時）：**
```typescript
const proc = spawn('claude', args, {
  detached: false,  // 不脫離 parent process group
  // Linux 上子程序預設繼承 parent 的 process group
  // Tauri 被 SIGKILL 時，OS 會清理整個 process group
});
```

**Windows 實作（Node.js Sidecar）：**
```typescript
// Windows 上需要明確建立 Job Object
// 使用 @tyranron/node-win-job-object 或 win32job npm 套件
// 將每個子程序加入 Job Object，設定 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
// Tauri 程序退出時 Job Object handle 關閉，所有子程序自動終止
import { JobObject } from 'win32job';
const job = new JobObject();
job.setKillOnJobClose();
job.addProcess(proc.pid!);
```

> **為什麼不用「啟動時掃孤兒」作為補充？**
> Process Group / Job Object 是 OS 層保證，強制 kill 場景下完全可靠。
> 啟動時掃孤兒需要持久化 PID 列表，引入額外複雜度，在有 OS 層保護的前提下不必要。

---

### Tauri `on_window_event` 攔截關閉事件

```rust
// src-tauri/src/lib.rs
app.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let running_agents = count_running_agents(&window.app_handle());
        if running_agents > 0 {
            api.prevent_close();  // 阻止預設關閉行為
            // 透過 Tauri emit 通知 React 顯示關閉對話框
            window.emit("app:close_requested", running_agents).unwrap();
        }
        // running_agents == 0 → 讓視窗正常關閉
    }
});
```

React 收到 `app:close_requested` 後顯示對話框，使用者選擇後呼叫對應 Tauri command。

---

## A.11 TODO

- `[TODO]` iOS 行動端連線協定（候選：WireGuard + mTLS WebSocket）
- `[TODO]` iOS 審批 UI 框架（React Native / SwiftUI）
- `[TODO]` Prompt Cache 心跳設計（間隔與內容）
- `[TODO]` 暖程序池 session 管理策略
- `[TODO]` 鍵盤快捷鍵完整清單（目前僅 `Ctrl+B`）
- `[TODO]` `--experimental-acp` 升版相容性驗證（目前鎖定 v0.21.2，升級前需確認 ACP 協議未變動）
- `[TODO]` `session/request_permission` 回調的完整參數格式（Gemini HITL 實作細節）
- `[TODO]` Claude Code `--input-format=stream-json` 的 `control_request` 完整 subtype 清單

---

---

# Part B：任務規格

> **給 Claude Code 的說明**：  
> 每個任務是一個獨立可分配的工作單元。  
> 執行前確認「前置條件」已完成。執行後用「驗證指令」確認結果。  
> 遇到規格不明確時，停下來，用 `// TODO: [CLARIFY]` 標記並向人類回報。

---

## Task 01：專案骨架初始化

**前置條件：** 無（第一個任務）

**目標：** 建立 Tauri 2.0 專案骨架，含 Node.js Sidecar 子目錄與基本目錄結構。

**產出清單：**
```
orchestrator-tower/
├── src/                        # React UI
│   ├── main.tsx
│   ├── App.tsx
│   └── index.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs              # Tauri app 入口
│   │   ├── state.rs            # AppState 結構體（空殼）
│   │   └── commands.rs         # Tauri commands 宣告（空殼）
│   ├── capabilities/
│   │   └── default.json        # 含 shell:allow-spawn 權限
│   ├── Cargo.toml
│   └── tauri.conf.json         # 含 externalBin: ["binaries/sidecar"]
├── sidecar/
│   ├── src/
│   │   └── index.ts            # 入口，啟動訊息輸出至 stdout
│   ├── package.json            # 含 build:linux / build:win scripts
│   └── tsconfig.json
├── package.json                # 根目錄，含 tauri dev / build scripts
├── CLAUDE.md                   # 從本專案根目錄複製
└── .nvmrc                      # 22.22.0
```

**關鍵設定：**

`tauri.conf.json` 必須包含：
```json
{
  "bundle": {
    "externalBin": ["binaries/sidecar"]
  }
}
```

`src-tauri/capabilities/default.json` 必須包含：
```json
{
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-spawn",
      "allow": [{ "name": "binaries/sidecar", "sidecar": true, "args": true }]
    }
  ]
}
```

**單元測試：** 無（骨架任務，無業務邏輯）

**整合測試：**
```bash
cd orchestrator-tower/
npm install
npx tauri info                        # Tauri 環境完整
cargo check --manifest-path src-tauri/Cargo.toml
cd sidecar && npm install && npx tsc --noEmit
# 確認目錄結構完整
test -f src-tauri/capabilities/default.json
test -f sidecar/src/index.ts
test -f .nvmrc && grep -q "22.22.0" .nvmrc
```

**完成條件：** 所有驗證指令無錯誤輸出；`.nvmrc` 內容為 `22.22.0`。

---

## Task 02：Rust AppState 與 Tauri Commands 骨架

**前置條件：** Task 01 完成

**目標：** 定義 Rust 狀態機的核心結構體與 Tauri IPC commands，為後續所有任務提供型別基礎。

**產出清單：**
```
src-tauri/src/
├── state.rs       # AppState, AgentState, ProjectState, QuotaState
├── commands.rs    # 所有 Tauri commands（實作為 todo!()）
└── lib.rs         # 更新：register all commands
```

**`state.rs` 必要結構體：**
```rust
#[derive(Debug, Clone, serde::Serialize)]
pub enum AgentStatus {
    Idle,
    Running,
    WaitingHitl,
    Error(String),
    Frozen,
}

// agentId 生成規則：UUID v4（由 Rust 在 create_agent 時呼叫 uuid::Uuid::new_v4().to_string()）
// 格式範例："550e8400-e29b-41d4-a716-446655440000"
// 理由：agentId 出現在 SQLite、Git ref、IPC 訊息、檔案路徑，重啟後不重複是必要條件
// 注意：Git ref 路徑中 agentId 含連字號，refs/orchestrator/{projectId}/node-{nodeId} 合法
#[derive(Debug, Clone)]
pub struct AgentState {
    pub id: String,  // UUID v4
    pub project_id: String,
    pub worktree_path: PathBuf,
    pub status: AgentStatus,
    pub session_id: Option<String>,
    pub model: String,
    pub tower_port: u16,
    pub priority: u32,
}

#[derive(Debug)]
pub struct AppState {
    pub agents: HashMap<String, AgentState>,
    pub tower_port: u16,   // 實際啟動的 Tower MCP port
    pub state_port: u16,   // 實際啟動的 State MCP port
    pub quota: QuotaState,
}
```

**`commands.rs` 必要 commands（全部 `todo!()`）：**
```rust
#[tauri::command] pub async fn start_agent(agent_id: String) -> Result<(), String>
#[tauri::command] pub async fn stop_agent(agent_id: String) -> Result<(), String>
#[tauri::command] pub async fn approve_hitl(request_id: String) -> Result<(), String>
#[tauri::command] pub async fn deny_hitl(request_id: String, reason: String) -> Result<(), String>
#[tauri::command] pub async fn rollback_to_node(agent_id: String, node_id: String) -> Result<(), String>
#[tauri::command] pub async fn create_project(path: String, name: String) -> Result<String, String>
#[tauri::command] pub async fn get_app_state() -> Result<serde_json::Value, String>
```

**單元測試（`src-tauri/src/state.rs`）：**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_status_serializes_correctly() {
        // AgentStatus::Error("msg") 序列化後包含 "msg"
        let s = serde_json::to_string(&AgentStatus::Error("oops".into())).unwrap();
        assert!(s.contains("oops"));
    }

    #[test]
    fn appstate_ports_default_values() {
        // tower_port / state_port 預設值合理（非 0）
        let state = AppState::default();
        assert!(state.tower_port > 1024);
        assert!(state.state_port > 1024);
        assert_ne!(state.tower_port, state.state_port);
    }

    #[test]
    fn agent_state_clone_is_independent() {
        // AgentState clone 後修改不影響原始值
        let mut a = AgentState { status: AgentStatus::Idle, ..Default::default() };
        let b = a.clone();
        a.status = AgentStatus::Running;
        assert!(matches!(b.status, AgentStatus::Idle));
    }
}
```

**整合測試：**
```bash
cargo check --manifest-path src-tauri/Cargo.toml   # 無編譯錯誤
cargo test --manifest-path src-tauri/Cargo.toml    # 所有測試通過
# 確認所有 commands 已在 lib.rs 正確 register
grep -q "start_agent" src-tauri/src/lib.rs
grep -q "approve_hitl" src-tauri/src/lib.rs
```

**完成條件：** `cargo check` 無錯誤；所有 command 可編譯（`todo!()` 不影響編譯）；單元測試全通過。

---

## Task 03：Node.js ↔ Rust IPC 通道

**前置條件：** Task 01、Task 02 完成

**目標：** 建立 Node.js Sidecar 與 Rust Core 之間的雙向通訊通道。

**產出清單：**
```
sidecar/src/
└── ipc/
    ├── index.ts         # 匯出 IpcClient
    ├── client.ts        # IpcClient：連接 Unix Socket / Named Pipe，發送事件至 Rust
    ├── messages.ts      # 所有訊息型別定義（TypeScript interface）
    └── platform.ts      # 依 process.platform 選擇 socket 路徑

src-tauri/src/
└── ipc/
    ├── mod.rs           # IPC Server：接收來自 Node.js 的事件
    └── messages.rs      # 對應 Node.js messages.ts 的 Rust 型別
```

**訊息型別（`messages.ts`）：**
```typescript
// Node.js → Rust（上報事件）
export type SidecarEvent =
  | { type: 'agent:session_start'; agentId: string; sessionId: string; model: string }
  | { type: 'agent:text'; agentId: string; text: string }
  | { type: 'agent:tool_use'; agentId: string; toolId: string; toolName: string; input: unknown }
  | { type: 'agent:tool_result'; agentId: string; toolUseId: string; content: string; isError: boolean }
  | { type: 'agent:session_end'; agentId: string; subtype: string; numTurns: number; totalCostUsd: number; usage: object }
  | { type: 'agent:stream_delta'; agentId: string; text: string }
  | { type: 'agent:crash'; agentId: string; exitCode: number | null; signal: string | null; lastSessionId: string | null; lastToolUse: unknown | null }
  | { type: 'hitl:request'; agentId: string; requestId: string; toolName: string; input: unknown; riskLevel: string; source: 'tower-mcp' | 'acp-permission' }
  // source='tower-mcp'：Worker（Claude Code）透過 --permission-prompt-tool → Tower MCP 3701 → IPC
  // source='acp-permission'：Master（Gemini CLI）透過 session/request_permission ACP 回調 → IPC
  // 兩條路徑轉換後格式相同，Rust 層不需要區分來源
  | { type: 'heartbeat' }
  // Node.js 每 1s 主動發送一次，Rust 超過 3s 未收到即判定 Sidecar 崩潰

// Rust → Node.js（指令）
export type RustCommand =
  | { type: 'agent:start'; agentId: string; prompt: string; model: string; maxTurns: number; towerPort: number; worktreePath: string }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:assign'; agentId: string; prompt: string; maxTurns: number }
  | { type: 'agent:freeze'; agentId: string; reason: 'quota' | 'orchestrator' | 'human'; immediate: boolean }
  | { type: 'agent:unfreeze'; agentId: string; reason: 'quota' | 'orchestrator' | 'human' }
  | { type: 'hitl:response'; requestId: string; approved: boolean; modifiedInput?: unknown; reason?: string }

// IPC request/response 配對機制（用於查詢類操作）
// Node.js 發送查詢時帶 ipcRequestId，Rust 回傳同 id 的 ipc:response
// 適用場景：State MCP 的 get_worker_status / get_quota_status / get_git_snapshot
export interface IpcRequest {
  ipcRequestId: string   // UUID v4，由 Node.js 生成
  type: 'ipc:query'
  query: 'get_worker_status' | 'get_quota_status' | 'get_git_snapshot'
  params: Record<string, unknown>
}

export interface IpcResponse {
  ipcRequestId: string   // 對應 IpcRequest.ipcRequestId
  type: 'ipc:response'
  ok: boolean
  data?: unknown
  error?: string
}

// Node.js 維護 pendingIpc Map，與 pendingHitl 相同模式：
// const pendingIpc = new Map<string, { resolve, reject }>()
// ipc.on('ipc:response', msg => pendingIpc.get(msg.ipcRequestId)?.resolve(msg))
// 逾時：10s 未回應 → reject（查詢比 HITL 快，不需要 5 分鐘）

// 注意：model 降級（quota 60–80% 時切換 Haiku）由 Rust 內部狀態變更，
// 在下次 agent:start / agent:assign 時直接帶入正確 model，不透過獨立指令通知 Node.js
//
// agent:freeze 與 model 降級是兩件不同的事：
// - agent:freeze：Rust 透過 IPC 發給 Node.js，由 Node.js 對子程序執行暫停動作
//   （Rust 無法直接控制 Node.js spawn 的子程序，沒有 PID / stdin handle / signal 能力）
// - model 降級：純 Rust 內部狀態，不需要 IPC
```

**Socket 路徑：**
- Linux：`/tmp/orchestrator-{agentId}.sock`
- Windows：`\\.\pipe\orchestrator-{agentId}`

**單元測試（`sidecar/src/ipc/client.test.ts`）：**
```typescript
describe('IpcClient', () => {
  it('platform.ts 在 Linux 回傳 Unix socket 路徑', () => {
    const path = getSocketPath('agent-1', 'linux');
    expect(path).toBe('/tmp/orchestrator-agent-1.sock');
  });

  it('platform.ts 在 Windows 回傳 Named Pipe 路徑', () => {
    const path = getSocketPath('agent-1', 'win32');
    expect(path).toBe('\\.\pipe\orchestrator-agent-1');
  });

  it('SidecarEvent 序列化後含正確 type 欄位', () => {
    const event: SidecarEvent = {
      type: 'agent:session_start',
      agentId: 'a1', sessionId: 's1', model: 'claude-opus-4-6'
    };
    const json = JSON.stringify(event);
    expect(json).toContain('"type":"agent:session_start"');
  });

  it('agent:crash 事件包含所有必要欄位', () => {
    const event: SidecarEvent = {
      type: 'agent:crash',
      agentId: 'a1', exitCode: 1, signal: null,
      lastSessionId: null, lastToolUse: null
    };
    expect(event).toHaveProperty('exitCode');
    expect(event).toHaveProperty('lastToolUse');
  });
});
```

**整合測試：**
```bash
cd sidecar && npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
# 確認 log 輸出：Sidecar 成功連接 IPC server
# 確認 log 輸出：無 IPC 連線錯誤、無 panic
```

**完成條件：** TypeScript 型別無錯誤；`tauri dev` 啟動後 Node.js Sidecar 成功連接 IPC server（log 輸出確認）；單元測試全通過。

---

## Task 04：stream-json 解析器

**前置條件：** Task 03 完成

**目標：** 實作兩種協議的解析器，將 stdout 轉換為統一的 `SidecarEvent` 並上報至 Rust。

| Agent | 協議 | 格式 |
|-------|------|------|
| Worker Agent（Claude Code） | `--print --input-format=stream-json --output-format=stream-json` | NDJSON，雙向 control_request/response |
| Master Orchestrator（Gemini CLI） | `--experimental-acp` | JSON-RPC NDJSON，雙向 method/params |

**產出清單：**
```
sidecar/src/
└── stream-parser/
    ├── index.ts              # 匯出 StreamParser、parseClaudeStream、parseGeminiAcp
    ├── claude-parser.ts      # Claude Code stream-json + control_request 解析
    ├── gemini-acp-parser.ts  # Gemini CLI ACP JSON-RPC 解析
    ├── normalize.ts          # 兩者輸出正規化為統一 SidecarEvent
    ├── types-claude.ts       # Claude Code 協議型別定義
    ├── types-gemini-acp.ts   # Gemini CLI ACP 協議型別定義
    └── parser.test.ts        # 雙解析器單元測試
```

**`types-claude.ts` — Claude Code stream-json 格式：**
```typescript
// 訊息序列：system(init) → assistant/user(交替) → stream_event(token) → result
export type ClaudeStreamMessage =
  | { type: 'system'; subtype: 'init'; session_id: string; tools: string[] }
  | { type: 'assistant'; message: { content: ClaudeContent[] }; session_id: string }
  | { type: 'user'; message: { content: ClaudeContent[] } }
  | { type: 'stream_event'; event: { type: string; delta?: { type: string; text?: string } } }
  | ClaudeResultMessage

// tool_use 在 assistant.message.content[] 內
// tool_result 在 user.message.content[] 內
type ClaudeContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type ClaudeResultSubtype =
  | 'success'
  | 'error_max_turns'
  | 'error_during_execution'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'

export interface ClaudeResultMessage {
  type: 'result'
  subtype: ClaudeResultSubtype
  session_id: string
  is_error: boolean
  duration_ms: number
  num_turns: number
  result: string
  total_cost_usd: number
}
```

**`types-gemini-acp.ts` — Gemini CLI ACP JSON-RPC 格式：**
```typescript
// ACP 協議（--experimental-acp），PROTOCOL_VERSION = 1
// 非 stream-json，為 JSON-RPC NDJSON

// Sidecar → Gemini（stdin）
export type AcpRequest =
  | { jsonrpc: '2.0'; id: number; method: 'initialize'; params: { clientCapabilities: object; protocolVersion: 1 } }
  | { jsonrpc: '2.0'; id: number; method: 'session/new'; params: AcpSessionNewParams }
  | { jsonrpc: '2.0'; id: number; method: 'session/prompt'; params: { sessionId: string; prompt: string } }
  | { jsonrpc: '2.0'; method: 'session/cancel'; params: { sessionId: string } }

export interface AcpSessionNewParams {
  cwd: string
  mcpServers: Array<{
    name: string
    command: string   // e.g. "node"
    args: string[]    // e.g. ["stdio-proxy.js"]
    env: string[]
    // ⚠️ 無 url 欄位：schema 層硬限制，HTTP transport 不支援
  }>
}

// Gemini → Sidecar（stdout，Notification 無 id）
export type AcpNotification =
  | { jsonrpc: '2.0'; method: 'session/update'; params: { sessionId: string; content: string } }
  | { jsonrpc: '2.0'; method: 'session/request_permission'; params: AcpPermissionRequest }

export interface AcpPermissionRequest {
  sessionId: string
  toolName: string
  // [TODO] 完整參數格式待確認
}

// Gemini → Sidecar（stdout，Response 有 id）
export type AcpResponse =
  | { jsonrpc: '2.0'; id: number; result: { protocolVersion: 1; authMethods: object[] } }  // initialize
  | { jsonrpc: '2.0'; id: number; result: { sessionId: string } }                           // session/new
  | { jsonrpc: '2.0'; id: number; result: { stopReason: 'end_turn' | 'cancelled' } }        // session/prompt
  | { jsonrpc: '2.0'; id: number; error: { code: number; message: string; data?: object } }
```

**`normalize.ts` — 統一 NormalizedEvent（解析器內部中間格式）：**
```typescript
// 無論來源為 Claude 或 Gemini，解析器輸出統一為 NormalizedEvent
// 再由 agent-manager 包裝為 SidecarEvent（含 agentId）上報 Rust
export type NormalizedEvent =
  | { kind: 'session_start'; sessionId: string }
  | { kind: 'text_delta'; text: string }
  | { kind: 'tool_call'; toolName: string; toolId: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; toolId: string; success: boolean; output: string }
  | { kind: 'session_end'; success: boolean; errorType?: string; costUsd?: number }
  // costUsd: Claude Code 填入 total_cost_usd；Gemini CLI 無費用資料，固定為 undefined
```

**Process Hang 處理（必須實作）：**
```typescript
// 收到 result 事件後
// 注意：不使用 proc.exitCode 判斷（存在 race condition，'exit' 事件尚未處理時值仍為 null）
// 改用 exited flag，在 'exit' 事件同步設定
let exited = false;
proc.on('exit', () => { exited = true; });

async function handleProcessEnd(proc: ChildProcess): Promise<void> {
  await sleep(2000);
  if (exited) return;    // 已自然退出
  proc.kill('SIGTERM');
  await sleep(3000);
  if (exited) return;
  proc.kill('SIGKILL');  // 強制終止
}
```

**`parser.test.ts` 必須測試：**

Claude Code 解析器：
1. 正常序列（system → assistant → user → result）
2. tool_use 在 assistant.message.content 內正確提取
3. tool_result 在 user.message.content 內正確提取
4. `result.subtype` 所有 5 種錯誤類型解析
5. stream_event 的 text_delta 提取

Gemini CLI 解析器：
6. 正常序列（init → message → tool_use → tool_result → message → result）
7. `delta:true` 的 message 識別為串流 token
8. tool_use/tool_result 以 tool_id 配對

共用：
9. 非 JSON 行被忽略（不拋錯）
10. buffer 跨多個 chunk 的行分割
11. 兩者輸出正規化後 SidecarEvent 格式一致

**單元測試（`parser.test.ts` 必須涵蓋以上 11 個案例，另補充）：**
```typescript
describe('normalize', () => {
  it('Claude session_end 填入 costUsd', () => {
    const result = normalizeClaudeResult({ type: 'result', subtype: 'success', total_cost_usd: 0.005, ... });
    expect(result.costUsd).toBe(0.005);
  });

  it('Gemini session_end costUsd 為 undefined', () => {
    const result = normalizeGeminiResult({ type: 'result', status: 'success', stats: { ... } });
    expect(result.costUsd).toBeUndefined();
  });

  it('exited flag 防止對已退出程序發送 SIGTERM', async () => {
    // 模擬程序在 sleep(2000) 期間自然退出
    // 確認 handleProcessEnd 不發送任何 signal
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- stream-parser   # 所有單元測試通過
npx tsc --noEmit                          # TypeScript 無錯誤
# 端對端：以實際 claude --output-format stream-json 輸出餵入解析器
# 確認每一行 stdout 均能正確解析為 NormalizedEvent，無拋錯
```

**完成條件：** 所有測試通過；TypeScript 無錯誤；Gemini `costUsd` 正確為 `undefined`。

---

## Task 05：Worker Agent 子程序管理

**前置條件：** Task 03、Task 04 完成

**目標：** 實作 Worker Agent 的完整生命週期管理，含啟動、監控、崩潰偵測與 HITL 上報。

**產出清單：**
```
sidecar/src/
└── agent-manager/
    ├── index.ts           # 匯出 AgentManager
    ├── agent-manager.ts   # AgentManager class（含協議分發邏輯）
    ├── cli-detector.ts    # Claude Code / Gemini CLI 路徑偵測
    └── process-guard.ts   # process hang 防護（SIGTERM/SIGKILL）
```

**協議分發邏輯（`agent-manager.ts` 核心設計）：**
```typescript
type AgentRole = 'worker' | 'master'
type AgentProtocol = 'claude-stream-json' | 'gemini-acp'

interface AgentConfig {
  agentId: string
  role: AgentRole
  protocol: AgentProtocol  // 決定 spawn 方式與 parser 選擇
  worktreePath: string
}

// 分發規則（寫死）：
// role === 'worker'  → protocol 強制為 'claude-stream-json'
// role === 'master'  → protocol 依使用者設定（'claude-stream-json' 或 'gemini-acp'）

function spawnAgent(config: AgentConfig): ChildProcess {
  if (config.protocol === 'claude-stream-json') {
    return spawnClaude(config)   // --print --input-format=stream-json --output-format=stream-json
  } else {
    return spawnGemini(config)   // --experimental-acp
  }
}

function getParser(config: AgentConfig): StreamParser {
  if (config.protocol === 'claude-stream-json') {
    return new ClaudeStreamParser()
  } else {
    return new GeminiAcpParser()
  }
}
```

**CLI 執行檔名稱（依平台）：**

| CLI | Linux/macOS | Windows |
|-----|------------|---------|
| Claude Code（原生安裝） | `claude`（無副檔名） | `claude.exe` |
| Gemini CLI（npm 安裝） | `gemini`（無副檔名） | `gemini.cmd`（CMD）/ `gemini.ps1`（PowerShell） |

> npm 全域安裝 `bin` 欄位指向 `.js` 的套件時，Windows 上 npm 自動產生 `.cmd` 和 `.ps1` wrapper，
> 不是原生 `.exe`。Gemini CLI `package.json` 的 `bin` 定義為 `"gemini": "dist/index.js"`，
> 因此 Windows 上是 `gemini.cmd`，不是 `gemini.exe`。

**`cli-detector.ts` — Claude Code 路徑偵測順序：**
1. 使用者設定路徑（從 Rust AppState 讀取）
2. `which claude`（Linux）/ `where claude`（Windows CMD）
3. `~/.local/bin/claude`（原生安裝器預設路徑，Linux + Windows）
4. `~/.npm-global/bin/claude`（npm 自訂 prefix）
5. `{npm root -g}/../bin/claude`（npm 預設 global bin，動態查詢）
6. 以上全部失敗 → 上報 `error:cli_not_found` 至 Rust

> **Windows 注意**：Claude Code 原生安裝器需要 Git Bash 才能執行。
> Node.js Sidecar 在 Windows 上必須透過 Git Bash 環境（`bash.exe -c "claude ..."`）呼叫 `claude`，
> 或依使用者設定的 `CLAUDE_CODE_GIT_BASH_PATH` 環境變數找到 bash 路徑。

**`cli-detector.ts` — Gemini CLI 路徑偵測順序：**
1. 使用者設定路徑（從 Rust AppState 讀取）
2. `which gemini`（Linux）/ `where gemini`（Windows CMD）
3. `~/.npm-global/bin/gemini`（npm 自訂 prefix）
4. `{npm root -g}/../bin/gemini`（npm 預設 global bin，動態查詢）
5. 以上全部失敗 → 上報 `error:gemini_cli_not_found` 至 Rust

> **Gemini CLI 無原生安裝器**，僅透過 npm 安裝（`npm install -g @google/gemini-cli`）。
> Windows 上 npm 產生 `gemini.cmd`（CMD 用）和 `gemini.ps1`（PowerShell 用），可直接執行，**不需要 Git Bash**。

**架構邊界（明確定義）：**
```
Worker Agent = Claude Code only（寫死）
  理由：Worker 是 single-task 執行單元，不需要多輪持久對話
        Gemini CLI 當 Worker 會失去 --permission-prompt-tool，Tower MCP 3701 整個作廢
        stream-json 提供完整的 tool_use/result/cost 追蹤，是 Worker 監控的基礎

Master Orchestrator = Claude Code 或 Gemini CLI（可設定）
  理由：Master 需要多輪持久對話協調任務，兩者都支援
```

**Worker Agent 固定啟動參數（不可修改）：**
```typescript
const WORKER_FIXED_ARGS = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--permission-prompt-tool', 'mcp__tower__auth',
];
```

**Master Orchestrator 啟動參數（Claude 模式）：**
```typescript
const MASTER_CLAUDE_ARGS = [
  '--print',
  '--verbose',
  '--input-format', 'stream-json',   // ← 雙向協議，可接收 control_request
  '--output-format', 'stream-json',
  // 無 --permission-prompt-tool（Master Orchestrator 不需要 HITL）
];
```

**Claude Code 雙向協議（`--input-format=stream-json`）：**
```
Sidecar → Claude stdin：
  { "type": "user", "message": { "role": "user", "content": "..." } }
  { "type": "control_request", "request": { "subtype": "interrupt" } }

Claude → Sidecar stdout：
  { "type": "assistant", ... }      ← 一般 stream-json 事件
  { "type": "control_response", ... }
```

**`control_request: interrupt` 行為語義（[VERIFY] 尚未實測，需在 Task 05 實作前驗證）：**
```
假設行為（依 Claude Code 原始碼推斷，類似 Ctrl+C）：
  - 中斷當前 turn 的推理，不等待後續 tool 執行完成
  - Claude Code 發出 result（subtype: error_during_execution 或類似）後退出
  - 不保證當前正在執行的 shell 子程序被終止（需另外 SIGKILL）

實作策略（依 immediate flag）：
  immediate=true  → 發 control_request: interrupt，2s 後若未退出改發 SIGTERM/SIGKILL
  immediate=false → 不發 interrupt，等待當前 result 事件後再停止接收新任務

驗證方法（Task 05 實作前必須手動執行）：
  claude --print --input-format=stream-json --output-format=stream-json << 'EOF'
  { "type": "user", "message": { "role": "user", "content": "run: sleep 30" } }
  EOF
  # 收到第一個 assistant 事件後，立即發送：
  { "type": "control_request", "request": { "subtype": "interrupt" } }
  # 觀察：是否發出 result？subtype 為何？程序是否自動退出？

[TODO] control_request 其他 subtype（目前只知道 interrupt，完整清單待確認）
```

**Master Orchestrator 啟動參數（Gemini 模式）：**
```typescript
// [DECISION] --experimental-acp：Gemini CLI v0.21.2 已實作，無需 TTY，多輪持久對話
// 原名 Zed Integration，PROTOCOL_VERSION = 1
const MASTER_GEMINI_ARGS = ['--experimental-acp'];

const proc = spawn('gemini.cmd', MASTER_GEMINI_ARGS, {
  stdio: ['pipe', 'pipe', 'pipe'],  // 不需要 TTY
  cwd: worktreePath,
});
```

**Gemini CLI ACP 協議（JSON-RPC NDJSON）：**
```
Sidecar → Gemini stdin：
  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
  {"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}
  {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"xxx","prompt":"..."}}
  {"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"xxx"}}

Gemini → Sidecar stdout：
  {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[...]}}
  {"jsonrpc":"2.0","id":2,"result":{"sessionId":"abc-123"}}
  {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc-123","content":"..."}}
  {"jsonrpc":"2.0","method":"session/request_permission","params":{...}}  ← HITL
  {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

**ACP 完整方法清單：**

| 方向 | 方法 | 說明 |
|------|------|------|
| Sidecar→Gemini | `initialize` | 握手，取得 protocolVersion |
| Sidecar→Gemini | `session/new` | 建立新對話，取得 sessionId |
| Sidecar→Gemini | `session/prompt` | 送訊息（非同步，streaming via notifications） |
| Sidecar→Gemini | `session/cancel` | 取消當前執行 |
| Gemini→Sidecar | `session/update` | 串流內容推送（工具呼叫、文字） |
| Gemini→Sidecar | `session/request_permission` | 詢問工具執行權限（Gemini 的 HITL） |

**注意：** `--experimental-acp` 含 `experimental` 前綴，最新 nightly 已到 v0.35.0，API 可能變動。固定使用 v0.21.2 或升版前需驗證。

**已知問題與修復（實測）：**

| 問題 | 原因 | 解法 |
|------|------|------|
| 429 MODEL_CAPACITY_EXHAUSTED | `auto-gemini-3` 容量不足 | `~/.gemini/settings.json` 設 `"model": "gemini-2.5-pro"` |
| `read_file` 在 stream-json 模式下 output 為空 | `returnDisplay: ""` by design（`llmContent` 才送模型） | ACP interactive 模式下不受此限制 |

**CLI 認證設計（OAuth 優先）：**

兩個 CLI 均採用**OAuth 快取憑證**為主要認證方式，API Key 為備選。Orchestrator Tower 本身不管理 token 更新，由 CLI 自行處理。

| CLI | 認證方式 | 憑證快取位置 |
|-----|---------|------------|
| Claude Code | OAuth（Claude.ai 帳號）或 API Key | Linux/Windows：`~/.claude/.credentials.json`；macOS：系統 Keychain |
| Gemini CLI | OAuth（Google 帳號，支援 Google AI Pro/Ultra）或 API Key | `~/.gemini/settings.json` + token 快取 |

**前置條件（使用者需手動完成一次）：**
- Claude Code：執行 `claude` → 選「Login with Claude app」→ 完成瀏覽器授權
- Gemini CLI：執行 `gemini` → 選「Login with Google」→ 用 Google AI Pro 帳號授權

**Headless 啟動時的認證行為：**
```typescript
// cli-detector.ts 在偵測到 CLI 路徑後，同步檢查憑證快取是否存在
// Claude Code
const claudeCredsPath = path.join(os.homedir(), '.claude', '.credentials.json');
// Gemini CLI
const geminiSettingsPath = path.join(os.homedir(), '.gemini', 'settings.json');

// 若快取不存在 → 上報 error:cli_not_authenticated 至 Rust → UI 顯示提示
// 若快取存在 → 直接啟動，CLI 自行讀取 token；token 失效時 CLI 報錯 → Sidecar 捕獲 → 上報 error:cli_auth_expired
```

> **注意**：Gemini CLI 若使用 Google AI Pro 帳號登入，`~/.gemini/settings.json` 中 `selectedAuthType` 為 `oauth-personal`。
> Orchestrator Tower 可讀取此欄位確認認證模式，但**不需要自行管理 OAuth flow**。

**崩潰處理（不自動重啟）：**

Worker Agent 崩潰時，Sidecar **不自動重啟**，改為：

1. 偵測意外退出（exit code 非 0，或未收到 `result` 事件就退出）
2. 寫入 SQLite crash 紀錄
3. 嘗試在 shadow branch 建立 `[crash]` commit（見 Task 08）
4. 上報 HITL 提示框（`riskLevel: high`）讓人決定後續

**意外退出 vs 正常退出的區分：**
```typescript
// process-guard.ts 內維護一個 flag
let resultReceived = false;
stream.on('data', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'result') resultReceived = true;
});
process.on('exit', (code, signal) => {
  if (!resultReceived) {
    // 意外退出 → 觸發崩潰處理流程
    handleCrash({ agentId, exitCode: code, signal, lastSessionId, lastToolUse });
  }
  // resultReceived === true → 正常完成，不處理
});
```

**崩潰處理函式 `handleCrash`：**
```typescript
// Node.js 只負責偵測崩潰並上報，後續由 Rust 統一處理：
// crash commit 寫入、SQLite 記錄、HITL 觸發
async function handleCrash(info: CrashInfo): Promise<void> {
  await ipc.send({
    type: 'agent:crash',
    agentId: info.agentId,
    exitCode: info.exitCode,
    signal: info.signal,
    lastSessionId: info.lastSessionId,
    lastToolUse: info.lastToolUse,
  });
}
```

> **架構原則**：Node.js 不直接寫 SQLite，不呼叫 Git Plumbing。
> Rust 收到 `agent:crash` 後依序執行：crash commit → SQLite 寫入 → HITL 觸發。

**SQLite crash 紀錄欄位（由 Rust 寫入）：**
| 欄位 | 說明 |
|------|------|
| `agent_id` | 哪個 Agent |
| `crashed_at` | 崩潰時間（ISO 8601，Rust 寫入時產生） |
| `exit_code` | process 退出碼（null 表示被 signal 終止） |
| `signal` | 終止 signal（SIGTERM / SIGKILL / null） |
| `last_session_id` | 最後一次 Claude Code session_id |
| `last_tool_use` | 崩潰前最後執行的工具呼叫（JSON，可能為 null） |
| `crash_ref` | Git crash commit ref（可能為 null，由 Rust crash_commit.rs 產生） |

**單元測試（`sidecar/src/agent-manager/agent-manager.test.ts`）：**
```typescript
describe('cli-detector', () => {
  it('CLI 不存在時上報 error:cli_not_found', async () => {
    // mock which/where 全部失敗
    const result = await detectClaude({ userConfigPath: null });
    expect(result.error).toBe('error:cli_not_found');
  });

  it('憑證快取不存在時上報 error:cli_not_authenticated', async () => {
    // mock CLI 存在，但 ~/.claude/.credentials.json 不存在
    const result = await checkClaudeAuth();
    expect(result.error).toBe('error:cli_not_authenticated');
  });
});

describe('process-guard', () => {
  it('正常退出（resultReceived=true）不觸發 handleCrash', async () => {
    const crashSpy = jest.fn();
    // 模擬程序發出 result 事件後退出
    await runWithGuard({ onCrash: crashSpy, simulateNormalExit: true });
    expect(crashSpy).not.toHaveBeenCalled();
  });

  it('意外退出（resultReceived=false）觸發 agent:crash IPC', async () => {
    const ipcSpy = jest.fn();
    await runWithGuard({ onIpc: ipcSpy, simulateCrash: true });
    expect(ipcSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:crash' }));
  });

  it('handleCrash 不直接寫 SQLite，只發 IPC', async () => {
    const dbSpy = jest.fn();
    const ipcSpy = jest.fn();
    await handleCrash({ agentId: 'a1', exitCode: 1, signal: null, ... }, { db: { insert: dbSpy }, ipc: { send: ipcSpy } });
    expect(dbSpy).not.toHaveBeenCalled();
    expect(ipcSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:crash' }));
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- agent-manager
npx tsc --noEmit
# 手動：以真實 claude CLI 啟動 Worker，確認 stream 正常接收
# 手動：強制 kill Worker，確認 3 秒內 Rust 收到 agent:crash IPC 事件
```

**完成條件：** CLI 路徑偵測成功率 100%；意外退出觸發 `agent:crash` IPC；正常完成不觸發；`handleCrash` 不寫 SQLite。

---

## Task 06：Tower MCP Server（port 3701）

**前置條件：** Task 03 完成

**目標：** 實作供 Worker Agent 使用的 Tower MCP Server，提供 `mcp__tower__auth` 工具。

**HITL 統一介面（兩條路徑都轉換為相同格式上報 Rust）：**
```
路徑 A（Worker / Claude Code）：
  --permission-prompt-tool → Tower MCP 3701 auth 工具被呼叫
  → auth-tool.ts 呼叫 classifier → 決定 riskLevel
  → IPC 上報 { type: 'hitl:request', source: 'tower-mcp', ... }

路徑 B（Master / Gemini CLI）：
  session/request_permission ACP 回調 → GeminiAcpParser 攔截
  → 呼叫同一個 classifier → 決定 riskLevel
  → IPC 上報 { type: 'hitl:request', source: 'acp-permission', ... }

Rust 收到 hitl:request 後行為相同，不區分 source
approve/deny 回傳路徑：
  source='tower-mcp'    → auth-tool.ts 等待 IPC approve/deny 回應後回傳 MCP result
  source='acp-permission' → GeminiAcpParser 等待 IPC 回應後發 session/prompt 繼續
```

**產出清單：**
```
sidecar/src/
└── mcp-servers/
    └── tower/
        ├── index.ts        # 匯出 startTowerMcpServer
        ├── server.ts       # HTTP Streamable MCP Server（stateful session 管理）
        └── auth-tool.ts    # mcp__tower__auth 工具實作
```

**MCP Server 實作要點（實測驗證）：**
```typescript
// ✅ 正確：stateful session 管理，使用 onsessioninitialized callback
const sessions = new Map<string, StreamableHTTPServerTransport>();

httpServer.on('request', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  let transport = sessions.get(sessionId);

  if (!transport) {
    const server = createMcpServer(); // 每個 session 獨立實例
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => { sessions.set(sid, transport!); }
    });
    transport.onclose = () => sessions.delete(transport!.sessionId!);
    await server.connect(transport);
  }

  await transport.handleRequest(req, res);
});

// ✅ 正確 schema：z.record 必須明確指定 key type
server.tool('auth',
  {
    tool_name: z.string(),
    tool_use_id: z.string(),
    input: z.record(z.string(), z.unknown())  // ❌ z.record(z.unknown()) 會爆炸
  },
  async (args) => { ... }
);
```

**`mcp__tower__auth` 規格（Claude Code 2.1.74 實測）：**
```typescript
// Claude Code 呼叫此工具時傳入的參數（實測確認）
interface AuthToolArgs {
  tool_name: string        // 被攔截的工具名稱，如 "Write"、"Bash"
  tool_use_id: string      // 對應的 tool_use id
  input: Record<string, unknown>  // 完整的原始工具輸入
}

// 回傳格式（必須嚴格符合，否則 Claude Code 回報 invalid_union）
type AuthToolResponse =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }  // updatedInput 必填
  | { behavior: 'deny'; message: string }                          // ❌ 不是 'block'

// 注意：updatedInput 傳回原始 input 即可，不需修改
// { behavior: 'allow', updatedInput: args.input }
```

**業務邏輯：**
```typescript
// requestId 由 Node.js 生成（randomUUID()），在 hitl:request IPC 上報時帶出
// auth-tool.ts 內維護一個全域 Map：
const pendingHitl = new Map<string, { resolve: (r: AuthToolResponse) => void; reject: (e: Error) => void }>();

// IPC client 收到 hitl:response 時路由回對應 Promise：
ipc.on('hitl:response', (msg: { requestId: string; approved: boolean; modifiedInput?: unknown; reason?: string }) => {
  const pending = pendingHitl.get(msg.requestId);
  if (!pending) return;  // 已逾時或重複回應，忽略
  pendingHitl.delete(msg.requestId);
  if (msg.approved) {
    pending.resolve({ behavior: 'allow', updatedInput: msg.modifiedInput ?? originalInput });
  } else {
    pending.resolve({ behavior: 'deny', message: msg.reason ?? 'denied' });
  }
});

// auth-tool.ts 核心流程：
// 1. riskLevel === 'low' → 立即回傳 allow（由 Task 09 classifier 決定 riskLevel）
// 2. 其他 → 生成 requestId，存入 pendingHitl Map，透過 IPC 上報 hitl:request，阻塞等待
// 3. 逾時 5 分鐘未回應 → 從 Map 刪除，回傳 deny, reason: 'timeout'
// 注意：HITL 呼叫不出現在 stream-json 事件流，完全在 infrastructure 層處理
```

**Port 衝突處理：**
```typescript
async function findAvailablePort(startPort: number): Promise<number> {
  // 從 startPort 開始，遞增尋找可用 port
  // 找到後寫入 Rust AppState（透過 IPC）
}
```

**單元測試（`sidecar/src/mcp-servers/tower/tower.test.ts`）：**
```typescript
describe('mcp__tower__auth', () => {
  it('riskLevel=low 立即回傳 allow，不呼叫 IPC', async () => {
    const ipcSpy = jest.fn();
    const result = await authTool({ tool_name: 'Read', tool_use_id: 'tu_1', input: {}, riskLevel: 'low', agentId: 'a1' }, { ipc: { send: ipcSpy } });
    expect(result.behavior).toBe('allow');
    expect(ipcSpy).not.toHaveBeenCalled();
  });

  it('riskLevel=high 透過 IPC 上報並阻塞等待', async () => {
    const result = await authTool({ tool_name: 'Bash', tool_use_id: 'tu_2', input: { command: 'rm -rf' }, riskLevel: 'high', agentId: 'a1' }, mockIpc);
    expect(result.behavior).toBe('allow');
    expect(result.updatedInput).toBeDefined();
  });

  it('5 分鐘無回應後回傳 deny, reason:timeout', async () => {
    jest.useFakeTimers();
    const promise = authTool({ riskLevel: 'medium', ... });
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    const result = await promise;
    expect(result.behavior).toBe('deny');
    expect(result.message).toContain('timeout');
  });

  it('port 衝突時自動遞增並寫入 AppState', async () => {
    const port = await findAvailablePort(3701);
    expect(port).toBe(3702);
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- tower-mcp
npx tsc --noEmit
# 確認 MCP Server 啟動後 Claude Code 可連線
claude mcp add --transport http tower http://localhost:3701
claude mcp list  # 預期：tower: ✓ Connected
# 實際 tool 呼叫驗證（需啟動 server）
claude --print --output-format stream-json \
  --permission-prompt-tool mcp__tower__auth \
  "create a file called hitl-test.txt with content hello"
# 預期：server log 出現 HITL args，檔案建立成功
```

**完成條件：** `low` 風險自動批准；`medium/high/critical` 阻塞等待；5 分鐘逾時正確觸發；port 衝突自動遞增；`behavior: 'allow'` 時 `updatedInput` 必須傳回原始 input。

---

## Task 07：State MCP Server（port 3702）+ STDIO Proxy

**前置條件：** Task 03、Task 02 完成

**目標：** 實作供 Master Orchestrator 使用的 State MCP Server，代理 Rust AppState 的讀寫。並提供 STDIO Proxy 橋接層，使 Gemini CLI ACP 能透過 STDIO MCP 協議存取 HTTP MCP（3702）。

> **背景：** Gemini CLI ACP 的 `mcpServerSchema` 硬限制只有 `command/args/env/name`，無 `url` 欄位，HTTP MCP transport 在 schema 層寫死不支援。每個 Gemini session 啟動獨立 proxy 進程，不污染 `settings.json`，多 session 並行無競爭條件。

**產出清單：**
```
sidecar/src/
└── mcp-servers/
    └── state/
        ├── index.ts        # 匯出 startStateMcpServer
        ├── server.ts       # 8 個工具的實作（HTTP MCP server，port 3702）
        └── stdio-proxy.ts  # STDIO↔HTTP 橋接器（每個 Gemini session 獨立啟動）
```

**STDIO Proxy 架構：**
```
Gemini CLI (ACP)
  └─ session/new { mcpServers: [{ command:"node", args:["stdio-proxy.js"], name:"state" }] }
       └─ stdio-proxy.ts ──HTTP──► 3702 (HTTP MCP server)
                                        └─ IPC ──► Rust AppState
```

**`stdio-proxy.ts` 行為：**
```typescript
// 1. 連到上游 HTTP MCP（3702）
// 2. listTools() 取得所有工具定義
// 3. 開 STDIO MCP server，re-export 所有工具
// 4. 每次工具呼叫透過 upstream.callTool() 轉發至 3702
// 依賴：@modelcontextprotocol/sdk（StdioServerTransport + StreamableHTTPClientTransport）
```

**`stdio-proxy.ts` 生命週期（由 Node.js Sidecar 管理）：**
```
啟動時機：session/new 發送至 Gemini stdin 之前
  → Sidecar 先 spawn proxy 子程序（得到 proxyPid）
  → 確認 proxy 輸出 "ready" 後才發送 session/new
  → proxy 路徑寫入 session/new params.mcpServers[].args

終止時機：session/prompt 收到 stopReason（end_turn / cancelled）後
  → Sidecar 對 proxy 發 SIGTERM
  → 2s 後若未退出 → SIGKILL

異常處理：
  proxy crash（意外退出）→ Sidecar 上報 agent:crash IPC，視同 Gemini session 異常結束
  proxy 啟動逾時（5s 內未輸出 "ready"）→ SIGKILL proxy，上報 error:proxy_start_timeout

並行隔離：
  每個 Gemini session 對應獨立 proxy 子程序（proxyPid 與 sessionId 1:1 綁定）
  多 session 並行時各自管理，無共享狀態
```

**ACP session/new 呼叫方式（Task 05 整合）：**
```json
{
  "method": "session/new",
  "params": {
    "cwd": "<worktree_path>",
    "mcpServers": [{
      "name": "state",
      "command": "node",
      "args": ["<sidecar_dist>/mcp-servers/state/stdio-proxy.js"],
      "env": []
    }]
  }
}
```

**8 個工具（全部透過 IPC 代理至 Rust，不在 Node.js 層持有狀態）：**

| 工具 | B 模式關閉時 |
|------|------------|
| `get_worker_status` | 正常 |
| `assign_task` | 正常 |
| `pause_worker` | 正常 |
| `resume_worker` | 正常 |
| `approve_hitl` | 回傳 403 Forbidden |
| `deny_hitl` | 回傳 403 Forbidden |
| `get_quota_status` | 正常 |
| `get_git_snapshot` | 正常 |

**單元測試（`sidecar/src/mcp-servers/state/state.test.ts`）：**
```typescript
describe('State MCP tools', () => {
  it('get_worker_status 透過 IPC 代理至 Rust，不在 Node.js 持有狀態', async () => {
    const ipcSpy = jest.fn().mockResolvedValue({ status: 'running' });
    const result = await getWorkerStatus('a1', { ipc: { request: ipcSpy } });
    expect(ipcSpy).toHaveBeenCalled();
    expect(result.status).toBe('running');
  });

  it('assign_task 發送 agent:assign IPC 指令', async () => {
    const ipcSpy = jest.fn();
    await assignTask('a1', 'do something', 10, { ipc: { send: ipcSpy } });
    expect(ipcSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:assign' }));
  });

  it('pause_worker 發送 agent:freeze（reason:orchestrator, immediate:true）', async () => {
    const ipcSpy = jest.fn();
    await pauseWorker('a1', { ipc: { send: ipcSpy } });
    expect(ipcSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent:freeze', reason: 'orchestrator', immediate: true
    }));
  });

  it('B 模式關閉時 approve_hitl 回傳 403', async () => {
    const result = await approveHitl('r1', { bModeEnabled: false });
    expect(result.status).toBe(403);
  });

  it('B 模式關閉時 deny_hitl 回傳 403', async () => {
    const result = await denyHitl('r1', 'reason', { bModeEnabled: false });
    expect(result.status).toBe(403);
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- state-mcp
npx tsc --noEmit
# 確認所有 8 個工具可透過 HTTP 呼叫並回傳正確結構
# 確認 B 模式關閉時 approve/deny 回傳 403
```

**完成條件：** 所有工具透過 IPC 代理，不在 Node.js 持有狀態；B 模式關閉時 `approve_hitl`/`deny_hitl` 回傳 403；`agent:freeze` 正確帶 `reason` 與 `immediate`。

---

## Task 08：Git Worktree 建立與 Shadow Branch 快照

**前置條件：** Task 02 完成

**目標：** 實作 Git Worktree 的建立/鎖定/清理，以及 Shadow Branch micro-commit 快照的寫入與回滾。

**產出清單：**
```
src-tauri/src/
└── git/
    ├── mod.rs              # 匯出所有 git 函式
    ├── worktree.rs         # Worktree 建立/鎖定/清理
    ├── snapshot.rs         # Shadow Branch 快照寫入
    ├── crash_commit.rs     # Crash commit 寫入
    └── rollback.rs         # 安全重置協議
```

**Worktree 命名規則：**
```
{project_root}/.trees/agent-{agentId}/
```

**Shadow Branch 命名：**
```
refs/heads/__orch_shadow_{projectId}_{agentId}
```
> 每個 Agent 獨立 Branch，避免多 Agent 並發寫入時覆蓋彼此歷史鏈。

**快照 ref 命名：**
```
refs/orchestrator/{projectId}/node-{nodeId}
```

**`snapshot.rs` 核心邏輯（必須使用 Plumbing）：**
```rust
// 不得使用 git commit, git checkout 等 Porcelain 指令
// 使用 git write-tree, git commit-tree, git update-ref
pub async fn write_snapshot(worktree_path: &Path, project_id: &str, node_id: &str) -> Result<String>
```

**`rollback.rs` 安全重置協議：**
```rust
// 順序：暫停 agent → 等待 .lock 清除（5s 上限）→ git reset --keep {sha} → 恢復 agent
// 禁止使用 git reset --hard
pub async fn safe_reset(agent_id: &str, target_sha: &str) -> Result<()>
```

**`crash_commit.rs` Crash 記錄點：**
```rust
// 在 shadow branch 上建立一個 [crash] commit，記錄崩潰資訊
// 僅在有上一個 snapshot ref 時執行，否則回傳 Ok(None)
// commit message 格式：[crash] agent-{agentId} exit={exit_code} signal={signal}
// commit 內容：新增 crash.log 檔案（包含 crashed_at、exit_code、signal、last_session_id）
// parent：上一個 snapshot ref（refs/orchestrator/{projectId}/node-{nodeId}）
// 必須使用 Plumbing：git hash-object → write-tree → commit-tree → update-ref
pub async fn write_crash_commit(
    worktree_path: &Path,
    project_id: &str,
    agent_id: &str,
    info: &CrashInfo,
    parent_ref: Option<&str>,  // 上一個 snapshot ref，None 則跳過
) -> Result<Option<String>>    // 回傳 crash commit SHA，或 None（無 parent 時）
```

**crash.log 格式：**
```
crashed_at: 2026-03-12T10:23:45Z
exit_code: 1
signal: null
last_session_id: abc-123-def
last_tool_use: {"toolName":"Bash","input":{"command":"npm install"}}
```

**Shadow Branch 清理（每晚排程，由 Rust 執行）：**

清理邏輯實作於 `git/mod.rs` 的 `cleanup_old_refs` 函式，不依賴 shell script（`date -d` 為 GNU 限定語法，跨平台不相容）：

```rust
// git/mod.rs
// Shadow Branch ref 與 Worktree 目錄同步清理（7 天後排程）
pub async fn cleanup_old_refs(repo_path: &Path, retention_days: u64) -> Result<()> {
  // 1. git for-each-ref --format=%(refname) %(creatordate:unix) refs/orchestrator/
  // 2. 在 Rust 層比較 unix timestamp 與 cutoff
  // 3. 對超期 ref 執行 git update-ref -d {refname}
  // 4. 從 refname 解析出 agentId，嘗試清理對應 Worktree：
  //    git worktree remove --force {repo_path}/.trees/agent-{agentId}
  //    若 Worktree 不存在則忽略（idempotent）
  // 注意：必須先刪 ref，再刪 Worktree 目錄，避免 git worktree list 出現孤兒記錄
}
```

> **清理順序**：Shadow Branch ref → `git worktree remove --force` → 目錄已由 git 指令清除。  
> 7 天後的 Worktree 不存在活躍 Agent，快照已保留於 ref，強制刪除無資料損失風險。

**單元測試（`src-tauri/src/git/` 各模組）：**
```rust
#[cfg(test)]
mod tests {
    // worktree.rs
    #[tokio::test]
    async fn worktree_path_follows_naming_convention() {
        // {project_root}/.trees/agent-{agentId}/
        let path = worktree_path("/repo", "agent-42");
        assert_eq!(path.to_str().unwrap(), "/repo/.trees/agent-agent-42");
    }

    // snapshot.rs
    #[tokio::test]
    async fn snapshot_uses_plumbing_not_porcelain() {
        // 確認不呼叫 git commit / git checkout
        // 只允許 write-tree, commit-tree, update-ref
        let log = capture_git_commands(|| write_snapshot(path, proj, node)).await;
        assert!(!log.iter().any(|cmd| cmd.contains("git commit")));
        assert!(!log.iter().any(|cmd| cmd.contains("git checkout")));
    }

    #[tokio::test]
    async fn snapshot_ref_follows_naming_convention() {
        // refs/orchestrator/{projectId}/node-{nodeId}
        let sha = write_snapshot(&tmp_path, "proj1", "node-7").await.unwrap();
        let ref_name = format!("refs/orchestrator/proj1/node-node-7");
        let resolved = run_git(&["rev-parse", &ref_name]).await.unwrap();
        assert_eq!(resolved.trim(), sha);
    }

    // rollback.rs
    #[tokio::test]
    async fn rollback_uses_reset_keep_not_hard() {
        let log = capture_git_commands(|| safe_reset("a1", "abc123")).await;
        assert!(log.iter().any(|cmd| cmd.contains("--keep")));
        assert!(!log.iter().any(|cmd| cmd.contains("--hard")));
    }

    // crash_commit.rs
    #[tokio::test]
    async fn crash_commit_skipped_when_no_parent() {
        let result = write_crash_commit(&path, "proj", "a1", &info, None).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn crash_commit_message_format() {
        let sha = write_crash_commit(&path, "proj", "a1", &info, Some("refs/...")).await.unwrap().unwrap();
        let msg = run_git(&["log", "-1", "--format=%s", &sha]).await.unwrap();
        assert!(msg.starts_with("[crash] agent-a1 exit="));
    }

    // cleanup
    #[tokio::test]
    async fn cleanup_removes_refs_older_than_retention() {
        // 建立一個假造 7 天前的 ref，確認被清除
        // 建立一個今天的 ref，確認保留
        cleanup_old_refs(&path, 7).await.unwrap();
        // assert old ref 已刪除
        // assert new ref 仍存在
    }
}
```

**整合測試：**
```bash
cargo test --manifest-path src-tauri/Cargo.toml git::
# 手動：建立 Worktree → 寫快照 → 確認 ref 存在 → 執行回滾 → 確認狀態
# 效能：快照寫入時間 < 50ms（cargo bench git::snapshot）
```

**完成條件：** Worktree 建立可鎖定；快照 < 50ms；回滾使用 `--keep`；無快照時 crash commit 回傳 `None`；清理正確刪除 7 天前的 ref 與對應 Worktree 目錄（順序：先 ref 後 Worktree）。

---

## Task 09：HITL 風險分類引擎

**前置條件：** Task 06 完成

**目標：** 實作風險分類函式，並整合至 Tower MCP Server 的 `mcp__tower__auth` 工具。

**產出清單：**
```
sidecar/src/
└── hitl/
    ├── index.ts           # 匯出 classifyRisk
    ├── classifier.ts      # 風險分類邏輯
    └── classifier.test.ts # 單元測試（覆蓋所有 critical 條件）
```

**分類規則（優先級從高到低）：**
```typescript
export function classifyRisk(toolName: string, input: unknown): RiskLevel {
  const cmd = (input as any)?.command ?? '';
  const filePath = (input as any)?.file_path ?? '';

  // critical：不可逆操作
  if (/\b(rm|delete|drop|format|truncate|unlink)\b/i.test(cmd)) return 'critical';
  if (toolName === 'Bash' && /\brm\s/.test(cmd)) return 'critical';

  // high：敏感檔案寫入
  if (['Write', 'Edit'].includes(toolName)) {
    if (/\.(env|key|pem|secret|credential)/i.test(filePath)) return 'high';
    if (/\b(password|token|secret|api.?key)\b/i.test(filePath)) return 'high';
  }

  // medium：一般寫入/執行
  if (['Write', 'Edit', 'Bash'].includes(toolName)) return 'medium';

  // low：讀取
  return 'low';
}
```

**必須測試的案例：**
- `rm -rf /tmp/test` → `critical`
- `Write` 到 `.env` 檔案 → `high`
- `Bash` 執行 `ls` → `medium`
- `Read` 任何檔案 → `low`
- `Grep` 任何內容 → `low`

**單元測試（`sidecar/src/hitl/classifier.test.ts`）：**
```typescript
describe('classifyRisk', () => {
  // critical
  it.each([
    ['Bash', { command: 'rm -rf /tmp' }],
    ['Bash', { command: 'delete from users' }],
    ['Bash', { command: 'format c:' }],
    ['Bash', { command: 'truncate -s 0 file.txt' }],
  ])('%s %j → critical', (tool, input) => {
    expect(classifyRisk(tool, input)).toBe('critical');
  });

  // high
  it.each([
    ['Write', { file_path: '.env' }],
    ['Edit',  { file_path: 'config.key' }],
    ['Write', { file_path: 'secrets/api.pem' }],
    ['Write', { file_path: 'password_store.txt' }],
  ])('%s %j → high', (tool, input) => {
    expect(classifyRisk(tool, input)).toBe('high');
  });

  // medium
  it.each([
    ['Write', { file_path: 'src/index.ts' }],
    ['Edit',  { file_path: 'README.md' }],
    ['Bash',  { command: 'ls -la' }],
  ])('%s %j → medium', (tool, input) => {
    expect(classifyRisk(tool, input)).toBe('medium');
  });

  // low
  it.each([
    ['Read', { file_path: 'any.txt' }],
    ['Glob', { pattern: '**/*.ts' }],
    ['Grep', { pattern: 'TODO' }],
  ])('%s %j → low', (tool, input) => {
    expect(classifyRisk(tool, input)).toBe('low');
  });

  // bypass 嘗試（確認無法繞過）
  it('大小寫混用 rM -rf 仍為 critical', () => {
    expect(classifyRisk('Bash', { command: 'rM -rf /tmp' })).toBe('critical');
  });

  it('rm 在 echo 字串中不誤判', () => {
    // "echo 'rm is a command'" 不應為 critical
    expect(classifyRisk('Bash', { command: "echo 'rm is a command'" })).toBe('medium');
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- hitl
npx tsc --noEmit
# 確認 classifier 整合至 Tower MCP auth-tool 後行為一致
```

**完成條件：** 所有測試通過；危險指令攔截率 100%（無 bypass）；`echo 'rm'` 等誤判率為 0。

---

## Task 10：配額管理（Bottleneck）

**前置條件：** Task 03 完成

**目標：** 實作集中式配額調度，含 Rate Limit 三態偵測與漸進式降級。

**產出清單：**
```
sidecar/src/
└── quota/
    ├── index.ts          # 匯出 QuotaManager
    ├── manager.ts        # QuotaManager class（Bottleneck 包裝）
    └── rate-limit.ts     # Rate Limit 三態偵測邏輯
```

**`manager.ts` 核心：**
```typescript
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 5 * 60 * 60 * 1000,  // 5 小時
  highWater: 20,
  strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
});
// Master Orchestrator: priority 0；Worker: priority 1..N
```

**Rate Limit 三態偵測：**
```
捕獲 Rate Limit 錯誤
  → 等待 60–90 秒
  → 重試一次
    成功  → 繼續（突發吞吐限制）
    失敗  → 全部暫停，等待重置（配額耗盡）
    異常訊息 → 記錄 + 通知（非限速 bug）
```

**降級策略：**
- **Agent 暫停**：Rust 透過 IPC 發 `agent:freeze`（`reason: 'quota'`, `immediate: false`）→ Node.js 收到後等當前 turn 完成再暫停子程序
  - Rust 無法直接控制子程序，必須透過 IPC 委託 Node.js 執行
- **model 降級**：純 Rust 內部狀態變更，下次 `agent:start` / `agent:assign` 時直接帶入 Haiku，不需要 IPC

**單元測試（`sidecar/src/quota/manager.test.ts`）：**
```typescript
describe('QuotaManager', () => {
  it('Master Orchestrator priority=0 優先於 Worker priority=1', async () => {
    // 同時排入 Master（priority 0）與 Worker（priority 1）任務
    // 確認 Master 先執行
    const order: string[] = [];
    await Promise.all([
      limiter.schedule({ priority: 1 }, async () => { order.push('worker'); }),
      limiter.schedule({ priority: 0 }, async () => { order.push('master'); }),
    ]);
    expect(order[0]).toBe('master');
  });

  it('Rate Limit 三態：重試成功 → 繼續（突發吞吐）', async () => {
    // 第一次失敗（Rate Limit），等 60s，第二次成功
    // 確認不觸發全部暫停
    const pauseSpy = jest.fn();
    await handleRateLimit({ retry: async () => 'ok', onPause: pauseSpy });
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('Rate Limit 三態：重試仍失敗 → 全部暫停', async () => {
    const pauseSpy = jest.fn();
    await handleRateLimit({ retry: async () => { throw new Error('rate limit'); }, onPause: pauseSpy });
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('Rate Limit 三態：非限速錯誤 → 記錄但不暫停', async () => {
    const pauseSpy = jest.fn();
    const logSpy = jest.fn();
    await handleRateLimit({ retry: async () => { throw new Error('network error'); }, onPause: pauseSpy, onLog: logSpy });
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('agent:freeze(quota) 等當前 turn 完成後才暫停', async () => {
    // immediate: false → 不立即中斷
  });

  it('agent:freeze(orchestrator) 立即中斷', async () => {
    // immediate: true → 立即中斷
  });
});
```

**整合測試：**
```bash
cd sidecar && npm test -- quota
npx tsc --noEmit
# 壓力測試：N=5 個 Agent 並發，確認 Master 永遠最先完成
```

**完成條件：** 優先級正確；Rate Limit 三態誤判率 < 5%；`immediate` flag 行為正確。

---

## Task 11：React UI 骨架（Tauri + Zustand）

**前置條件：** Task 02 完成

**目標：** 建立 React UI 的基本框架，含 Tauri IPC 橋接、Zustand store、整體佈局骨架。

**產出清單：**
```
src/
├── main.tsx                    # React 入口
├── App.tsx                     # 整體佈局（Toolbar + Sidebar + MosaicArea）
├── store/
│   ├── agentStore.ts           # Zustand：訂閱 Tauri agent:* 事件
│   ├── uiStore.ts              # Zustand：UI 視覺狀態（tauri-plugin-store 持久化）
│   └── notificationStore.ts    # Zustand：Toast/Modal 佇列
├── i18n/
│   ├── zh-TW.json              # 繁體中文字串
│   └── en.json                 # English 字串
└── components/
    ├── Toolbar/
    │   └── index.tsx           # 頂部工具列（含「重置佈局」按鈕、「顯示推理樹」toggle）
    ├── Sidebar/
    │   └── index.tsx           # 左側側邊欄（展開/收合，Ctrl+B）
    └── MosaicArea/
        └── index.tsx           # react-mosaic-component 統一管理所有面板
```

**佈局設計：**
- `react-mosaic-component` 統一管理所有面板，包含 AgentPanel × N 與 ReasoningTree
- 預設佈局：AgentPanel 均分上方（70%），ReasoningTree 佔下方（30%）
- 佈局狀態持久化至 `tauri-plugin-store`
- Toolbar 提供：
  - 「重置佈局」按鈕 → 清除 `tauri-plugin-store` 佈局狀態，套用預設值
  - 「顯示推理樹」toggle（預設 on）→ 關閉時 mosaic 空間重新分配給 AgentPanel
- 預設佈局定義為常數供重置時參照：
```typescript
const DEFAULT_MOSAIC_LAYOUT = {
  direction: 'column',
  first: 'agent-panels',   // AgentPanel × N
  second: 'reasoning-tree', // ReasoningTree
  splitPercentage: 70,
}
```

**Zustand store 規則：**
- Store 不持有任何業務邏輯
- Store 只訂閱 Tauri events，更新本地 UI 狀態
- Store 不直接呼叫 Tauri commands（由 UI event handler 呼叫）

**i18n 實作：**
```typescript
// 使用 i18next 或簡單的 context
// 語言切換即時生效，不需重啟
// 預設值：跟隨 navigator.language，zh-TW 優先
```

**單元測試（`src/store/*.test.ts`）：**
```typescript
describe('agentStore', () => {
  it('訂閱 agent:session_start 事件後更新 store', () => {
    // mock Tauri emit
    emitTauriEvent('agent:session_start', { agentId: 'a1', sessionId: 's1' });
    expect(useAgentStore.getState().agents['a1'].sessionId).toBe('s1');
  });

  it('store 不持有業務邏輯，只更新狀態', () => {
    // store 無 async 操作，無直接 invoke
  });
});

describe('uiStore', () => {
  it('重置佈局清除 mosaic 佈局狀態並套用預設值', () => {
    useUiStore.getState().setLayout({ custom: true });
    useUiStore.getState().resetLayout();
    expect(useUiStore.getState().layout).toEqual(DEFAULT_MOSAIC_LAYOUT);
  });

  it('顯示推理樹 toggle 狀態正確切換', () => {
    useUiStore.getState().setShowReasoningTree(false);
    expect(useUiStore.getState().showReasoningTree).toBe(false);
  });
});
```

**整合測試：**
```bash
npm run typecheck
npm run lint
npm run tauri dev
# 確認 Ctrl+B 切換側邊欄
# 確認語言切換即時生效（無需重啟）
# 確認 Toolbar「重置佈局」按鈕可點擊
# 確認「顯示推理樹」toggle 可切換
```

**完成條件：** `tauri dev` 可正常啟動；Ctrl+B 切換側邊欄；語言切換即時生效；重置佈局套用預設值；單元測試全通過。

---

## Task 12：AgentPanel 元件

**前置條件：** Task 11 完成

**目標：** 實作單一 Agent 面板，含訊息流、HITL 審批區、狀態顏色編碼。

**產出清單：**
```
src/components/
└── AgentPanel/
    ├── index.tsx            # AgentPanel 主元件
    ├── MessageStream.tsx    # 訊息流（文字塊 + 工具呼叫卡片）
    ├── HitlReview.tsx       # HITL 審批區（有請求時展開）
    ├── StatusBar.tsx        # 標題列（Agent ID / 狀態 / token 數）
    └── AgentPanel.test.tsx  # 元件測試
```

**面板狀態顏色：**
```
idle         → 灰色邊框（border-gray-300）
running      → 藍色邊框 + 旋轉動畫（border-blue-500）
waiting_hitl → 橘色邊框（border-orange-500），HITL 區自動展開
error        → 紅色邊框（border-red-500）
frozen       → 橘色邊框無動畫（border-orange-300）
```

**工具呼叫卡片格式：**
```
[🔧 {toolName}]  {input 摘要，最多 60 字元}
    → [✓ 完成 {durationMs}ms] / [✗ 失敗]
```

**StatusBar 費用顯示：**
```
costUsd 有值  → 顯示 "$0.0042"
costUsd 為 undefined → 顯示 "—"（Gemini CLI 無費用資料）
```

**HITL 審批區：**
```
風險等級標籤（critical=紅色/high=橘色/medium=黃色）
工具名稱：{toolName}
指令內容：{input 完整顯示}
[批准]  [拒絕]
```

**單元測試（`src/components/AgentPanel/AgentPanel.test.tsx`）：**
```typescript
describe('AgentPanel', () => {
  it.each([
    ['idle',         'border-gray-300'],
    ['running',      'border-blue-500'],
    ['waiting_hitl', 'border-orange-500'],
    ['error',        'border-red-500'],
    ['frozen',       'border-orange-300'],
  ])('狀態 %s 顯示正確邊框顏色 %s', (status, borderClass) => {
    render(<AgentPanel agentId="a1" status={status as AgentStatus} />);
    expect(screen.getByTestId('agent-panel')).toHaveClass(borderClass);
  });

  it('waiting_hitl 時 HITL 區自動展開', () => {
    render(<AgentPanel agentId="a1" status="waiting_hitl" hitlRequest={{ riskLevel: 'high', ... }} />);
    expect(screen.getByTestId('hitl-review')).toBeVisible();
  });

  it('無 HITL 請求時 HITL 區不顯示', () => {
    render(<AgentPanel agentId="a1" status="running" hitlRequest={null} />);
    expect(screen.queryByTestId('hitl-review')).not.toBeInTheDocument();
  });

  it('工具卡片 input 摘要最多 60 字元', () => {
    const longInput = 'x'.repeat(100);
    render(<ToolCallCard toolName="Bash" input={{ command: longInput }} />);
    const summary = screen.getByTestId('tool-input-summary').textContent!;
    expect(summary.length).toBeLessThanOrEqual(60);
  });

  it('StatusBar costUsd 有值時顯示金額', () => {
    render(<StatusBar agentId="a1" costUsd={0.0042} />);
    expect(screen.getByText('$0.0042')).toBeInTheDocument();
  });

  it('StatusBar costUsd 為 undefined 時顯示 —', () => {
    render(<StatusBar agentId="a1" costUsd={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

**整合測試：**
```bash
npm run typecheck
npm run test -- AgentPanel
npm run tauri dev
# 確認所有狀態顏色正確渲染
# 確認 HITL 審批區有請求時展開，無請求時隱藏
# 確認 [批准] / [拒絕] 按鈕呼叫正確 Tauri command
```

**完成條件：** 狀態顏色正確；HITL 區自動展開；工具卡片摘要 ≤ 60 字元；costUsd 顯示邏輯正確。

---

## Task 13：ReasoningTree（React Flow DAG）

**前置條件：** Task 11 完成

**目標：** 實作推理樹 DAG 視覺化，含節點建立、狀態更新、Agent 切換、Git 快照面板。

**產出清單：**
```
src/components/
└── ReasoningTree/
    ├── index.tsx              # ReasoningTree 主元件
    ├── ReasoningNode.tsx      # 自訂節點元件（memo 包裝）
    ├── useReasoningTree.ts    # Hook：從 agentStore 建立 nodes/edges
    └── GitSnapshotPanel.tsx   # 右側 Git 快照面板（含一鍵回滾）
```

**效能規則（必須遵守）：**
```typescript
// 必須 memo 包裝自訂節點
const ReasoningNode = memo(({ data }: NodeProps<ReasoningNodeData>) => { ... });

// 使用精確選擇器，不用 useStore(s => s.nodes)
const selectedNodeId = useReasoningTreeStore(s => s.selectedNodeId);

// 不在 <ReactFlow> props 中傳匿名函式
const onNodeClick = useCallback((_, node) => { ... }, []);
```

**節點型別與顏色：**
```
thought      → 白色背景，黑色文字
tool_call    → 藍色背景（pending 時閃爍）
tool_result  → 綠色邊框（成功）/ 紅色邊框（失敗）
decision     → 紫色背景
error        → 紅色背景
```

**Agent 切換：** 下拉選單切換 Agent 時，保留各 Agent 的 viewport 狀態（縮放 + 位移）。

**單元測試（`src/components/ReasoningTree/useReasoningTree.test.ts`）：**
```typescript
describe('useReasoningTree', () => {
  it('從 agentStore 正確建立 nodes 與 edges', () => {
    // mock agentStore 含 3 個節點
    const { nodes, edges } = renderHook(() => useReasoningTree('a1')).result.current;
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2); // parent-child 連線
  });

  it('切換 Agent 時保留各自 viewport 狀態', () => {
    // 切換到 a2，再切回 a1，viewport 與切換前相同
  });

  it('ReasoningNode 以 memo 包裝，父層重渲不觸發子節點重渲', () => {
    const renderCount = trackRenderCount(ReasoningNode);
    // 觸發不相關的父層狀態更新
    expect(renderCount).toBe(1); // 未重渲
  });
});
```

**整合測試：**
```bash
npm run typecheck
npm run tauri dev
# 手動壓力測試：建立 450 個節點，確認可拖動互動（目標 60 FPS）
# 確認 Agent 切換 < 100ms（DevTools Performance）
# 確認快照 SHA 點擊後觸發 rollback_to_node Tauri command
# 確認「顯示推理樹」關閉時 ReasoningTree 從 mosaic 移除
```

**完成條件：** Agent 切換 < 100ms；450 節點流暢互動（60 FPS）；快照 SHA 可點擊觸發回滾；`memo` 防止不必要重渲。

---

## Task 14：SQLite 持久層

**前置條件：** Task 02 完成

**目標：** 實作推理節點歷史與 HITL 記錄的 SQLite 持久化。

**產出清單：**
```
src-tauri/src/
└── db/
    ├── mod.rs          # 匯出所有 DB 函式
    ├── schema.rs       # 建表 SQL（初始化時執行）
    ├── nodes.rs        # 推理節點 CRUD
    └── hitl.rs         # HITL 記錄 CRUD
```

**Schema：**
```sql
-- 推理節點
CREATE TABLE reasoning_nodes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  node_type TEXT NOT NULL,        -- thought/tool_call/tool_result/decision/error
  content TEXT NOT NULL,          -- JSON
  status TEXT NOT NULL,           -- pending/active/completed/failed/frozen
  git_snapshot_sha TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- HITL 記錄（審計日誌）
CREATE TABLE hitl_records (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,            -- JSON
  risk_level TEXT NOT NULL,
  approved INTEGER NOT NULL,      -- 0/1
  modified_input TEXT,            -- JSON，若審批時修改了輸入
  reason TEXT,
  decided_by TEXT NOT NULL,       -- 'human' / 'orchestrator_b_mode'
  created_at INTEGER NOT NULL
);
```

**WAL 模式啟用（必須）：**
```rust
// DB 初始化時執行
db.execute("PRAGMA journal_mode=WAL")?;
db.execute("PRAGMA synchronous=NORMAL")?;
```

**單元測試（`src-tauri/src/db/`）：**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn wal_mode_enabled_on_init() {
        let dir = tempdir().unwrap();
        let db = init_db(dir.path()).await.unwrap();
        let mode: String = db.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
    }

    #[tokio::test]
    async fn insert_reasoning_node_and_query_back() {
        let db = setup_test_db().await;
        let node = ReasoningNode { id: "n1".into(), node_type: "thought".into(), ... };
        db::nodes::insert(&db, &node).await.unwrap();
        let fetched = db::nodes::get(&db, "n1").await.unwrap();
        assert_eq!(fetched.id, "n1");
    }

    #[tokio::test]
    async fn hitl_record_decided_by_field() {
        let db = setup_test_db().await;
        let record = HitlRecord { decided_by: "human".into(), approved: true, ... };
        db::hitl::insert(&db, &record).await.unwrap();
        let fetched = db::hitl::get(&db, &record.id).await.unwrap();
        assert_eq!(fetched.decided_by, "human");
    }

    #[tokio::test]
    async fn concurrent_writes_no_lock_conflict() {
        // 5 個 tokio task 同時寫入，確認無 SQLITE_BUSY
        let db = Arc::new(setup_test_db().await);
        let handles: Vec<_> = (0..5).map(|i| {
            let db = db.clone();
            tokio::spawn(async move {
                db::nodes::insert(&db, &make_node(i)).await.unwrap();
            })
        }).collect();
        for h in handles { h.await.unwrap(); }
    }

    #[tokio::test]
    async fn write_throughput_exceeds_50k_per_sec() {
        let db = setup_test_db().await;
        let start = std::time::Instant::now();
        for i in 0..50_000 {
            db::nodes::insert(&db, &make_node(i)).await.unwrap();
        }
        assert!(start.elapsed().as_secs() < 1);
    }
}
```

**整合測試：**
```bash
cargo test --manifest-path src-tauri/Cargo.toml db::
# 確認 DB 路徑在 ~/.orchestrator/projects/{id}/agent.db
# 確認多專案並發時各自使用獨立 DB 檔案
```

**完成條件：** WAL 模式啟用；寫入速度 > 50K inserts/sec；並發無鎖衝突；DB 路徑符合規範。

---

## Task 15：崩潰恢復與 Session 恢復

**前置條件：** Task 05、Task 08、Task 14 完成

**目標：** 實作 Node.js Sidecar 崩潰後的自動恢復，以及任務跨 session 的狀態恢復。

**產出清單：**
```
sidecar/src/
└── recovery/
    ├── index.ts           # 匯出 RecoveryManager
    ├── task-state.ts      # 任務狀態 JSON 讀寫
    └── session-resume.ts  # --resume 參數注入邏輯

src-tauri/src/
└── recovery/
    ├── mod.rs             # Rust 端崩潰偵測與恢復驅動
    └── state-rebuild.rs   # 從 Git 快照重建 AgentState
```

**任務狀態 JSON（`~/.orchestrator/projects/{id}/tasks/{task-id}.json`）：**
```typescript
interface TaskState {
  taskId: string
  agentId: string
  projectId: string
  prompt: string
  lastCompletedNodeId: string | null
  lastGitSha: string | null
  startedAt: number
  updatedAt: number
}
```

**恢復流程：**
```
Sidecar 崩潰（Rust 偵測到 IPC 斷線，超過 3s 無心跳）
// 心跳機制：
// - Node.js Sidecar 啟動後每 1s 透過 IPC 發送 { type: 'heartbeat' }
// - Rust 維護 last_heartbeat_at timestamp，每 500ms 檢查一次
// - 超過 3s 未更新 → 觸發重啟流程（3s 窗口內正常情況下有 2–3 次心跳）
  → Rust 遍歷 AppState.agents，對所有孤兒 Worker 程序發送 SIGKILL
  → 等待 2s 確認孤兒程序清除
  → Rust 用 Tauri Command::new("binaries/sidecar") 重啟 Sidecar
  → Rust 讀取 TaskState JSON
  → 重建 AgentState（從 Git SHA + SQLite nodes）
  → 向新 Sidecar 發送 agent:start 指令
    （含 --resume {session_id} 若有前次 session_id）
```

> **注意**：Worker 子程序（Claude Code CLI）在 Sidecar 崩潰後成為孤兒程序，繼續消耗 API quota 但無人接收輸出。
> 必須在重啟前強制清除，不可讓孤兒程序繼續執行。

**單元測試：**
```rust
// src-tauri/src/recovery/state-rebuild.rs
#[tokio::test]
async fn rebuild_agent_state_from_git_sha_and_sqlite() {
    // 給定 git SHA + SQLite nodes，確認 AgentState 正確重建
    let state = rebuild_agent_state("a1", "abc123", &db).await.unwrap();
    assert_eq!(state.id, "a1");
    assert!(state.worktree_path.exists());
}

#[tokio::test]
async fn ipc_disconnect_detected_within_3s() {
    // mock Sidecar 斷線，確認 Rust 在 3s 內偵測到
    let detected = timeout(Duration::from_secs(3), wait_for_disconnect()).await;
    assert!(detected.is_ok());
}
```

```typescript
// sidecar/src/recovery/task-state.test.ts
describe('TaskState', () => {
  it('每個節點完成後 100ms 內寫入 JSON', async () => {
    const start = Date.now();
    await writeTaskState({ taskId: 't1', lastCompletedNodeId: 'n5', ... });
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('TaskState JSON 路徑符合規範', () => {
    const path = getTaskStatePath('proj1', 'task-42');
    expect(path).toMatch(/\.orchestrator\/projects\/proj1\/tasks\/task-42\.json$/);
  });
});
```

**整合測試：**
```bash
cargo test --manifest-path src-tauri/Cargo.toml recovery::
cd sidecar && npm test -- recovery
# 端對端：強制 kill Sidecar（kill -9 {pid}）
# 確認 Rust 在 3s 內偵測斷線
# 確認 Rust SIGKILL 所有孤兒 Worker 程序
# 確認新 Sidecar 啟動並恢復任務
# 確認有快照時 Agent 從正確 Git SHA 繼續
```

**完成條件：** 崩潰後 < 3s 重啟；孤兒程序在重啟前清除；有快照時任務恢復率 > 95%；TaskState JSON 寫入 < 100ms。

---

## Task 16：專案與 Agent 生命週期管理

**前置條件：** Task 02、Task 08、Task 14 完成

**目標：** 實作專案與 Agent 的建立、刪除流程，含 `projects.json` 維護與 Worktree 管理。

**產出清單：**
```
src-tauri/src/
└── lifecycle/
    ├── mod.rs           # 匯出所有生命週期函式
    ├── project.rs       # create_project / delete_project
    ├── agent.rs         # create_agent / remove_agent
    └── projects_json.rs # projects.json atomic read/write
```

**`projects.json` 路徑與格式：**
```
~/.orchestrator/projects.json
```
```json
{
  "version": 1,
  "projects": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "my-app",
      "path": "/home/user/my-app",
      "createdAt": "2026-03-14T10:00:00Z"
    }
  ]
}
```

**`projects_json.rs` atomic write 實作：**
```rust
// 先寫 ~/.orchestrator/projects.json.tmp
// 再 std::fs::rename（同一 filesystem 上 rename 是 atomic）
// 使用 fs2::FileExt::lock_exclusive 防止並發寫入
pub fn write_projects(projects: &[Project]) -> Result<()>
pub fn read_projects() -> Result<Vec<Project>>
```

**`project.rs` — create_project 流程：**
```
1. 驗證 path 存在且為 Git repo（git rev-parse --git-dir）
2. 生成 projectId（UUID v4）
3. 建立 ~/.orchestrator/projects/{id}/
4. 初始化 agent.db（WAL 模式，建立 schema）
5. atomic write 更新 projects.json
6. 回傳 projectId
```

**`project.rs` — delete_project 流程：**
```
1. 確認所有 Agent 均為 idle（否則回傳 error:agents_still_running）
2. 對每個 Agent 執行 remove_agent 流程
3. 刪除 ~/.orchestrator/projects/{id}/ 整個目錄
4. atomic write 更新 projects.json（移除該專案）
```

**`agent.rs` — create_agent 流程：**
```
1. 生成 agentId（UUID v4）
2. git worktree add {projectPath}/.trees/agent-{agentId} HEAD
3. 寫入 AppState.agents（記憶體）
4. 寫入 agent.db（初始 reasoning_node 記錄）
5. 透過 IPC 發 agent:start 給 Node.js
```

**`agent.rs` — remove_agent 流程：**
```
1. 確認 Agent 狀態為 idle（否則回傳 error:agent_still_running）
2. 透過 IPC 發 agent:stop 給 Node.js，等待確認
3. 從 AppState.agents 移除
4. git worktree remove --force {projectPath}/.trees/agent-{agentId}
5. agent.db 標記 Agent 為 deleted（軟刪除，保留 reasoning_nodes 歷史）
```

> **軟刪除**：`reasoning_nodes` 不實際刪除，供事後審計。
> `agent.db` 新增 `agents` 表記錄每個 agentId 的狀態，`deleted_at` 欄位非 null 表示已刪除。

**新增 `agents` 表 schema（補充至 Task 14）：**
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,           -- agentId（UUID v4）
  project_id TEXT NOT NULL,
  model TEXT NOT NULL,
  priority INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER             -- null 表示仍活躍，非 null 表示已刪除
);
```

**Tauri commands（補充至 Task 02 commands.rs）：**
```rust
#[tauri::command] pub async fn create_project(path: String, name: String) -> Result<String, String>
#[tauri::command] pub async fn delete_project(project_id: String) -> Result<(), String>
#[tauri::command] pub async fn create_agent(project_id: String, prompt: String, model: String) -> Result<String, String>
#[tauri::command] pub async fn remove_agent(agent_id: String) -> Result<(), String>
#[tauri::command] pub async fn list_projects() -> Result<Vec<Project>, String>
```

**單元測試：**
```rust
#[tokio::test]
async fn create_project_writes_projects_json() {
    let dir = tempdir().unwrap();
    // mock Git repo
    create_project(dir.path().to_str().unwrap(), "test").await.unwrap();
    let projects = read_projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "test");
}

#[tokio::test]
async fn delete_project_rejects_running_agents() {
    // Agent 狀態為 Running 時，delete_project 回傳 error
    let err = delete_project("proj-1").await.unwrap_err();
    assert!(err.contains("agents_still_running"));
}

#[tokio::test]
async fn remove_agent_soft_deletes_db_record() {
    // remove_agent 後 agents 表 deleted_at 非 null
    remove_agent("agent-1").await.unwrap();
    let agent = query_agent_record("agent-1").await.unwrap();
    assert!(agent.deleted_at.is_some());
}

#[tokio::test]
async fn concurrent_project_writes_no_corruption() {
    // 5 個 task 同時 create_project，確認 projects.json 不損壞
    let handles: Vec<_> = (0..5).map(|i| {
        tokio::spawn(async move { create_project(&format!("/tmp/repo-{i}"), &format!("proj-{i}")).await })
    }).collect();
    for h in handles { h.await.unwrap().unwrap(); }
    let projects = read_projects().unwrap();
    assert_eq!(projects.len(), 5);
}
```

**整合測試：**
```bash
cargo test --manifest-path src-tauri/Cargo.toml lifecycle::
# 手動：建立 3 個專案，各新增 1/2/3 個 Agent
# 確認 projects.json 正確反映 3 個專案
# 確認 .trees/ 目錄結構正確
# 確認刪除專案時有 Agent running 被拒絕
# 確認刪除後 projects.json 移除對應記錄
```

**完成條件：** `projects.json` atomic write 無損壞；有 Agent running 時拒絕刪除；軟刪除保留歷史；並發建立專案無競爭條件。

---

# 附錄：開發環境建置

## 環境驗證清單

```bash
node --version      # v22.22.0
npm --version       # 10.9.4
git --version       # git version 2.43.0+
npx tauri --version # tauri-cli 2.10.1
cargo --version     # 任意穩定版
```

## Git 前置設定（Worktree 效能）

```bash
git config --global core.fsmonitor true
git config --global core.splitIndex true
git config --global gc.auto 0        # 停用自動 GC，改為排程
```

## 打包（終端使用者發佈）

Node.js Sidecar 使用 `@yao-pkg/pkg` 編譯為獨立二進位（使用者不需安裝 Node.js）：

```bash
# Linux
cd sidecar && npm run build:linux
# → src-tauri/binaries/sidecar-x86_64-unknown-linux-gnu

# Windows
cd sidecar && npm run build:win
# → src-tauri/binaries/sidecar-x86_64-pc-windows-msvc.exe

# 最終打包
npx tauri build
# Linux：orchestrator-tower_amd64.deb + .AppImage
# Windows：OrchestratorTower_x64.exe (NSIS)
```

> Claude Code CLI 與 Gemini CLI 仍需使用者另外安裝，無法內嵌。

---

*— 文件結束 —*
