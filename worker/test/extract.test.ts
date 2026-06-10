import { describe, it, expect } from "vitest";
import { extractArticle } from "../src/extract";

const ARTICLE_HTML = `<!DOCTYPE html>
<html>
  <head><title>My Great Article — Site</title></head>
  <body>
    <nav>home about contact</nav>
    <article>
      <h1>My Great Article</h1>
      <p>${"This is the first substantial paragraph of the article body. ".repeat(8)}</p>
      <p>${"Here is a second paragraph that adds even more readable content. ".repeat(8)}</p>
      <p>${"And a third paragraph so Readability is confident this is content. ".repeat(8)}</p>
    </article>
    <footer>copyright</footer>
  </body>
</html>`;

describe("extractArticle", () => {
  it("returns the title and cleaned content HTML for an article", () => {
    const result = extractArticle(ARTICLE_HTML, "https://site.test/post");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("My Great Article — Site");
    expect(result!.contentHtml).toContain("first substantial paragraph");
    expect(result!.contentHtml).not.toContain("home about contact");
  });

  it("returns null when there is no extractable article content", () => {
    const result = extractArticle(
      "<!DOCTYPE html><html><body><div></div></body></html>",
      "https://site.test/empty",
    );
    expect(result).toBeNull();
  });
});
