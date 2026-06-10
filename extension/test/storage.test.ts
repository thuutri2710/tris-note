import { describe, it, expect } from "vitest";
import {
  getConnections,
  saveConnection,
  removeConnection,
  getLastDestination,
  setLastDestination,
  getCachedDatabases,
  setCachedDatabases,
  getRecentNotes,
  addRecentNote,
} from "../src/lib/storage";
import type { Connection } from "../src/lib/types";

const connA: Connection = {
  workspaceId: "ws-a",
  workspaceName: "Workspace A",
  workspaceIcon: null,
  accessToken: "tok-a",
  botId: "bot-a",
};
const connAUpdated: Connection = { ...connA, accessToken: "tok-a2" };
const connB: Connection = {
  workspaceId: "ws-b",
  workspaceName: "Workspace B",
  workspaceIcon: "https://x/i.png",
  accessToken: "tok-b",
  botId: "bot-b",
};

describe("connections storage", () => {
  it("returns [] when nothing stored", async () => {
    expect(await getConnections()).toEqual([]);
  });

  it("saves and reads back a connection", async () => {
    await saveConnection(connA);
    expect(await getConnections()).toEqual([connA]);
  });

  it("replaces an existing connection by workspaceId (no duplicates)", async () => {
    await saveConnection(connA);
    await saveConnection(connAUpdated);
    const all = await getConnections();
    expect(all).toHaveLength(1);
    expect(all[0].accessToken).toBe("tok-a2");
  });

  it("keeps multiple distinct workspaces", async () => {
    await saveConnection(connA);
    await saveConnection(connB);
    expect((await getConnections()).map((c) => c.workspaceId)).toEqual([
      "ws-a",
      "ws-b",
    ]);
  });

  it("removes a connection by workspaceId", async () => {
    await saveConnection(connA);
    await saveConnection(connB);
    await removeConnection("ws-a");
    expect((await getConnections()).map((c) => c.workspaceId)).toEqual(["ws-b"]);
  });
});

describe("lastDestination storage", () => {
  it("returns null when unset", async () => {
    expect(await getLastDestination()).toBeNull();
  });

  it("round-trips a destination", async () => {
    await setLastDestination({ workspaceId: "ws-a", databaseId: "db-1" });
    expect(await getLastDestination()).toEqual({
      workspaceId: "ws-a",
      databaseId: "db-1",
    });
  });
});

describe("database cache", () => {
  const dbs = [
    { id: "db-1", title: "One", icon: null },
    { id: "db-2", title: "Two", icon: { kind: "emoji" as const, value: "📚" } },
  ];

  it("returns null when nothing is cached for a workspace", async () => {
    expect(await getCachedDatabases("ws-a")).toBeNull();
  });

  it("round-trips a per-workspace database list", async () => {
    await setCachedDatabases("ws-a", dbs);
    expect(await getCachedDatabases("ws-a")).toEqual(dbs);
  });

  it("keeps caches for different workspaces independent", async () => {
    await setCachedDatabases("ws-a", dbs);
    await setCachedDatabases("ws-b", [{ id: "db-9", title: "Nine", icon: null }]);
    expect(await getCachedDatabases("ws-a")).toEqual(dbs);
    expect(await getCachedDatabases("ws-b")).toEqual([
      { id: "db-9", title: "Nine", icon: null },
    ]);
  });
});

describe("recent notes", () => {
  it("returns [] when none stored", async () => {
    expect(await getRecentNotes()).toEqual([]);
  });

  it("prepends most-recent-first and ignores blank notes", async () => {
    await addRecentNote("first");
    await addRecentNote("   ");
    await addRecentNote("second");
    expect(await getRecentNotes()).toEqual(["second", "first"]);
  });

  it("de-duplicates, moving a repeated note back to the front", async () => {
    await addRecentNote("a");
    await addRecentNote("b");
    await addRecentNote("a");
    expect(await getRecentNotes()).toEqual(["a", "b"]);
  });

  it("caps the history at 8 entries", async () => {
    for (let i = 0; i < 12; i++) await addRecentNote(`note ${i}`);
    const notes = await getRecentNotes();
    expect(notes).toHaveLength(8);
    expect(notes[0]).toBe("note 11");
  });
});
