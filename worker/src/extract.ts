import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export type ExtractedArticle = {
  title: string;
  contentHtml: string;
};

/**
 * Extract the readable article from a full HTML document string.
 * Returns null when no meaningful content can be extracted (e.g. login
 * walls, SPA shells, or empty pages).
 */
export function extractArticle(
  html: string,
  url: string,
): ExtractedArticle | null {
  let document: any;
  try {
    document = parseHTML(html).document;
  } catch {
    return null;
  }

  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(document as any).parse();
  } catch {
    return null;
  }

  if (!article || !article.content) return null;

  const contentHtml = article.content.trim();
  if (!contentHtml) return null;

  let title = (article.title ?? "").trim();
  if (!title) {
    title = (document.title ?? "").trim() || url;
  }

  return { title, contentHtml };
}
