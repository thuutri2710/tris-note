import { describe, it, expect } from "vitest";
import { htmlToBlocks } from "../src/notion-blocks";

describe("htmlToBlocks", () => {
  it("converts a paragraph into a paragraph block", () => {
    const blocks = htmlToBlocks("<p>Hello world</p>");

    expect(blocks).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Hello world" } },
          ],
        },
      },
    ]);
  });

  it("converts h1/h2/h3 into heading_1/2/3 blocks", () => {
    const blocks = htmlToBlocks("<h1>A</h1><h2>B</h2><h3>C</h3>");

    expect(blocks.map((b) => b.type)).toEqual([
      "heading_1",
      "heading_2",
      "heading_3",
    ]);
    expect(blocks[0]).toEqual({
      object: "block",
      type: "heading_1",
      heading_1: { rich_text: [{ type: "text", text: { content: "A" } }] },
    });
  });

  it("maps h4-h6 down to heading_3", () => {
    const blocks = htmlToBlocks("<h4>D</h4><h5>E</h5><h6>F</h6>");
    expect(blocks.map((b) => b.type)).toEqual([
      "heading_3",
      "heading_3",
      "heading_3",
    ]);
  });

  it("converts ul items into bulleted_list_item blocks", () => {
    const blocks = htmlToBlocks("<ul><li>one</li><li>two</li></ul>");
    expect(blocks).toEqual([
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: "one" } }],
        },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: "two" } }],
        },
      },
    ]);
  });

  it("converts ol items into numbered_list_item blocks", () => {
    const blocks = htmlToBlocks("<ol><li>first</li><li>second</li></ol>");
    expect(blocks.map((b) => b.type)).toEqual([
      "numbered_list_item",
      "numbered_list_item",
    ]);
  });

  it("converts blockquote into a quote block", () => {
    const blocks = htmlToBlocks("<blockquote>wise words</blockquote>");
    expect(blocks).toEqual([
      {
        object: "block",
        type: "quote",
        quote: {
          rich_text: [{ type: "text", text: { content: "wise words" } }],
        },
      },
    ]);
  });

  it("converts pre/code into a code block preserving whitespace", () => {
    const blocks = htmlToBlocks(
      "<pre><code>const a = 1;\n  const b = 2;</code></pre>",
    );
    expect(blocks).toEqual([
      {
        object: "block",
        type: "code",
        code: {
          language: "plain text",
          rich_text: [
            { type: "text", text: { content: "const a = 1;\n  const b = 2;" } },
          ],
        },
      },
    ]);
  });

  it("converts a standalone img into an external image block", () => {
    const blocks = htmlToBlocks('<img src="https://x.test/a.png" alt="cat">');
    expect(blocks).toEqual([
      {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: "https://x.test/a.png" },
        },
      },
    ]);
  });

  it("extracts an img nested inside a figure", () => {
    const blocks = htmlToBlocks(
      '<figure><img src="https://x.test/b.jpg"><figcaption>cap</figcaption></figure>',
    );
    expect(blocks).toEqual([
      {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: "https://x.test/b.jpg" },
        },
      },
    ]);
  });

  it("ignores images without an absolute http(s) src", () => {
    const blocks = htmlToBlocks('<img src="data:image/png;base64,AAAA">');
    expect(blocks).toEqual([]);
  });

  it("descends into wrapper elements (div/article/section)", () => {
    const blocks = htmlToBlocks(
      '<div id="readability-page-1"><article><p>nested</p><h2>head</h2></article></div>',
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading_2"]);
  });

  it("preserves inline links as rich_text with href", () => {
    const blocks = htmlToBlocks(
      '<p>see <a href="https://x.test/p">the page</a> now</p>',
    );
    expect(blocks[0]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "see " } },
          {
            type: "text",
            text: { content: "the page", link: { url: "https://x.test/p" } },
          },
          { type: "text", text: { content: " now" } },
        ],
      },
    });
  });

  it("annotates bold, italic, and inline code, leaving plain text unannotated", () => {
    const blocks = htmlToBlocks(
      "<p>plain <strong>bold</strong> <em>it</em> <code>cd</code></p>",
    );
    const rt = (blocks[0] as any).paragraph.rich_text;
    expect(rt[0]).toEqual({ type: "text", text: { content: "plain " } });
    expect(rt.find((s: any) => s.text.content === "bold").annotations).toEqual({
      bold: true,
    });
    expect(rt.find((s: any) => s.text.content === "it").annotations).toEqual({
      italic: true,
    });
    expect(rt.find((s: any) => s.text.content === "cd").annotations).toEqual({
      code: true,
    });
  });

  it("resolves a relative link against the base URL", () => {
    const blocks = htmlToBlocks(
      '<p>see <a href="/posts/x?ref=z">it</a></p>',
      "https://site.test/blog/",
    );
    const rt = (blocks[0] as any).paragraph.rich_text;
    const linked = rt.find((s: any) => s.text.content === "it");
    expect(linked.text.link).toEqual({ url: "https://site.test/posts/x?ref=z" });
  });

  it("drops invalid links (relative with no base, pure anchors) but keeps the text", () => {
    const noBase = htmlToBlocks('<p>a <a href="/rel">b</a> c</p>');
    const rtNoBase = (noBase[0] as any).paragraph.rich_text;
    expect(rtNoBase.find((s: any) => s.text.content === "b").text.link).toBeUndefined();

    const anchor = htmlToBlocks(
      '<p>x <a href="#frag">y</a></p>',
      "https://site.test/",
    );
    const rtAnchor = (anchor[0] as any).paragraph.rich_text;
    expect(rtAnchor.find((s: any) => s.text.content === "y").text.link).toBeUndefined();
  });

  it("splits text over 2000 chars into multiple rich_text segments", () => {
    const long = "a".repeat(4500);
    const blocks = htmlToBlocks(`<p>${long}</p>`);

    expect(blocks).toHaveLength(1);
    const rt = (blocks[0] as any).paragraph.rich_text;
    expect(rt).toHaveLength(3);
    expect(rt[0].text.content).toHaveLength(2000);
    expect(rt[1].text.content).toHaveLength(2000);
    expect(rt[2].text.content).toHaveLength(500);
    expect(rt.map((s: any) => s.text.content).join("")).toBe(long);
  });
});
