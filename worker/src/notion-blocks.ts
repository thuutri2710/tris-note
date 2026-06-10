import { parseHTML } from "linkedom";

export type NotionBlock = Record<string, unknown>;

type Annotations = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
};

type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: Annotations;
};

type InlineCtx = { linkUrl?: string } & Annotations;

const MAX_TEXT_LENGTH = 2000;

// Plain rich text (no inline links), used for code blocks.
function richText(content: string): RichText[] {
  const segments: RichText[] = [];
  for (let i = 0; i < content.length; i += MAX_TEXT_LENGTH) {
    segments.push({
      type: "text",
      text: { content: content.slice(i, i + MAX_TEXT_LENGTH) },
    });
  }
  return segments;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Resolve an href to a valid absolute URL Notion will accept, or null.
 * Relative links are resolved against `baseUrl`; pure anchors and any
 * non-http(s)/mailto links are dropped (Notion rejects them with a 400).
 */
function normalizeLinkUrl(
  href: string | null | undefined,
  baseUrl?: string,
): string | undefined {
  const raw = (href ?? "").trim();
  if (!raw || raw.startsWith("#")) return undefined;
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    ) {
      return url.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function annotationsOf(ctx: InlineCtx): Annotations | undefined {
  const ann: Annotations = {};
  if (ctx.bold) ann.bold = true;
  if (ctx.italic) ann.italic = true;
  if (ctx.code) ann.code = true;
  if (ctx.strikethrough) ann.strikethrough = true;
  return Object.keys(ann).length ? ann : undefined;
}

function pushTextRun(
  segments: RichText[],
  content: string,
  ctx: InlineCtx,
): void {
  const annotations = annotationsOf(ctx);
  for (let i = 0; i < content.length; i += MAX_TEXT_LENGTH) {
    const text: RichText["text"] = { content: content.slice(i, i + MAX_TEXT_LENGTH) };
    if (ctx.linkUrl) text.link = { url: ctx.linkUrl };
    const segment: RichText = { type: "text", text };
    if (annotations) segment.annotations = annotations;
    segments.push(segment);
  }
}

function walkInline(
  node: any,
  segments: RichText[],
  ctx: InlineCtx = {},
  baseUrl?: string,
): void {
  for (const child of Array.from(node.childNodes) as any[]) {
    if (child.nodeType === TEXT_NODE) {
      const value = (child.nodeValue ?? "").replace(/\s+/g, " ");
      if (value) pushTextRun(segments, value, ctx);
    } else if (child.nodeType === ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      const next: InlineCtx = { ...ctx };
      if (tag === "a") {
        next.linkUrl =
          normalizeLinkUrl(child.getAttribute("href"), baseUrl) ?? ctx.linkUrl;
      } else if (tag === "strong" || tag === "b") {
        next.bold = true;
      } else if (tag === "em" || tag === "i") {
        next.italic = true;
      } else if (tag === "code") {
        next.code = true;
      } else if (tag === "del" || tag === "s" || tag === "strike") {
        next.strikethrough = true;
      }
      walkInline(child, segments, next, baseUrl);
    }
  }
}

// Rich text from an element's inline content, preserving links + formatting.
function inlineRichText(node: any, baseUrl?: string): RichText[] {
  const segments: RichText[] = [];
  walkInline(node, segments, {}, baseUrl);
  return segments;
}

function paragraph(rich: RichText[]): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: rich },
  };
}

function heading(level: 1 | 2 | 3, rich: RichText[]): NotionBlock {
  const type = `heading_${level}` as const;
  return {
    object: "block",
    type,
    [type]: { rich_text: rich },
  };
}

function listItem(ordered: boolean, rich: RichText[]): NotionBlock {
  const type = ordered ? "numbered_list_item" : "bulleted_list_item";
  return {
    object: "block",
    type,
    [type]: { rich_text: rich },
  };
}

function quote(rich: RichText[]): NotionBlock {
  return {
    object: "block",
    type: "quote",
    quote: { rich_text: rich },
  };
}

function code(content: string): NotionBlock {
  return {
    object: "block",
    type: "code",
    code: { language: "plain text", rich_text: richText(content) },
  };
}

function imageBlock(url: string): NotionBlock {
  return {
    object: "block",
    type: "image",
    image: { type: "external", external: { url } },
  };
}

function findImageUrl(node: any): string | null {
  const img =
    node.tagName.toLowerCase() === "img" ? node : node.querySelector("img");
  const src = img?.getAttribute("src") ?? "";
  return /^https?:\/\//.test(src) ? src : null;
}

const WRAPPER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
]);

export function htmlToBlocks(html: string, baseUrl?: string): NotionBlock[] {
  const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
  const container = document.createElement("div");
  container.innerHTML = html;
  const blocks: NotionBlock[] = [];
  convertNodes(Array.from(container.children) as any[], blocks, baseUrl);
  return blocks;
}

function convertNodes(
  nodes: any[],
  blocks: NotionBlock[],
  baseUrl?: string,
): void {
  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    const raw = node.textContent ?? "";
    const text = raw.trim();

    if (tag === "img" || tag === "figure") {
      const url = findImageUrl(node);
      if (url) blocks.push(imageBlock(url));
      continue;
    }

    if (WRAPPER_TAGS.has(tag)) {
      convertNodes(Array.from(node.children) as any[], blocks, baseUrl);
      continue;
    }

    if (!text) continue;

    if (tag === "pre") {
      blocks.push(code(raw.replace(/\n$/, "")));
      continue;
    }
    if (tag === "blockquote") {
      blocks.push(quote(inlineRichText(node, baseUrl)));
      continue;
    }

    if (tag === "p") {
      blocks.push(paragraph(inlineRichText(node, baseUrl)));
    } else if (tag === "h1") {
      blocks.push(heading(1, inlineRichText(node, baseUrl)));
    } else if (tag === "h2") {
      blocks.push(heading(2, inlineRichText(node, baseUrl)));
    } else if (/^h[3-6]$/.test(tag)) {
      blocks.push(heading(3, inlineRichText(node, baseUrl)));
    } else if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      for (const li of Array.from(node.children) as any[]) {
        const itemText = (li.textContent ?? "").trim();
        if (li.tagName.toLowerCase() === "li" && itemText) {
          blocks.push(listItem(ordered, inlineRichText(li, baseUrl)));
        }
      }
    }
  }
}
