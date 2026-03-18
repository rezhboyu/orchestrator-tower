import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Store } from '@tauri-apps/plugin-store';
import type { MosaicNode } from 'react-mosaic-component';

// Tauri Store adapter for Zustand persist
const tauriStoreAdapter = {
  store: null as Store | null,
  async init() {
    if (!this.store) {
      this.store = await Store.load('ui-settings.json');
    }
    return this.store;
  },
};

const tauriStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const store = await tauriStoreAdapter.init();
      const value = await store.get<string>(name);
      return value ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const store = await tauriStoreAdapter.init();
      await store.set(name, value);
      await store.save();
    } catch {
      // Ignore errors in non-Tauri environment
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const store = await tauriStoreAdapter.init();
      await store.delete(name);
      await store.save();
    } catch {
      // Ignore errors in non-Tauri environment
    }
  },
};

export const DEFAULT_MOSAIC_LAYOUT: MosaicNode<string> = {
  direction: 'column',
  first: 'agent-panels',
  second: 'reasoning-tree',
  splitPercentage: 70,
};

// Valid tile IDs for this application
const VALID_TILE_IDS = new Set(['agent-panels', 'reasoning-tree']);

/**
 * Validates a Mosaic layout to ensure no duplicate or invalid IDs
 */
function validateMosaicLayout(layout: MosaicNode<string> | null): boolean {
  if (!layout) return true;

  const seenIds = new Set<string>();

  function traverse(node: MosaicNode<string>): boolean {
    if (typeof node === 'string') {
      // Check for valid ID
      if (!VALID_TILE_IDS.has(node)) return false;
      // Check for duplicate
      if (seenIds.has(node)) return false;
      seenIds.add(node);
      return true;
    }
    // Branch node
    return traverse(node.first) && traverse(node.second);
  }

  return traverse(layout);
}

interface UiStoreState {
  // Layout
  layout: MosaicNode<string> | null;
  showReasoningTree: boolean;
  sidebarCollapsed: boolean;

  // Language
  language: 'zh-TW' | 'en';

  // Actions
  setLayout: (layout: MosaicNode<string> | null) => void;
  resetLayout: () => void;
  setShowReasoningTree: (show: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLanguage: (lang: 'zh-TW' | 'en') => void;
}

const getDefaultLanguage = (): 'zh-TW' | 'en' => {
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) {
    return 'zh-TW';
  }
  return 'en';
};

export const useUiStore = create<UiStoreState>()(
  persist(
    (set) => ({
      layout: DEFAULT_MOSAIC_LAYOUT,
      showReasoningTree: true,
      sidebarCollapsed: false,
      language: getDefaultLanguage(),

      setLayout: (layout) => set({ layout }),
      resetLayout: () => set({ layout: DEFAULT_MOSAIC_LAYOUT, showReasoningTree: true }),
      setShowReasoningTree: (show) => set({ showReasoningTree: show }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ui-store',
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        layout: state.layout,
        showReasoningTree: state.showReasoningTree,
        sidebarCollapsed: state.sidebarCollapsed,
        language: state.language,
      }),
      // Validate persisted layout on load - reset to default if invalid
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UiStoreState> | undefined;
        if (persisted?.layout && !validateMosaicLayout(persisted.layout)) {
          console.warn('Invalid persisted layout detected, resetting to default');
          return { ...currentState, ...persisted, layout: DEFAULT_MOSAIC_LAYOUT };
        }
        return { ...currentState, ...persisted };
      },
    }
  )
);
