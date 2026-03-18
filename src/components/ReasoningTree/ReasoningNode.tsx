import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ReasoningNodeData } from './useReasoningTree';
import type { NodeType, NodeStatus } from '../../types/events';

// Node type -> background and border color mapping
const NODE_STYLES: Record<NodeType, { bg: string; border: string }> = {
  thought: { bg: 'bg-white', border: 'border-gray-400' },
  tool_call: { bg: 'bg-blue-100', border: 'border-blue-500' },
  tool_result: { bg: 'bg-green-100', border: 'border-green-500' },
  decision: { bg: 'bg-purple-100', border: 'border-purple-500' },
  error: { bg: 'bg-red-200', border: 'border-red-600' },
};

// Status modifiers
const STATUS_MODIFIERS: Record<NodeStatus, string> = {
  pending: 'animate-pulse opacity-70',
  active: 'ring-2 ring-blue-400',
  completed: '',
  failed: 'opacity-80',
  frozen: 'opacity-50',
};

// Node type labels
const NODE_TYPE_LABELS: Record<NodeType, string> = {
  thought: 'Thought',
  tool_call: 'Tool Call',
  tool_result: 'Result',
  decision: 'Decision',
  error: 'Error',
};

// Parse content JSON safely
function parseContentSummary(content: string): string {
  try {
    const parsed = JSON.parse(content);
    // Try to get a summary from common fields
    if (typeof parsed === 'string') return parsed;
    if (parsed.summary) return parsed.summary;
    if (parsed.text) return parsed.text;
    if (parsed.toolName) return parsed.toolName;
    if (parsed.message) return parsed.message;
    // Fallback to stringified (truncated)
    const str = JSON.stringify(parsed);
    return str.length > 50 ? str.slice(0, 47) + '...' : str;
  } catch {
    return content.length > 50 ? content.slice(0, 47) + '...' : content;
  }
}

/**
 * Custom React Flow node for reasoning tree visualization
 * CRITICAL: Must be wrapped with memo() for performance
 */
const ReasoningNodeComponent = ({ data }: { data: Record<string, unknown> }) => {
  const nodeData = data as unknown as ReasoningNodeData;
  const { nodeType, content, status, gitSnapshotSha } = nodeData;

  // Determine styles based on type and status
  const typeStyle = NODE_STYLES[nodeType] || NODE_STYLES.thought;
  const statusModifier = STATUS_MODIFIERS[status] || '';

  // Special case: tool_result with failed status uses error colors
  const finalBg =
    nodeType === 'tool_result' && status === 'failed'
      ? 'bg-red-100'
      : typeStyle.bg;
  const finalBorder =
    nodeType === 'tool_result' && status === 'failed'
      ? 'border-red-500'
      : typeStyle.border;

  const contentSummary = parseContentSummary(content);

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-md min-w-[180px] max-w-[200px] ${finalBg} ${finalBorder} ${statusModifier}`}
      data-testid="reasoning-node"
      data-node-type={nodeType}
      data-status={status}
    >
      {/* Target handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-gray-600 !w-2 !h-2"
      />

      {/* Header with type label */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-700 uppercase">
          {NODE_TYPE_LABELS[nodeType]}
        </span>
        {status === 'pending' && (
          <span className="text-xs text-blue-600">...</span>
        )}
        {status === 'failed' && (
          <span className="text-xs text-red-600">\u2716</span>
        )}
        {status === 'completed' && (
          <span className="text-xs text-green-600">\u2714</span>
        )}
      </div>

      {/* Content summary */}
      <div className="text-sm text-gray-800 truncate" title={content}>
        {contentSummary}
      </div>

      {/* Git snapshot SHA (if available) */}
      {gitSnapshotSha && (
        <div className="mt-1 text-xs text-gray-500 font-mono">
          SHA: {gitSnapshotSha.slice(0, 7)}
        </div>
      )}

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-gray-600 !w-2 !h-2"
      />
    </div>
  );
};

// CRITICAL: memo wrapper for performance with large node counts
export const ReasoningNode = memo(ReasoningNodeComponent);

// Export for type registration
export default ReasoningNode;
