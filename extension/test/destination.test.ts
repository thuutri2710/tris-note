import { describe, it, expect } from "vitest";
import {
  pickInitialWorkspaceId,
  pickInitialDatabaseId,
} from "../src/lib/destination";
import type { Connection, DatabaseOption } from "../src/lib/types";

const conns: Connection[] = [
  { workspaceId: "ws-a", workspaceName: "A", workspaceIcon: null, accessToken: "t", botId: "b" },
  { workspaceId: "ws-b", workspaceName: "B", workspaceIcon: null, accessToken: "t", botId: "b" },
];
const dbs: DatabaseOption[] = [
  { id: "db-1", title: "One" },
  { id: "db-2", title: "Two" },
];

describe("pickInitialWorkspaceId", () => {
  it("returns null when there are no connections", () => {
    expect(pickInitialWorkspaceId([], null)).toBeNull();
  });

  it("prefers the last destination's workspace when still connected", () => {
    expect(pickInitialWorkspaceId(conns, { workspaceId: "ws-b", databaseId: "db-2" }))
      .toBe("ws-b");
  });

  it("falls back to the first connection when last is missing or gone", () => {
    expect(pickInitialWorkspaceId(conns, null)).toBe("ws-a");
    expect(pickInitialWorkspaceId(conns, { workspaceId: "ws-gone", databaseId: "x" }))
      .toBe("ws-a");
  });
});

describe("pickInitialDatabaseId", () => {
  it("returns null when there are no databases", () => {
    expect(pickInitialDatabaseId([], null, "ws-a")).toBeNull();
  });

  it("prefers the last destination's database when it belongs to this workspace and exists", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-a", databaseId: "db-2" }, "ws-a"),
    ).toBe("db-2");
  });

  it("falls back to the first database when last is for a different workspace", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-b", databaseId: "db-2" }, "ws-a"),
    ).toBe("db-1");
  });

  it("falls back to the first database when the last db no longer exists", () => {
    expect(
      pickInitialDatabaseId(dbs, { workspaceId: "ws-a", databaseId: "db-gone" }, "ws-a"),
    ).toBe("db-1");
  });
});
