import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentPanel } from './index';
import { truncateInput } from './MessageStream';
import { useAgentStore } from '../../store/agentStore';
import type { AgentStatus } from '../../types/events';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

// Helper to create agent data
const createAgent = (
  id: string,
  status: AgentStatus,
  options: {
    hitlRequest?: {
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      riskLevel: 'critical' | 'high' | 'medium' | 'low';
    };
    totalCostUsd?: number | null;
    messages?: Array<{ type: 'text' | 'tool_use' | 'tool_result'; content: unknown }>;
  } = {}
) => ({
  id,
  status,
  sessionId: 'session-1',
  model: 'claude-opus-4-5-20251101',
  messages: options.messages || [],
  hitlRequest: options.hitlRequest || null,
  totalCostUsd: options.totalCostUsd ?? null,
});

describe('AgentPanel', () => {
  beforeEach(() => {
    // Reset store before each test
    useAgentStore.setState({
      agents: {},
      activeAgentId: null,
    });
  });

  // Test 1: Status border color corresponds to CSS class
  it.each([
    ['idle', 'border-gray-500'],
    ['running', 'border-blue-500'],
    ['waiting_hitl', 'border-orange-500'],
    ['error', 'border-red-500'],
    ['frozen', 'border-orange-300'],
  ] as const)('displays correct border color for %s status', (status, expectedClass) => {
    useAgentStore.setState({
      agents: { 'agent-1': createAgent('agent-1', status) },
      activeAgentId: 'agent-1',
    });

    render(<AgentPanel />);
    const panel = screen.getByTestId('agent-panel');
    expect(panel.className).toContain(expectedClass);
  });

  // Test 2: waiting_hitl auto-expands HITL area
  it('auto-expands HITL review area when status is waiting_hitl', () => {
    useAgentStore.setState({
      agents: {
        'agent-1': createAgent('agent-1', 'waiting_hitl', {
          hitlRequest: {
            requestId: 'req-1',
            toolName: 'Bash',
            input: { command: 'rm -rf /' },
            riskLevel: 'critical',
          },
        }),
      },
      activeAgentId: 'agent-1',
    });

    render(<AgentPanel />);
    expect(screen.getByTestId('hitl-review')).toBeInTheDocument();
  });

  // Test 3: No HITL request = no HITL DOM
  it('does not render HITL review area when status is not waiting_hitl', () => {
    useAgentStore.setState({
      agents: { 'agent-1': createAgent('agent-1', 'running') },
      activeAgentId: 'agent-1',
    });

    render(<AgentPanel />);
    expect(screen.queryByTestId('hitl-review')).not.toBeInTheDocument();
  });

  // Test 4: Tool card summary <= 60 characters
  it('truncates tool input summary to 60 characters or less', () => {
    const longInput = { path: '/very/long/path/to/some/file/that/exceeds/sixty/characters/definitely' };
    const truncated = truncateInput(longInput);
    expect(truncated.length).toBeLessThanOrEqual(60);
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('does not truncate short input', () => {
    const shortInput = { path: '/short' };
    const result = truncateInput(shortInput);
    expect(result).toBe(JSON.stringify(shortInput));
    expect(result.endsWith('...')).toBe(false);
  });

  // Test 5: costUsd display logic
  it('displays cost as "$X.XX" when costUsd is a number', () => {
    useAgentStore.setState({
      agents: {
        'agent-1': createAgent('agent-1', 'idle', { totalCostUsd: 0.05 }),
      },
      activeAgentId: 'agent-1',
    });

    render(<AgentPanel />);
    const costDisplay = screen.getByTestId('cost-display');
    expect(costDisplay.textContent).toBe('$0.05');
  });

  it('displays "—" when costUsd is null', () => {
    useAgentStore.setState({
      agents: {
        'agent-1': createAgent('agent-1', 'idle', { totalCostUsd: null }),
      },
      activeAgentId: 'agent-1',
    });

    render(<AgentPanel />);
    const costDisplay = screen.getByTestId('cost-display');
    expect(costDisplay.textContent).toBe('\u2014'); // em-dash
  });

  // Additional test: Empty state
  it('shows empty state when no agents are available', () => {
    useAgentStore.setState({
      agents: {},
      activeAgentId: null,
    });

    render(<AgentPanel />);
    expect(screen.getByTestId('agent-panel-empty')).toBeInTheDocument();
  });
});
