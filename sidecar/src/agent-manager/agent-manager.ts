/**
 * AgentManager - Agent 生命週期管理核心
 *
 * 職責：
 * - CLI 路徑偵測
 * - Agent 子程序啟動/停止
 * - stdout 解析與 IPC 上報
 * - 崩潰偵測（不自動重啟，只上報）
 * - 配額管理整合（Task 10）
 *
 * 架構原則：
 * - Node.js 不持有業務狀態（只有程序層面狀態）
 * - 崩潰處理只發 IPC，不寫 SQLite
 * - 使用 exited flag 而非 exitCode 判斷（避免 race condition）
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { IpcClient } from '../ipc/index.js';
import type { SidecarEvent, RustCommand } from '../ipc/messages.js';
import { QuotaManager } from '../quota/index.js';
import {
  ClaudeStreamParser,
  GeminiAcpParser,
  type NormalizedEvent,
  handleProcessEnd,
  createExitedFlag,
} from '../stream-parser/index.js';
import {
  detectAllClis,
  checkClaudeAuth,
  checkGeminiAuth,
  type CliPaths,
} from './cli-detector.js';
import { spawnWorker } from './spawn-worker.js';
import { spawnMasterClaude, spawnMasterGemini } from './spawn-master.js';
import type {
  AgentConfig,
  ManagedAgent,
  CrashInfo,
} from './types.js';
// Task 15: 崩潰恢復
import {
  writeTaskState,
  createTaskState,
  type TaskState,
} from '../recovery/index.js';

// =============================================================================
// Events
// =============================================================================

export interface AgentManagerEvents {
  error: [agentId: string, error: Error];
  agentStarted: [agentId: string];
  agentStopped: [agentId: string];
  agentCrashed: [agentId: string, info: CrashInfo];
}

// =============================================================================
// AgentManager Class
// =============================================================================

export class AgentManager extends EventEmitter<AgentManagerEvents> {
  private agents = new Map<string, ManagedAgent>();
  private ipc: IpcClient;
  private cliPaths: CliPaths | null = null;
  private initialized = false;
  private quotaManager: QuotaManager;

  constructor(ipc: IpcClient) {
    super();
    this.ipc = ipc;
    this.quotaManager = new QuotaManager(ipc);
    this.setupCommandHandler();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * 初始化 AgentManager，偵測 CLI 路徑
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[AgentManager] Detecting CLI paths...');
    this.cliPaths = await detectAllClis();

    if (this.cliPaths.claude) {
      console.log(`[AgentManager] Claude CLI found: ${this.cliPaths.claude}`);
    } else {
      console.warn('[AgentManager] Claude CLI not found');
    }

    if (this.cliPaths.gemini) {
      console.log(`[AgentManager] Gemini CLI found: ${this.cliPaths.gemini}`);
    } else {
      console.warn('[AgentManager] Gemini CLI not found');
    }

    if (this.cliPaths.windowsConfig.gitBashPath) {
      console.log(`[AgentManager] Git Bash found: ${this.cliPaths.windowsConfig.gitBashPath}`);
    }

    this.initialized = true;
    console.log('[AgentManager] Initialized');
  }

  // ===========================================================================
  // Command Handler
  // ===========================================================================

  private setupCommandHandler(): void {
    this.ipc.on('command', (cmd: RustCommand) => {
      this.handleCommand(cmd).catch(err => {
        console.error('[AgentManager] Command error:', err);
      });
    });
  }

  private async handleCommand(cmd: RustCommand): Promise<void> {
    switch (cmd.type) {
      case 'agent:start':
        await this.startAgent({
          agentId: cmd.agentId,
          role: 'worker',
          protocol: 'claude-stream-json',
          worktreePath: cmd.worktreePath,
          model: cmd.model,
          maxTurns: cmd.maxTurns,
          towerPort: cmd.towerPort,
          prompt: cmd.prompt,
          // Task 15: 崩潰恢復
          sessionId: cmd.sessionId,
          taskId: cmd.taskId,
          projectId: cmd.projectId,
        });
        break;

      case 'agent:stop':
        await this.stopAgent(cmd.agentId);
        break;

      case 'agent:assign':
        await this.assignTask(cmd.agentId, cmd.prompt, cmd.maxTurns);
        break;

      case 'agent:freeze':
        await this.freezeAgent(cmd.agentId, cmd.reason, cmd.immediate);
        break;

      case 'agent:unfreeze':
        await this.unfreezeAgent(cmd.agentId, cmd.reason);
        break;

      case 'hitl:response':
        // HITL 回應由 Task 06 Tower MCP Server 處理
        // AgentManager 不直接處理
        break;
    }
  }

  // ===========================================================================
  // Agent Lifecycle
  // ===========================================================================

  /**
   * 啟動新 Agent
   */
  async startAgent(config: AgentConfig): Promise<void> {
    if (!this.initialized || !this.cliPaths) {
      throw new Error('AgentManager not initialized');
    }

    if (this.agents.has(config.agentId)) {
      throw new Error(`Agent ${config.agentId} already exists`);
    }

    console.log(`[AgentManager] Starting agent ${config.agentId}`);

    // 註冊至配額管理器（Task 10）
    const priority = this.quotaManager.registerAgent(config.agentId, config.role);
    console.log(`[AgentManager] Agent ${config.agentId} registered with priority ${priority}`);

    // 檢查 CLI 可用性
    if (config.protocol === 'claude-stream-json') {
      if (!this.cliPaths.claude) {
        throw new Error('Claude CLI not found');
      }

      // 檢查認證
      const authResult = await checkClaudeAuth();
      if (!authResult.authenticated) {
        throw new Error(authResult.error ?? 'Claude not authenticated');
      }
    } else if (config.protocol === 'gemini-acp') {
      if (!this.cliPaths.gemini) {
        throw new Error('Gemini CLI not found');
      }

      const authResult = await checkGeminiAuth();
      if (!authResult.authenticated) {
        throw new Error(authResult.error ?? 'Gemini not authenticated');
      }
    }

    // 根據角色和協議選擇 spawn 方式
    let proc: ChildProcess;
    if (config.role === 'worker') {
      // Worker 強制使用 Claude stream-json
      proc = spawnWorker(config, {
        claudePath: this.cliPaths.claude!,
        gitBashPath: this.cliPaths.windowsConfig.gitBashPath,
      });
    } else {
      // Master 依協議選擇
      if (config.protocol === 'claude-stream-json') {
        proc = spawnMasterClaude(config, {
          claudePath: this.cliPaths.claude ?? undefined,
          gitBashPath: this.cliPaths.windowsConfig.gitBashPath,
        });
      } else {
        proc = spawnMasterGemini(config, {
          geminiPath: this.cliPaths.gemini ?? undefined,
          gitBashPath: this.cliPaths.windowsConfig.gitBashPath,
        });
      }
    }

    // 選擇對應的 parser
    const parser = config.protocol === 'claude-stream-json'
      ? new ClaudeStreamParser()
      : new GeminiAcpParser();

    // 建立 exited flag（防止 race condition）
    const exitedFlag = createExitedFlag(proc);

    // 建立 ManagedAgent 記錄
    const managed: ManagedAgent = {
      config,
      process: proc,
      parser,
      exitedFlag,
      resultReceived: false,
      lastSessionId: config.sessionId ?? null, // Task 15: 從 config 繼承（用於恢復）
      lastToolUse: null,
      state: 'running',
      // Task 15: 崩潰恢復
      lastGitSha: null,
      lastNodeId: null,
      startedAt: Date.now(),
    };
    this.agents.set(config.agentId, managed);

    // Task 15: 初始化 TaskState（若有 taskId 和 projectId）
    if (config.taskId && config.projectId) {
      const taskState = createTaskState({
        taskId: config.taskId,
        agentId: config.agentId,
        projectId: config.projectId,
        prompt: config.prompt ?? '',
      });
      taskState.lastSessionId = config.sessionId ?? null;
      writeTaskState(taskState).catch(err => {
        console.error(`[AgentManager] Failed to write initial TaskState: ${err}`);
      });
    }

    // 接管 stdout
    proc.stdout?.on('data', (chunk: Buffer) => {
      parser.write(chunk.toString());
    });

    // 監聽 parser 事件
    parser.on('event', (event: NormalizedEvent) => {
      this.handleNormalizedEvent(config.agentId, event);
    });

    parser.on('result', () => {
      // 收到 result，設定 flag 並啟動 hang 防護
      managed.resultReceived = true;
      managed.state = 'stopping';
      console.log(`[AgentManager] Agent ${config.agentId} received result, starting hang protection`);
      handleProcessEnd(proc, exitedFlag);
    });

    parser.on('error', (err: Error) => {
      console.error(`[AgentManager] Parser error for ${config.agentId}:`, err.message);
      this.emit('error', config.agentId, err);
    });

    // 監聽程序退出
    proc.on('exit', (code, signal) => {
      this.handleProcessExit(config.agentId, code, signal);
    });

    // stderr 記錄（不上報，只記 log）
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[Agent ${config.agentId}] stderr:`, chunk.toString());
    });

    this.emit('agentStarted', config.agentId);
    console.log(`[AgentManager] Agent ${config.agentId} started`);
  }

  /**
   * 停止 Agent
   */
  async stopAgent(agentId: string, immediate = false): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      console.warn(`[AgentManager] Agent ${agentId} not found`);
      return;
    }

    console.log(`[AgentManager] Stopping agent ${agentId} (immediate=${immediate})`);
    managed.state = 'stopping';

    if (immediate) {
      // 立即終止
      managed.process.kill('SIGTERM');
      // 設置 3 秒後 SIGKILL
      setTimeout(() => {
        if (!managed.exitedFlag.value) {
          managed.process.kill('SIGKILL');
        }
      }, 3000);
    } else {
      // 等待當前任務完成後自然退出
      // 對於已經在等待結果的 Agent，hang 防護會處理
    }
  }

  /**
   * 指派新任務給現有 Agent (Master only)
   *
   * 透過 stdin 發送 stream-json 訊息
   */
  async assignTask(agentId: string, prompt: string, _maxTurns: number): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (managed.config.role !== 'master') {
      throw new Error(`Agent ${agentId} is not a master, cannot assign task`);
    }

    if (managed.state !== 'running') {
      throw new Error(`Agent ${agentId} is not running`);
    }

    console.log(`[AgentManager] Assigning task to agent ${agentId}`);

    // 根據協議發送訊息
    if (managed.config.protocol === 'claude-stream-json') {
      // Claude 雙向協議
      const message = {
        type: 'user',
        message: {
          role: 'user',
          content: prompt,
        },
      };
      managed.process.stdin?.write(JSON.stringify(message) + '\n');
    } else {
      // Gemini ACP 協議
      const message = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'session/prompt',
        params: {
          sessionId: managed.lastSessionId ?? 'default',
          prompt,
        },
      };
      managed.process.stdin?.write(JSON.stringify(message) + '\n');
    }
  }

  /**
   * 凍結 Agent
   */
  async freezeAgent(agentId: string, reason: string, immediate: boolean): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      console.warn(`[AgentManager] Agent ${agentId} not found`);
      return;
    }

    console.log(`[AgentManager] Freezing agent ${agentId} (reason=${reason}, immediate=${immediate})`);

    if (immediate && managed.config.protocol === 'claude-stream-json') {
      // 發送 control_request: interrupt
      const message = {
        type: 'control_request',
        request: {
          subtype: 'interrupt',
        },
      };
      managed.process.stdin?.write(JSON.stringify(message) + '\n');
    }

    // 實際的凍結狀態由 Rust 管理，這裡只是發送中斷請求
  }

  /**
   * 解凍 Agent
   */
  async unfreezeAgent(agentId: string, reason: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      console.warn(`[AgentManager] Agent ${agentId} not found`);
      return;
    }

    console.log(`[AgentManager] Unfreezing agent ${agentId} (reason=${reason})`);
    // 解凍後的任務指派由 Rust 決定
  }

  /**
   * 關閉所有 Agent
   */
  async shutdown(): Promise<void> {
    console.log('[AgentManager] Shutting down all agents...');

    const shutdownPromises = Array.from(this.agents.keys()).map(agentId =>
      this.stopAgent(agentId, true)
    );

    await Promise.all(shutdownPromises);

    // 等待所有程序退出
    await new Promise<void>(resolve => {
      const checkInterval = setInterval(() => {
        if (this.agents.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // 最多等 10 秒
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });

    // 關閉配額管理器（Task 10）
    await this.quotaManager.shutdown();

    console.log('[AgentManager] All agents shut down');
  }

  /**
   * 取得配額管理器（用於外部整合）
   */
  getQuotaManager(): QuotaManager {
    return this.quotaManager;
  }

  /**
   * 取得所有 Agent 狀態
   */
  getAgents(): Map<string, ManagedAgent> {
    return new Map(this.agents);
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  private handleNormalizedEvent(agentId: string, event: NormalizedEvent): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    // 追蹤最後的 session_id 和 tool_use
    if (event.kind === 'session_start') {
      managed.lastSessionId = event.sessionId;
      // Task 15: 更新 TaskState
      this.updateTaskState(managed, { lastSessionId: event.sessionId });
    } else if (event.kind === 'tool_call') {
      managed.lastToolUse = {
        toolName: event.toolName,
        toolId: event.toolId,
        input: event.input,
      };
    } else if (event.kind === 'tool_result') {
      // Task 15: 工具完成後可能有新的 node
      // TODO(Task 17): nodeId 應從 Rust 層的 ReasoningTree/SQLite 取得
      //   - toolId 是 Claude 生成的工具呼叫 ID
      //   - nodeId 是 reasoning_nodes 表中的節點 ID
      //   - 需要 Rust 層上報 nodeId 或從 IPC 查詢
      //   - 目前暫用 toolId 作為 placeholder
      managed.lastNodeId = event.toolId;
      this.updateTaskState(managed, { lastCompletedNodeId: event.toolId });
    }

    // 轉換並上報
    const sidecarEvent = this.normalizedEventToSidecarEvent(agentId, managed, event);
    if (sidecarEvent) {
      this.ipc.send(sidecarEvent);
    }
  }

  // Task 15: 更新 TaskState（非阻塞）
  private updateTaskState(
    managed: ManagedAgent,
    updates: Partial<Pick<TaskState, 'lastSessionId' | 'lastCompletedNodeId' | 'lastGitSha'>>
  ): void {
    const { config } = managed;
    if (!config.taskId || !config.projectId) {
      return; // 沒有 taskId/projectId 不寫入
    }

    // 更新 managed 狀態
    if (updates.lastGitSha !== undefined) {
      managed.lastGitSha = updates.lastGitSha;
    }
    if (updates.lastCompletedNodeId !== undefined) {
      managed.lastNodeId = updates.lastCompletedNodeId;
    }

    // 非阻塞寫入
    const taskState: TaskState = {
      version: 1,
      taskId: config.taskId,
      agentId: config.agentId,
      projectId: config.projectId,
      prompt: config.prompt ?? '',
      lastCompletedNodeId: managed.lastNodeId,
      lastGitSha: managed.lastGitSha,
      lastSessionId: managed.lastSessionId,
      startedAt: managed.startedAt,
      updatedAt: Date.now(),
    };

    writeTaskState(taskState).catch(err => {
      console.error(`[AgentManager] Failed to update TaskState: ${err}`);
    });
  }

  private handleProcessExit(
    agentId: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    // 清理 parser
    managed.parser.end();

    if (managed.resultReceived) {
      // 正常完成：收到 result 後程序退出
      managed.state = 'stopped';
      console.log(`[AgentManager] Agent ${agentId} normal exit`);
      this.emit('agentStopped', agentId);
    } else {
      // 意外退出：未收到 result 就退出
      managed.state = 'crashed';
      console.error(`[AgentManager] Agent ${agentId} crash detected: code=${code}, signal=${signal}`);

      const crashInfo: CrashInfo = {
        agentId,
        exitCode: code,
        signal: signal as string | null,
        lastSessionId: managed.lastSessionId,
        lastToolUse: managed.lastToolUse,
      };

      this.handleCrash(crashInfo);
      this.emit('agentCrashed', agentId, crashInfo);
    }

    // 從配額管理器取消註冊（Task 10）
    this.quotaManager.unregisterAgent(agentId);

    // 從管理列表移除
    this.agents.delete(agentId);
  }

  private handleCrash(info: CrashInfo): void {
    // 架構原則：Node.js 只發 IPC，不寫 SQLite
    console.log(`[AgentManager] Reporting crash for agent ${info.agentId}`);

    this.ipc.send({
      type: 'agent:crash',
      agentId: info.agentId,
      exitCode: info.exitCode,
      signal: info.signal,
      lastSessionId: info.lastSessionId,
      lastToolUse: info.lastToolUse,
    });
  }

  // ===========================================================================
  // Event Conversion
  // ===========================================================================

  private normalizedEventToSidecarEvent(
    agentId: string,
    managed: ManagedAgent,
    event: NormalizedEvent
  ): SidecarEvent | null {
    switch (event.kind) {
      case 'session_start':
        return {
          type: 'agent:session_start',
          agentId,
          sessionId: event.sessionId,
          model: managed.config.model,
        };

      case 'text_delta':
        return {
          type: 'agent:stream_delta',
          agentId,
          text: event.text,
        };

      case 'tool_call':
        return {
          type: 'agent:tool_use',
          agentId,
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.input,
        };

      case 'tool_result':
        return {
          type: 'agent:tool_result',
          agentId,
          toolUseId: event.toolId,
          content: event.output,
          isError: !event.success,
        };

      case 'session_end':
        return {
          type: 'agent:session_end',
          agentId,
          subtype: event.success ? 'success' : (event.errorType ?? 'unknown'),
          numTurns: event.numTurns ?? 0,
          totalCostUsd: event.costUsd ?? 0,
          usage: {},
        };

      case 'permission_request':
        // Gemini ACP 的 HITL 回調
        // TODO: Task 09 實作 risk classifier
        return {
          type: 'hitl:request',
          agentId,
          requestId: event.requestId,
          toolName: event.toolName,
          input: event.input,
          riskLevel: 'medium', // 暫時硬編碼，Task 09 實作 classifier
          source: 'acp-permission',
        };

      default:
        return null;
    }
  }
}
