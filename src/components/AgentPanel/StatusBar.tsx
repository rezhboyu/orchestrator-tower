import type { AgentStatus } from '../../types/events';

interface StatusBarProps {
  agentId: string;
  status: AgentStatus;
  model: string | null;
  costUsd: number | null;
}

const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: '\u25CB',       // ○
  running: '\u25CF',    // ●
  waiting_hitl: '\u25C6', // ◆
  error: '\u2716',      // ✖
  frozen: '\u275A',     // ❚
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'text-gray-400',
  running: 'text-blue-500',
  waiting_hitl: 'text-orange-500',
  error: 'text-red-500',
  frozen: 'text-orange-300',
};

const formatCost = (cost: number | null): string => {
  if (cost === null) return '\u2014'; // —
  return `$${cost.toFixed(2)}`;
};

export const StatusBar: React.FC<StatusBarProps> = ({
  agentId,
  status,
  model,
  costUsd,
}) => {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-2">
        <span
          className={`${STATUS_COLORS[status]} ${status === 'running' ? 'animate-pulse' : ''}`}
          data-testid="status-icon"
        >
          {STATUS_ICONS[status]}
        </span>
        <span className="text-white font-medium">{agentId}</span>
        {model && (
          <span className="text-gray-400 text-sm">({model})</span>
        )}
      </div>
      <div className="text-gray-300 text-sm" data-testid="cost-display">
        {formatCost(costUsd)}
      </div>
    </div>
  );
};
