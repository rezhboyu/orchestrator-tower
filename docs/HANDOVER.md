# Orchestrator Tower - 專案交接文檔

> 最後更新：2026-03-15

## 專案概述

Orchestrator Tower 是一個桌面端 AI 代理管理系統，採用四層架構：

```
[React UI]  ──Tauri IPC──▶  [Rust Core]  ──IPC──▶  [Node.js Sidecar]  ──stdout──▶  [Claude Code CLI]
  唯讀顯示                   唯一狀態權威              子程序管理                        實際執行任務
```

**核心原則**：狀態只在 Rust 寫，Node.js 無狀態，React 只讀。

---

## 已完成任務

| Task | 說明 | PR | 狀態 |
|------|------|-----|------|
| 01 | 專案骨架初始化 | - | ✅ 完成 |
| 02 | Rust AppState 與 Tauri Commands 骨架 | - | ✅ 完成 |
| 03 | Node.js ↔ Rust IPC 通道 | ✅ 已合併 | ✅ 完成 |
| 04 | stream-json 解析器 | ✅ 已合併 | ✅ 完成 |
| 08 | Git Worktree + Shadow Branch 快照 | ✅ 已合併 | ✅ 完成 |
| 14 | SQLite 持久層 | ✅ 已合併 | ✅ 完成 |

---

## 程式碼結構

```
orchestrator-tower/
├── src/                          # React UI (TypeScript)
│   └── ...
├── src-tauri/                    # Rust Core
│   └── src/
│       ├── lib.rs                # Tauri 入口
│       ├── commands.rs           # Tauri Commands (todo!() 骨架)
│       ├── state.rs              # AppState, AgentState, QuotaState
│       ├── git/                  # Task 08: Git Worktree
│       │   ├── mod.rs            # run_git, cleanup_old_refs
│       │   ├── worktree.rs       # Worktree 建立/鎖定
│       │   ├── snapshot.rs       # Shadow Branch 快照
│       │   ├── crash_commit.rs   # Crash commit 寫入
│       │   └── rollback.rs       # 安全重置 (--keep)
│       ├── ipc/                  # Task 03: IPC Server
│       │   ├── mod.rs            # Unix Socket / Named Pipe Server
│       │   └── messages.rs       # SidecarEvent, RustCommand
│       └── db/                   # Task 14: SQLite
│           ├── mod.rs            # Database 包裝, WAL 模式
│           ├── schema.rs         # CREATE TABLE SQL
│           ├── models.rs         # ReasoningNode, HitlRecord, AgentRecord
│           ├── nodes.rs          # ReasoningNode CRUD
│           └── hitl.rs           # HitlRecord CRUD
└── sidecar/                      # Node.js Sidecar
    └── src/
        ├── index.ts              # Sidecar 入口
        ├── ipc/                  # Task 03: IPC Client
        │   ├── index.ts          # 模組匯出
        │   ├── client.ts         # IpcClient 類別
        │   ├── messages.ts       # TypeScript 型別定義
        │   ├── platform.ts       # 跨平台 socket 路徑
        │   └── client.test.ts    # 10 個測試
        └── stream-parser/        # Task 04: Stream Parser
            ├── index.ts          # 模組匯出
            ├── types-claude.ts   # Claude stream-json 型別
            ├── types-gemini-acp.ts # Gemini ACP JSON-RPC 型別
            ├── normalize.ts      # NormalizedEvent 統一格式
            ├── claude-parser.ts  # Claude 解析器
            ├── gemini-acp-parser.ts # Gemini 解析器
            ├── line-buffer.ts    # NDJSON 分行處理
            ├── process-guard.ts  # 掛起防護 (SIGTERM/SIGKILL)
            └── parser.test.ts    # 19 個測試
```

---

## 測試狀態

### Rust (cargo test)
```
running 50 tests
- db: 22 tests (WAL, CRUD, 50K inserts/sec)
- git: 14 tests (worktree, snapshot, crash commit)
- ipc: 11 tests (messages, heartbeat)
- state: 3 tests
```

### Node.js (npm test)
```
29 tests passed
- ipc/client.test.ts: 10 tests
- stream-parser/parser.test.ts: 19 tests (11 規格 + 8 額外)
```

---

## 下一步工作 (依賴關係)

根據 CLAUDE.md 的依賴圖，現在可以開始：

### 優先推薦

| Task | 說明 | 依賴 | 理由 |
|------|------|------|------|
| **05** | Worker Agent 子程序管理 | T03, T04 ✅ | 核心功能，解鎖 Task 15 |
| **06** | Tower MCP Server (3701) | T03 ✅ | HITL 審批入口 |
| **16** | 專案/Agent 生命週期 | T08, T14 ✅ | projects.json CRUD |

### 其他可開始

| Task | 說明 | 依賴 |
|------|------|------|
| 07 | State MCP Server (3702) | T03 ✅ |
| 09 | HITL 風險分類引擎 | T06 |
| 10 | 配額管理 (Bottleneck) | T03 ✅ |
| 11 | React UI 骨架 | T02 ✅ |
| 15 | 崩潰恢復與 Session 恢復 | T05, T08 ✅ |

---

## 技術細節

### IPC 協議

**Socket 路徑**：
- Linux: `/tmp/orchestrator-tower-ipc.sock`
- Windows: `\\.\pipe\orchestrator-tower-ipc`

**訊息格式**：NDJSON (每行一個 JSON)

**RustCommand 類型**：
- `agent:start`, `agent:stop`, `agent:assign`
- `agent:freeze`, `agent:unfreeze`
- `hitl:response`

**SidecarEvent 類型**：
- `session_start`, `session_end`
- `text_delta`, `tool_call`, `tool_result`
- `hitl:request`, `agent:crash`
- `heartbeat`

### Stream Parser

**NormalizedEvent 類型** (兩個解析器統一輸出)：
- `session_start`, `session_end`
- `text_delta`, `tool_call`, `tool_result`
- `permission_request`

**掛起防護**：
```
收到 result → 等 2s → SIGTERM → 等 3s → SIGKILL
```

### SQLite

**WAL 模式**：啟用，支援 50K inserts/sec

**資料表**：
- `reasoning_nodes`: 推理節點歷史
- `hitl_records`: HITL 審計日誌
- `agents`: Agent 生命週期

**路徑**：`~/.orchestrator/projects/{id}/agent.db`

### Git Plumbing

**禁止使用**：`git commit`, `git checkout`, `git reset --hard`

**允許使用**：
- `git add -A` (唯一例外的 Porcelain)
- `git write-tree`, `git commit-tree`, `git update-ref`
- `git reset --keep`

**命名約定**：
- Worktree: `{root}/.trees/agent-{id}/`
- Shadow Branch: `refs/heads/__orch_shadow_{proj}_{agent}`
- Snapshot Ref: `refs/orchestrator/{proj}/node-{node}`

---

## 已知的 TODO

| 位置 | 說明 |
|------|------|
| `git/mod.rs:212-215` | projectId/agentId 包含底線的邊界情況 |
| `state.rs:31, 88` | `AgentState::new`, `with_ports` 待後續 Task 使用 |
| `db/agents.rs` | AgentRecord CRUD 缺失，待 Task 16 補齊 |
| `ipc/mod.rs:334-338` | IPC Query 未實作，待 Task 07 |

---

## 驗證命令

```bash
# Rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# Node.js
cd sidecar && npx tsc --noEmit && npm test

# 完整啟動
npm run tauri dev
```

---

## 參考文件

- `CLAUDE.md` - 每次任務前必讀
- `Orchestrator_Tower_Spec_v2.md` - 完整技術規格
