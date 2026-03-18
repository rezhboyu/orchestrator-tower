# Orchestrator Tower - 專案交接文檔

> 最後更新：2026-03-18

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
| 05 | Worker Agent 子程序管理 | ✅ 已合併 | ✅ 完成 |
| 06 | Tower MCP Server (3701) | ✅ 已合併 | ✅ 完成 |
| 07 | State MCP Server (3702) | ✅ 已合併 | ✅ 完成 |
| 08 | Git Worktree + Shadow Branch 快照 | ✅ 已合併 | ✅ 完成 |
| 09 | HITL 風險分類引擎 | ✅ 已合併 | ✅ 完成 |
| 10 | 配額管理 (Bottleneck) | ✅ 已合併 | ✅ 完成 |
| 11 | React UI 骨架 | ✅ 已合併 | ✅ 完成 |
| 12 | AgentPanel 元件 | PR #3 待合併 | 🔄 程式碼完成 |
| 13 | ReasoningTree (React Flow) | PR #3 待合併 | 🔄 程式碼完成 |
| 14 | SQLite 持久層 | ✅ 已合併 | ✅ 完成 |

---

## 程式碼結構

```
orchestrator-tower/
├── src/                          # React UI (TypeScript)
│   ├── components/
│   │   ├── AgentPanel/           # Task 12: Agent 訊息流與 HITL
│   │   │   ├── index.tsx         # 主容器 + Tab 切換
│   │   │   ├── StatusBar.tsx     # 狀態列
│   │   │   ├── MessageStream.tsx # 訊息流
│   │   │   ├── HitlReview.tsx    # HITL 審批區
│   │   │   └── AgentPanel.test.tsx # 8 個測試
│   │   ├── ReasoningTree/        # Task 13: React Flow DAG
│   │   │   ├── index.tsx         # React Flow 容器
│   │   │   ├── ReasoningNode.tsx # 自訂節點 (memo)
│   │   │   ├── useReasoningTree.ts # Hook (dagre 佈局)
│   │   │   ├── GitSnapshotPanel.tsx # 回滾面板
│   │   │   └── ReasoningTree.test.tsx # 9 個測試
│   │   ├── MosaicArea/           # Task 11: 面板佈局
│   │   ├── Sidebar/              # Task 11: 側邊欄
│   │   └── Toolbar/              # Task 11: 工具列
│   ├── store/
│   │   ├── agentStore.ts         # Agent 狀態 + Tauri 事件訂閱
│   │   ├── uiStore.ts            # UI 狀態 (Mosaic 佈局)
│   │   └── notificationStore.ts  # 通知狀態
│   ├── i18n/                     # 多語言 (en, zh-TW)
│   └── types/events.ts           # Tauri 事件型別
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
│       ├── ipc/                  # Task 03, 07: IPC Server
│       │   ├── mod.rs            # Unix Socket / Named Pipe Server
│       │   ├── messages.rs       # SidecarEvent, RustCommand
│       │   └── handler.rs        # IPC Query Handler
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
        ├── stream-parser/        # Task 04: Stream Parser
        │   ├── index.ts          # 模組匯出
        │   ├── types-claude.ts   # Claude stream-json 型別
        │   ├── types-gemini-acp.ts # Gemini ACP JSON-RPC 型別
        │   ├── normalize.ts      # NormalizedEvent 統一格式
        │   ├── claude-parser.ts  # Claude 解析器
        │   ├── gemini-acp-parser.ts # Gemini 解析器
        │   ├── line-buffer.ts    # NDJSON 分行處理
        │   ├── process-guard.ts  # 掛起防護 (SIGTERM/SIGKILL)
        │   └── parser.test.ts    # 19 個測試
        ├── agent-manager/        # Task 05: Agent Manager
        │   ├── index.ts          # 模組匯出
        │   ├── agent-manager.ts  # AgentManager 核心類別
        │   ├── cli-detector.ts   # CLI 路徑偵測
        │   ├── spawn-worker.ts   # Worker Agent 啟動
        │   ├── spawn-master.ts   # Master Orchestrator 啟動
        │   ├── types.ts          # 型別定義
        │   └── agent-manager.test.ts # 22 個測試
        ├── hitl/                 # Task 09: HITL Classifier
        │   ├── classifier.ts     # 風險分類引擎
        │   └── classifier.test.ts # 62 個測試
        ├── quota/                # Task 10: Quota Manager
        │   ├── index.ts          # 模組匯出
        │   ├── manager.ts        # QuotaManager (Bottleneck)
        │   ├── rate-limit.ts     # Rate Limit 三態偵測
        │   └── manager.test.ts   # 25 個測試
        ├── mcp-servers/tower/    # Task 06: Tower MCP Server
        │   ├── index.ts          # 模組匯出與啟動函數
        │   ├── server.ts         # Express + MCP SDK 整合
        │   ├── auth-tool.ts      # mcp__tower__auth 工具
        │   ├── pending-manager.ts # HITL 請求管理
        │   ├── port-finder.ts    # 可用 port 探測
        │   ├── types.ts          # 型別定義
        │   └── tower.test.ts     # 35 個測試
        └── mcp-servers/state/    # Task 07: State MCP Server
            ├── index.ts          # 模組匯出
            ├── server.ts         # Express + MCP SDK 整合
            ├── tools.ts          # 8 個 MCP 工具
            ├── types.ts          # 型別定義
            └── state.test.ts     # 24 個測試
```

---

## 測試狀態

### Rust (cargo test)
```
running 55 tests
- db: 22 tests (WAL, CRUD, 50K inserts/sec)
- git: 14 tests (worktree, snapshot, crash commit)
- ipc: 16 tests (messages, heartbeat, handler)
- state: 3 tests
```

### Node.js Sidecar (cd sidecar && npm test)
```
197 tests passed
- ipc/client.test.ts: 10 tests
- stream-parser/parser.test.ts: 19 tests
- agent-manager/agent-manager.test.ts: 22 tests
- hitl/classifier.test.ts: 62 tests
- quota/manager.test.ts: 25 tests
- mcp-servers/tower/tower.test.ts: 35 tests
- mcp-servers/state/state.test.ts: 24 tests
```

### React UI (npm test)
```
40 tests passed (PR #3 合併後)
- store/agentStore.test.ts: 9 tests
- store/uiStore.test.ts: 6 tests
- components/__tests__/Sidebar.test.tsx: 5 tests
- components/AgentPanel/AgentPanel.test.tsx: 8 tests (PR #3)
- components/ReasoningTree/ReasoningTree.test.tsx: 9 tests (PR #3)
```

---

## 下一步工作

### 待合併

| Task | 說明 | PR | 動作 |
|------|------|-----|------|
| 12 | AgentPanel 元件 | PR #3 | `gh pr merge 3 --squash` |
| 13 | ReasoningTree | PR #3 | (同上) |

### 剩餘任務

| Task | 說明 | 依賴 | 主要產出 |
|------|------|------|----------|
| **15** | 崩潰恢復與 Session 恢復 | T05 ✅, T08 ✅, T14 ✅ | Sidecar crash 後 3s 重啟，孤兒清除 |
| **16** | 專案與 Agent 生命週期管理 | T08 ✅ | `projects.json` CRUD |

### 建議執行順序

1. **合併 PR #3** → 更新 CLAUDE.md (T12, T13 標記完成)
2. **做 Task 16** — 專案生命週期，相對獨立
3. **做 Task 15** — 崩潰恢復，最複雜，涉及多層整合

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
- `agent:session_start`, `agent:session_end`
- `agent:text`, `agent:tool_use`, `agent:tool_result`
- `agent:stream_delta`, `agent:crash`
- `hitl:request`, `heartbeat`

### Tower MCP Server (Task 06)

**端點**：`http://localhost:3701/mcp/:agentId`

**auth tool 協議**：
```
輸入: { tool_name, tool_use_id, input }
輸出 (允許): { behavior: 'allow', updatedInput }
輸出 (拒絕): { behavior: 'deny', message }
```

**風險分類**：
- `critical`: rm/delete/drop/format/truncate, git reset --hard
- `high`: .env/.key/.pem/.secret 寫入
- `medium`: Write/Edit/Bash
- `low`: Read/Glob/Grep (自動批准)

### State MCP Server (Task 07)

**端點**：`http://localhost:3702/mcp`

**8 個工具**：
- `get_worker_status` - 查詢 Worker 狀態
- `assign_task` - 指派任務給 Worker
- `pause_worker` - 暫停 Worker
- `resume_worker` - 恢復 Worker
- `approve_hitl` - 批准 HITL (需 B mode)
- `deny_hitl` - 拒絕 HITL (需 B mode)
- `get_quota_status` - 查詢配額狀態
- `get_git_snapshot` - 查詢 Git 快照

**B Mode 保護**：`approve_hitl` 和 `deny_hitl` 在 B mode 關閉時返回 403。

### HITL Risk Classifier (Task 09)

**風險等級** (增強版)：
- `critical`: rm/delete/drop/format/truncate/unlink/rmdir, git reset --hard, dd, mkfs
- `high`: .env/.key/.pem/.secret/.credential/.token/.password 寫入
- `medium`: Write/Edit/Bash (非以上)
- `low`: Read/Glob/Grep (自動批准)

**引號感知**：防止 `echo 'rm'` 誤判為 critical

### Quota Manager (Task 10)

**Bottleneck 配置**：
- `maxConcurrent`: 2
- `minTime`: 2000ms
- `reservoir`: 100
- `strategy`: OVERFLOW_PRIORITY

**優先級**：Master = 0, Worker = 1, 2, 3...

**Rate Limit 三態**：
1. 首次錯誤 → 等待 60-90s → 重試
2. 重試成功 → 繼續 (突發限流)
3. 重試失敗 → 凍結所有 Agent (配額耗盡)

### Agent Manager (Task 05)

**CLI 偵測優先順序**：
1. 環境變數 `ORCHESTRATOR_CLAUDE_PATH` / `ORCHESTRATOR_GEMINI_PATH`
2. `which`/`where` 命令
3. `~/.local/bin/claude`
4. `~/.npm-global/bin/`
5. `npm root -g` 動態查詢

**Windows 支援**：
- Claude Code 需透過 Git Bash 執行
- Gemini CLI 可直接執行 (gemini.cmd)

### Stream Parser

**NormalizedEvent 類型** (兩個解析器統一輸出)：
- `session_start`, `session_end`
- `text_delta`, `tool_call`, `tool_result`
- `permission_request`

**掛起防護**：
```
收到 result → 等 2s → SIGTERM → 等 3s → SIGKILL
```

### React UI (Task 11-13)

**狀態管理**：Zustand + Tauri 事件訂閱

**AgentPanel** (Task 12)：
- Tab 切換多 Agent
- 狀態邊框顏色：idle(灰), running(藍), waiting_hitl(橙), error(紅), frozen(淺橙)
- MessageStream：text/tool_use/tool_result 訊息流
- HitlReview：風險等級標籤 + 批准/拒絕按鈕

**ReasoningTree** (Task 13)：
- React Flow + dagre 自動佈局
- 節點類型：thought, tool_call, tool_result, decision, error
- Viewport 在 Agent 切換時保留
- GitSnapshotPanel 支援回滾

**已知 Bug 修復**：
- Zustand selector 無限迴圈 → 使用穩定空陣列引用
- Mosaic Split 重複 ID → 移除 Split 按鈕
- favicon.ico 404 → 新增 public/favicon.ico
- 無效佈局持久化 → validateMosaicLayout 自動重置

### Tailwind CSS v4 配置

**PostCSS 配置** (postcss.config.js)：
```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

**注意**：Tailwind CSS v4 將 PostCSS 插件移至 `@tailwindcss/postcss`。

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

| 位置 | 說明 | 狀態 |
|------|------|------|
| `cli-detector.ts:228` | macOS Keychain 的 service 名稱確認 | 待驗證 |
| `git/mod.rs:214-226` | projectId/agentId 包含底線的邊界情況 | 待修復 |
| `commands.rs` | 7 個 Tauri Commands 待實作 | 待 Task 15, 16 |
| `HitlReview.tsx` | 實作 Rust 層 `hitl_approve`, `hitl_deny` | 待整合 |
| `GitSnapshotPanel.tsx` | 實作 Rust 層 `git_rollback` command | 待整合 |
| `ReasoningTree` | 450+ 節點效能測試 (目標 < 100ms) | 待測試 |

---

## 驗證命令

```bash
# Rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# Node.js Sidecar
cd sidecar && npx tsc --noEmit && npm test

# React UI
npm run typecheck
npm test
npm run lint

# 完整啟動
npm run tauri dev
```

---

## 參考文件

- `CLAUDE.md` - 每次任務前必讀
- `Orchestrator_Tower_Spec_v2.md` - 完整技術規格
