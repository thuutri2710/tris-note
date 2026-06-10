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
  import {
    getCachedDatabases,
    getRecentNotes,
    addRecentNote,
    setLastDestination,
  } from "../lib/storage";
  import type { Connection, DatabaseOption, Destination } from "../lib/types";
  import SelectRow, { type RowOption } from "./components/SelectRow.svelte";
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
  let recentNotes = $state<string[]>([]);
  let noteMarkdown = $state(false);
  let saving = $state(false);
  let status = $state<Status>({ kind: "idle" });
  let booted = $state(false);

  const connected = $derived(connections.length > 0);

  const workspaceOptions = $derived<RowOption[]>(
    connections.map((c) => ({
      id: c.workspaceId,
      title: c.workspaceName,
      icon: c.workspaceIcon ? { kind: "url", value: c.workspaceIcon } : null,
    })),
  );

  async function boot() {
    try {
      const tab = await getActiveTab();
      title = tab.title;
      url = tab.url;
      recentNotes = await getRecentNotes();
      const state = await sendMessage(getStateMessage());
      if (state.ok) {
        connections = state.connections;
        lastDestination = state.lastDestination;
        workspaceId = pickInitialWorkspaceId(connections, lastDestination);
        if (workspaceId) await loadDatabases(workspaceId);
      }
    } catch (err) {
      console.error("Notion clipper: boot failed", err);
      status = {
        kind: "error",
        message: `Couldn't reach the background worker: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    } finally {
      booted = true;
    }
  }

  // Cache-first: show the last known database list instantly (no spinner),
  // then refresh from the network in the background. Only show a spinner the
  // very first time, when there's nothing cached yet.
  async function loadDatabases(ws: string) {
    const cached = await getCachedDatabases(ws);
    if (cached && cached.length > 0) {
      databases = cached;
      databaseId = pickInitialDatabaseId(cached, lastDestination, ws);
      loadingDatabases = false;
      void refreshDatabases(ws, false);
      return;
    }
    await refreshDatabases(ws, true);
  }

  async function refreshDatabases(ws: string, showSpinner: boolean) {
    if (showSpinner) {
      loadingDatabases = true;
      databases = [];
    }
    const res = await sendMessage(listDatabasesMessage(ws));
    if (ws !== workspaceId) return; // user switched workspace mid-flight
    if (showSpinner) loadingDatabases = false;

    if (res.ok) {
      databases = res.databases;
      if (!databases.some((d) => d.id === databaseId)) {
        databaseId = pickInitialDatabaseId(databases, lastDestination, ws);
      }
    } else if (showSpinner || res.needsReconnect) {
      // Surface errors when we had nothing to show, or when the token died.
      status = {
        kind: "error",
        message: res.needsReconnect
          ? "Workspace access expired — reconnect."
          : res.error,
      };
    }
    // Otherwise (background refresh failed but cache is showing): stay quiet.
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
    if (id === workspaceId) return;
    workspaceId = id;
    databaseId = null;
    await loadDatabases(id);
  }

  function selectDatabase(id: string) {
    databaseId = id;
  }

  // Remember the chosen workspace + database as soon as it changes — so
  // reopening restores the last selection even without saving.
  $effect(() => {
    if (booted && workspaceId && databaseId) {
      void setLastDestination({ workspaceId, databaseId });
    }
  });

  async function save() {
    if (!workspaceId || !databaseId || saving) return;
    saving = true;
    status = { kind: "info", message: "Saving…" };
    const res = await sendMessage(
      clipMessage({ workspaceId, databaseId, title, url, note, noteMarkdown }),
    );
    saving = false;
    if (res.ok) {
      if (note.trim()) {
        await addRecentNote(note);
        recentNotes = await getRecentNotes();
      }
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

  function onTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }

  boot();
</script>

<main>
  <header class="brand">
    <span class="mark" aria-hidden="true">✂️</span>
    <span class="wordmark">Clipper</span>
    <span class="sub">for Notion</span>
  </header>

  {#if !booted}
    <p class="hint">Loading…</p>
  {:else if !connected}
    <div class="stack empty">
      <svg
        class="artwork"
        viewBox="0 0 120 96"
        fill="none"
        aria-hidden="true"
      >
        <rect x="30" y="14" width="60" height="74" rx="7" />
        <path d="M74 14v16h16" />
        <line x1="42" y1="44" x2="78" y2="44" />
        <line x1="42" y1="56" x2="78" y2="56" />
        <line x1="42" y1="68" x2="64" y2="68" />
        <path d="M22 30l-12 6 12 6" class="thin" />
        <path d="M98 30l12 6-12 6" class="thin" />
      </svg>
      <p class="lede">Clip any page straight into your Notion workspace.</p>
      {#if status.kind !== "idle"}
        <StatusBanner kind={status.kind} message={status.message} />
      {/if}
      <button class="primary" onclick={connect}>Connect Notion</button>
    </div>
  {:else}
    <div class="stack">
      <input
        class="title"
        bind:value={title}
        placeholder="Page title"
        onkeydown={onTitleKeydown}
      />

      <section class="note-block" style="--i: 1">
        <textarea
          class="note"
          bind:value={note}
          rows="4"
          placeholder="Add a note (optional)"
        ></textarea>
        {#if recentNotes.length > 0 && !note.trim()}
          <div class="recent">
            <span class="recent-label">Recent</span>
            {#each recentNotes.slice(0, 3) as r (r)}
              <button
                type="button"
                class="chip"
                title={r}
                onclick={() => (note = r)}
              >
                {r}
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <div class="save-line" style="--i: 2">
        <button class="primary" onclick={save} disabled={saving || !databaseId}>
          {saving ? "Saving…" : "Save page"}
        </button>
        <span class="enter-hint">↵ Enter</span>
      </div>

      {#if status.kind !== "idle"}
        <StatusBanner kind={status.kind} message={status.message} />
      {/if}

      <div class="rows" style="--i: 3">
        <SelectRow
          label="Add to"
          options={databases}
          selectedId={databaseId}
          onSelect={selectDatabase}
          loading={loadingDatabases}
          emptyText="No databases shared — share one with the integration, then reopen."
        />
        <SelectRow
          label="Workspace"
          options={workspaceOptions}
          selectedId={workspaceId}
          onSelect={selectWorkspace}
          useLetterFallback={true}
          footerLabel="Add workspace"
          onFooter={connect}
        />
      </div>

      <a
        class="learn"
        href="https://www.notion.so/help/web-clipper"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="q">?</span> Learn more
      </a>
    </div>
  {/if}
</main>

<style>
  main {
    /* functional minimalism — monochrome ink on white, outline-driven */
    --ink: #191919;
    --ink-2: #5c5b57;
    --muted: #9a9893;
    --line: #eaeae8;
    --hover: #f4f4f2;
    --field: #ffffff;
    --focus: rgba(25, 25, 25, 0.1);
    --accent: #191919;

    width: 328px;
    box-sizing: border-box;
    padding: 18px;
    background: var(--field);
    color: var(--ink);
    font-family: "Hanken Grotesk", ui-sans-serif, -apple-system, sans-serif;
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 14px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  .mark {
    font-size: 15px;
    line-height: 1;
  }
  .wordmark {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.01em;
  }
  .sub {
    margin-left: auto;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .stack > * {
    animation: rise 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
    animation-delay: calc(var(--i, 0) * 45ms);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stack > * {
      animation: none;
    }
  }

  .hint {
    font-size: 13px;
    color: var(--muted);
  }

  /* connect / empty state — centered line-art illustration */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    padding: 10px 6px 6px;
  }
  .artwork {
    width: 104px;
    height: 84px;
    stroke: #d3d2ce;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .artwork .thin {
    stroke-width: 1.6;
  }
  .lede {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--ink-2);
    max-width: 230px;
  }

  .title {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--field);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--ink);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .title:focus {
    border-color: var(--ink-2);
    box-shadow: 0 0 0 3px var(--focus);
  }

  .note-block {
    margin-top: 14px;
  }

  .note {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--field);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ink);
    resize: vertical;
    min-height: 84px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .note:focus {
    border-color: var(--ink-2);
    box-shadow: 0 0 0 3px var(--focus);
  }
  .note::placeholder {
    color: #b8b7b2;
  }

  .recent {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 7px;
    overflow: hidden;
  }
  .recent-label {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .chip {
    flex: 0 1 auto;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 3px 9px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--field);
    font: inherit;
    font-size: 11px;
    color: var(--ink-2);
    cursor: pointer;
    transition: background 0.13s, border-color 0.13s;
  }
  .chip:hover {
    background: var(--hover);
    border-color: #dcdcd8;
  }

  .save-line {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 6px;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 9px 18px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.14s, transform 0.06s;
  }
  .primary:hover:not(:disabled) {
    opacity: 0.86;
  }
  .primary:active:not(:disabled) {
    transform: translateY(1px);
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .enter-hint {
    font-size: 11px;
    color: var(--muted);
  }

  .rows {
    position: relative;
    z-index: 5; /* keep open dropdowns above the footer link */
    border-top: 1px solid var(--line);
    margin-top: 12px;
    padding-top: 4px;
  }

  .learn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 4px 2px;
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
  }
  .learn:hover {
    color: var(--ink-2);
  }
  .q {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 10px;
  }
</style>
