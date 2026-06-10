import { describe, it, expect, vi } from "vitest";
import { exchangeCode, clipViaWorker } from "../src/lib/worker-client";

describe("exchangeCode", () => {
  it("POSTs code + redirectUri to the Worker and returns the bundle", async () => {
    const bundle = {
      access_token: "tok",
      workspace_id: "ws-a",
      workspace_name: "A",
      workspace_icon: null,
      bot_id: "bot",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));
    const result = await exchangeCode(
      { code: "c1", redirectUri: "https://id.chromiumapp.org/" },
      { workerUrl: "https://w.example", fetch: fetchMock },
    );
    expect(result).toEqual(bundle);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://w.example/oauth/exchange");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      code: "c1",
      redirectUri: "https://id.chromiumapp.org/",
    });
  });

  it("throws with the Worker error message on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "bad code" }), { status: 400 }),
    );
    await expect(
      exchangeCode(
        { code: "x", redirectUri: "r" },
        { workerUrl: "https://w.example", fetch: fetchMock },
      ),
    ).rejects.toThrow("bad code");
  });
});

describe("clipViaWorker", () => {
  it("POSTs the clip body and returns the ClipResult", async () => {
    const body = { ok: true, pageUrl: "https://notion.so/p", fallback: false };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const result = await clipViaWorker(
      { accessToken: "tok", databaseId: "db-1", title: "T", url: "https://x/", note: "n" },
      { workerUrl: "https://w.example", fetch: fetchMock },
    );
    expect(result).toEqual(body);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://w.example/clip");
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "server boom" }), { status: 500 }),
    );
    await expect(
      clipViaWorker(
        { accessToken: "t", databaseId: "d", title: "", url: "u", note: "" },
        { workerUrl: "https://w.example", fetch: fetchMock },
      ),
    ).rejects.toThrow("server boom");
  });
});
