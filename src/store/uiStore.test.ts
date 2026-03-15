import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, DEFAULT_MOSAIC_LAYOUT } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      layout: DEFAULT_MOSAIC_LAYOUT,
      showReasoningTree: true,
      sidebarCollapsed: false,
      language: 'en',
    });
  });

  it('resetLayout restores DEFAULT_MOSAIC_LAYOUT', () => {
    const store = useUiStore.getState();
    store.setLayout({ direction: 'row', first: 'a', second: 'b', splitPercentage: 50 });
    store.setShowReasoningTree(false);

    store.resetLayout();

    expect(useUiStore.getState().layout).toEqual(DEFAULT_MOSAIC_LAYOUT);
    expect(useUiStore.getState().showReasoningTree).toBe(true);
  });

  it('setShowReasoningTree toggles reasoning tree visibility', () => {
    const store = useUiStore.getState();

    store.setShowReasoningTree(false);
    expect(useUiStore.getState().showReasoningTree).toBe(false);

    store.setShowReasoningTree(true);
    expect(useUiStore.getState().showReasoningTree).toBe(true);
  });

  it('toggleSidebar inverts sidebarCollapsed', () => {
    const store = useUiStore.getState();

    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    store.toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setLanguage updates language', () => {
    const store = useUiStore.getState();

    store.setLanguage('zh-TW');
    expect(useUiStore.getState().language).toBe('zh-TW');

    store.setLanguage('en');
    expect(useUiStore.getState().language).toBe('en');
  });

  it('setLayout updates layout', () => {
    const store = useUiStore.getState();
    const newLayout = { direction: 'row' as const, first: 'x', second: 'y', splitPercentage: 30 };

    store.setLayout(newLayout);
    expect(useUiStore.getState().layout).toEqual(newLayout);
  });

  it('setSidebarCollapsed directly sets collapsed state', () => {
    const store = useUiStore.getState();

    store.setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    store.setSidebarCollapsed(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });
});
