import { useMemo } from 'react';
import {
  Mosaic,
  MosaicWindow,
  MosaicWindowContext,
  ExpandButton,
  RemoveButton,
} from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useUiStore, DEFAULT_MOSAIC_LAYOUT } from '../../store/uiStore';
import { AgentPanel } from '../AgentPanel';
import { ReasoningTree } from '../ReasoningTree';
import 'react-mosaic-component/react-mosaic-component.css';

const TILE_MAP: Record<string, React.ReactNode> = {
  'agent-panels': <AgentPanel />,
  'reasoning-tree': <ReasoningTree />,
};

const TITLE_MAP: Record<string, string> = {
  'agent-panels': 'Agent Panels',
  'reasoning-tree': 'Reasoning Tree',
};

// Custom toolbar without Split button (we have fixed panels, splitting causes duplicate ID errors)
const CustomToolbar: React.FC = () => (
  <MosaicWindowContext.Consumer>
    {() => (
      <div className="mosaic-default-toolbar">
        <ExpandButton />
        <RemoveButton />
      </div>
    )}
  </MosaicWindowContext.Consumer>
);

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
            toolbarControls={<CustomToolbar />}
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
