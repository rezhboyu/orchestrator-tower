import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(() => Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    })),
  },
}));
