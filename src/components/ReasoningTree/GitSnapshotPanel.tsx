import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../store/agentStore';
import type { ReasoningNode } from '../../types/events';

interface GitSnapshotPanelProps {
  selectedNodeId: string | null;
}

export const GitSnapshotPanel: React.FC<GitSnapshotPanelProps> = ({
  selectedNodeId,
}) => {
  const { t } = useTranslation();
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAgentId = useAgentStore((state) => state.activeAgentId);

  // Get selected node's data
  const selectedNode = useAgentStore(
    useCallback(
      (state): ReasoningNode | null => {
        if (!activeAgentId || !selectedNodeId) return null;
        const nodes = state.reasoningNodes[activeAgentId];
        if (!nodes) return null;
        return nodes.find((n) => n.id === selectedNodeId) ?? null;
      },
      [activeAgentId, selectedNodeId]
    )
  );

  const handleRollback = useCallback(async () => {
    if (!activeAgentId || !selectedNodeId || !selectedNode?.gitSnapshotSha) {
      return;
    }

    setIsRollingBack(true);
    setError(null);

    try {
      await invoke('rollback_to_node', {
        agentId: activeAgentId,
        nodeId: selectedNodeId,
      });
    } catch (err) {
      console.error('Rollback failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRollingBack(false);
    }
  }, [activeAgentId, selectedNodeId, selectedNode?.gitSnapshotSha]);

  // Don't render if no node selected or no SHA
  if (!selectedNode || !selectedNode.gitSnapshotSha) {
    return null;
  }

  return (
    <div
      className="absolute bottom-4 left-4 bg-gray-800/95 backdrop-blur rounded-lg p-4 shadow-xl border border-gray-700 max-w-xs"
      data-testid="git-snapshot-panel"
    >
      {/* Header */}
      <div className="text-sm text-gray-400 mb-2">
        {t('reasoningTree.gitSnapshot', 'Git Snapshot')}
      </div>

      {/* SHA Display */}
      <div className="flex items-center gap-2 mb-3">
        <code className="text-blue-400 font-mono text-sm bg-gray-900 px-2 py-1 rounded">
          {selectedNode.gitSnapshotSha.slice(0, 7)}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(selectedNode.gitSnapshotSha!);
          }}
          className="text-gray-400 hover:text-white text-xs"
          title="Copy full SHA"
        >
          \u2398
        </button>
      </div>

      {/* Node Info */}
      <div className="text-xs text-gray-500 mb-3">
        <span className="capitalize">{selectedNode.nodeType}</span>
        {' \u2022 '}
        <span className="capitalize">{selectedNode.status}</span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="text-xs text-red-400 mb-2 p-2 bg-red-900/30 rounded">
          {error}
        </div>
      )}

      {/* Rollback Button */}
      <button
        onClick={handleRollback}
        disabled={isRollingBack}
        className="w-full px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
        data-testid="rollback-button"
      >
        {isRollingBack
          ? t('reasoningTree.rollingBack', 'Rolling back...')
          : t('reasoningTree.rollback', 'Rollback to this state')}
      </button>
    </div>
  );
};
