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
    noteMarkdown?: boolean;
  },
  deps: WorkerDeps,
): Promise<ClipResult> {
  return postJson(deps, "/clip", params);
}
