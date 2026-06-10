export type DatabaseAnalysis = {
  titleProp: string;
  urlProp: string | null;
  noteProp: string | null;
};

// A rich_text property the note can be written into so it shows in the table.
const NOTE_PROP_RE = /^(note|notes|comment|comments|description|summary)$/i;

export function analyzeDatabase(db: any): DatabaseAnalysis {
  const properties: Record<string, { type?: string }> = db?.properties ?? {};
  let titleProp: string | null = null;
  let urlProp: string | null = null;
  let noteProp: string | null = null;

  for (const [name, prop] of Object.entries(properties)) {
    if (prop?.type === "title" && titleProp === null) titleProp = name;
    if (prop?.type === "url" && urlProp === null) urlProp = name;
    if (prop?.type === "rich_text" && noteProp === null && NOTE_PROP_RE.test(name)) {
      noteProp = name;
    }
  }

  return { titleProp: titleProp ?? "title", urlProp, noteProp };
}

export function buildPageProperties(
  title: string,
  url: string,
  note: string,
  analysis: DatabaseAnalysis,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [analysis.titleProp]: { title: [{ text: { content: title } }] },
  };
  if (analysis.urlProp) {
    properties[analysis.urlProp] = { url };
  }
  if (analysis.noteProp && note.trim()) {
    properties[analysis.noteProp] = {
      rich_text: [{ text: { content: note } }],
    };
  }
  return properties;
}

export function buildClipChildren(params: {
  url: string;
  note: string;
  hasUrlProperty: boolean;
  contentBlocks: any[];
  /** Pre-built blocks for a markdown note; when present, used instead of the
   * plain callout. */
  noteBlocks?: any[];
  /** True when the note was already written to a database property, so the
   * body callout is skipped to avoid duplication. */
  noteInProperty?: boolean;
}): any[] {
  const children: any[] = [];

  if (!params.hasUrlProperty) {
    children.push({
      object: "block",
      type: "bookmark",
      bookmark: { url: params.url },
    });
  }

  if (params.noteBlocks && params.noteBlocks.length > 0) {
    children.push(...params.noteBlocks);
  } else if (!params.noteInProperty && params.note.trim()) {
    children.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: params.note } }],
        icon: { type: "emoji", emoji: "📝" },
      },
    });
  }

  children.push(...params.contentBlocks);
  return children;
}

const NOTION_API = "https://api.notion.com/v1";

export type NotionConfig = {
  token: string;
  fetch: typeof fetch;
  notionVersion: string;
};

export class NotionApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`Notion API error ${status}`);
    this.name = "NotionApiError";
    this.status = status;
    this.body = body;
  }
}

async function notionRequest(
  config: NotionConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Notion-Version": config.notionVersion,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await config.fetch(`${NOTION_API}${path}`, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NotionApiError(response.status, data);
  }
  return data;
}

export function getDatabase(config: NotionConfig, databaseId: string): Promise<any> {
  return notionRequest(config, "GET", `/databases/${databaseId}`);
}

export async function createPage(
  config: NotionConfig,
  params: { databaseId: string; properties: unknown; children: any[] },
): Promise<{ id: string; url: string }> {
  const data = await notionRequest(config, "POST", "/pages", {
    parent: { database_id: params.databaseId },
    properties: params.properties,
    children: params.children,
  });
  return { id: data.id, url: data.url };
}

export async function appendBlockChildren(
  config: NotionConfig,
  blockId: string,
  blocks: any[],
  batchSize: number,
): Promise<void> {
  for (const batch of chunk(blocks, batchSize)) {
    await notionRequest(config, "PATCH", `/blocks/${blockId}/children`, {
      children: batch,
    });
  }
}

export async function exchangeOAuthCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
}): Promise<any> {
  const basic = btoa(`${params.clientId}:${params.clientSecret}`);
  const response = await params.fetch(`${NOTION_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NotionApiError(response.status, data);
  }
  return data;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
