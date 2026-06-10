import { describe, it, expect, vi } from "vitest";
import { handleMessage, type RouterDeps } from "../src/background/router";
import type { Connection } from "../src/lib/types";

const conn: Connection = {
  workspaceId: "ws-a",
  workspaceName: "A",
  workspaceIcon: null,
  accessToken: "tok-a",
  botId: "bot-a",
};

function makeDeps(over: Partial<RouterDeps> = {}): RouterDeps {
  return {
    getConnections: vi.fn(async () => [conn]),
    getLastDestination: vi.fn(async () => null),
    saveConnection: vi.fn(async () => {}),
    setLastDestination: vi.fn(async () => {}),
    runOAuth: vi.fn(async () => conn),
    listDatabases: vi.fn(async () => [{ id: "db-1", title: "One" }]),
    setCachedDatabases: vi.fn(async () => {}),
    clip: vi.fn(async () => ({ ok: true, pageUrl: "https://n/p", fallback: false })),
    ...over,
  };
}

describe("handleMessage", () => {
  it("getState returns connections + lastDestination", async () => {
    const res = await handleMessage(makeDeps(), { type: "getState" });
    expect(res).toEqual({ ok: true, connections: [conn], lastDestination: null });
  });

  it("connect runs OAuth, saves the connection, returns it", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, { type: "connect" });
    expect(deps.saveConnection).toHaveBeenCalledWith(conn);
    expect(res).toEqual({ ok: true, connection: conn });
  });

  it("connect returns an error response when OAuth fails", async () => {
    const deps = makeDeps({
      runOAuth: vi.fn(async () => {
        throw new Error("user cancelled");
      }),
    });
    const res = await handleMessage(deps, { type: "connect" });
    expect(res).toEqual({ ok: false, error: "user cancelled" });
  });

  it("listDatabases returns options for the workspace's token", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, {
      type: "listDatabases",
      workspaceId: "ws-a",
    });
    expect(deps.listDatabases).toHaveBeenCalledWith("tok-a");
    expect(deps.setCachedDatabases).toHaveBeenCalledWith("ws-a", [
      { id: "db-1", title: "One" },
    ]);
    expect(res).toEqual({ ok: true, databases: [{ id: "db-1", title: "One" }] });
  });

  it("listDatabases for an unknown workspace returns an error", async () => {
    const res = await handleMessage(makeDeps(), {
      type: "listDatabases",
      workspaceId: "ws-missing",
    });
    expect(res).toEqual({ ok: false, error: "Workspace not connected" });
  });

  it("listDatabases maps a 401 to needsReconnect", async () => {
    const err: any = new Error("Unauthorized");
    err.status = 401;
    const deps = makeDeps({
      listDatabases: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await handleMessage(deps, {
      type: "listDatabases",
      workspaceId: "ws-a",
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized", needsReconnect: true });
  });

  it("clip uses the workspace token, saves lastDestination, returns the result", async () => {
    const deps = makeDeps();
    const res = await handleMessage(deps, {
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "n",
      },
    });
    expect(deps.clip).toHaveBeenCalledWith({
      accessToken: "tok-a",
      databaseId: "db-1",
      title: "T",
      url: "https://x/",
      note: "n",
      noteMarkdown: false,
    });
    expect(deps.setLastDestination).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      databaseId: "db-1",
    });
    expect(res).toEqual({
      ok: true,
      result: { ok: true, pageUrl: "https://n/p", fallback: false },
    });
  });

  it("clip maps a 401 to needsReconnect and does not save destination", async () => {
    const err: any = new Error("Unauthorized");
    err.status = 401;
    const deps = makeDeps({
      clip: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await handleMessage(deps, {
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "",
      },
    });
    expect(deps.setLastDestination).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: "Unauthorized", needsReconnect: true });
  });
});
