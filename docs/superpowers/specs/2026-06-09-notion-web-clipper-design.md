# Notion Web Clipper Clone — Design

**Date:** 2026-06-09
**Status:** Approved (pending implementation plan)

## Overview

A Chrome (Manifest V3) browser extension that clips the current web page into a
user's Notion workspace, replicating the behavior of the official Notion Web
Clipper. The extension authenticates via Notion's public OAuth flow and saves
clipped pages into a user-selected Notion database.

This is a from-scratch, functional equivalent. It does not copy Notion's
proprietary code, branding, or assets.

## Goals

- Clip the current tab into Notion with one click.
- Match the official clipper's popup layout: editable title, destination
  ("Add to") picker, workspace selector.
- Capture: **Title** (editable), source **URL**, full **article content**, and
  an optional user **Note**.
- Use Notion's public OAuth "Connect" flow (not a pasted integration token).
- Support multiple connected workspaces.

## Non-Goals

- Firefox / cross-browser support (Chrome MV3 only for now).
- Clipping arbitrary text selections / highlights (future enhancement).
- Notion database property mapping beyond Title + URL + Note (future).
- Offline queueing of clips.

## Architecture

Two components:

### 1. Chrome MV3 Extension (`/extension`)

Built with **Svelte + Vite + the CRXJS Vite plugin** (TypeScript). CRXJS gives
MV3-aware bundling and hot-module reload for the popup during development.

- **Popup** (Svelte components) — mirrors the official clipper layout:
  - Editable **Title** field (pre-filled from the tab title).
  - Optional **Note** field (user free-text).
  - **Save page** button (Enter submits).
  - **Add to** — database/page picker (dropdown of databases shared with the
    integration; remembers last choice).
  - **Workspace** — selector across connected workspaces.
  - Success / error / fallback states.
- **Background service worker** —
  - Runs the OAuth flow via `chrome.identity.launchWebAuthFlow`.
  - Lists the user's shared databases via the Notion API directly (using
    `host_permissions` for `https://api.notion.com/*`, which bypasses CORS from
    the service worker).
  - Calls the Cloudflare Worker `/clip` endpoint to perform a save.
- **Storage** (`chrome.storage.local`):
  - `connections`: array of `{ workspaceId, workspaceName, workspaceIcon,
    accessToken, botId }` — one entry per connected workspace.
  - `lastDestination`: `{ workspaceId, databaseId }` to restore the last choice.

### 2. Cloudflare Worker (`/worker`)

Stateless. Holds the Notion OAuth `client_secret` as a Worker secret. Two
endpoints:

- **`POST /oauth/exchange`** — body `{ code, redirectUri }`. Calls Notion
  `POST /v1/oauth/token` with HTTP Basic auth (`client_id:client_secret`),
  returns the token bundle (`access_token`, `workspace_id`, `workspace_name`,
  `workspace_icon`, `bot_id`).
- **`POST /clip`** — body `{ accessToken, databaseId, title, url, note }`.
  1. Fetches the `url` (server-side, with a browser-like User-Agent).
  2. Parses with `linkedom` + `@mozilla/readability` to extract clean article
     HTML.
  3. Converts article HTML → Notion block objects.
  4. Creates a page in `databaseId` via `POST /v1/pages` with the Title, the URL
     (as page property and/or bookmark block), the Note, and content blocks.
  5. Appends remaining blocks via `PATCH /v1/blocks/{id}/children` in batches
     (Notion limits 100 blocks per request).
  6. Returns `{ ok, pageUrl, fallback }`.

## Data Flow — A Clip

1. User clicks the extension icon → popup loads. It reads the active tab's title
   and URL (`chrome.tabs.query`), restores last destination/workspace.
2. User edits the title, optionally adds a note, picks a database + workspace,
   presses **Save page** (or Enter).
3. Popup → background message `{ type: "clip", payload }`.
4. Background → Cloudflare Worker `POST /clip` with
   `{ accessToken, databaseId, title, url, note }`.
5. Worker fetches + extracts + writes to Notion, returns `{ ok, pageUrl,
   fallback }`.
6. Popup shows success (with a link to the new page), a fallback notice, or an
   error.

## OAuth Flow

1. User clicks **Connect** (shown when no workspace is connected, or "Add
   workspace").
2. Background calls `chrome.identity.launchWebAuthFlow` with Notion's
   authorization URL (`https://api.notion.com/v1/oauth/authorize`),
   `client_id`, `response_type=code`, and
   `redirect_uri=https://<extension-id>.chromiumapp.org/`.
3. User authorizes and selects which pages/databases to share with the
   integration.
4. Notion redirects back with `?code=...`; the extension extracts the code.
5. Background → Worker `POST /oauth/exchange` with the code and redirect URI.
6. Worker returns the token bundle; background stores a new `connection`.
7. Background fetches the shared databases to populate the "Add to" picker.

Multiple workspaces: each Connect run yields one workspace's token; repeating the
flow adds another `connection`.

## Error Handling & Fallback

- **Extraction fails** (login wall, SPA shell, bot block, fetch error): the
  Worker still creates the page with **Title + URL + Note** only (bookmark
  style) and returns `fallback: true`. Popup shows: *"Saved as bookmark —
  content couldn't be extracted."*
- **Auth error** (401 / token revoked): popup prompts to re-connect that
  workspace.
- **No databases shared:** popup shows guidance to share a database with the
  integration and a "Refresh" action.
- **Network / Worker error:** popup shows a retryable error message.

## Notion API Notes & Limits

- Page creation: `POST /v1/pages` with `parent: { database_id }`. The database
  must have a Title property; URL stored as a `url` property if present,
  otherwise as a bookmark block. Note prepended as a paragraph/callout block.
- Block limits: max 100 blocks per create/append request; rich text segments
  capped at 2000 chars — the converter chunks accordingly.
- Database discovery: `POST /v1/search` filtered to `object: "database"`.
- API version header `Notion-Version` pinned to a known-good date.

## Testing Strategy

- **Worker (vitest + Miniflare/workerd):**
  - HTML → Notion blocks converter: fixtures for paragraphs, headings, lists,
    blockquotes, code blocks, images, links. Assert block structure + limit
    chunking.
  - `/clip`: happy path (mocked fetch + mocked Notion API) and
    extraction-failure path (asserts bookmark fallback).
  - `/oauth/exchange`: success and Notion-error responses (mocked).
- **Extension:**
  - Pure logic (vitest): storage helpers, destination-state reducer, message
    payload shapes.
  - Svelte components (`vitest` + `@testing-library/svelte` + jsdom): popup
    renders fields, Save dispatches the right message, success/error/fallback
    states.
  - Manual checklist for the live OAuth flow and end-to-end clip (hard to fully
    automate).
- TDD throughout: tests written before implementation.

## Development & Testing Guide

A `DEVELOPMENT.md` (written during implementation) will document how to run and
test the project locally:

- **Worker:** `wrangler dev` to run locally; `vitest` for unit tests; how to set
  secrets (`wrangler secret put`) and point the extension at the local Worker.
- **Extension:** `pnpm dev` (Vite + CRXJS) for an HMR build; how to load the
  unpacked extension from `dist/` in `chrome://extensions`; how to find the
  extension ID and register the OAuth redirect URI.
- **OAuth setup walkthrough:** creating the Notion public integration, the
  one-time config, and connecting a workspace.
- **Manual test checklist:** connect, list databases, clip a normal article,
  clip a logged-in/SPA page (verify bookmark fallback), clip with a note, switch
  workspaces, re-connect after token revocation.
- **Running the automated tests:** commands for Worker tests and extension
  tests, and what each covers.

## Project Layout

```
/extension
  manifest.config.ts   MV3 manifest (CRXJS, typed)
  vite.config.ts       Vite + CRXJS + Svelte
  src/
    popup/             Svelte popup (App.svelte, components, popup.html)
    background/        service worker (oauth, notion list, clip dispatch)
    lib/               storage helpers, message types, pure logic
/worker
  src/
    index.js        router
    oauth.js        /oauth/exchange
    clip.js         /clip
    extract.js      readability extraction
    notion-blocks.js  html -> notion blocks converter
    notion-client.js  notion API calls
  test/
  wrangler.toml
/docs/superpowers/specs
  2026-06-09-notion-web-clipper-design.md
```

## One-Time Setup (documented for the user)

A **single** Notion public integration serves both dev and production. A Notion
integration can register **multiple redirect URIs**, so both environments share
one `client_id` / `client_secret` and differ only by which redirect URI is used.

1. **Pin the dev extension ID** so the dev redirect URI stays stable across
   reloads/machines: add a `key` (public key from a generated keypair) to the
   MV3 manifest via `manifest.config.ts`. Chrome derives a deterministic ID from
   it. Confirm the resulting redirect URI at runtime with
   `chrome.identity.getRedirectURL()` (returns
   `https://<extension-id>.chromiumapp.org/`).
2. Create a Notion **public** integration → obtain `client_id` and
   `client_secret`. Register **both** redirect URIs on it:
   - dev: `https://<dev-extension-id>.chromiumapp.org/`
   - prod: `https://<prod-extension-id>.chromiumapp.org/` (the prod ID is the
     permanent ID assigned on Chrome Web Store publish — add this URI once known).
3. Configure the extension's `client_id` and Worker URL.
4. `wrangler secret put NOTION_CLIENT_SECRET` (and `NOTION_CLIENT_ID`) for each
   Worker environment (the same secret value, since one integration); deploy the
   Worker with `wrangler deploy`.
5. Load the unpacked extension in Chrome; click **Connect**.

> Note: one shared integration means dev testing and prod use the same OAuth
> credentials and token store scope. If this build is later shared with others,
> revisit splitting into separate dev/prod integrations for isolation.

## Open Questions / Future Enhancements

- Database property mapping (tags, status) at clip time.
- Text-selection clipping.
- Token refresh handling if Notion introduces token expiry for OAuth bots.
