import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../store/agentStore';
import { StatusBar } from './StatusBar';
import { MessageStream } from './MessageStream';
import { HitlReview } from './HitlReview';
import type { AgentStatus } from '../../types/events';

// Status -> Border color mapping (Tailwind classes)
const STATUS_BORDER_CLASSES: Record<AgentStatus, string> = {
  idle: 'border-gray-500',
  running: 'border-blue-500',
  waiting_hitl: 'border-orange-500',
  error: 'border-red-500',
  frozen: 'border-orange-300',
};

interface AgentTabProps {
  agentId: string;
  isActive: boolean;
  status: AgentStatus;
  onClick: () => void;
}

const AgentTab: React.FC<AgentTabProps> = ({
  agentId,
  isActive,
  status,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-t transition-colors ${
        isActive
          ? 'bg-gray-800 text-white'
          : 'bg-gray-900 text-gray-400 hover:text-gray-200'
      } border-b-2 ${STATUS_BORDER_CLASSES[status]}`}
      data-testid={`agent-tab-${agentId}`}
    >
      {agentId}
    </button>
  );
};

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();

  // Subscribe to store with precise selectors
  const agents = useAgentStore((state) => state.agents);
  const activeAgentId = useAgentStore((state) => state.activeAgentId);
  const setActiveAgent = useAgentStore((state) => state.setActiveAgent);
  const clearHitlRequest = useAgentStore((state) => state.clearHitlRequest);

  const agentIds = Object.keys(agents);
  const activeAgent = activeAgentId ? agents[activeAgentId] : null;

  const handleTabClick = useCallback(
    (agentId: string) => {
      setActiveAgent(agentId);
    },
    [setActiveAgent]
  );

  const handleHitlComplete = useCallback(() => {
    if (activeAgentId) {
      clearHitlRequest(activeAgentId);
    }
  }, [activeAgentId, clearHitlRequest]);

  // No agents state
  if (agentIds.length === 0) {
    return (
      <div
        className="h-full flex items-center justify-center bg-gray-900 text-gray-500"
        data-testid="agent-panel-empty"
      >
        {t('agentPanel.noAgent', 'No agents available')}
      </div>
    );
  }

  // Auto-select first agent if none selected
  if (!activeAgentId && agentIds.length > 0) {
    setActiveAgent(agentIds[0]);
    return null; // Re-render will happen
  }

  if (!activeAgent) {
    return null;
  }

  return (
    <div
      className={`h-full flex flex-col bg-gray-900 border-2 rounded-lg overflow-hidden ${
        STATUS_BORDER_CLASSES[activeAgent.status]
      }`}
      data-testid="agent-panel"
      data-status={activeAgent.status}
    >
      {/* Agent Tabs */}
      {agentIds.length > 1 && (
        <div
          className="flex gap-1 px-2 pt-2 bg-gray-900 overflow-x-auto"
          data-testid="agent-tabs"
        >
          {agentIds.map((agentId) => (
            <AgentTab
              key={agentId}
              agentId={agentId}
              isActive={agentId === activeAgentId}
              status={agents[agentId].status}
              onClick={() => handleTabClick(agentId)}
            />
          ))}
        </div>
      )}

      {/* Status Bar */}
      <StatusBar
        agentId={activeAgent.id}
        status={activeAgent.status}
        model={activeAgent.model}
        costUsd={activeAgent.totalCostUsd}
      />

      {/* Message Stream */}
      <MessageStream messages={activeAgent.messages} />

      {/* HITL Review (conditional) */}
      {activeAgent.status === 'waiting_hitl' && activeAgent.hitlRequest && (
        <HitlReview
          agentId={activeAgent.id}
          hitlRequest={activeAgent.hitlRequest}
          onComplete={handleHitlComplete}
        />
      )}
    </div>
  );
};

export default AgentPanel;
