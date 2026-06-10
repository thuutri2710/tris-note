<script lang="ts">
  import type { NotionIcon } from "../../lib/types";
  import NotionIconView from "./NotionIconView.svelte";

  export type RowOption = {
    id: string;
    title: string;
    icon?: NotionIcon | null;
  };

  let {
    label,
    options,
    selectedId,
    onSelect,
    loading = false,
    emptyText = "",
    useLetterFallback = false,
    footerLabel,
    onFooter,
  }: {
    label: string;
    options: RowOption[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    loading?: boolean;
    emptyText?: string;
    useLetterFallback?: boolean;
    footerLabel?: string;
    onFooter?: () => void;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const selected = $derived(options.find((o) => o.id === selectedId) ?? null);

  function toggle() {
    if (loading) return;
    open = !open;
  }

  function choose(id: string) {
    onSelect(id);
    open = false;
  }

  function footer() {
    open = false;
    onFooter?.();
  }

  // Close on outside click or Escape while open.
  $effect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="row" bind:this={root}>
  <span class="label">{label}</span>

  <button
    type="button"
    class="value"
    class:open
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={toggle}
  >
    {#if loading}
      <span class="muted">Loading…</span>
    {:else if selected}
      <NotionIconView
        icon={selected.icon}
        fallbackText={useLetterFallback ? selected.title : ""}
      />
      <span class="name">{selected.title}</span>
    {:else}
      <span class="muted">{emptyText || "Select…"}</span>
    {/if}
    <svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      {#if options.length === 0}
        <div class="menu-empty">{emptyText || "Nothing to show."}</div>
      {:else}
        {#each options as o (o.id)}
          <button
            type="button"
            class="item"
            class:selected={o.id === selectedId}
            role="option"
            aria-selected={o.id === selectedId}
            onclick={() => choose(o.id)}
          >
            <NotionIconView
              icon={o.icon}
              fallbackText={useLetterFallback ? o.title : ""}
            />
            <span class="item-name">{o.title}</span>
            {#if o.id === selectedId}
              <svg class="check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3 8.5l3.5 3.5L13 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            {/if}
          </button>
        {/each}
      {/if}

      {#if footerLabel}
        <div class="menu-sep"></div>
        <button type="button" class="item footer" onclick={footer}>
          <span class="plus">＋</span>
          <span class="item-name">{footerLabel}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 4px;
  }
  .label {
    font-size: 13px;
    color: var(--muted, #6b6b6b);
  }
  .value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 190px;
    padding: 4px 6px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink, #37352f);
    cursor: pointer;
    transition: background 0.13s;
  }
  .value:hover,
  .value.open {
    background: var(--hover, #efefee);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .muted {
    color: var(--muted, #9b9a97);
  }
  .chevron {
    color: var(--muted, #9b9a97);
    flex: 0 0 auto;
  }

  .menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    min-width: 220px;
    max-width: 280px;
    max-height: 260px;
    overflow-y: auto;
    background: var(--field, #fff);
    border: 1px solid var(--line, #e3e2e0);
    border-radius: 10px;
    box-shadow: 0 8px 22px rgba(40, 30, 15, 0.16);
    padding: 4px;
    z-index: 20;
    animation: menu-in 0.14s ease-out both;
  }
  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink, #37352f);
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--hover, #f1f1f0);
  }
  .item.selected {
    background: var(--hover, #f1f1f0);
  }
  .item-name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    color: var(--accent, #2383e2);
    flex: 0 0 auto;
  }
  .menu-empty {
    padding: 8px;
    font-size: 12px;
    color: #9b9a97;
  }
  .menu-sep {
    height: 1px;
    background: #ececec;
    margin: 4px 2px;
  }
  .footer {
    color: #6b6b6b;
  }
  .plus {
    width: 18px;
    text-align: center;
    color: #9b9a97;
  }
</style>
