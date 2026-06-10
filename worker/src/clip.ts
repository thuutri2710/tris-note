export type ClipDeps = {
  fetchPageHtml: (url: string) => Promise<string | null>;
  getDatabase: (databaseId: string) => Promise<any>;
  createPage: (params: {
    databaseId: string;
    properties: unknown;
    children: any[];
  }) => Promise<{ id: string; url: string }>;
  appendBlockChildren: (
    databaseId: string,
    pageId: string,
    blocks: any[],
  ) => Promise<void>;
};

export type ClipParams = {
  databaseId: string;
  title: string;
  url: string;
  note: string;
  /** When true, the note is parsed as Markdown into Notion blocks. */
  noteMarkdown?: boolean;
};

export type ClipResult = {
  ok: boolean;
  pageUrl: string;
  fallback: boolean;
};

import { marked } from "marked";
import { extractArticle } from "./extract";
import { htmlToBlocks } from "./notion-blocks";
import {
  analyzeDatabase,
  buildPageProperties,
  buildClipChildren,
} from "./notion-client";

/** Parse a Markdown note into Notion blocks (via Markdown -> HTML -> blocks). */
export function markdownToBlocks(markdown: string): any[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];
  const html = marked.parse(trimmed, { async: false }) as string;
  return htmlToBlocks(html);
}

const MAX_CHILDREN_PER_CREATE = 100;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Fetch a page's HTML. Returns null on any non-ok response or network error,
 * which the caller treats as an extraction failure (bookmark fallback).
 */
export async function fetchPageHtml(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function performClip(
  deps: ClipDeps,
  params: ClipParams,
): Promise<ClipResult> {
  const analysis = analyzeDatabase(await deps.getDatabase(params.databaseId));

  const html = await deps.fetchPageHtml(params.url);
  const article = html ? extractArticle(html, params.url) : null;
  const fallback = !article;

  const title =
    params.title.trim() || article?.title?.trim() || params.url;
  const contentBlocks = article
    ? htmlToBlocks(article.contentHtml, params.url)
    : [];

  const noteBlocks = params.noteMarkdown ? markdownToBlocks(params.note) : [];

  const properties = buildPageProperties(title, params.url, analysis);
  const children = buildClipChildren({
    url: params.url,
    note: params.note,
    hasUrlProperty: analysis.urlProp !== null,
    contentBlocks,
    noteBlocks,
  });

  const firstBatch = children.slice(0, MAX_CHILDREN_PER_CREATE);
  const overflow = children.slice(MAX_CHILDREN_PER_CREATE);

  const page = await deps.createPage({
    databaseId: params.databaseId,
    properties,
    children: firstBatch,
  });

  if (overflow.length > 0) {
    await deps.appendBlockChildren(params.databaseId, page.id, overflow);
  }

  return { ok: true, pageUrl: page.url, fallback };
}
