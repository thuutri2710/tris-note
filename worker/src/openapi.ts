// OpenAPI 3 description of the Worker's HTTP API, served as JSON at
// `/openapi.json` and rendered by Swagger UI at `/docs`.

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Notion Web Clipper Worker API",
    version: "0.1.0",
    description:
      "Stateless Cloudflare Worker backing the Notion Web Clipper extension. " +
      "Exchanges Notion OAuth codes for tokens and saves clipped pages into a " +
      "Notion database. Holds the Notion OAuth client secret; the extension " +
      "never sees it.",
  },
  servers: [
    { url: "http://localhost:8787", description: "Local (wrangler dev)" },
    { url: "https://{worker}.workers.dev", description: "Deployed", variables: { worker: { default: "notion-web-clipper-worker" } } },
  ],
  paths: {
    "/oauth/exchange": {
      post: {
        summary: "Exchange a Notion OAuth code for an access token",
        description:
          "Calls Notion `POST /v1/oauth/token` with HTTP Basic auth " +
          "(client_id:client_secret) and returns the raw token bundle.",
        operationId: "oauthExchange",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExchangeRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Notion token bundle",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NotionTokenBundle" },
              },
            },
          },
          "400": {
            description: "Missing `code` or `redirectUri`",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "401": {
            description:
              "Notion rejected the credentials (e.g. `invalid_client`).",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/clip": {
      post: {
        summary: "Clip a web page into a Notion database",
        description:
          "Fetches the URL server-side, extracts the readable article, " +
          "converts it to Notion blocks, and creates a page in the target " +
          "database. Falls back to a bookmark-only page when extraction fails.",
        operationId: "clip",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClipRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Page created. `fallback` is true when only a bookmark could be saved.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClipResult" },
              },
            },
          },
          "400": {
            description: "Missing `accessToken`, `databaseId`, or `url`",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "401": {
            description: "Notion token invalid or revoked",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ExchangeRequest: {
        type: "object",
        required: ["code", "redirectUri"],
        properties: {
          code: {
            type: "string",
            description: "Authorization code from the OAuth redirect.",
          },
          redirectUri: {
            type: "string",
            format: "uri",
            description:
              "The redirect URI used in the authorize step; must match exactly.",
            example: "https://abcdefghijklmnop.chromiumapp.org/",
          },
        },
      },
      NotionTokenBundle: {
        type: "object",
        description: "Raw token bundle returned by Notion.",
        properties: {
          access_token: { type: "string" },
          workspace_id: { type: "string" },
          workspace_name: { type: "string", nullable: true },
          workspace_icon: { type: "string", nullable: true },
          bot_id: { type: "string" },
        },
        required: ["access_token", "workspace_id", "bot_id"],
        additionalProperties: true,
      },
      ClipRequest: {
        type: "object",
        required: ["accessToken", "databaseId", "url"],
        properties: {
          accessToken: {
            type: "string",
            description: "Notion access token for the target workspace.",
          },
          databaseId: {
            type: "string",
            description: "ID of the database the page is created in.",
          },
          title: {
            type: "string",
            description:
              "Page title. If empty, the extracted article title (or URL) is used.",
          },
          url: { type: "string", format: "uri", description: "Page to clip." },
          note: { type: "string", description: "Optional user note." },
          noteMarkdown: {
            type: "boolean",
            default: false,
            description:
              "When true, the note is parsed as Markdown into Notion blocks " +
              "instead of a single callout.",
          },
        },
      },
      ClipResult: {
        type: "object",
        required: ["ok", "pageUrl", "fallback"],
        properties: {
          ok: { type: "boolean" },
          pageUrl: {
            type: "string",
            format: "uri",
            description: "URL of the created Notion page.",
          },
          fallback: {
            type: "boolean",
            description:
              "True when the article couldn't be extracted and only a bookmark was saved.",
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            description: "Human-readable message; includes Notion's reason when available.",
          },
          detail: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            description: "Raw upstream error body from Notion, when present.",
          },
        },
      },
    },
  },
} as const;

export const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Notion Web Clipper Worker API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
      });
    </script>
  </body>
</html>`;
