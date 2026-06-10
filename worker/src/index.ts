import { performClip, fetchPageHtml, type ClipResult } from "./clip";
import { openApiSpec, SWAGGER_UI_HTML } from "./openapi";
import {
  exchangeOAuthCode,
  getDatabase,
  createPage,
  appendBlockChildren,
  type NotionConfig,
} from "./notion-client";

export type Env = {
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
  NOTION_VERSION?: string;
};

export type ExchangeBody = { code: string; redirectUri: string };
export type ClipBody = {
  accessToken: string;
  databaseId: string;
  title?: string;
  url: string;
  note?: string;
  noteMarkdown?: boolean;
};

// Injected operations so routing/CORS/error-mapping is testable without network.
export type RouterDeps = {
  exchange: (env: Env, body: ExchangeBody) => Promise<unknown>;
  clip: (env: Env, body: ClipBody) => Promise<ClipResult>;
};

const DEFAULT_NOTION_VERSION = "2022-06-28";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  deps: RouterDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { pathname } = new URL(request.url);

  // API docs (OpenAPI spec + Swagger UI) — served without auth.
  if (request.method === "GET" && pathname === "/openapi.json") {
    return jsonResponse(openApiSpec);
  }
  if (request.method === "GET" && (pathname === "/docs" || pathname === "/")) {
    return new Response(SWAGGER_UI_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
    });
  }

  try {
    if (request.method === "POST" && pathname === "/oauth/exchange") {
      const body = (await request.json()) as ExchangeBody;
      if (!body?.code || !body?.redirectUri) {
        return jsonResponse({ error: "code and redirectUri are required" }, 400);
      }
      const bundle = await deps.exchange(env, body);
      return jsonResponse(bundle);
    }

    if (request.method === "POST" && pathname === "/clip") {
      const body = (await request.json()) as ClipBody;
      if (!body?.accessToken || !body?.databaseId || !body?.url) {
        return jsonResponse(
          { error: "accessToken, databaseId and url are required" },
          400,
        );
      }
      const result = await deps.clip(env, body);
      return jsonResponse(result);
    }

    return jsonResponse({ error: "not found" }, 404);
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    // Surface Notion's own error reason (e.g. "invalid_client") when present,
    // so OAuth/clip failures are diagnosable instead of an opaque status.
    const body = err?.body;
    const reason =
      body && typeof body === "object"
        ? body.error_description ?? body.error ?? body.message
        : undefined;
    const message = reason
      ? `${err?.message ?? "error"}: ${reason}`
      : err?.message ?? "internal error";
    return jsonResponse({ error: message, detail: body ?? null }, status);
  }
}

// --- Real dependency wiring -------------------------------------------------

// The global `fetch` must keep its `this` bound to globalThis on Workers;
// passing it around as a bare reference triggers an "Illegal invocation" error.
const boundFetch: typeof fetch = (...args) => fetch(...args);

function notionConfig(env: Env, token: string): NotionConfig {
  return {
    token,
    fetch: boundFetch,
    notionVersion: env.NOTION_VERSION ?? DEFAULT_NOTION_VERSION,
  };
}

const realDeps: RouterDeps = {
  exchange: (env, body) =>
    exchangeOAuthCode({
      code: body.code,
      redirectUri: body.redirectUri,
      clientId: env.NOTION_CLIENT_ID,
      clientSecret: env.NOTION_CLIENT_SECRET,
      fetch: boundFetch,
    }),
  clip: (env, body) => {
    const config = notionConfig(env, body.accessToken);
    return performClip(
      {
        fetchPageHtml: (url) => fetchPageHtml(url, boundFetch),
        getDatabase: (databaseId) => getDatabase(config, databaseId),
        createPage: (params) => createPage(config, params),
        appendBlockChildren: (_databaseId, pageId, blocks) =>
          appendBlockChildren(config, pageId, blocks, 100),
      },
      {
        databaseId: body.databaseId,
        title: body.title ?? "",
        url: body.url,
        note: body.note ?? "",
        noteMarkdown: body.noteMarkdown ?? false,
      },
    );
  },
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, realDeps);
  },
};
