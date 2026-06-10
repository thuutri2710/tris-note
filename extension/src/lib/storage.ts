import type { Connection, DatabaseOption, Destination } from "./types";

const CONNECTIONS_KEY = "connections";
const LAST_DESTINATION_KEY = "lastDestination";
const DATABASE_CACHE_KEY = "databaseCache";
const RECENT_NOTES_KEY = "recentNotes";
const MAX_RECENT_NOTES = 8;

export async function getConnections(): Promise<Connection[]> {
  const data = await chrome.storage.local.get(CONNECTIONS_KEY);
  const value = data[CONNECTIONS_KEY];
  return Array.isArray(value) ? (value as Connection[]) : [];
}

export async function saveConnection(connection: Connection): Promise<void> {
  const existing = await getConnections();
  const next = existing.filter(
    (c) => c.workspaceId !== connection.workspaceId,
  );
  next.push(connection);
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: next });
}

export async function removeConnection(workspaceId: string): Promise<void> {
  const existing = await getConnections();
  const next = existing.filter((c) => c.workspaceId !== workspaceId);
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: next });
}

export async function getLastDestination(): Promise<Destination | null> {
  const data = await chrome.storage.local.get(LAST_DESTINATION_KEY);
  const value = data[LAST_DESTINATION_KEY];
  if (value && typeof value === "object" && "workspaceId" in value) {
    return value as Destination;
  }
  return null;
}

export async function setLastDestination(dest: Destination): Promise<void> {
  await chrome.storage.local.set({ [LAST_DESTINATION_KEY]: dest });
}

// --- Database list cache (per workspace) ----------------------------------
// Lets the popup render the "Add to" picker instantly from the last known
// list while a fresh copy is fetched in the background.

type DatabaseCache = Record<string, DatabaseOption[]>;

async function readDatabaseCache(): Promise<DatabaseCache> {
  const data = await chrome.storage.local.get(DATABASE_CACHE_KEY);
  const value = data[DATABASE_CACHE_KEY];
  return value && typeof value === "object" ? (value as DatabaseCache) : {};
}

export async function getCachedDatabases(
  workspaceId: string,
): Promise<DatabaseOption[] | null> {
  const cache = await readDatabaseCache();
  const list = cache[workspaceId];
  return Array.isArray(list) ? list : null;
}

export async function setCachedDatabases(
  workspaceId: string,
  databases: DatabaseOption[],
): Promise<void> {
  const cache = await readDatabaseCache();
  cache[workspaceId] = databases;
  await chrome.storage.local.set({ [DATABASE_CACHE_KEY]: cache });
}

// --- Recent notes ----------------------------------------------------------
// Most-recent-first, de-duplicated, capped — so a note can be reused quickly.

export async function getRecentNotes(): Promise<string[]> {
  const data = await chrome.storage.local.get(RECENT_NOTES_KEY);
  const value = data[RECENT_NOTES_KEY];
  return Array.isArray(value)
    ? value.filter((n): n is string => typeof n === "string")
    : [];
}

export async function addRecentNote(note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;
  const existing = await getRecentNotes();
  const next = [trimmed, ...existing.filter((n) => n !== trimmed)].slice(
    0,
    MAX_RECENT_NOTES,
  );
  await chrome.storage.local.set({ [RECENT_NOTES_KEY]: next });
}
