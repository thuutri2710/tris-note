# Notion Web Clipper — Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome MV3 browser extension that clips the current tab into a user's Notion workspace, talking to the already-built Cloudflare Worker for OAuth exchange and clip-saving, and to the Notion API directly for database discovery.

**Architecture:** Svelte 5 popup (UI) + a background service worker (OAuth via `chrome.identity.launchWebAuthFlow`, Notion database listing, clip dispatch) + a `lib/` of pure, unit-tested logic (storage, destination selection, message shapes, response parsing). The popup never touches the network directly — it sends messages to the background worker, which calls the Worker and the Notion API. Pure logic is TDD'd with vitest; Svelte components with `@testing-library/svelte` + jsdom; the live OAuth/clip path has a manual checklist.

**Tech Stack:** Svelte 5 (runes), Vite 5, `@crxjs/vite-plugin` v2 (MV3 bundling + HMR), TypeScript, vitest, `@testing-library/svelte`, jsdom, `@types/chrome`, pnpm.

---

## Worker Contract (already built — do not change)

The extension is a client of these. Match them exactly.

- `POST {WORKER_URL}/oauth/exchange` — body `{ code, redirectUri }` → returns the raw Notion token bundle: `{ access_token, workspace_id, workspace_name, workspace_icon, bot_id, ... }`.
- `POST {WORKER_URL}/clip` — body `{ accessToken, databaseId, title, url, note }` → `{ ok: true, pageUrl: string, fallback: boolean }`. On error returns `{ error: string }` with a non-2xx status.

Database discovery is **not** in the Worker — the extension calls Notion directly from the background service worker:
- `POST https://api.notion.com/v1/search` — headers `Authorization: Bearer <token>`, `Notion-Version: 2022-06-28`, `Content-Type: application/json`; body `{ filter: { property: "object", value: "database" }, page_size: 100 }` → `{ results: [{ id, title: RichText[], icon, ... }] }`. A 401 here means the token was revoked → reconnect.

## File Structure

```
/extension
  package.json
  pnpm-workspace.yaml?      (no — standalone)
  tsconfig.json
  vite.config.ts            Vite + CRXJS + Svelte
  svelte.config.js
  vitest.config.ts          jsdom env + chrome stub setup
  manifest.config.ts        MV3 manifest (typed, CRXJS), incl. pinned dev `key`
  .env.example              VITE_WORKER_URL, VITE_NOTION_CLIENT_ID
  .gitignore
  test/
    setup.ts                installs a fake `chrome` global
    storage.test.ts
    destination.test.ts
    messages.test.ts
    oauth.test.ts
    notion.test.ts
    worker-client.test.ts
    router.test.ts
    App.test.ts
  src/
    config.ts               reads import.meta.env (WORKER_URL, CLIENT_ID)
    lib/
      types.ts              Connection, DatabaseOption, Destination, messages, ClipResult
      storage.ts            chrome.storage.local helpers
      destination.ts        pure selection helpers
      messages.ts           message builders + type guards
      notion.ts             buildSearchRequest, parseDatabaseList, databaseTitle
      worker-client.ts      exchangeCode(), clip() — fetch wrappers around the Worker
    background/
      index.ts              service worker entry: message router wiring
      router.ts             pure-ish handleMessage(deps, msg) — testable
      oauth.ts              buildAuthUrl, parseAuthCode, runOAuth (launchWebAuthFlow)
    popup/
      index.html            popup document
      main.ts               mounts App.svelte
      App.svelte            main popup component
      lib-bridge.ts         sendMessage() promise wrapper around chrome.runtime
      components/
        DatabasePicker.svelte
        WorkspaceSelector.svelte
        StatusBanner.svelte
  DEVELOPMENT.md            (created in final task; also documents the Worker)
```

---

## Task 0: Scaffold the extension project

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/svelte.config.js`
- Create: `extension/vite.config.ts`
- Create: `extension/vitest.config.ts`
- Create: `extension/manifest.config.ts`
- Create: `extension/.env.example`
- Create: `extension/.gitignore`
- Create: `extension/src/config.ts`
- Create: `extension/src/popup/index.html`
- Create: `extension/src/popup/main.ts`
- Create: `extension/src/popup/App.svelte` (placeholder)
- Create: `extension/src/background/index.ts` (placeholder)
- Create: `extension/test/setup.ts`

- [ ] **Step 1: Create `extension/package.json`**

```json
{
  "name": "notion-web-clipper-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.28",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/svelte": "^5.2.0",
    "@types/chrome": "^0.0.268",
    "jsdom": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["chrome", "vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "resolveJsonModule": true
  },
  "include": ["src", "test", "manifest.config.ts", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `extension/svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 4: Create `extension/manifest.config.ts`**

```ts
import { defineManifest } from "@crxjs/vite-plugin";

// `key` pins a deterministic extension ID in dev so the OAuth redirect URI
// (https://<id>.chromiumapp.org/) stays stable across reloads. Generate it
// once (see DEVELOPMENT.md "Pin the dev extension ID") and paste the base64
// public key below. Leave undefined to let Chrome assign a random dev ID.
const DEV_KEY: string | undefined = undefined;

export default defineManifest({
  manifest_version: 3,
  name: "Web Clipper for Notion (unofficial)",
  version: "0.1.0",
  description: "Clip the current page into your Notion workspace.",
  ...(DEV_KEY ? { key: DEV_KEY } : {}),
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Clip to Notion",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["identity", "storage", "tabs"],
  host_permissions: ["https://api.notion.com/*"],
});
```

- [ ] **Step 5: Create `extension/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
  build: { target: "esnext" },
});
```

- [ ] **Step 6: Create `extension/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    // testing-library/svelte needs the browser build of svelte
    conditions: ["browser"],
  },
});
```

- [ ] **Step 7: Create `extension/test/setup.ts`** (fake `chrome` global usable by all tests)

```ts
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
```

- [ ] **Step 8: Create `extension/src/config.ts`**

```ts
// Build-time config injected via Vite env (.env / .env.local). See .env.example.
export const WORKER_URL: string =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
export const NOTION_CLIENT_ID: string =
  import.meta.env.VITE_NOTION_CLIENT_ID ?? "";
export const NOTION_VERSION = "2022-06-28";
```

- [ ] **Step 9: Create `extension/.env.example`**

```
# Copy to `.env.local`. Do NOT commit `.env.local`.
# The deployed (or local `wrangler dev`) Worker base URL, no trailing slash.
VITE_WORKER_URL="http://localhost:8787"
# The Notion public integration's OAuth client_id (NOT the secret).
VITE_NOTION_CLIENT_ID="your-notion-oauth-client-id"
```

- [ ] **Step 10: Create `extension/.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
```

- [ ] **Step 11: Create placeholder `extension/src/popup/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clip to Notion</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 12: Create placeholder `extension/src/popup/main.ts`**

```ts
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });
export default app;
```

- [ ] **Step 13: Create placeholder `extension/src/popup/App.svelte`**

```svelte
<main>
  <h1>Clip to Notion</h1>
</main>
```

- [ ] **Step 14: Create placeholder `extension/src/background/index.ts`**

```ts
// Service worker entry. Wired up in Task 7.
console.log("Notion Web Clipper background worker loaded");
```

- [ ] **Step 15: Install dependencies and verify the build**

Run: `cd extension && pnpm install && pnpm build`
Expected: install succeeds; `vite build` writes a `dist/` containing `manifest.json`, the popup HTML/JS, and the background service worker, with no errors.

- [ ] **Step 16: Commit**

```bash
git add extension/
git commit -m "chore(extension): scaffold MV3 Svelte + CRXJS project"
```

---

## Task 1: Shared types

**Files:**
- Create: `extension/src/lib/types.ts`

No test (declaration-only module). Later tasks import from here.

- [ ] **Step 1: Create `extension/src/lib/types.ts`**

```ts
/** One connected Notion workspace (one OAuth grant). */
export type Connection = {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  accessToken: string;
  botId: string;
};

/** A database the integration can write to, shown in the "Add to" picker. */
export type DatabaseOption = {
  id: string;
  title: string;
};

/** Restores the user's last choice across popup opens. */
export type Destination = {
  workspaceId: string;
  databaseId: string;
};

/** Worker /clip response. */
export type ClipResult = {
  ok: boolean;
  pageUrl: string;
  fallback: boolean;
};

/** The raw Notion OAuth token bundle the Worker returns from /oauth/exchange. */
export type NotionTokenBundle = {
  access_token: string;
  workspace_id: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  bot_id: string;
};

// --- Messages: popup -> background ----------------------------------------

export type GetStateMessage = { type: "getState" };
export type ConnectMessage = { type: "connect" };
export type ListDatabasesMessage = { type: "listDatabases"; workspaceId: string };
export type ClipMessage = {
  type: "clip";
  payload: {
    workspaceId: string;
    databaseId: string;
    title: string;
    url: string;
    note: string;
  };
};

export type RequestMessage =
  | GetStateMessage
  | ConnectMessage
  | ListDatabasesMessage
  | ClipMessage;

// --- Responses: background -> popup ----------------------------------------

export type GetStateResponse = {
  ok: true;
  connections: Connection[];
  lastDestination: Destination | null;
};
export type ConnectResponse =
  | { ok: true; connection: Connection }
  | { ok: false; error: string };
export type ListDatabasesResponse =
  | { ok: true; databases: DatabaseOption[] }
  | { ok: false; error: string; needsReconnect?: boolean };
export type ClipResponse =
  | { ok: true; result: ClipResult }
  | { ok: false; error: string; needsReconnect?: boolean };

export type ResponseFor<M extends RequestMessage> = M extends GetStateMessage
  ? GetStateResponse
  : M extends ConnectMessage
    ? ConnectResponse
    : M extends ListDatabasesMessage
      ? ListDatabasesResponse
      : M extends ClipMessage
        ? ClipResponse
        : never;
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/lib/types.ts
git commit -m "feat(extension): shared types for connections, messages, responses"
```

---

## Task 2: Storage helpers

**Files:**
- Create: `extension/src/lib/storage.ts`
- Test: `extension/test/storage.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/test/storage.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  getConnections,
  saveConnection,
  removeConnection,
  getLastDestination,
  setLastDestination,
} from "../src/lib/storage";
import type { Connection } from "../src/lib/types";

const connA: Connection = {
  workspaceId: "ws-a",
  workspaceName: "Workspace A",
  workspaceIcon: null,
  accessToken: "tok-a",
  botId: "bot-a",
};
const connAUpdated: Connection = { ...connA, accessToken: "tok-a2" };
const connB: Connection = {
  workspaceId: "ws-b",
  workspaceName: "Workspace B",
  workspaceIcon: "https://x/i.png",
  accessToken: "tok-b",
  botId: "bot-b",
};

describe("connections storage", () => {
  it("returns [] when nothing stored", async () => {
    expect(await getConnections()).toEqual([]);
  });

  it("saves and reads back a connection", async () => {
    await saveConnection(connA);
    expect(await getConnections()).toEqual([connA]);
  });

  it("replaces an existing connection by workspaceId (no duplicates)", async () => {
    await saveConnection(connA);
    await saveConnection(connAUpdated);
    const all = await getConnections();
    expect(all).toHaveLength(1);
    expect(all[0].accessToken).toBe("tok-a2");
  });

  it("keeps multiple distinct workspaces", async () => {
    await saveConnection(connA);
    await saveConnection(connB);
    expect((await getConnections()).map((c) => c.workspaceId)).toEqual([
      "ws-a",
      "ws-b",
    ]);
  });

  it("removes a connection by workspaceId", async () => {
    await saveConnection(connA);
    await saveConnection(connB);
    await removeConnection("ws-a");
    expect((await getConnections()).map((c) => c.workspaceId)).toEqual(["ws-b"]);
  });
});

describe("lastDestination storage", () => {
  it("returns null when unset", async () => {
    expect(await getLastDestination()).toBeNull();
  });

  it("round-trips a destination", async () => {
    await setLastDestination({ workspaceId: "ws-a", databaseId: "db-1" });
    expect(await getLastDestination()).toEqual({
      workspaceId: "ws-a",
      databaseId: "db-1",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- storage`
Expected: FAIL — cannot find module `../src/lib/storage`.

- [ ] **Step 3: Write `extension/src/lib/storage.ts`**

```ts
import type { Connection, Destination } from "./types";

const CONNECTIONS_KEY = "connections";
const LAST_DESTINATION_KEY = "lastDestination";

export async function getConnections(): Promise<Connection[]> {
  const data = await chrome.storage.local.get(CONNECTIONS_KEY);
  const value = data[CONNECTIONS_KEY];
  return Array.isArray(value) ? (value as Connection[]) : [];
}

export async function saveConnection(connection: Connection): Promise<void> {
  const existing = await getConnections();
  const next = existing.filter(
    (c) => c.workspaceId !== connection.workspaceId,
  );
  next.push(connection);
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: next });
}

export async function removeConnection(workspaceId: string): Promise<void> {
  const existing = await getConnections();
  const next = existing.filter((c) => c.workspaceId !== workspaceId);
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: next });
}

export async function getLastDestination(): Promise<Destination | null> {
  const data = await chrome.storage.local.get(LAST_DESTINATION_KEY);
  const value = data[LAST_DESTINATION_KEY];
  if (value && typeof value === "object" && "workspaceId" in value) {
    return value as Destination;
  }
  return null;
}

export async function setLastDestination(dest: Destination): Promise<void> {
  await chrome.storage.local.set({ [LAST_DESTINATION_KEY]: dest });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- storage`
Expected: PASS (all storage tests green).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/storage.ts extension/test/storage.test.ts
git commit -m "feat(extension): chrome.storage helpers for connections + last destination"
```

---

## Task 3: Destination selection helpers

**Files:**
- Create: `extension/src/lib/destination.ts`
- Test: `extension/test/destination.test.ts`

These pure helpers decide which workspace/database is preselected when the popup opens.

- [ ] **Step 1: Write the failing test** — `extension/test/destination.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  pickInitialWorkspaceId,
  pickInitialDatabaseId,
} from "../src/lib/destination";
import type { Connection, DatabaseOption } from "../src/lib/types";

const conns: Connection[] = [
  { workspaceId: "ws-a", workspaceName: "A", workspaceIcon: null, accessToken: "t", botId: "b" },
  { workspaceId: "ws-b", workspaceName: "B", workspaceIcon: null, accessToken: "t", botId: "b" },
];
const dbs: DatabaseOption[] = [
  { id: "db-1", title: "One" },
  { id: "db-2", title: "Two" },
];

describe("pickInitialWorkspaceId", () => {
  it("returns null when there are no connections", () => {
    expect(pickInitialWorkspaceId([], null)).toBeNull();
  });

  it("prefers the last destination's workspace when still connected", () => {
    expect(pickInitialWorkspaceId(conns, { workspaceId: "ws-b", databaseId: "db-2" }))
      .toBe("ws-b");
  });

  it("falls back to the first connection when last is missing or gone", () => {
    expect(pickInitialWorkspaceId(conns, null)).toBe("ws-a");
    expect(pickInitialWorkspaceId(conns, { workspaceId: "ws-gone", databaseId: "x" }))
      .toBe("ws-a");
  });
});

describe("pickInitialDatabaseId", () => {
  it("returns null when there are no databases", () => {
    expect(pickInitialDatabaseId([], null, "ws-a")).toBeNull();
  });

  it("prefers the last destination's database when it belongs to this workspace and exists", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-a", databaseId: "db-2" }, "ws-a"),
    ).toBe("db-2");
  });

  it("falls back to the first database when last is for a different workspace", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-b", databaseId: "db-2" }, "ws-a"),
    ).toBe("db-1");
  });

  it("falls back to the first database when the last db no longer exists", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-a", databaseId: "db-gone" }, "ws-a"),
    ).toBe("db-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- destination`
Expected: FAIL — cannot find module `../src/lib/destination`.

- [ ] **Step 3: Write `extension/src/lib/destination.ts`**

```ts
import type { Connection, DatabaseOption, Destination } from "./types";

export function pickInitialWorkspaceId(
  connections: Connection[],
  last: Destination | null,
): string | null {
  if (connections.length === 0) return null;
  if (last && connections.some((c) => c.workspaceId === last.workspaceId)) {
    return last.workspaceId;
  }
  return connections[0].workspaceId;
}

export function pickInitialDatabaseId(
  databases: DatabaseOption[],
  last: Destination | null,
  workspaceId: string | null,
): string | null {
  if (databases.length === 0) return null;
  if (
    last &&
    last.workspaceId === workspaceId &&
    databases.some((d) => d.id === last.databaseId)
  ) {
    return last.databaseId;
  }
  return databases[0].id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- destination`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/destination.ts extension/test/destination.test.ts
git commit -m "feat(extension): pure initial workspace/database selection helpers"
```

---

## Task 4: Message builders + type guards

**Files:**
- Create: `extension/src/lib/messages.ts`
- Test: `extension/test/messages.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/test/messages.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  getStateMessage,
  connectMessage,
  listDatabasesMessage,
  clipMessage,
  isRequestMessage,
} from "../src/lib/messages";

describe("message builders", () => {
  it("builds a getState message", () => {
    expect(getStateMessage()).toEqual({ type: "getState" });
  });

  it("builds a connect message", () => {
    expect(connectMessage()).toEqual({ type: "connect" });
  });

  it("builds a listDatabases message", () => {
    expect(listDatabasesMessage("ws-a")).toEqual({
      type: "listDatabases",
      workspaceId: "ws-a",
    });
  });

  it("builds a clip message with the full payload", () => {
    const msg = clipMessage({
      workspaceId: "ws-a",
      databaseId: "db-1",
      title: "T",
      url: "https://x/",
      note: "n",
    });
    expect(msg).toEqual({
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "n",
      },
    });
  });
});

describe("isRequestMessage", () => {
  it("accepts known message types", () => {
    expect(isRequestMessage({ type: "getState" })).toBe(true);
    expect(isRequestMessage({ type: "clip", payload: {} })).toBe(true);
  });

  it("rejects unknown or malformed values", () => {
    expect(isRequestMessage(null)).toBe(false);
    expect(isRequestMessage({})).toBe(false);
    expect(isRequestMessage({ type: "nope" })).toBe(false);
    expect(isRequestMessage("getState")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- messages`
Expected: FAIL — cannot find module `../src/lib/messages`.

- [ ] **Step 3: Write `extension/src/lib/messages.ts`**

```ts
import type {
  ClipMessage,
  ConnectMessage,
  GetStateMessage,
  ListDatabasesMessage,
  RequestMessage,
} from "./types";

export function getStateMessage(): GetStateMessage {
  return { type: "getState" };
}

export function connectMessage(): ConnectMessage {
  return { type: "connect" };
}

export function listDatabasesMessage(workspaceId: string): ListDatabasesMessage {
  return { type: "listDatabases", workspaceId };
}

export function clipMessage(payload: ClipMessage["payload"]): ClipMessage {
  return { type: "clip", payload };
}

const KNOWN_TYPES = new Set([
  "getState",
  "connect",
  "listDatabases",
  "clip",
]);

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string" &&
    KNOWN_TYPES.has((value as { type: string }).type)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- messages`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/messages.ts extension/test/messages.test.ts
git commit -m "feat(extension): message builders and request type guard"
```

---

## Task 5: Notion search request + database-list parsing

**Files:**
- Create: `extension/src/lib/notion.ts`
- Test: `extension/test/notion.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/test/notion.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  buildSearchRequest,
  databaseTitle,
  parseDatabaseList,
} from "../src/lib/notion";

describe("buildSearchRequest", () => {
  it("targets the Notion search endpoint with the database filter and auth", () => {
    const req = buildSearchRequest("tok-123");
    expect(req.url).toBe("https://api.notion.com/v1/search");
    expect(req.init.method).toBe("POST");
    const headers = req.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-123");
    expect(headers["Notion-Version"]).toBe("2022-06-28");
    expect(JSON.parse(req.init.body as string)).toEqual({
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
  });
});

describe("databaseTitle", () => {
  it("joins rich-text plain_text segments", () => {
    expect(
      databaseTitle({
        title: [
          { plain_text: "My " },
          { plain_text: "Clips" },
        ],
      }),
    ).toBe("My Clips");
  });

  it("falls back to 'Untitled' when title is empty or missing", () => {
    expect(databaseTitle({ title: [] })).toBe("Untitled");
    expect(databaseTitle({})).toBe("Untitled");
  });
});

describe("parseDatabaseList", () => {
  it("maps a search response to {id, title} options, skipping non-databases", () => {
    const res = {
      results: [
        { object: "database", id: "db-1", title: [{ plain_text: "One" }] },
        { object: "page", id: "pg-x", properties: {} },
        { object: "database", id: "db-2", title: [] },
      ],
    };
    expect(parseDatabaseList(res)).toEqual([
      { id: "db-1", title: "One" },
      { id: "db-2", title: "Untitled" },
    ]);
  });

  it("returns [] for a malformed response", () => {
    expect(parseDatabaseList(null)).toEqual([]);
    expect(parseDatabaseList({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- notion`
Expected: FAIL — cannot find module `../src/lib/notion`.

- [ ] **Step 3: Write `extension/src/lib/notion.ts`**

```ts
import type { DatabaseOption } from "./types";
import { NOTION_VERSION } from "../config";

const SEARCH_URL = "https://api.notion.com/v1/search";

export function buildSearchRequest(token: string): {
  url: string;
  init: RequestInit;
} {
  return {
    url: SEARCH_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "object", value: "database" },
        page_size: 100,
      }),
    },
  };
}

export function databaseTitle(db: any): string {
  const parts: string[] = Array.isArray(db?.title)
    ? db.title.map((t: any) => t?.plain_text ?? "")
    : [];
  const joined = parts.join("").trim();
  return joined || "Untitled";
}

export function parseDatabaseList(response: any): DatabaseOption[] {
  const results = response?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r?.object === "database")
    .map((r) => ({ id: r.id as string, title: databaseTitle(r) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- notion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/notion.ts extension/test/notion.test.ts
git commit -m "feat(extension): Notion search request builder + database-list parser"
```

---

## Task 6: Worker client (OAuth exchange + clip) and OAuth URL/code helpers

**Files:**
- Create: `extension/src/lib/worker-client.ts`
- Create: `extension/src/background/oauth.ts`
- Test: `extension/test/worker-client.test.ts`
- Test: `extension/test/oauth.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/test/worker-client.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { exchangeCode, clipViaWorker } from "../src/lib/worker-client";

describe("exchangeCode", () => {
  it("POSTs code + redirectUri to the Worker and returns the bundle", async () => {
    const bundle = {
      access_token: "tok",
      workspace_id: "ws-a",
      workspace_name: "A",
      workspace_icon: null,
      bot_id: "bot",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));
    const result = await exchangeCode(
      { code: "c1", redirectUri: "https://id.chromiumapp.org/" },
      { workerUrl: "https://w.example", fetch: fetchMock },
    );
    expect(result).toEqual(bundle);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://w.example/oauth/exchange");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      code: "c1",
      redirectUri: "https://id.chromiumapp.org/",
    });
  });

  it("throws with the Worker error message on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "bad code" }), { status: 400 }),
    );
    await expect(
      exchangeCode(
        { code: "x", redirectUri: "r" },
        { workerUrl: "https://w.example", fetch: fetchMock },
      ),
    ).rejects.toThrow("bad code");
  });
});

describe("clipViaWorker", () => {
  it("POSTs the clip body and returns the ClipResult", async () => {
    const body = { ok: true, pageUrl: "https://notion.so/p", fallback: false };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const result = await clipViaWorker(
      { accessToken: "tok", databaseId: "db-1", title: "T", url: "https://x/", note: "n" },
      { workerUrl: "https://w.example", fetch: fetchMock },
    );
    expect(result).toEqual(body);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://w.example/clip");
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "server boom" }), { status: 500 }),
    );
    await expect(
      clipViaWorker(
        { accessToken: "t", databaseId: "d", title: "", url: "u", note: "" },
        { workerUrl: "https://w.example", fetch: fetchMock },
      ),
    ).rejects.toThrow("server boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- worker-client`
Expected: FAIL — cannot find module `../src/lib/worker-client`.

- [ ] **Step 3: Write `extension/src/lib/worker-client.ts`**

```ts
import type { ClipResult, NotionTokenBundle } from "./types";

export type WorkerDeps = {
  workerUrl: string;
  fetch: typeof fetch;
};

async function postJson(
  deps: WorkerDeps,
  path: string,
  body: unknown,
): Promise<any> {
  const response = await deps.fetch(`${deps.workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Worker request failed (${response.status})`);
  }
  return data;
}

export function exchangeCode(
  params: { code: string; redirectUri: string },
  deps: WorkerDeps,
): Promise<NotionTokenBundle> {
  return postJson(deps, "/oauth/exchange", params);
}

export function clipViaWorker(
  params: {
    accessToken: string;
    databaseId: string;
    title: string;
    url: string;
    note: string;
  },
  deps: WorkerDeps,
): Promise<ClipResult> {
  return postJson(deps, "/clip", params);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- worker-client`
Expected: PASS.

- [ ] **Step 5: Write the failing test** — `extension/test/oauth.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildAuthUrl, parseAuthCode } from "../src/background/oauth";

describe("buildAuthUrl", () => {
  it("builds the Notion authorize URL with required params", () => {
    const url = new URL(
      buildAuthUrl("client-123", "https://id.chromiumapp.org/"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://api.notion.com/v1/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://id.chromiumapp.org/",
    );
  });
});

describe("parseAuthCode", () => {
  it("extracts the code from the redirect URL", () => {
    expect(
      parseAuthCode("https://id.chromiumapp.org/?code=abc123&state=x"),
    ).toBe("abc123");
  });

  it("throws when the user denied access (error param)", () => {
    expect(() =>
      parseAuthCode("https://id.chromiumapp.org/?error=access_denied"),
    ).toThrow(/access_denied/);
  });

  it("throws when no code is present", () => {
    expect(() => parseAuthCode("https://id.chromiumapp.org/")).toThrow(
      /no authorization code/i,
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd extension && pnpm test -- oauth`
Expected: FAIL — cannot find module `../src/background/oauth`.

- [ ] **Step 7: Write `extension/src/background/oauth.ts`**

```ts
import type { Connection, NotionTokenBundle } from "../lib/types";
import { exchangeCode, type WorkerDeps } from "../lib/worker-client";
import { NOTION_CLIENT_ID, WORKER_URL } from "../config";

const AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";

export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export function parseAuthCode(redirectUrl: string): string {
  const url = new URL(redirectUrl);
  const error = url.searchParams.get("error");
  if (error) throw new Error(`Notion authorization failed: ${error}`);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("No authorization code in redirect");
  return code;
}

export function bundleToConnection(bundle: NotionTokenBundle): Connection {
  return {
    workspaceId: bundle.workspace_id,
    workspaceName: bundle.workspace_name ?? "Notion workspace",
    workspaceIcon: bundle.workspace_icon ?? null,
    accessToken: bundle.access_token,
    botId: bundle.bot_id,
  };
}

/**
 * Run the interactive OAuth flow and return a stored-ready Connection.
 * `launchWebAuthFlow` is injected so the orchestration is testable; in the
 * service worker it is `chrome.identity.launchWebAuthFlow`.
 */
export async function runOAuth(deps: {
  launchWebAuthFlow: (opts: {
    url: string;
    interactive: boolean;
  }) => Promise<string>;
  getRedirectURL: () => string;
  fetch: typeof fetch;
  clientId?: string;
  workerUrl?: string;
}): Promise<Connection> {
  const clientId = deps.clientId ?? NOTION_CLIENT_ID;
  const redirectUri = deps.getRedirectURL();
  const authUrl = buildAuthUrl(clientId, redirectUri);
  const redirectUrl = await deps.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  const code = parseAuthCode(redirectUrl);
  const workerDeps: WorkerDeps = {
    workerUrl: deps.workerUrl ?? WORKER_URL,
    fetch: deps.fetch,
  };
  const bundle = await exchangeCode({ code, redirectUri }, workerDeps);
  return bundleToConnection(bundle);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd extension && pnpm test -- oauth`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/src/lib/worker-client.ts extension/src/background/oauth.ts extension/test/worker-client.test.ts extension/test/oauth.test.ts
git commit -m "feat(extension): Worker client + OAuth url/code helpers and flow"
```

---

## Task 7: Background message router + service-worker wiring

**Files:**
- Create: `extension/src/background/router.ts`
- Modify: `extension/src/background/index.ts`
- Test: `extension/test/router.test.ts`

`handleMessage` takes injected deps so every branch is testable without `chrome`.

- [ ] **Step 1: Write the failing test** — `extension/test/router.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { handleMessage, type RouterDeps } from "../src/background/router";
import type { Connection } from "../src/lib/types";

const conn: Connection = {
  workspaceId: "ws-a",
  workspaceName: "A",
  workspaceIcon: null,
  accessToken: "tok-a",
  botId: "bot-a",
};

function makeDeps(over: Partial<RouterDeps> = {}): RouterDeps {
  return {
    getConnections: vi.fn(async () => [conn]),
    getLastDestination: vi.fn(async () => null),
    saveConnection: vi.fn(async () => {}),
    setLastDestination: vi.fn(async () => {}),
    runOAuth: vi.fn(async () => conn),
    listDatabases: vi.fn(async () => [{ id: "db-1", title: "One" }]),
    clip: vi.fn(async () => ({ ok: true, pageUrl: "https://n/p", fallback: false })),
    ...over,
  };
}

describe("handleMessage", () => {
  it("getState returns connections + lastDestination", async () => {
    const res = await handleMessage(makeDeps(), { type: "getState" });
    expect(res).toEqual({ ok: true, connections: [conn], lastDestination: null });
  });

  it("connect runs OAuth, saves the connection, returns it", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, { type: "connect" });
    expect(deps.saveConnection).toHaveBeenCalledWith(conn);
    expect(res).toEqual({ ok: true, connection: conn });
  });

  it("connect returns an error response when OAuth fails", async () => {
    const deps = makeDeps({
      runOAuth: vi.fn(async () => {
        throw new Error("user cancelled");
      }),
    });
    const res = await handleMessage(deps, { type: "connect" });
    expect(res).toEqual({ ok: false, error: "user cancelled" });
  });

  it("listDatabases returns options for the workspace's token", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, {
      type: "listDatabases",
      workspaceId: "ws-a",
    });
    expect(deps.listDatabases).toHaveBeenCalledWith("tok-a");
    expect(res).toEqual({ ok: true, databases: [{ id: "db-1", title: "One" }] });
  });

  it("listDatabases for an unknown workspace returns an error", async () => {
    const res = await handleMessage(makeDeps(), {
      type: "listDatabases",
      workspaceId: "ws-missing",
    });
    expect(res).toEqual({ ok: false, error: "Workspace not connected" });
  });

  it("listDatabases maps a 401 to needsReconnect", async () => {
    const err: any = new Error("Unauthorized");
    err.status = 401;
    const deps = makeDeps({
      listDatabases: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await handleMessage(deps, {
      type: "listDatabases",
      workspaceId: "ws-a",
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized", needsReconnect: true });
  });

  it("clip uses the workspace token, saves lastDestination, returns the result", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, {
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "n",
      },
    });
    expect(deps.clip).toHaveBeenCalledWith({
      accessToken: "tok-a",
      databaseId: "db-1",
      title: "T",
      url: "https://x/",
      note: "n",
    });
    expect(deps.setLastDestination).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      databaseId: "db-1",
    });
    expect(res).toEqual({
      ok: true,
      result: { ok: true, pageUrl: "https://n/p", fallback: false },
    });
  });

  it("clip maps a 401 to needsReconnect and does not save destination", async () => {
    const err: any = new Error("Unauthorized");
    err.status = 401;
    const deps = makeDeps({
      clip: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await handleMessage(deps, {
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "",
      },
    });
    expect(deps.setLastDestination).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: "Unauthorized", needsReconnect: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && pnpm test -- router`
Expected: FAIL — cannot find module `../src/background/router`.

- [ ] **Step 3: Write `extension/src/background/router.ts`**

```ts
import type {
  ClipMessage,
  ClipResult,
  Connection,
  DatabaseOption,
  Destination,
  ListDatabasesMessage,
  RequestMessage,
} from "../lib/types";

export type RouterDeps = {
  getConnections: () => Promise<Connection[]>;
  getLastDestination: () => Promise<Destination | null>;
  saveConnection: (c: Connection) => Promise<void>;
  setLastDestination: (d: Destination) => Promise<void>;
  runOAuth: () => Promise<Connection>;
  listDatabases: (token: string) => Promise<DatabaseOption[]>;
  clip: (params: {
    accessToken: string;
    databaseId: string;
    title: string;
    url: string;
    note: string;
  }) => Promise<ClipResult>;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 401
  );
}

export async function handleMessage(
  deps: RouterDeps,
  msg: RequestMessage,
): Promise<unknown> {
  switch (msg.type) {
    case "getState": {
      const [connections, lastDestination] = await Promise.all([
        deps.getConnections(),
        deps.getLastDestination(),
      ]);
      return { ok: true, connections, lastDestination };
    }

    case "connect": {
      try {
        const connection = await deps.runOAuth();
        await deps.saveConnection(connection);
        return { ok: true, connection };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }

    case "listDatabases": {
      const { workspaceId } = msg as ListDatabasesMessage;
      const conn = (await deps.getConnections()).find(
        (c) => c.workspaceId === workspaceId,
      );
      if (!conn) return { ok: false, error: "Workspace not connected" };
      try {
        const databases = await deps.listDatabases(conn.accessToken);
        return { ok: true, databases };
      } catch (err) {
        return {
          ok: false,
          error: errorMessage(err),
          ...(isUnauthorized(err) ? { needsReconnect: true } : {}),
        };
      }
    }

    case "clip": {
      const { payload } = msg as ClipMessage;
      const conn = (await deps.getConnections()).find(
        (c) => c.workspaceId === payload.workspaceId,
      );
      if (!conn) return { ok: false, error: "Workspace not connected" };
      try {
        const result = await deps.clip({
          accessToken: conn.accessToken,
          databaseId: payload.databaseId,
          title: payload.title,
          url: payload.url,
          note: payload.note,
        });
        await deps.setLastDestination({
          workspaceId: payload.workspaceId,
          databaseId: payload.databaseId,
        });
        return { ok: true, result };
      } catch (err) {
        return {
          ok: false,
          error: errorMessage(err),
          ...(isUnauthorized(err) ? { needsReconnect: true } : {}),
        };
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && pnpm test -- router`
Expected: PASS.

- [ ] **Step 5: Wire the real service worker** — replace `extension/src/background/index.ts`

```ts
import { handleMessage, type RouterDeps } from "./router";
import { runOAuth } from "./oauth";
import {
  getConnections,
  getLastDestination,
  saveConnection,
  setLastDestination,
} from "../lib/storage";
import { buildSearchRequest, parseDatabaseList } from "../lib/notion";
import { clipViaWorker } from "../lib/worker-client";
import { WORKER_URL } from "../config";
import { isRequestMessage } from "../lib/messages";

const boundFetch: typeof fetch = (...args) => fetch(...args);

async function listDatabases(token: string) {
  const { url, init } = buildSearchRequest(token);
  const response = await boundFetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err: any = new Error(
      data?.message ?? `Notion search failed (${response.status})`,
    );
    err.status = response.status;
    throw err;
  }
  return parseDatabaseList(data);
}

const deps: RouterDeps = {
  getConnections,
  getLastDestination,
  saveConnection,
  setLastDestination,
  runOAuth: () =>
    runOAuth({
      launchWebAuthFlow: (opts) => chrome.identity.launchWebAuthFlow(opts),
      getRedirectURL: () => chrome.identity.getRedirectURL(),
      fetch: boundFetch,
    }),
  listDatabases,
  clip: (params) => clipViaWorker(params, { workerUrl: WORKER_URL, fetch: boundFetch }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRequestMessage(message)) {
    sendResponse({ ok: false, error: "Unknown message" });
    return false;
  }
  handleMessage(deps, message).then(sendResponse);
  return true; // keep the message channel open for the async response
});
```

- [ ] **Step 6: Verify the build still succeeds**

Run: `cd extension && pnpm build`
Expected: build succeeds; `dist/service-worker-loader.js` (or the bundled background) is emitted with no errors.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background/router.ts extension/src/background/index.ts extension/test/router.test.ts
git commit -m "feat(extension): background message router + service-worker wiring"
```

---

## Task 8: Popup UI (Svelte) + component tests

**Files:**
- Create: `extension/src/popup/lib-bridge.ts`
- Create: `extension/src/popup/components/StatusBanner.svelte`
- Create: `extension/src/popup/components/WorkspaceSelector.svelte`
- Create: `extension/src/popup/components/DatabasePicker.svelte`
- Modify: `extension/src/popup/App.svelte`
- Test: `extension/test/App.test.ts`

- [ ] **Step 1: Create `extension/src/popup/lib-bridge.ts`** (promise wrapper over `chrome.runtime.sendMessage`)

```ts
import type { RequestMessage, ResponseFor } from "../lib/types";

export function sendMessage<M extends RequestMessage>(
  message: M,
): Promise<ResponseFor<M>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response as ResponseFor<M>);
    });
  });
}

export async function getActiveTab(): Promise<{ title: string; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { title: tab?.title ?? "", url: tab?.url ?? "" };
}
```

- [ ] **Step 2: Create `extension/src/popup/components/StatusBanner.svelte`**

```svelte
<script lang="ts">
  let { kind, message }: { kind: "success" | "error" | "info"; message: string } =
    $props();
</script>

<div class="banner {kind}" role="status">{message}</div>

<style>
  .banner {
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin: 8px 0;
  }
  .success { background: #e7f5ec; color: #1a7f43; }
  .error { background: #fdecea; color: #b3261e; }
  .info { background: #eef1f5; color: #444; }
</style>
```

- [ ] **Step 3: Create `extension/src/popup/components/WorkspaceSelector.svelte`**

```svelte
<script lang="ts">
  import type { Connection } from "../../lib/types";
  let {
    connections,
    selectedId,
    onSelect,
  }: {
    connections: Connection[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  } = $props();
</script>

<label class="field">
  <span>Workspace</span>
  <select
    value={selectedId ?? ""}
    onchange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each connections as c (c.workspaceId)}
      <option value={c.workspaceId}>{c.workspaceName}</option>
    {/each}
  </select>
</label>

<style>
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  select { padding: 6px; font-size: 13px; }
</style>
```

- [ ] **Step 4: Create `extension/src/popup/components/DatabasePicker.svelte`**

```svelte
<script lang="ts">
  import type { DatabaseOption } from "../../lib/types";
  let {
    databases,
    selectedId,
    loading,
    onSelect,
  }: {
    databases: DatabaseOption[];
    selectedId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
  } = $props();
</script>

<label class="field">
  <span>Add to</span>
  {#if loading}
    <div class="hint">Loading databases…</div>
  {:else if databases.length === 0}
    <div class="hint">
      No databases shared. Share a database with the integration, then Refresh.
    </div>
  {:else}
    <select
      value={selectedId ?? ""}
      onchange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
    >
      {#each databases as d (d.id)}
        <option value={d.id}>{d.title}</option>
      {/each}
    </select>
  {/if}
</label>

<style>
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  select { padding: 6px; font-size: 13px; }
  .hint { font-size: 12px; color: #777; }
</style>
```

- [ ] **Step 5: Replace `extension/src/popup/App.svelte`**

```svelte
<script lang="ts">
  import { sendMessage, getActiveTab } from "./lib-bridge";
  import {
    getStateMessage,
    connectMessage,
    listDatabasesMessage,
    clipMessage,
  } from "../lib/messages";
  import {
    pickInitialWorkspaceId,
    pickInitialDatabaseId,
  } from "../lib/destination";
  import type { Connection, DatabaseOption, Destination } from "../lib/types";
  import WorkspaceSelector from "./components/WorkspaceSelector.svelte";
  import DatabasePicker from "./components/DatabasePicker.svelte";
  import StatusBanner from "./components/StatusBanner.svelte";

  type Status =
    | { kind: "idle" }
    | { kind: "info" | "success" | "error"; message: string };

  let connections = $state<Connection[]>([]);
  let lastDestination = $state<Destination | null>(null);
  let workspaceId = $state<string | null>(null);
  let databases = $state<DatabaseOption[]>([]);
  let databaseId = $state<string | null>(null);
  let loadingDatabases = $state(false);

  let title = $state("");
  let url = $state("");
  let note = $state("");
  let saving = $state(false);
  let status = $state<Status>({ kind: "idle" });
  let booted = $state(false);

  const connected = $derived(connections.length > 0);

  async function boot() {
    const tab = await getActiveTab();
    title = tab.title;
    url = tab.url;
    const state = await sendMessage(getStateMessage());
    if (state.ok) {
      connections = state.connections;
      lastDestination = state.lastDestination;
      workspaceId = pickInitialWorkspaceId(connections, lastDestination);
      if (workspaceId) await loadDatabases(workspaceId);
    }
    booted = true;
  }

  async function loadDatabases(ws: string) {
    loadingDatabases = true;
    databases = [];
    const res = await sendMessage(listDatabasesMessage(ws));
    loadingDatabases = false;
    if (res.ok) {
      databases = res.databases;
      databaseId = pickInitialDatabaseId(databases, lastDestination, ws);
    } else {
      status = {
        kind: "error",
        message: res.needsReconnect
          ? "Workspace access expired — reconnect."
          : res.error,
      };
    }
  }

  async function connect() {
    status = { kind: "info", message: "Connecting…" };
    const res = await sendMessage(connectMessage());
    if (res.ok) {
      const state = await sendMessage(getStateMessage());
      if (state.ok) {
        connections = state.connections;
        lastDestination = state.lastDestination;
      }
      workspaceId = res.connection.workspaceId;
      status = { kind: "idle" };
      await loadDatabases(workspaceId);
    } else {
      status = { kind: "error", message: res.error };
    }
  }

  async function selectWorkspace(id: string) {
    workspaceId = id;
    await loadDatabases(id);
  }

  function selectDatabase(id: string) {
    databaseId = id;
  }

  async function save() {
    if (!workspaceId || !databaseId) return;
    saving = true;
    status = { kind: "info", message: "Saving…" };
    const res = await sendMessage(
      clipMessage({ workspaceId, databaseId, title, url, note }),
    );
    saving = false;
    if (res.ok) {
      status = {
        kind: "success",
        message: res.result.fallback
          ? "Saved as bookmark — content couldn't be extracted."
          : "Saved to Notion.",
      };
    } else {
      status = {
        kind: "error",
        message: res.needsReconnect
          ? "Workspace access expired — reconnect."
          : res.error,
      };
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !saving && databaseId) save();
  }

  boot();
</script>

<main onkeydown={onKeydown}>
  <h1>Clip to Notion</h1>

  {#if status.kind !== "idle"}
    <StatusBanner kind={status.kind} message={status.message} />
  {/if}

  {#if !booted}
    <p class="hint">Loading…</p>
  {:else if !connected}
    <p class="hint">Connect your Notion workspace to start clipping.</p>
    <button class="primary" onclick={connect}>Connect Notion</button>
  {:else}
    <label class="field">
      <span>Title</span>
      <input bind:value={title} placeholder="Page title" />
    </label>

    <label class="field">
      <span>Note (optional)</span>
      <textarea bind:value={note} rows="2" placeholder="Add a note…"></textarea>
    </label>

    <DatabasePicker
      databases={databases}
      selectedId={databaseId}
      loading={loadingDatabases}
      onSelect={selectDatabase}
    />

    <WorkspaceSelector
      connections={connections}
      selectedId={workspaceId}
      onSelect={selectWorkspace}
    />

    <div class="actions">
      <button
        class="primary"
        onclick={save}
        disabled={saving || !databaseId}
      >
        {saving ? "Saving…" : "Save page"}
      </button>
      <button class="link" onclick={connect}>Add workspace</button>
    </div>
  {/if}
</main>

<style>
  main { width: 320px; padding: 14px; font-family: system-ui, sans-serif; }
  h1 { font-size: 15px; margin: 0 0 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin: 8px 0; }
  input, textarea { padding: 6px; font-size: 13px; font-family: inherit; }
  .actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .primary { background: #2383e2; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .link { background: none; border: 0; color: #2383e2; cursor: pointer; font-size: 12px; }
  .hint { font-size: 12px; color: #777; }
</style>
```

- [ ] **Step 6: Write the component test** — `extension/test/App.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import App from "../src/popup/App.svelte";
import * as bridge from "../src/popup/lib-bridge";

vi.mock("../src/popup/lib-bridge", () => ({
  sendMessage: vi.fn(),
  getActiveTab: vi.fn(async () => ({ title: "Example Page", url: "https://example.com/" })),
}));

const conn = {
  workspaceId: "ws-a",
  workspaceName: "Workspace A",
  workspaceIcon: null,
  accessToken: "tok",
  botId: "bot",
};

function mockSend(impl: (msg: any) => any) {
  (bridge.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (msg: any) => impl(msg),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("App popup", () => {
  it("shows Connect when no workspace is connected", async () => {
    mockSend((msg) =>
      msg.type === "getState"
        ? { ok: true, connections: [], lastDestination: null }
        : { ok: false, error: "unexpected" },
    );
    render(App);
    expect(await screen.findByText("Connect Notion")).toBeInTheDocument();
  });

  it("prefills the title from the active tab and lists databases when connected", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const titleInput = (await screen.findByPlaceholderText(
      "Page title",
    )) as HTMLInputElement;
    expect(titleInput.value).toBe("Example Page");
    expect(await screen.findByText("Clips")).toBeInTheDocument();
  });

  it("dispatches a clip message and shows success", async () => {
    const sent: any[] = [];
    mockSend((msg) => {
      sent.push(msg);
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip")
        return { ok: true, result: { ok: true, pageUrl: "https://n/p", fallback: false } };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(screen.getByText("Saved to Notion.")).toBeInTheDocument(),
    );
    const clip = sent.find((m) => m.type === "clip");
    expect(clip.payload).toMatchObject({
      workspaceId: "ws-a",
      databaseId: "db-1",
      title: "Example Page",
      url: "https://example.com/",
    });
  });

  it("shows the bookmark-fallback notice when the worker reports fallback", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip")
        return { ok: true, result: { ok: true, pageUrl: "https://n/p", fallback: true } };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(
        screen.getByText("Saved as bookmark — content couldn't be extracted."),
      ).toBeInTheDocument(),
    );
  });

  it("shows an error banner when clip fails", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip") return { ok: false, error: "server boom" };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(screen.getByText("server boom")).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `cd extension && pnpm test -- App`
Expected: PASS (all five App tests green). If `@testing-library/svelte` cannot mount a Svelte 5 component, confirm `@testing-library/svelte@^5.2.0` (the Svelte 5-compatible line) is installed.

- [ ] **Step 8: Run the full extension test suite**

Run: `cd extension && pnpm test`
Expected: PASS — storage, destination, messages, notion, worker-client, oauth, router, App all green.

- [ ] **Step 9: Commit**

```bash
git add extension/src/popup/ extension/test/App.test.ts
git commit -m "feat(extension): Svelte popup UI with workspace/database pickers and clip flow"
```

---

## Task 9: DEVELOPMENT.md + dev-key pinning + final verification

**Files:**
- Create: `DEVELOPMENT.md` (repo root)
- Modify: `extension/manifest.config.ts` (paste the generated dev `key`)

- [ ] **Step 1: Generate the dev keypair and derive the extension ID**

Run (from repo root):
```bash
# 1. Generate a private key (keep it OUT of git).
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out extension/dev-key.pem
# 2. Print the base64 public key (DER, single line) to paste into the manifest.
openssl rsa -in extension/dev-key.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'; echo
```
Add `dev-key.pem` to `extension/.gitignore`.

- [ ] **Step 2: Paste the key into `extension/manifest.config.ts`**

Replace the `DEV_KEY` line with the base64 string from Step 1:
```ts
const DEV_KEY: string | undefined =
  "MIIBIjANBgkqhkiG9w0BAQEFAAO...";  // <-- paste the single-line base64 here
```
After loading the unpacked extension once, read the redirect URI at runtime (DevTools console of the service worker): `chrome.identity.getRedirectURL()` → `https://<id>.chromiumapp.org/`. This ID is now stable.

- [ ] **Step 3: Create `DEVELOPMENT.md`**

````markdown
# Development & Testing Guide

This repo has two parts:

- `worker/` — the Cloudflare Worker (OAuth exchange + clip-saving). Already built.
- `extension/` — the Chrome MV3 extension (popup + background service worker).

## One-time Notion setup

1. Create a **public** integration at https://www.notion.so/my-integrations
   (type: Public). Note the **OAuth client ID** and **client secret**.
2. You will register redirect URIs in step "Connect the extension" below once
   you know the extension ID.

## Worker

```bash
cd worker
pnpm install
cp .dev.vars.example .dev.vars   # fill in NOTION_CLIENT_ID + NOTION_CLIENT_SECRET
pnpm test                        # vitest (46 tests)
npx wrangler dev                 # serves on http://localhost:8787
```

Production secrets:
```bash
npx wrangler secret put NOTION_CLIENT_ID
npx wrangler secret put NOTION_CLIENT_SECRET
npx wrangler deploy
```

## Extension

```bash
cd extension
pnpm install
cp .env.example .env.local        # set VITE_WORKER_URL + VITE_NOTION_CLIENT_ID
pnpm test                         # vitest (pure logic + Svelte component tests)
pnpm dev                          # Vite + CRXJS HMR build into dist/
```

Load it:
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/dist`.
3. The pinned dev `key` in `manifest.config.ts` gives a stable ID. In the
   extension's service-worker console, run `chrome.identity.getRedirectURL()`
   to read `https://<id>.chromiumapp.org/`.

### Pin the dev extension ID

See the repo's plan, Task 9 — generate `dev-key.pem`, paste the base64 public
key into `manifest.config.ts` as `DEV_KEY`. Do not commit `dev-key.pem`.

## Connect the extension (OAuth)

1. In the Notion integration settings, add the redirect URI
   `https://<id>.chromiumapp.org/` (dev). Add the Web Store ID's URI later for prod.
2. Make sure the Worker is running (local `wrangler dev` or deployed) and
   `VITE_WORKER_URL` points at it; rebuild the extension if you changed `.env.local`.
3. Click the extension → **Connect Notion** → authorize and pick which
   databases to share.

## Manual test checklist

- [ ] Connect a workspace; the database picker populates.
- [ ] Clip a normal article → opens as a Notion page with content.
- [ ] Clip a login-walled / SPA page → saved with the bookmark-fallback notice.
- [ ] Clip with a note → note appears as a callout on the page.
- [ ] Add a second workspace; switch between workspaces; pickers update.
- [ ] Revoke the integration in Notion, clip again → "reconnect" prompt.
- [ ] Reopen the popup → last workspace + database are preselected.

## Automated tests

- Worker: `cd worker && pnpm test` — converter, clip happy/fallback, oauth, router.
- Extension: `cd extension && pnpm test` — storage, destination selection,
  message shapes, Notion parsing, worker client, background router, popup component.
````

- [ ] **Step 4: Final full verification — both suites green**

Run:
```bash
cd worker && pnpm test
cd ../extension && pnpm test && pnpm build
```
Expected: Worker 46 tests PASS; extension all tests PASS; `pnpm build` emits `dist/` with no errors.

- [ ] **Step 5: Commit**

```bash
git add DEVELOPMENT.md extension/manifest.config.ts extension/.gitignore
git commit -m "docs: DEVELOPMENT.md and pinned dev extension key"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Popup layout (Title, Note, Save, Add-to picker, Workspace selector, states) → Task 8.
- Background service worker (OAuth, list databases, clip dispatch) → Tasks 6–7.
- `chrome.storage.local` `connections` + `lastDestination` → Task 2.
- OAuth via `launchWebAuthFlow` + `/oauth/exchange` → Tasks 6–7.
- Multiple workspaces → Task 2 (dedupe/keep-many) + Task 8 (selector).
- Clip data flow → Task 7 (router) + Task 8 (popup).
- Error/fallback (extraction fallback notice, 401 reconnect, no-databases guidance, worker error) → Tasks 7–8.
- Notion search for databases → Task 5.
- CRXJS + Svelte + Vite stack, typed manifest, pinned dev key → Tasks 0, 9.
- DEVELOPMENT.md (worker + extension run/test/oauth/manual checklist) → Task 9.
- TDD throughout → every logic task is test-first.

**Out of scope (matches spec non-goals):** Firefox, text-selection clipping, property mapping beyond Title+URL+Note, offline queueing.

**Type consistency:** `Connection`, `DatabaseOption`, `Destination`, message/response types defined once in `lib/types.ts` (Task 1) and imported everywhere. Router `RouterDeps` method names (`getConnections`, `runOAuth`, `listDatabases`, `clip`, `setLastDestination`) match the wiring in `background/index.ts` and the test doubles.
