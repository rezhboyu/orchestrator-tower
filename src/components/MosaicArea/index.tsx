import { useMemo } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useUiStore, DEFAULT_MOSAIC_LAYOUT } from '../../store/uiStore';
import 'react-mosaic-component/react-mosaic-component.css';

// Placeholder components (will be replaced in Task 12/13)
const AgentPanelsPlaceholder: React.FC = () => (
  <div className="flex items-center justify-center h-full bg-gray-800 text-gray-400">
    Agent Panels (Task 12)
  </div>
);

const ReasoningTreePlaceholder: React.FC = () => (
  <div className="flex items-center justify-center h-full bg-gray-800 text-gray-400">
    Reasoning Tree (Task 13)
  </div>
);

const TILE_MAP: Record<string, React.ReactNode> = {
  'agent-panels': <AgentPanelsPlaceholder />,
  'reasoning-tree': <ReasoningTreePlaceholder />,
};

const TITLE_MAP: Record<string, string> = {
  'agent-panels': 'Agent Panels',
  'reasoning-tree': 'Reasoning Tree',
};

export const MosaicArea: React.FC = () => {
  const { layout, setLayout, showReasoningTree } = useUiStore();

  // Compute effective layout based on showReasoningTree toggle
  const effectiveLayout = useMemo((): MosaicNode<string> | null => {
    if (!showReasoningTree) {
      // When reasoning tree is hidden, show only agent-panels
      return 'agent-panels';
    }
    return layout ?? DEFAULT_MOSAIC_LAYOUT;
  }, [layout, showReasoningTree]);

  const handleLayoutChange = (newLayout: MosaicNode<string> | null) => {
    // Only persist layout changes when reasoning tree is visible
    if (showReasoningTree) {
      setLayout(newLayout);
    }
  };

  return (
    <div className="flex-1 bg-gray-900" data-testid="mosaic-area">
      <Mosaic<string>
        renderTile={(id, path) => (
          <MosaicWindow<string>
            path={path}
            title={TITLE_MAP[id] || id}
            createNode={() => 'agent-panels'}
          >
            {TILE_MAP[id] || <div>Unknown tile: {id}</div>}
          </MosaicWindow>
        )}
        value={effectiveLayout}
        onChange={handleLayoutChange}
        className="mosaic-dark"
      />
    </div>
  );
};

export default MosaicArea;
