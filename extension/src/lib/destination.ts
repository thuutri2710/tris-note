import type { Connection, DatabaseOption, Destination } from "./types";

export function pickInitialWorkspaceId(
  connections: Connection[],
  last: Destination | null,
): string | null {
  if (connections.length === 0) return null;
  if (last && connections.some((c) => c.workspaceId === last.workspaceId)) {
    return last.workspaceId;
  }
  return connections[0].workspaceId;
}

export function pickInitialDatabaseId(
  databases: DatabaseOption[],
  last: Destination | null,
  workspaceId: string | null,
): string | null {
  if (databases.length === 0) return null;
  if (
    last &&
    last.workspaceId === workspaceId &&
    databases.some((d) => d.id === last.databaseId)
  ) {
    return last.databaseId;
  }
  return databases[0].id;
}
