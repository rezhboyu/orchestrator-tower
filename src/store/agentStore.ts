import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type {
  AgentStatus,
  RiskLevel,
  AgentSessionStartEvent,
  AgentTextEvent,
  AgentToolUseEvent,
  AgentToolResultEvent,
  AgentSessionEndEvent,
  AgentCrashEvent,
  HitlRequestEvent,
  ReasoningNode,
  ReasoningNodeEvent,
  AgentViewport,
} from '../types/events';

interface HitlRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
}

interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result';
  content: unknown;
}

interface AgentData {
  id: string;
  status: AgentStatus;
  sessionId: string | null;
  model: string | null;
  messages: AgentMessage[];
  hitlRequest: HitlRequest | null;
  totalCostUsd: number | null;
}

interface AgentStoreState {
  agents: Record<string, AgentData>;
  activeAgentId: string | null;
  reasoningNodes: Record<string, ReasoningNode[]>; // agentId -> nodes
  agentViewports: Record<string, AgentViewport>;   // agentId -> viewport

  // Actions (purely state updates, no business logic)
  setActiveAgent: (agentId: string | null) => void;
  handleSessionStart: (agentId: string, sessionId: string, model: string) => void;
  handleText: (agentId: string, text: string) => void;
  handleToolUse: (agentId: string, toolId: string, toolName: string, input: unknown) => void;
  handleToolResult: (agentId: string, toolUseId: string, content: string, isError: boolean) => void;
  handleSessionEnd: (agentId: string, subtype: string, totalCostUsd: number) => void;
  handleCrash: (agentId: string, exitCode?: number, signal?: string) => void;
  handleHitlRequest: (agentId: string, request: HitlRequest) => void;
  clearHitlRequest: (agentId: string) => void;
  // ReasoningTree actions
  handleReasoningNode: (agentId: string, node: ReasoningNode) => void;
  setAgentViewport: (agentId: string, viewport: AgentViewport) => void;
  clearReasoningNodes: (agentId: string) => void;
}

const createEmptyAgent = (id: string): AgentData => ({
  id,
  status: 'idle',
  sessionId: null,
  model: null,
  messages: [],
  hitlRequest: null,
  totalCostUsd: null,
});

export const useAgentStore = create<AgentStoreState>((set) => ({
  agents: {},
  activeAgentId: null,
  reasoningNodes: {},
  agentViewports: {},

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),

  handleSessionStart: (agentId, sessionId, model) => set((state) => ({
    agents: {
      ...state.agents,
      [agentId]: {
        ...(state.agents[agentId] || createEmptyAgent(agentId)),
        status: 'running',
        sessionId,
        model,
        messages: [],
      },
    },
  })),

  handleText: (agentId, text) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          messages: [...agent.messages, { type: 'text', content: text }],
        },
      },
    };
  }),

  handleToolUse: (agentId, toolId, toolName, input) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          messages: [...agent.messages, { type: 'tool_use', content: { toolId, toolName, input } }],
        },
      },
    };
  }),

  handleToolResult: (agentId, toolUseId, content, isError) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          messages: [...agent.messages, { type: 'tool_result', content: { toolUseId, content, isError } }],
        },
      },
    };
  }),

  handleSessionEnd: (agentId, subtype, totalCostUsd) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          status: subtype === 'error' ? 'error' : 'idle',
          totalCostUsd,
        },
      },
    };
  }),

  handleCrash: (agentId, _exitCode, _signal) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          status: 'error',
        },
      },
    };
  }),

  handleHitlRequest: (agentId, request) => set((state) => {
    const agent = state.agents[agentId] || createEmptyAgent(agentId);
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          status: 'waiting_hitl',
          hitlRequest: request,
        },
      },
    };
  }),

  clearHitlRequest: (agentId) => set((state) => {
    const agent = state.agents[agentId];
    if (!agent) return state;
    return {
      agents: {
        ...state.agents,
        [agentId]: {
          ...agent,
          status: 'running',
          hitlRequest: null,
        },
      },
    };
  }),

  // ReasoningTree actions
  handleReasoningNode: (agentId, node) => set((state) => {
    const existingNodes = state.reasoningNodes[agentId] || [];
    // Check if node already exists (update) or is new (append)
    const nodeIndex = existingNodes.findIndex((n) => n.id === node.id);
    let updatedNodes: ReasoningNode[];
    if (nodeIndex >= 0) {
      // Update existing node
      updatedNodes = [...existingNodes];
      updatedNodes[nodeIndex] = node;
    } else {
      // Append new node
      updatedNodes = [...existingNodes, node];
    }
    return {
      reasoningNodes: {
        ...state.reasoningNodes,
        [agentId]: updatedNodes,
      },
    };
  }),

  setAgentViewport: (agentId, viewport) => set((state) => ({
    agentViewports: {
      ...state.agentViewports,
      [agentId]: viewport,
    },
  })),

  clearReasoningNodes: (agentId) => set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _removed, ...rest } = state.reasoningNodes;
    return { reasoningNodes: rest };
  }),
}));

// Event subscription setup (called from main.tsx)
export async function setupAgentEventListeners(): Promise<() => void> {
  const store = useAgentStore.getState();
  const unlisteners: Array<() => void> = [];

  // Subscribe to agent:session_start
  unlisteners.push(await listen<AgentSessionStartEvent>('agent:session_start', (event) => {
    store.handleSessionStart(event.payload.agentId, event.payload.sessionId, event.payload.model);
  }));

  // Subscribe to agent:text
  unlisteners.push(await listen<AgentTextEvent>('agent:text', (event) => {
    store.handleText(event.payload.agentId, event.payload.text);
  }));

  // Subscribe to agent:tool_use
  unlisteners.push(await listen<AgentToolUseEvent>('agent:tool_use', (event) => {
    store.handleToolUse(
      event.payload.agentId,
      event.payload.toolId,
      event.payload.toolName,
      event.payload.input
    );
  }));

  // Subscribe to agent:tool_result
  unlisteners.push(await listen<AgentToolResultEvent>('agent:tool_result', (event) => {
    store.handleToolResult(
      event.payload.agentId,
      event.payload.toolUseId,
      event.payload.content,
      event.payload.isError
    );
  }));

  // Subscribe to agent:session_end
  unlisteners.push(await listen<AgentSessionEndEvent>('agent:session_end', (event) => {
    store.handleSessionEnd(
      event.payload.agentId,
      event.payload.subtype,
      event.payload.totalCostUsd
    );
  }));

  // Subscribe to agent:crash
  unlisteners.push(await listen<AgentCrashEvent>('agent:crash', (event) => {
    store.handleCrash(event.payload.agentId, event.payload.exitCode, event.payload.signal);
  }));

  // Subscribe to hitl:request
  unlisteners.push(await listen<HitlRequestEvent>('hitl:request', (event) => {
    store.handleHitlRequest(event.payload.agentId, {
      requestId: event.payload.requestId,
      toolName: event.payload.toolName,
      input: event.payload.input,
      riskLevel: event.payload.riskLevel,
    });
  }));

  // Subscribe to reasoning:node_created
  unlisteners.push(await listen<ReasoningNodeEvent>('reasoning:node_created', (event) => {
    store.handleReasoningNode(event.payload.agentId, event.payload.node);
  }));

  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
