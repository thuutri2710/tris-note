import { describe, it, expect, vi } from "vitest";
import { handleRequest, type RouterDeps } from "../src/index";

const ENV = {
  NOTION_CLIENT_ID: "cid",
  NOTION_CLIENT_SECRET: "csecret",
  NOTION_VERSION: "2022-06-28",
};

function deps(over: Partial<RouterDeps> = {}): RouterDeps {
  return {
    exchange: vi.fn(async () => ({
      access_token: "tok",
      workspace_id: "ws1",
    })),
    clip: vi.fn(async () => ({
      ok: true,
      pageUrl: "https://notion.so/p1",
      fallback: false,
    })),
    ...over,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "chrome-extension://abc" },
    body: JSON.stringify(body),
  });
}

describe("handleRequest", () => {
  it("answers CORS preflight with 204 and allow headers", async () => {
    const req = new Request("https://worker.test/clip", {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abc" },
    });
    const res = await handleRequest(req, ENV, deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("routes POST /oauth/exchange to the exchange op and returns its bundle", async () => {
    const d = deps();
    const res = await handleRequest(
      post("/oauth/exchange", {
        code: "auth-code",
        redirectUri: "https://abc.chromiumapp.org/",
      }),
      ENV,
      d,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await expect(res.json()).resolves.toEqual({
      access_token: "tok",
      workspace_id: "ws1",
    });
    expect(d.exchange).toHaveBeenCalledWith(ENV, {
      code: "auth-code",
      redirectUri: "https://abc.chromiumapp.org/",
    });
  });

  it("routes POST /clip to the clip op and returns the result", async () => {
    const d = deps();
    const body = {
      accessToken: "tok",
      databaseId: "db1",
      title: "T",
      url: "https://x.test",
      note: "n",
    };
    const res = await handleRequest(post("/clip", body), ENV, d);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      pageUrl: "https://notion.so/p1",
      fallback: false,
    });
    expect(d.clip).toHaveBeenCalledWith(ENV, body);
  });

  it("returns 400 when /clip is missing required fields", async () => {
    const d = deps();
    const res = await handleRequest(
      post("/clip", { accessToken: "tok" }),
      ENV,
      d,
    );
    expect(res.status).toBe(400);
    expect(d.clip).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown routes", async () => {
    const res = await handleRequest(post("/nope", {}), ENV, deps());
    expect(res.status).toBe(404);
  });

  it("maps an upstream Notion error status to the response", async () => {
    const failing = deps({
      clip: vi.fn(async () => {
        const err: any = new Error("unauthorized");
        err.status = 401;
        throw err;
      }),
    });
    const res = await handleRequest(
      post("/clip", {
        accessToken: "bad",
        databaseId: "db1",
        url: "https://x.test",
      }),
      ENV,
      failing,
    );
    expect(res.status).toBe(401);
  });
});
