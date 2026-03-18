# Task 17 & 18 規格書

## Task 17: 前後端串接整合

### 目標
將 React UI 元件與 Rust Tauri Commands 完全串接，實現完整的資料流。

### 依賴
- Task 12 ✅ (AgentPanel)
- Task 13 ✅ (ReasoningTree)
- Task 05 ✅ (Agent Manager)
- Task 14 ✅ (SQLite)

### 產出檔案

#### Rust 層 (`src-tauri/src/`)
```
commands.rs          # 實作 7 個 Tauri Commands (移除 todo!())
  - start_agent      → 呼叫 Sidecar agent:start
  - stop_agent       → 呼叫 Sidecar agent:stop
  - assign_task      → 呼叫 Sidecar agent:assign
  - approve_hitl     → 呼叫 Sidecar hitl:response (approved=true)
  - deny_hitl        → 呼叫 Sidecar hitl:response (approved=false)
  - git_rollback     → 呼叫 Git 模組執行回滾
  - get_projects     → 讀取 projects.json
```

#### React 層 (`src/`)
```
hooks/useAgent.ts           # Agent 操作 Hook
  - startAgent(config)
  - stopAgent(agentId)
  - assignTask(agentId, prompt)

hooks/useHitl.ts            # HITL 操作 Hook
  - approveHitl(requestId, modifiedInput?)
  - denyHitl(requestId, reason)

hooks/useGit.ts             # Git 操作 Hook
  - rollbackToSnapshot(agentId, sha)

services/tauri.ts           # Tauri invoke 包裝
  - 統一錯誤處理
  - Loading 狀態管理
```

### 驗收標準
1. `npm run tauri dev` 啟動後，可透過 UI 執行 HITL 審批
2. Agent 狀態變化即時反映在 UI
3. ReasoningTree 節點點擊可觸發 Git 回滾
4. 所有 Tauri commands 有對應的錯誤處理

---

## Task 18: UI 美化與動效

### 目標
提升視覺品質，增加動效與互動回饋，打造專業級 UI。

### 依賴
- Task 17 ✅ (前後端串接)
- Task 12 ✅ (AgentPanel)
- Task 13 ✅ (ReasoningTree)

### 設計規範

#### 色彩系統
```css
/* 主色調 */
--primary: #3B82F6;      /* Blue-500 */
--primary-dark: #1D4ED8; /* Blue-700 */

/* 狀態色 */
--success: #10B981;      /* Green-500 */
--warning: #F59E0B;      /* Amber-500 */
--error: #EF4444;        /* Red-500 */
--info: #6366F1;         /* Indigo-500 */

/* 背景層次 */
--bg-base: #0F172A;      /* Slate-900 */
--bg-surface: #1E293B;   /* Slate-800 */
--bg-elevated: #334155;  /* Slate-700 */
```

#### 動效規範
```css
/* 過渡時間 */
--duration-fast: 150ms;
--duration-normal: 300ms;
--duration-slow: 500ms;

/* 緩動函數 */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```

### 產出檔案

#### 樣式層
```
src/styles/
  theme.css              # CSS 變數定義
  animations.css         # Keyframe 動畫
  components.css         # 元件樣式覆寫

tailwind.config.js       # 擴展 Tailwind 主題
```

#### 元件增強
```
src/components/
  AgentPanel/
    index.tsx            # 增加入場動畫
    StatusBar.tsx        # 狀態圖示 pulse 動畫
    MessageStream.tsx    # 訊息滑入動畫
    HitlReview.tsx       # 按鈕 hover/active 效果

  ReasoningTree/
    index.tsx            # 節點連線動畫
    ReasoningNode.tsx    # hover 放大效果
    GitSnapshotPanel.tsx # 抽屜滑入動畫

  common/
    Button.tsx           # 統一按鈕元件
    Badge.tsx            # 狀態徽章元件
    Tooltip.tsx          # 工具提示元件
    LoadingSpinner.tsx   # 載入動畫
    Toast.tsx            # 通知 Toast
```

### 視覺效果清單

#### AgentPanel
- [ ] Tab 切換時內容淡入淡出
- [ ] 狀態邊框顏色漸變過渡
- [ ] MessageStream 訊息從下滑入
- [ ] HITL 審批區展開時彈簧動畫
- [ ] 按鈕 ripple 效果

#### ReasoningTree
- [ ] 節點首次出現時縮放動畫
- [ ] 連線繪製動畫 (stroke-dashoffset)
- [ ] 節點 hover 時陰影增強
- [ ] Agent 切換時 viewport 平滑過渡
- [ ] GitSnapshotPanel 從右滑入

#### Sidebar
- [ ] 項目 hover 背景漸變
- [ ] 展開/收合旋轉箭頭
- [ ] 選中項目指示條動畫

#### 通用
- [ ] 骨架屏載入效果
- [ ] 錯誤 shake 動畫
- [ ] 成功 checkmark 動畫
- [ ] 通知 Toast 滑入/滑出

### 驗收標準
1. 所有狀態變化有視覺過渡 (無突兀跳變)
2. 互動元素有 hover/active/focus 回饋
3. 載入狀態有明確指示
4. 動畫流暢 (60fps)
5. 無障礙：prefers-reduced-motion 支援

---

## 建議執行順序

1. **Task 17** (前後端串接) — 約 1-2 天
   - 實作 Rust commands
   - 建立 React hooks
   - 測試資料流

2. **Task 18** (UI 美化) — 約 1-2 天
   - 定義設計系統
   - 逐元件增強
   - 動效調校

---

## 參考資源

- [Framer Motion](https://www.framer.com/motion/) — React 動畫庫
- [Tailwind CSS Animation](https://tailwindcss.com/docs/animation)
- [React Flow Custom Nodes](https://reactflow.dev/docs/guides/custom-nodes/)
