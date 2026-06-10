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

`manifest.config.ts` already ships with a pinned `DEV_KEY` (the public half of
a throwaway RSA keypair), so the extension ID — and therefore the OAuth
redirect URI — is stable across reloads. The matching private key is **not**
stored: it is only needed to package a signed `.crx`, which dev doesn't do.

To rotate the key (e.g. you want a different ID), regenerate the public half
and paste it into `manifest.config.ts` as `DEV_KEY`:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out /tmp/devkey.pem
openssl rsa -in /tmp/devkey.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'; echo
rm /tmp/devkey.pem
```

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
