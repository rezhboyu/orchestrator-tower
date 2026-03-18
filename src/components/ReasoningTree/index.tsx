import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../store/agentStore';
import { useReasoningTree, type ReasoningNodeData } from './useReasoningTree';
import { ReasoningNode } from './ReasoningNode';
import { GitSnapshotPanel } from './GitSnapshotPanel';
import type { AgentViewport } from '../../types/events';

// Register custom node types
const nodeTypes = {
  reasoning: ReasoningNode,
};

// MiniMap node color based on type
const getMinimapNodeColor = (node: Node): string => {
  const data = node.data as ReasoningNodeData | undefined;
  const typeColors: Record<string, string> = {
    thought: '#9CA3AF',     // gray
    tool_call: '#3B82F6',   // blue
    tool_result: '#10B981', // green
    decision: '#8B5CF6',    // purple
    error: '#EF4444',       // red
  };
  return typeColors[data?.nodeType as string] || '#6B7280';
};

/**
 * Inner component that uses React Flow hooks
 */
function ReasoningTreeInner() {
  const { t } = useTranslation();
  const activeAgentId = useAgentStore((state) => state.activeAgentId);

  // Use stable selector - only select the viewport for active agent
  const savedViewportSelector = useCallback(
    (state: { agentViewports: Record<string, AgentViewport> }) =>
      activeAgentId ? state.agentViewports[activeAgentId] : undefined,
    [activeAgentId]
  );
  const savedViewport = useAgentStore(savedViewportSelector);

  const { nodes, edges, isEmpty } = useReasoningTree(activeAgentId);
  const { setViewport, getViewport, fitView } = useReactFlow();

  // Selected node for GitSnapshotPanel
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Track previous agent for viewport persistence
  const prevAgentIdRef = useRef<string | null>(null);

  // Memoize savedViewport to prevent unnecessary effect triggers
  // Intentionally using individual fields to avoid re-triggering on reference changes
  const memoizedViewport = useMemo(
    () => savedViewport,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedViewport?.x, savedViewport?.y, savedViewport?.zoom]
  );

  // Save viewport when agent changes
  useEffect(() => {
    const prevAgentId = prevAgentIdRef.current;

    // Save current viewport before switching (access setAgentViewport via getState to avoid deps)
    if (prevAgentId && prevAgentId !== activeAgentId) {
      const currentViewport = getViewport();
      useAgentStore.getState().setAgentViewport(prevAgentId, currentViewport);
    }

    // Restore viewport for new agent or fit view
    if (activeAgentId) {
      if (memoizedViewport) {
        // Small delay to ensure nodes are rendered
        setTimeout(() => {
          setViewport(memoizedViewport, { duration: 200 });
        }, 50);
      } else if (nodes.length > 0) {
        // Fit view for first time
        setTimeout(() => {
          fitView({ padding: 0.2, duration: 200 });
        }, 50);
      }
    }

    // Clear selection on agent change
    setSelectedNodeId(null);
    prevAgentIdRef.current = activeAgentId;
  }, [activeAgentId, memoizedViewport, getViewport, setViewport, fitView, nodes.length]);

  // Handle node click - must use useCallback for performance
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  // Handle pane click to deselect
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Empty state
  if (isEmpty) {
    return (
      <div
        className="h-full flex items-center justify-center bg-gray-900 text-gray-500"
        data-testid="reasoning-tree-empty"
      >
        {t('reasoningTree.noNodes', 'No reasoning nodes yet')}
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-900" data-testid="reasoning-tree">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#6B7280' },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={16} />
        <Controls className="!bg-gray-800 !border-gray-700 [&>button]:!bg-gray-700 [&>button]:!border-gray-600 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-600" />
        <MiniMap
          nodeColor={getMinimapNodeColor}
          maskColor="rgba(17, 24, 39, 0.8)"
          className="!bg-gray-800 !border-gray-700"
        />
      </ReactFlow>

      {/* Git Snapshot Panel */}
      <GitSnapshotPanel selectedNodeId={selectedNodeId} />
    </div>
  );
}

/**
 * ReasoningTree component - wraps inner component with ReactFlowProvider
 */
export const ReasoningTree: React.FC = () => {
  return (
    <ReactFlowProvider>
      <ReasoningTreeInner />
    </ReactFlowProvider>
  );
};

export default ReasoningTree;
