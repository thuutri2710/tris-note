// Build-time config injected via Vite env (.env / .env.local). See .env.example.
export const WORKER_URL: string =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
export const NOTION_CLIENT_ID: string =
  import.meta.env.VITE_NOTION_CLIENT_ID ?? "";
export const NOTION_VERSION = "2022-06-28";
