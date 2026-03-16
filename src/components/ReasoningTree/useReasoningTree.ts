import { useMemo, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import dagre from 'dagre';
import { useAgentStore } from '../../store/agentStore';
import type { ReasoningNode, NodeType, NodeStatus } from '../../types/events';

export interface ReasoningNodeData {
  nodeId: string;
  nodeType: NodeType;
  content: string;
  status: NodeStatus;
  gitSnapshotSha: string | null;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

interface UseReasoningTreeReturn {
  nodes: Node[];
  edges: Edge[];
  isEmpty: boolean;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/**
 * Applies dagre layout to position nodes in a top-to-bottom DAG
 */
function applyDagreLayout(
  nodes: Node[],
  edges: Edge[]
): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 50, nodesep: 30 });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // Run layout
  dagre.layout(g);

  // Apply calculated positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/**
 * Transforms ReasoningNode[] from store into React Flow nodes/edges
 */
function transformToFlowElements(
  reasoningNodes: ReasoningNode[]
): { nodes: Node[]; edges: Edge[] } {
  // Build nodes
  const flowNodes: Node[] = reasoningNodes.map((node) => ({
    id: node.id,
    type: 'reasoning', // Custom node type
    position: { x: 0, y: 0 }, // Will be set by dagre
    data: {
      nodeId: node.id,
      nodeType: node.nodeType,
      content: node.content,
      status: node.status,
      gitSnapshotSha: node.gitSnapshotSha,
    },
  }));

  // Build edges from parent-child relationships
  const flowEdges: Edge[] = reasoningNodes
    .filter((node) => node.parentId !== null)
    .map((node) => ({
      id: `e-${node.parentId}-${node.id}`,
      source: node.parentId!,
      target: node.id,
      type: 'smoothstep',
      animated: node.status === 'pending',
    }));

  // Apply layout
  const positionedNodes = applyDagreLayout(flowNodes, flowEdges);

  return { nodes: positionedNodes, edges: flowEdges };
}

/**
 * Hook to get React Flow nodes/edges for a specific agent's reasoning tree
 */
export function useReasoningTree(agentId: string | null): UseReasoningTreeReturn {
  // Use precise selector to avoid unnecessary re-renders
  const reasoningNodes = useAgentStore(
    useCallback(
      (state) => (agentId ? state.reasoningNodes[agentId] ?? [] : []),
      [agentId]
    )
  );

  const { nodes, edges } = useMemo(() => {
    if (!reasoningNodes || reasoningNodes.length === 0) {
      return { nodes: [], edges: [] };
    }
    return transformToFlowElements(reasoningNodes);
  }, [reasoningNodes]);

  return {
    nodes,
    edges,
    isEmpty: nodes.length === 0,
  };
}

// Export for testing
export { transformToFlowElements, applyDagreLayout };
