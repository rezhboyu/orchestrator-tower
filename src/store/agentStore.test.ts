import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';

describe('agentStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAgentStore.setState({
      agents: {},
      activeAgentId: null,
    });
  });

  it('handleSessionStart creates new agent with running status', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent).toBeDefined();
    expect(agent.status).toBe('running');
    expect(agent.sessionId).toBe('s1');
    expect(agent.model).toBe('claude-opus-4');
  });

  it('handleText appends message to agent', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleText('a1', 'Hello world');

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]).toEqual({ type: 'text', content: 'Hello world' });
  });

  it('handleToolUse appends tool_use message', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleToolUse('a1', 't1', 'Read', { path: '/test' });

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0].type).toBe('tool_use');
    expect(agent.messages[0].content).toEqual({
      toolId: 't1',
      toolName: 'Read',
      input: { path: '/test' },
    });
  });

  it('handleHitlRequest updates status to waiting_hitl', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleHitlRequest('a1', {
      requestId: 'r1',
      toolName: 'Bash',
      input: { command: 'ls' },
      riskLevel: 'medium',
    });

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent.status).toBe('waiting_hitl');
    expect(agent.hitlRequest).toBeDefined();
    expect(agent.hitlRequest?.requestId).toBe('r1');
  });

  it('clearHitlRequest resets status to running', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleHitlRequest('a1', {
      requestId: 'r1',
      toolName: 'Bash',
      input: {},
      riskLevel: 'low',
    });
    store.clearHitlRequest('a1');

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent.status).toBe('running');
    expect(agent.hitlRequest).toBeNull();
  });

  it('handleSessionEnd updates status based on subtype', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleSessionEnd('a1', 'success', 0.05);

    let agent = useAgentStore.getState().agents['a1'];
    expect(agent.status).toBe('idle');
    expect(agent.totalCostUsd).toBe(0.05);

    // Test error subtype
    store.handleSessionStart('a2', 's2', 'claude-opus-4');
    store.handleSessionEnd('a2', 'error', 0.01);

    agent = useAgentStore.getState().agents['a2'];
    expect(agent.status).toBe('error');
  });

  it('handleCrash sets status to error', () => {
    const store = useAgentStore.getState();
    store.handleSessionStart('a1', 's1', 'claude-opus-4');
    store.handleCrash('a1', 1, 'SIGTERM');

    const agent = useAgentStore.getState().agents['a1'];
    expect(agent.status).toBe('error');
  });

  it('setActiveAgent updates activeAgentId', () => {
    const store = useAgentStore.getState();
    store.setActiveAgent('a1');

    expect(useAgentStore.getState().activeAgentId).toBe('a1');

    store.setActiveAgent(null);
    expect(useAgentStore.getState().activeAgentId).toBeNull();
  });
});
