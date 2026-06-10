import { describe, it, expect } from "vitest";
import {
  chunk,
  analyzeDatabase,
  buildPageProperties,
  buildClipChildren,
  createPage,
  appendBlockChildren,
  getDatabase,
  exchangeOAuthCode,
} from "../src/notion-client";

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no canned response");
    return next;
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const config = (fetchImpl: typeof fetch) => ({
  token: "secret-token",
  fetch: fetchImpl,
  notionVersion: "2022-06-28",
});

describe("chunk", () => {
  it("splits an array into batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("returns a single batch when input fits", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });
});

describe("analyzeDatabase", () => {
  it("finds the title property name and a url property name", () => {
    const db = {
      properties: {
        Link: { id: "a", type: "url" },
        Name: { id: "title", type: "title" },
        Tags: { id: "c", type: "multi_select" },
      },
    };
    expect(analyzeDatabase(db)).toEqual({
      titleProp: "Name",
      urlProp: "Link",
      noteProp: null,
    });
  });

  it("returns urlProp null when no url-typed property exists", () => {
    const db = {
      properties: {
        Title: { id: "title", type: "title" },
      },
    };
    expect(analyzeDatabase(db)).toEqual({
      titleProp: "Title",
      urlProp: null,
      noteProp: null,
    });
  });

  it("finds a rich_text property named like a note", () => {
    const db = {
      properties: {
        Name: { id: "title", type: "title" },
        Notes: { id: "n", type: "rich_text" },
        Other: { id: "o", type: "rich_text" },
      },
    };
    expect(analyzeDatabase(db)).toEqual({
      titleProp: "Name",
      urlProp: null,
      noteProp: "Notes",
    });
  });

  it("falls back to a default title prop name when none is found", () => {
    const db = { properties: {} };
    expect(analyzeDatabase(db)).toEqual({
      titleProp: "title",
      urlProp: null,
      noteProp: null,
    });
  });
});

describe("buildPageProperties", () => {
  it("sets the title property and the url property when available", () => {
    const props = buildPageProperties("My Title", "https://x.test", "", {
      titleProp: "Name",
      urlProp: "Link",
      noteProp: null,
    });
    expect(props).toEqual({
      Name: { title: [{ text: { content: "My Title" } }] },
      Link: { url: "https://x.test" },
    });
  });

  it("omits the url property when the database has none", () => {
    const props = buildPageProperties("My Title", "https://x.test", "", {
      titleProp: "Name",
      urlProp: null,
      noteProp: null,
    });
    expect(props).toEqual({
      Name: { title: [{ text: { content: "My Title" } }] },
    });
  });

  it("writes the note into the note property when one exists", () => {
    const props = buildPageProperties("My Title", "https://x.test", "remember", {
      titleProp: "Name",
      urlProp: null,
      noteProp: "Notes",
    });
    expect(props).toEqual({
      Name: { title: [{ text: { content: "My Title" } }] },
      Notes: { rich_text: [{ text: { content: "remember" } }] },
    });
  });
});

describe("buildClipChildren", () => {
  it("adds a bookmark for the url when no url property exists", () => {
    const children = buildClipChildren({
      url: "https://x.test",
      note: "",
      hasUrlProperty: false,
      contentBlocks: [{ object: "block", type: "paragraph", paragraph: {} }],
    });
    expect(children[0]).toEqual({
      object: "block",
      type: "bookmark",
      bookmark: { url: "https://x.test" },
    });
    expect(children).toHaveLength(2);
  });

  it("does not add a bookmark when a url property exists", () => {
    const children = buildClipChildren({
      url: "https://x.test",
      note: "",
      hasUrlProperty: true,
      contentBlocks: [],
    });
    expect(children).toEqual([]);
  });

  it("prepends a note callout above content when a note is given", () => {
    const children = buildClipChildren({
      url: "https://x.test",
      note: "remember this",
      hasUrlProperty: true,
      contentBlocks: [{ object: "block", type: "paragraph", paragraph: {} }],
    });
    expect(children[0]).toEqual({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: "remember this" } }],
        icon: { type: "emoji", emoji: "📝" },
      },
    });
    expect(children).toHaveLength(2);
  });

  it("skips the body callout when the note was written to a property", () => {
    const children = buildClipChildren({
      url: "https://x.test",
      note: "remember this",
      hasUrlProperty: true,
      contentBlocks: [{ object: "block", type: "paragraph", paragraph: {} }],
      noteInProperty: true,
    });
    expect(children.some((b: any) => b.type === "callout")).toBe(false);
    expect(children).toHaveLength(1);
  });
});

describe("getDatabase", () => {
  it("GETs the database with auth headers and returns the json", async () => {
    const { fn, calls } = fakeFetch([json({ id: "db1", properties: {} })]);
    const db = await getDatabase(config(fn), "db1");

    expect(calls[0].url).toBe("https://api.notion.com/v1/databases/db1");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect(
      (calls[0].init.headers as Record<string, string>)["Notion-Version"],
    ).toBe("2022-06-28");
    expect(db).toEqual({ id: "db1", properties: {} });
  });

  it("throws a NotionApiError on a non-ok response", async () => {
    const { fn } = fakeFetch([json({ message: "unauthorized" }, 401)]);
    await expect(getDatabase(config(fn), "db1")).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("createPage", () => {
  it("POSTs a page to the database and returns id and url", async () => {
    const { fn, calls } = fakeFetch([
      json({ id: "page1", url: "https://notion.so/page1" }),
    ]);

    const result = await createPage(config(fn), {
      databaseId: "db1",
      properties: { Name: { title: [{ text: { content: "T" } }] } },
      children: [{ object: "block", type: "paragraph", paragraph: {} }],
    });

    expect(calls[0].url).toBe("https://api.notion.com/v1/pages");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      parent: { database_id: "db1" },
      properties: { Name: { title: [{ text: { content: "T" } }] } },
      children: [{ object: "block", type: "paragraph", paragraph: {} }],
    });
    expect(result).toEqual({ id: "page1", url: "https://notion.so/page1" });
  });
});

describe("appendBlockChildren", () => {
  it("PATCHes children in batches of 100", async () => {
    const blocks = Array.from({ length: 250 }, (_, i) => ({ n: i }));
    const { fn, calls } = fakeFetch([json({}), json({}), json({})]);

    await appendBlockChildren(config(fn), "page1", blocks, 100);

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(
      "https://api.notion.com/v1/blocks/page1/children",
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string).children).toHaveLength(100);
    expect(JSON.parse(calls[2].init.body as string).children).toHaveLength(50);
  });

  it("does nothing when there are no blocks", async () => {
    const { fn, calls } = fakeFetch([]);
    await appendBlockChildren(config(fn), "page1", [], 100);
    expect(calls).toHaveLength(0);
  });
});

describe("exchangeOAuthCode", () => {
  it("POSTs the code with Basic auth and returns the token bundle", async () => {
    const tokenBundle = {
      access_token: "tok",
      workspace_id: "ws1",
      workspace_name: "Tri's Notion",
      workspace_icon: "https://x.test/icon.png",
      bot_id: "bot1",
    };
    const { fn, calls } = fakeFetch([json(tokenBundle)]);

    const result = await exchangeOAuthCode({
      code: "auth-code",
      redirectUri: "https://abc.chromiumapp.org/",
      clientId: "cid",
      clientSecret: "csecret",
      fetch: fn,
    });

    expect(calls[0].url).toBe("https://api.notion.com/v1/oauth/token");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + btoa("cid:csecret"),
    );
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://abc.chromiumapp.org/",
    });
    expect(result).toEqual(tokenBundle);
  });

  it("throws a NotionApiError when Notion rejects the code", async () => {
    const { fn } = fakeFetch([json({ error: "invalid_grant" }, 400)]);
    await expect(
      exchangeOAuthCode({
        code: "bad",
        redirectUri: "https://abc.chromiumapp.org/",
        clientId: "cid",
        clientSecret: "csecret",
        fetch: fn,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
