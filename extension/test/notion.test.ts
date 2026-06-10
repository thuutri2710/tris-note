import { describe, it, expect } from "vitest";
import {
  buildSearchRequest,
  databaseTitle,
  databaseIcon,
  parseDatabaseList,
} from "../src/lib/notion";

describe("buildSearchRequest", () => {
  it("targets the Notion search endpoint with the database filter and auth", () => {
    const req = buildSearchRequest("tok-123");
    expect(req.url).toBe("https://api.notion.com/v1/search");
    expect(req.init.method).toBe("POST");
    const headers = req.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-123");
    expect(headers["Notion-Version"]).toBe("2022-06-28");
    expect(JSON.parse(req.init.body as string)).toEqual({
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
  });
});

describe("databaseTitle", () => {
  it("joins rich-text plain_text segments", () => {
    expect(
      databaseTitle({
        title: [
          { plain_text: "My " },
          { plain_text: "Clips" },
        ],
      }),
    ).toBe("My Clips");
  });

  it("falls back to 'Untitled' when title is empty or missing", () => {
    expect(databaseTitle({ title: [] })).toBe("Untitled");
    expect(databaseTitle({})).toBe("Untitled");
  });
});

describe("databaseIcon", () => {
  it("reads an emoji icon", () => {
    expect(databaseIcon({ icon: { type: "emoji", emoji: "📚" } })).toEqual({
      kind: "emoji",
      value: "📚",
    });
  });

  it("reads an external (URL) icon", () => {
    expect(
      databaseIcon({ icon: { type: "external", external: { url: "https://x/i.png" } } }),
    ).toEqual({ kind: "url", value: "https://x/i.png" });
  });

  it("reads an uploaded (file) icon", () => {
    expect(
      databaseIcon({ icon: { type: "file", file: { url: "https://x/f.png" } } }),
    ).toEqual({ kind: "url", value: "https://x/f.png" });
  });

  it("returns null when there is no icon", () => {
    expect(databaseIcon({})).toBeNull();
    expect(databaseIcon({ icon: null })).toBeNull();
  });
});

describe("parseDatabaseList", () => {
  it("maps a search response to {id, title, icon} options, skipping non-databases", () => {
    const res = {
      results: [
        {
          object: "database",
          id: "db-1",
          title: [{ plain_text: "One" }],
          icon: { type: "emoji", emoji: "📚" },
        },
        { object: "page", id: "pg-x", properties: {} },
        { object: "database", id: "db-2", title: [] },
      ],
    };
    expect(parseDatabaseList(res)).toEqual([
      { id: "db-1", title: "One", icon: { kind: "emoji", value: "📚" } },
      { id: "db-2", title: "Untitled", icon: null },
    ]);
  });

  it("returns [] for a malformed response", () => {
    expect(parseDatabaseList(null)).toEqual([]);
    expect(parseDatabaseList({})).toEqual([]);
  });
});
