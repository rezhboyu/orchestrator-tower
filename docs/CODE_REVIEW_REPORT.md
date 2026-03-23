# Orchestrator Tower - Code Quality Review Report

> Date: 2026-03-23 (Second Pass)
> Scope: Full codebase review (Tasks 01-14 complete, pre-Task 17/18)
> Method: Line-by-line review of all React components, stores, types, Rust commands, and tests

---

## Executive Summary

The codebase demonstrates **strong architectural design** with clear separation across 4 layers (React/Rust/Node.js/CLI). All 14 completed tasks are structurally sound. This second-pass review identified **22 issues** (5 new from deeper inspection) across security, correctness, performance, and test coverage that should be addressed before proceeding with integration (Task 17).

**Key Blockers:**
1. Build fails — TypeScript compilation errors due to missing `node_modules`
2. HITL commands are `todo!()` stubs — approval/denial silently discarded
3. React mutates state directly — violates "React read-only" architecture rule
4. Stale closure in event listeners — events update old store instance
5. **[NEW]** ReasoningTree viewport resets on every new node (not just agent switch)
6. **[NEW]** Duplicate interface definitions will diverge

---

## 1. Critical Issues

### 1.1 HITL Commands Not Implemented (CRITICAL)
**Location:** `src-tauri/src/commands.rs:32-57`

All 7 Tauri commands are `todo!()` placeholders:
- `approve_hitl` / `deny_hitl` — HITL decisions are silently discarded
- `start_agent` / `stop_agent` — Agent lifecycle non-functional
- `rollback_to_node` / `create_project` / `get_app_state` — Partially stubbed

**Impact:** HITL approval flow is completely broken. Users click "Approve" but nothing happens. Critical/high-risk operations proceed without actual human authorization.

**Recommendation:** Implement these commands to forward IPC messages to the Sidecar. This is the primary deliverable of Task 17.

---

### 1.2 Stale Closure in Event Listeners (CRITICAL)
**Location:** `src/store/agentStore.ts:225-291`

```typescript
export async function setupAgentEventListeners(): Promise<() => void> {
  const store = useAgentStore.getState(); // ← Captured once at setup
  // ...
  unlisteners.push(await listen<...>('agent:session_start', (event) => {
    store.handleSessionStart(...); // ← Uses stale reference
  }));
}
```

`store` is captured once at initialization. If the store is reset or reinstantiated, all event handlers reference the old instance. Events silently update dead state.

**Fix:**
```typescript
listen('agent:session_start', (event) => {
  useAgentStore.getState().handleSessionStart(...); // Fresh reference each time
});
```

---

### 1.3 Build Failure — Missing Dependencies (CRITICAL)
**Symptom:** `tsc` reports 100+ errors: `Cannot find module 'react'`, `Cannot find module 'vitest'`, etc.

**Cause:** `node_modules/` not installed in either root or `sidecar/`.

**Fix:** `npm install && cd sidecar && npm install`

**Note:** Vitest version mismatch between root (`^4.1.0`) and sidecar (`^3.0.0`) — standardize to same major version.

---

## 2. Security Issues

### 2.1 Missing Input Validation on HITL Deny Reason (HIGH)
**Location:** `src/components/AgentPanel/HitlReview.tsx:55-73`

```typescript
const handleDeny = useCallback(async () => {
  if (!denyReason.trim()) { return; } // Only trims — no length check
  await invoke('deny_hitl', { reason: denyReason }); // Unbounded string
});
```

No maximum length validation. A user (or injected input) could send megabytes of text, causing SQLite storage issues or audit log pollution.

**Fix:** Add `denyReason.length > 500` guard.

### 2.2 Unguarded JSON.stringify in Tool Display (HIGH)
**Location:** `src/components/AgentPanel/HitlReview.tsx:114`, `MessageStream.tsx:27-31`

`JSON.stringify(hitlRequest.input, null, 2)` — if input contains circular references, this throws an unhandled exception and crashes the UI.

**Fix:** Wrap in try/catch with fallback: `'[Invalid input structure]'`.

### 2.3 Silent Error Swallowing in HITL Flow (HIGH)
**Location:** `src/components/AgentPanel/HitlReview.tsx:43-52`

```typescript
catch (error) {
  console.error('Failed to approve HITL request:', error); // Logged, not shown
}
```

HITL failures are logged to console but never shown to the user. The user believes approval succeeded when it didn't.

**Fix:** Surface errors via `notificationStore.addNotification()`.

---

## 3. Architecture Violations

### 3.1 React Writes State Directly (HIGH)
**Violation of:** "狀態只在 Rust 寫，Node.js 無狀態，React 只讀"

| Location | Violation |
|----------|-----------|
| `agentStore.ts:clearHitlRequest()` | Forces agent status to `'running'` without Rust confirmation |
| `HitlReview.tsx:handleApprove()` | Calls `onComplete()` (clears HITL) before Rust acknowledges |
| `agentStore.ts:handleCrash()` | Sets `status: 'error'` locally without Rust event |

**Correct flow:** React sends command → Rust processes → Rust emits event → React updates from event.

### 3.2 Hardcoded Port in Test (MEDIUM)
**Location:** `src-tauri/src/ipc/messages.rs:312`

```rust
tower_port: 3701, // ← Hardcoded, violates CLAUDE.md rule
```

While only in a test, this reinforces bad patterns. Use a constant or dynamic port.

---

## 4. Performance Issues

### 4.1 Missing Memoization for List Components (MEDIUM)
**Locations:**
- `AgentPanel/index.tsx:25-44` — `AgentTab` not wrapped in `React.memo()`
- `MessageStream.tsx:39-92` — `ToolUseCard`/`ToolResultCard` not memoized

With 20+ agents or 500+ messages, every state change rerenders all list items.

### 4.2 Inefficient Store Subscriptions (MEDIUM)
**Location:** `AgentPanel/index.tsx:50-52`

Subscribes to entire `agents` object — rerenders on ANY agent change, even inactive ones. Should use precise selector for active agent only.

### 4.3 Index-Based React Keys (MEDIUM)
**Location:** `MessageStream.tsx:116-142`

```typescript
messages.map((message, index) => (
  <TextMessage key={`text-${index}`} ... />
))
```

If messages are reordered/deleted, React will remount wrong components. Use stable message IDs.

### 4.4 ReasoningTree Viewport Switching (LOW)
**Location:** `ReasoningTree/index.tsx:70-97`

Multiple `setTimeout(50ms)` calls for viewport restoration. Brittle timing that could cause jank with 450+ nodes. Consider `requestAnimationFrame` or React Flow's built-in viewport API.

---

## 5. Test Coverage Analysis

### Coverage by Component

| Component | Test File | Quality | Issues |
|-----------|-----------|---------|--------|
| AgentPanel | `AgentPanel.test.tsx` | MEDIUM | Happy path only, no error/edge cases |
| agentStore | `agentStore.test.ts` | MEDIUM | No concurrency, no cleanup tests |
| uiStore | `uiStore.test.ts` | MEDIUM | Missing validation edge cases |
| Sidebar | `Sidebar.test.tsx` | MEDIUM | No keyboard edge cases |
| ReasoningTree | `ReasoningTree.test.tsx` | LOW | Missing layout/performance tests |
| **GitSnapshotPanel** | **NONE** | **0%** | No tests at all |
| **MosaicArea** | **NONE** | **0%** | No tests at all |
| **Toolbar** | **NONE** | **0%** | No tests at all |
| MessageStream | Part of AgentPanel | LOW | Insufficient isolation |

### Critical Missing Tests
1. **GitSnapshotPanel** — Rollback functionality, error handling, async state
2. **MosaicArea** — Layout persistence, panel rendering, toggle behavior
3. **Toolbar** — Language switching, layout reset, notification dispatch
4. **ReasoningTree memo test** (`ReasoningTree.test.tsx:177-196`) — Test is ineffective: `component.type !== undefined` always returns true
5. **Event listener cleanup** — `setupAgentEventListeners` returns cleanup function but `main.tsx` never captures it

### Missing Edge Cases Across All Tests
- Empty state rendering (0 agents, 0 messages, 0 nodes)
- Concurrent operations (multiple agents starting/stopping)
- Error boundary testing (failed Tauri invocations)
- Memory leak verification (event listener cleanup)

---

## 6. Code Quality Issues

### 6.1 Race Condition in Auto-Select (MEDIUM)
**Location:** `AgentPanel/index.tsx:84-87`

```typescript
if (!activeAgentId && agentIds.length > 0) {
  setActiveAgent(agentIds[0]);
  return null; // Returns null, triggers re-render
}
```

Side effect in render body. Should use `useEffect` to avoid render loop risk.

### 6.2 Missing Event Listener Cleanup (LOW)
**Location:** `src/main.tsx:10`

```typescript
setupAgentEventListeners().catch(console.error); // Cleanup function discarded
```

On HMR or app reload, old listeners aren't cleaned up → duplicate handlers, memory leak.

### 6.3 ReasoningNode Type Casting (LOW)
**Location:** `ReasoningTree/ReasoningNode.tsx:56`

```typescript
const nodeData = data as unknown as ReasoningNodeData; // Unsafe double cast
```

No runtime validation. If data shape changes, errors are silent.

### ~~6.4 Navigator Nullability~~ (RETRACTED)
**Previous report claimed** `i18n/index.ts` lacked null check. **Correction:** `uiStore.ts:100` already has proper guard: `if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh'))`. This issue does NOT exist.

---

## 7. New Findings (Second Pass)

### 7.1 ReasoningTree Viewport Resets on Every New Node (HIGH)
**Location:** `src/components/ReasoningTree/index.tsx:97`

```typescript
useEffect(() => {
  // ... viewport save/restore logic ...
}, [activeAgentId, memoizedViewport, getViewport, setViewport, fitView, nodes.length]);
//                                                                       ^^^^^^^^^^^^
```

`nodes.length` is in the dependency array. Every time a new reasoning node arrives (which happens continuously during agent execution), this effect re-runs and triggers viewport restoration or `fitView`. The user's manual pan/zoom is constantly overridden while an agent is working.

**Fix:** Remove `nodes.length` from deps. Only trigger viewport logic on `activeAgentId` change. Use a separate effect for initial `fitView` on first nodes.

### 7.2 Duplicate Interface Definitions (MEDIUM)
**Locations:**
- `HitlRequest` defined in BOTH `agentStore.ts:18-23` AND `HitlReview.tsx:6-11`
- `AgentMessage` defined in BOTH `agentStore.ts:25-28` AND `MessageStream.tsx:16-19`

These are identical today but will inevitably diverge as features are added. Should be in `types/events.ts`.

### 7.3 Unbounded Messages Array — Memory Leak (MEDIUM)
**Location:** `src/store/agentStore.ts:100`

```typescript
messages: [...agent.messages, { type: 'text', content: text }],
```

Messages array grows indefinitely with no cap. A long-running agent session producing thousands of tool calls will consume unbounded memory. Need a max message limit (e.g., keep last 1000) or virtualized storage.

### 7.4 Clipboard API Promise Not Handled (LOW)
**Location:** `src/components/ReasoningTree/GitSnapshotPanel.tsx:76`

```typescript
navigator.clipboard.writeText(selectedNode.gitSnapshotSha!);
```

`writeText()` returns a Promise that is neither awaited nor caught. If clipboard access is denied (e.g., iframe, permissions), the error is unhandled.

### 7.5 `agentStore.test.ts` Uses Stale Store Pattern (LOW)
**Location:** `src/store/agentStore.test.ts:14-15`

```typescript
const store = useAgentStore.getState();
store.handleSessionStart('a1', 's1', 'claude-opus-4');
```

Tests capture `store` once and call methods on it — the exact same stale closure pattern as the production bug in issue 1.2. The tests pass because Zustand's `getState()` returns the actual store object (not a snapshot), but this pattern masks the real bug and makes it look correct.

---

## 8. Configuration Issues

| Item | Status | Action |
|------|--------|--------|
| postcss.config.js | `autoprefixer` installed but not configured | Remove from package.json or add to PostCSS |
| Vitest versions | Root `^4.1.0` vs Sidecar `^3.0.0` | Standardize to same major |
| Sidecar binaries | `src-tauri/binaries/` empty (`.gitkeep` only) | Build after `npm install` |
| Icon bundle | `"icon": []` in tauri.conf.json | Add icons before release |
| ESLint config | Flat config format, well-structured | OK |

---

## 9. Recommendations (Priority Order)

### P0 — Before Task 17
1. Install dependencies (`npm install` in root + sidecar)
2. Fix stale closure in `setupAgentEventListeners` (use `getState()` per event)
3. Capture event listener cleanup function in `main.tsx`
4. **[NEW]** Fix ReasoningTree viewport effect — remove `nodes.length` from deps

### P1 — During Task 17
5. Implement all 7 Rust commands (remove `todo!()`)
6. Redesign HITL flow: React should not call `clearHitlRequest` directly; wait for Rust event
7. Add input validation on deny reason (max 500 chars)
8. Add try/catch around `JSON.stringify` for tool input display
9. Surface HITL errors to user via notification store
10. **[NEW]** Consolidate duplicate `HitlRequest` / `AgentMessage` interfaces into `types/events.ts`

### P2 — During Task 18
11. Add `React.memo()` to `AgentTab`, `ToolUseCard`, `ToolResultCard`
12. Use stable message IDs instead of array indices for React keys
13. Optimize store selectors (subscribe to active agent only)
14. Replace `setTimeout(50)` with `requestAnimationFrame` in ReasoningTree
15. **[NEW]** Add message array cap (e.g., 2000) to prevent memory leak

### P3 — Before Release
16. Add tests for GitSnapshotPanel, MosaicArea, Toolbar
17. Fix ineffective ReasoningTree memo test
18. Add error boundary components around major panels
19. Standardize Vitest versions
20. Remove unused `autoprefixer` dependency
21. **[NEW]** Handle clipboard API promise rejection in GitSnapshotPanel

---

## 10. Summary Severity Matrix

| Severity | Count | Categories |
|----------|-------|------------|
| CRITICAL | 3 | HITL bypass, stale closure, build failure |
| HIGH | 6 | Input validation, error swallowing, architecture violations, JSON crash, **viewport reset bug** |
| MEDIUM | 7 | Performance, race conditions, hardcoded ports, test gaps, **duplicate interfaces, unbounded messages** |
| LOW | 4 | Cleanup, type safety, clipboard, test pattern |

### Corrections from First Pass
- ~~Navigator nullability~~ — **RETRACTED**. `uiStore.ts:100` already has proper `typeof navigator !== 'undefined'` guard.
- `agentStore.ts:handleCrash()` — First pass listed this as "sets status without Rust event". **Clarification:** This is actually correct behavior since `handleCrash` is called FROM a Tauri event listener, meaning it IS responding to a Rust event. The architecture violation only applies to `clearHitlRequest()`.

**Overall Assessment:** Architecture is solid. Implementation quality is good for the development stage. The critical items (HITL stubs, stale closures) are expected given Tasks 15-17 haven't started yet. The viewport reset bug (7.1) is a usability-breaking issue that should be fixed immediately. Addressing the P0/P1 items during Task 17 will bring the codebase to production-ready quality.
