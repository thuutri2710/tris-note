import { defineManifest } from "@crxjs/vite-plugin";

// `key` pins a deterministic extension ID in dev so the OAuth redirect URI
// (https://<id>.chromiumapp.org/) stays stable across reloads. This is the
// base64 public half of a generated RSA keypair; the private key is not kept
// (it's only needed to package a .crx, which we don't do for dev). To rotate
// it, see DEVELOPMENT.md "Pin the dev extension ID". Set to undefined to let
// Chrome assign a random dev ID instead.
const DEV_KEY: string | undefined =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3fog5VJE2CgLIRmaTmVexrQPyFBOk1VfoG5Do6y7O5kQY5D08H/uqRhfkKtZSNTYKV4+paRTT2Sn9QWZTariqJUnD4LWkpM7cYRxOgUARuOAi8ONr0glYneTzWiLYjKBEiCc2inypvrI1LLO3YgFKxGendJ6RsWaTo1m46hnHKxa6pIbB1GUDB2IBDh1EoDxo1qO/U7mfBpT2ySQT9xM/vFdfNx8SVI462sy1v5dArPQ8AXKxkiRDm/mq4qxaDIT66dw3Wdldt/dRYUcZCn7j+O4vTGn0vXbSsIbPznw7iY8oKZ2eEsDyxQ9gLo3o2ZuCI+x7X6aqo2HXi5NJUdjmwIDAQAB";

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
  // `_execute_action` is a built-in command that opens the popup — no JS needed.
  // The user can rebind it at chrome://extensions/shortcuts.
  commands: {
    _execute_action: {
      suggested_key: {
        default: "Ctrl+Shift+Y",
        mac: "Command+Shift+Y",
      },
      description: "Open the Notion clipper",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["identity", "storage", "tabs"],
  host_permissions: ["https://api.notion.com/*"],
});
