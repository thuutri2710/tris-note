import { handleMessage, type RouterDeps } from "./router";
import { runOAuth } from "./oauth";
import {
  getConnections,
  getLastDestination,
  saveConnection,
  setLastDestination,
  setCachedDatabases,
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
    const err: any = new Error(data?.message ?? `Notion search failed (${response.status})`);
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
  setCachedDatabases,
  clip: (params) => clipViaWorker(params, { workerUrl: WORKER_URL, fetch: boundFetch }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRequestMessage(message)) {
    sendResponse({ ok: false, error: "Unknown message" });
    return false;
  }
  handleMessage(deps, message)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  return true; // keep the message channel open for the async response
});
