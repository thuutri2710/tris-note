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
