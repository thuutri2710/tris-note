import type { DatabaseOption, NotionIcon } from "./types";
import { NOTION_VERSION } from "../config";

const SEARCH_URL = "https://api.notion.com/v1/search";

export function buildSearchRequest(token: string): {
  url: string;
  init: RequestInit;
} {
  return {
    url: SEARCH_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "object", value: "database" },
        page_size: 100,
      }),
    },
  };
}

export function databaseTitle(db: any): string {
  const parts: string[] = Array.isArray(db?.title)
    ? db.title.map((t: any) => t?.plain_text ?? "")
    : [];
  const joined = parts.join("").trim();
  return joined || "Untitled";
}

/**
 * Extract a Notion object's icon as an emoji glyph or an image URL.
 * Handles `emoji`, `external` (custom URL), and `file` (uploaded) icon types.
 */
export function databaseIcon(db: any): NotionIcon | null {
  const icon = db?.icon;
  if (!icon || typeof icon !== "object") return null;
  if (icon.type === "emoji" && typeof icon.emoji === "string") {
    return { kind: "emoji", value: icon.emoji };
  }
  if (icon.type === "external" && typeof icon.external?.url === "string") {
    return { kind: "url", value: icon.external.url };
  }
  if (icon.type === "file" && typeof icon.file?.url === "string") {
    return { kind: "url", value: icon.file.url };
  }
  return null;
}

export function parseDatabaseList(response: any): DatabaseOption[] {
  const results = response?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r?.object === "database")
    .map((r) => ({
      id: r.id as string,
      title: databaseTitle(r),
      icon: databaseIcon(r),
    }));
}
