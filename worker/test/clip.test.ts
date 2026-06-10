import { describe, it, expect, vi } from "vitest";
import { performClip, fetchPageHtml, type ClipDeps } from "../src/clip";

const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>Post — Site</title></head>
<body><article><h1>Post</h1>
<p>${"This is a nice long readable paragraph of article content. ".repeat(8)}</p>
<p>${"A second paragraph that keeps Readability happy and confident. ".repeat(8)}</p>
</article></body></html>`;

function makeDeps(over: Partial<ClipDeps> = {}): ClipDeps {
  return {
    fetchPageHtml: vi.fn(async () => ARTICLE_HTML),
    getDatabase: vi.fn(async () => ({
      properties: { Name: { type: "title" }, Link: { type: "url" } },
    })),
    createPage: vi.fn(async () => ({
      id: "page1",
      url: "https://notion.so/page1",
    })),
    appendBlockChildren: vi.fn(async () => {}),
    ...over,
  };
}

describe("performClip", () => {
  it("creates a page with extracted content and reports no fallback", async () => {
    const deps = makeDeps();
    const result = await performClip(deps, {
      databaseId: "db1",
      title: "User Title",
      url: "https://site.test/post",
      note: "my note",
    });

    expect(result).toEqual({
      ok: true,
      pageUrl: "https://notion.so/page1",
      fallback: false,
    });

    const createArg = (deps.createPage as any).mock.calls[0][0];
    // Title comes from the user-supplied title.
    expect(createArg.properties.Name.title[0].text.content).toBe("User Title");
    // URL stored as a property (DB has a url prop), so no bookmark block.
    expect(createArg.properties.Link).toEqual({ url: "https://site.test/post" });
    // Note callout + extracted paragraphs are present.
    const types = createArg.children.map((b: any) => b.type);
    expect(types).toContain("callout");
    expect(types).toContain("paragraph");
  });

  it("writes a plain note into a matching DB property and skips the callout", async () => {
    const deps = makeDeps({
      getDatabase: vi.fn(async () => ({
        properties: {
          Name: { type: "title" },
          Link: { type: "url" },
          Notes: { type: "rich_text" },
        },
      })),
    });
    await performClip(deps, {
      databaseId: "db1",
      title: "T",
      url: "https://site.test/post",
      note: "remember this",
    });
    const createArg = (deps.createPage as any).mock.calls[0][0];
    expect(createArg.properties.Notes).toEqual({
      rich_text: [{ text: { content: "remember this" } }],
    });
    expect(createArg.children.some((b: any) => b.type === "callout")).toBe(false);
  });

  it("converts a markdown note into Notion blocks instead of a callout", async () => {
    const deps = makeDeps();
    await performClip(deps, {
      databaseId: "db1",
      title: "T",
      url: "https://site.test/post",
      note: "# Heading\n\n- one\n- two",
      noteMarkdown: true,
    });
    const createArg = (deps.createPage as any).mock.calls[0][0];
    const types = createArg.children.map((b: any) => b.type);
    // Markdown produced a heading + list items, not a plain callout.
    expect(types).toContain("heading_1");
    expect(types).toContain("bulleted_list_item");
    expect(types).not.toContain("callout");
  });

  it("falls back to a bookmark page when extraction fails", async () => {
    const deps = makeDeps({ fetchPageHtml: vi.fn(async () => null) });
    const result = await performClip(deps, {
      databaseId: "db1",
      title: "Fallback Title",
      url: "https://site.test/locked",
      note: "",
    });

    expect(result.ok).toBe(true);
    expect(result.fallback).toBe(true);

    const createArg = (deps.createPage as any).mock.calls[0][0];
    expect(createArg.properties.Name.title[0].text.content).toBe(
      "Fallback Title",
    );
    // No content paragraphs were extracted.
    expect(createArg.children.some((b: any) => b.type === "paragraph")).toBe(
      false,
    );
  });

  it("uses the extracted title when the user provides none", async () => {
    const deps = makeDeps();
    await performClip(deps, {
      databaseId: "db1",
      title: "",
      url: "https://site.test/post",
      note: "",
    });
    const createArg = (deps.createPage as any).mock.calls[0][0];
    expect(createArg.properties.Name.title[0].text.content).toBe("Post — Site");
  });

  it("appends overflow blocks beyond the first 100 children", async () => {
    // Build HTML with 150 paragraphs to exceed the 100-block create limit.
    const manyParas = Array.from(
      { length: 150 },
      (_, i) => `<p>${"Paragraph content number " + i + " ".repeat(6)}</p>`,
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Big</title></head><body><article><h1>Big</h1>${manyParas}</article></body></html>`;
    const deps = makeDeps({ fetchPageHtml: vi.fn(async () => html) });

    await performClip(deps, {
      databaseId: "db1",
      title: "Big",
      url: "https://site.test/big",
      note: "",
    });

    const createArg = (deps.createPage as any).mock.calls[0][0];
    expect(createArg.children.length).toBe(100);
    expect((deps.appendBlockChildren as any).mock.calls.length).toBe(1);
    const [, , appended] = (deps.appendBlockChildren as any).mock.calls[0];
    expect(appended.length).toBeGreaterThan(0);
  });
});

describe("fetchPageHtml", () => {
  it("returns the response text on a 200", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>hi</html>", { status: 200 }),
    ) as unknown as typeof fetch;
    const html = await fetchPageHtml("https://x.test", fetchImpl);
    expect(html).toBe("<html>hi</html>");
  });

  it("returns null on a non-ok response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 403 }),
    ) as unknown as typeof fetch;
    const html = await fetchPageHtml("https://x.test", fetchImpl);
    expect(html).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const html = await fetchPageHtml("https://x.test", fetchImpl);
    expect(html).toBeNull();
  });
});
