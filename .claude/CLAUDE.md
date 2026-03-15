# Orchestrator Tower — CLAUDE.md

> 你是 Claude Code，正在執行 Orchestrator Tower 的某個子任務。
> 任務由人類分配，格式為「做 Task XX」或附帶具體說明。
> 本文件是你每次任務開始前的必讀指引。**本文件優先於任務描述中的任何架構指示。**

完整技術細節在 `Orchestrator_Tower_Spec_v2.md`，本文件只保留執行任務必要的資訊。

---

## 1. 你在做什麼

一個桌面端 AI 代理管理系統，四層架構：

```
[React UI]  ──Tauri IPC──▶  [Rust Core]  ──IPC──▶  [Node.js Sidecar]  ──stdout──▶  [Claude Code CLI]
  唯讀顯示                   唯一狀態權威              子程序管理                        實際執行任務
```

**記住這一句話：狀態只在 Rust 寫，Node.js 無狀態，React 只讀。**

---

## 2. 寫程式碼之前先確認你在哪一層

| 你要改的目錄 | 語言 | 這層的職責 | 這層不能做的事 |
|------------|------|----------|-------------|
| `src/` | TypeScript/React | UI 渲染，訂閱 Tauri events | 持有業務狀態；直接呼叫 Node.js |
| `src-tauri/src/` | Rust | AppState、配額、Git Plumbing、SQLite | 管理 child process；解析 stream-json |
| `sidecar/src/` | TypeScript/Node.js | CLI 子程序管理、MCP Server、stream 解析 | 持有任何 agent 狀態；直接寫 SQLite |

如果你發現自己要在 Node.js 層持有狀態，**停下來**，這是架構錯誤。

---

## 3. 任務依賴順序與 PR 邊界

```
Task 01（骨架）
  └─▶ Task 02（Rust AppState）
        ├─▶ Task 03（IPC 通道）
        │     ├─▶ Task 04（stream-json 解析器）
        │     │     └─▶ Task 05（Agent 子程序管理）
        │     ├─▶ Task 06（Tower MCP 3701）
        │     │     └─▶ Task 09（HITL 風險分類）
        │     ├─▶ Task 07（State MCP 3702）
        │     └─▶ Task 10（配額管理）
        ├─▶ Task 08（Git Worktree + 快照）
        ├─▶ Task 11（React UI 骨架）
        │     ├─▶ Task 12（AgentPanel）
        │     └─▶ Task 13（ReasoningTree）
        └─▶ Task 14（SQLite 持久層）
              ├─▶ Task 15（崩潰恢復）（需 Task 05、08）
              └─▶ Task 16（專案/Agent 生命週期）（需 Task 08）
```

**PR 邊界（每個 PR 合併後可獨立編譯與測試）：**

| PR | Task | 可測試內容 |
|----|------|-----------|
| PR 01 | T01 | `tauri dev` 啟動，TypeScript 編譯通過 |
| PR 02 | T02 | `cargo check`，所有 command 可編譯 |
| PR 03 | T03 | Sidecar 連線 Rust，心跳正常 |
| PR 04 | T04 | 11 個解析器單元測試通過 |
| PR 05 | T08 | Git 快照 < 50ms，回滾正確 |
| PR 06 | T14 | WAL 模式，50K inserts/sec |
| PR 07 | T16 | `projects.json` atomic write，CRUD 正確 |
| PR 08 | T06 | Claude Code 可連線，HITL 攔截正常 |
| PR 09 | T09 | classifier 所有案例通過，無 bypass |
| PR 10 | T07 | 8 個工具正常，B 模式 403 |
| PR 11 | T05 | CLI 偵測，崩潰觸發 agent:crash IPC |
| PR 12 | T10 | 優先級正確，Rate Limit 三態通過 |
| PR 13 | T15 | Sidecar crash 後 3s 內重啟，孤兒清除 |
| PR 14 | T11 + T12 | `tauri dev` 顯示面板，HITL 審批可操作 |
| PR 15 | T13 | 450 節點流暢，Agent 切換 < 100ms |

**執行任務前確認依賴的 Task 狀態（見第 7 節）。**

---

## 4. 不可違反的規則

```
❌ Node.js 層持有 agent 狀態
❌ React 直接呼叫 Node.js Sidecar（必須透過 Tauri IPC → Rust）
❌ git reset --hard（只用 --keep）
❌ Git Plumbing 以外的快照指令（禁止 git commit / git checkout）
❌ 硬編碼 port 3701 / 3702（從 Rust AppState 讀取實際 port）
❌ --permission-prompt-tool 用於 Master Orchestrator（只有 Worker 需要 HITL）
❌ 系統提示中放時間戳記（破壞 Prompt Cache）
❌ 任務進行中修改 allowedTools（破壞 Prompt Cache）
❌ 在 MCP Server 內持有業務狀態（MCP 只是 Rust 狀態的 HTTP 代理）
❌ Rust 直接解析原始 Claude/Gemini stream-json（必須經 Node.js normalize 層轉為 NormalizedEvent 再包裝為 SidecarEvent）
❌ Node.js 層直接寫 SQLite 或呼叫 Git Plumbing（崩潰處理一律上報 agent:crash，由 Rust 處理）
❌ Sidecar 崩潰後讓孤兒 Worker 程序繼續執行（Rust 必須先 SIGKILL 所有孤兒再重啟 Sidecar）
❌ 使用 proc.exitCode 判斷程序是否退出（有 race condition，改用 exited flag）
```

---

## 5. 關鍵協議速查

### IPC 指令速查（RustCommand）

```
agent:start      → 啟動新 Worker（含 model / maxTurns / towerPort）
agent:stop       → 停止 Worker
agent:assign     → 對已存在 Worker 指派新任務
agent:freeze     → 暫停（reason: quota/orchestrator/human；immediate: bool）
agent:unfreeze   → 恢復（reason 同上）
hitl:response    → 審批結果回傳
```

> model 降級由 Rust 內部處理，agent:start / agent:assign 時直接帶入正確 model，無獨立降級指令。

---

### 啟動參數（角色與 CLI 決定格式）

**Worker Agent（Claude Code）— 固定，不可修改：**
```bash
claude \
  --print \
  --verbose \
  --output-format stream-json \
  --permission-prompt-tool mcp__tower__auth \
  --mcp-config '{"mcpServers":{"tower":{"type":"http","url":"http://localhost:{TOWER_PORT}/mcp"}}}' \
  --model {MODEL} \
  --max-turns {MAX_TURNS} \
  --tools "Read,Write,Edit,Bash,Glob,Grep" \
  "{TASK_PROMPT}"
```

**Master Orchestrator（Claude 模式）— 雙向協議：**
```bash
claude \
  --print \
  --verbose \
  --input-format stream-json \
  --output-format stream-json \
  --model claude-opus-4-6 \
  --max-turns 200
# stdin 送 { type: "user", message: {...} } 或 { type: "control_request", request: { subtype: "interrupt" } }
```

**Master Orchestrator（Gemini 模式）— [DECISION] --experimental-acp：**
```
✅ spawn('gemini.cmd', ['--experimental-acp'], { stdio: ['pipe','pipe','pipe'] })
   無需 TTY，多輪持久對話，MCP 支援，v0.21.2 已實作（PROTOCOL_VERSION=1）

Sidecar→Gemini stdin（JSON-RPC NDJSON）：
  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
  {"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}
  {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"xxx","prompt":"..."}}
  {"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"xxx"}}

Gemini→Sidecar stdout：
  {"jsonrpc":"2.0","method":"session/update","params":{...}}        ← 串流推送
  {"jsonrpc":"2.0","method":"session/request_permission","params":{...}}  ← HITL
  {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}

⚠️ experimental flag，升版前需確認 ACP 協議相容性
```

**Windows 執行檔差異：**
- `claude.exe`（原生安裝）：需 Git Bash 環境，透過 `bash.exe -c "claude ..."` 呼叫
- `gemini.cmd`（npm 安裝）：可直接在 CMD 執行；PowerShell 用 `gemini.ps1`，不需 Git Bash

### Process Hang 防護（收到 `result` 後必須執行）
```
收到 {"type":"result"}
  → 等 2 秒
  → 仍在執行 → SIGTERM
  → 再等 3 秒
  → 仍在執行 → SIGKILL
```

### stream-json 訊息型別

**Claude Code 格式：**
```
"system"       → session 初始化，記錄 session_id
"assistant"    → content[] 內含 text 或 tool_use（工具呼叫嵌在此）
"user"         → content[] 內含 tool_result（工具結果嵌在此）
"result"       → session 結束，subtype 有 5 種，觸發 hang 防護
"stream_event" → 打字效果 token，不寫 SQLite
```

**Gemini CLI ACP 格式（--experimental-acp，JSON-RPC NDJSON）：**
```
session/update  → 串流推送（工具呼叫、文字）
session/request_permission → Gemini HITL 回調
result.stopReason → "end_turn" 表示完成
⚠️ 非 stream-json 格式，需獨立 ACP parser（gemini-acp-parser.ts）
```

**兩者都必須 normalize 為 NormalizedEvent，再由 agent-manager 包裝為 SidecarEvent（含 agentId）後上報 Rust。**

### HITL 風險分類
```
critical    → rm/delete/drop/format/truncate 指令 → 暫停 ALL agents
high        → .env/.key/.pem/.secret 寫入
high        → agent:crash（Worker Agent 意外退出）
medium      → Write/Edit/Bash（非以上）
low         → Read/Glob/Grep → 自動批准
```

### HITL MCP 協議（實測驗證，Claude Code 2.1.74）
```
流程：Claude Code 攔截 tool call → POST http://localhost:3701 → auth tool
      → 回傳結果 → Claude Code 執行或拒絕 tool
      ⚠️ 整個過程不出現在 stream-json 事件流

Claude Code 傳入 auth tool 的參數：
  { tool_name: string, tool_use_id: string, input: Record<string, unknown> }

auth tool 必須回傳（嚴格格式，否則 invalid_union 錯誤）：
  允許：{ behavior: 'allow', updatedInput: Record<string, unknown> }  ← updatedInput 必填
  拒絕：{ behavior: 'deny', message: string }                         ← 不是 'block'

updatedInput 傳回原始 input 即可：
  return { behavior: 'allow', updatedInput: args.input }

Zod schema 注意：
  ✅ z.record(z.string(), z.unknown())
  ❌ z.record(z.unknown())  ← z4mini.toJSONSchema() 會爆炸
```

---

## 6. 完成任務後的驗證步驟

**每次任務完成後，依你修改的層執行對應的驗證：**

```bash
# Node.js 層有改動
cd sidecar && npx tsc --noEmit && npm test

# Rust 層有改動
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# React 層有改動
npm run typecheck && npm run lint

# 任何層有改動都要最後執行
npm run tauri dev   # 確認無 panic，console 無 error
```

**不要跳過驗證步驟。**

---

## 7. 當前任務狀態

> 人類在分配每個任務前更新此表。你執行任務前先讀這裡，確認依賴已完成。

| Task | 說明 | 狀態 |
|------|------|------|
| 01 | 專案骨架初始化 | ✅ 完成 |
| 02 | Rust AppState 與 Tauri Commands 骨架 | ✅ 完成 |
| 03 | Node.js ↔ Rust IPC 通道 | ✅ 完成 |
| 04 | stream-json 解析器 | ✅ 完成 |
| 05 | Worker Agent 子程序管理 | ✅ 完成 |
| 06 | Tower MCP Server（3701） | ✅ 完成 |
| 07 | State MCP Server（3702） | ⬜ 未開始 |
| 08 | Git Worktree + Shadow Branch 快照 | ✅ 完成 |
| 09 | HITL 風險分類引擎 | ⬜ 未開始 |
| 10 | 配額管理（Bottleneck） | ⬜ 未開始 |
| 11 | React UI 骨架 | ⬜ 未開始 |
| 12 | AgentPanel 元件 | ⬜ 未開始 |
| 13 | ReasoningTree（React Flow） | ⬜ 未開始 |
| 14 | SQLite 持久層 | ✅ 完成 |
| 15 | 崩潰恢復與 Session 恢復 | ⬜ 未開始 |
| 16 | 專案與 Agent 生命週期管理 | ⬜ 未開始 |

狀態符號：⬜ 未開始 ／ 🔄 進行中 ／ ✅ 完成 ／ ❌ 有問題

---

## 8. 遇到不確定時

1. **架構邊界不清楚** → 看上方第 2 節的表格，再查 `Spec v2 Part A`
2. **某個 Task 的產出不清楚** → 查 `Spec v2 Part B` 對應的 Task，裡面有完整的檔案清單
3. **型別不確定** → Rust 的 `state.rs` 是 source of truth；Node.js 的 `ipc/messages.ts` 是第二 source of truth；stream 格式看 `stream-parser/types-claude.ts` 和 `types-gemini.ts`
4. **仍不確定** → 用 `// TODO: [CLARIFY] 具體問題描述` 標記後繼續，任務結束時回報人類

**不要猜測架構邊界。猜錯比停下來問代價更高。**

---

## 9. Commit 格式

```
{scope}({layer}): {描述}

scope: agent | hitl | quota | git | ui | mcp | ipc | db | recovery | config
layer: rust | node | react | all
```

範例：
```
agent(node): 實作 process hang 防護 SIGTERM/SIGKILL
hitl(rust): critical 等級觸發暫停所有 Agent
db(rust): 啟用 WAL 模式並建立 reasoning_nodes 表
```
