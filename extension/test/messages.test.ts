import { describe, it, expect } from "vitest";
import {
  getStateMessage,
  connectMessage,
  listDatabasesMessage,
  clipMessage,
  isRequestMessage,
} from "../src/lib/messages";

describe("message builders", () => {
  it("builds a getState message", () => {
    expect(getStateMessage()).toEqual({ type: "getState" });
  });

  it("builds a connect message", () => {
    expect(connectMessage()).toEqual({ type: "connect" });
  });

  it("builds a listDatabases message", () => {
    expect(listDatabasesMessage("ws-a")).toEqual({
      type: "listDatabases",
      workspaceId: "ws-a",
    });
  });

  it("builds a clip message with the full payload", () => {
    const msg = clipMessage({
      workspaceId: "ws-a",
      databaseId: "db-1",
      title: "T",
      url: "https://x/",
      note: "n",
    });
    expect(msg).toEqual({
      type: "clip",
      payload: {
        workspaceId: "ws-a",
        databaseId: "db-1",
        title: "T",
        url: "https://x/",
        note: "n",
      },
    });
  });
});

describe("isRequestMessage", () => {
  it("accepts known message types", () => {
    expect(isRequestMessage({ type: "getState" })).toBe(true);
    expect(isRequestMessage({ type: "clip", payload: {} })).toBe(true);
  });

  it("rejects unknown or malformed values", () => {
    expect(isRequestMessage(null)).toBe(false);
    expect(isRequestMessage({})).toBe(false);
    expect(isRequestMessage({ type: "nope" })).toBe(false);
    expect(isRequestMessage("getState")).toBe(false);
  });
});
