import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// Minimal in-memory chrome.storage.local + stubs for runtime/identity/tabs.
// Tests that need specific behavior override these per-test with vi.fn().
function makeChrome() {
  let store: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          if (keys == null) return { ...store };
          const names = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of names) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          store = { ...store, ...items };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const names = Array.isArray(keys) ? keys : [keys];
          for (const k of names) delete store[k];
        }),
        clear: vi.fn(async () => {
          store = {};
        }),
        __store: () => store,
        __reset: () => {
          store = {};
        },
      },
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      lastError: undefined as undefined | { message: string },
    },
    identity: {
      getRedirectURL: vi.fn(() => "https://abcdefghijklmnop.chromiumapp.org/"),
      launchWebAuthFlow: vi.fn(),
    },
    tabs: {
      query: vi.fn(async () => [{ title: "Example", url: "https://example.com/" }]),
    },
  };
}

(globalThis as any).chrome = makeChrome();

beforeEach(() => {
  (globalThis as any).chrome.storage.local.__reset();
  vi.clearAllMocks();
});
