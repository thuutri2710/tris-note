import type {
  ClipMessage,
  ClipResult,
  Connection,
  DatabaseOption,
  Destination,
  ListDatabasesMessage,
  RequestMessage,
} from "../lib/types";

export type RouterDeps = {
  getConnections: () => Promise<Connection[]>;
  getLastDestination: () => Promise<Destination | null>;
  saveConnection: (c: Connection) => Promise<void>;
  setLastDestination: (d: Destination) => Promise<void>;
  runOAuth: () => Promise<Connection>;
  listDatabases: (token: string) => Promise<DatabaseOption[]>;
  setCachedDatabases: (workspaceId: string, databases: DatabaseOption[]) => Promise<void>;
  clip: (params: {
    accessToken: string;
    databaseId: string;
    title: string;
    url: string;
    note: string;
    noteMarkdown?: boolean;
  }) => Promise<ClipResult>;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 401
  );
}

export async function handleMessage(
  deps: RouterDeps,
  msg: RequestMessage,
): Promise<unknown> {
  switch (msg.type) {
    case "getState": {
      const [connections, lastDestination] = await Promise.all([
        deps.getConnections(),
        deps.getLastDestination(),
      ]);
      return { ok: true, connections, lastDestination };
    }

    case "connect": {
      try {
        const connection = await deps.runOAuth();
        await deps.saveConnection(connection);
        return { ok: true, connection };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }

    case "listDatabases": {
      const { workspaceId } = msg as ListDatabasesMessage;
      const conn = (await deps.getConnections()).find(
        (c) => c.workspaceId === workspaceId,
      );
      if (!conn) return { ok: false, error: "Workspace not connected" };
      try {
        const databases = await deps.listDatabases(conn.accessToken);
        await deps.setCachedDatabases(workspaceId, databases);
        return { ok: true, databases };
      } catch (err) {
        return {
          ok: false,
          error: errorMessage(err),
          ...(isUnauthorized(err) ? { needsReconnect: true } : {}),
        };
      }
    }

    case "clip": {
      const { payload } = msg as ClipMessage;
      const conn = (await deps.getConnections()).find(
        (c) => c.workspaceId === payload.workspaceId,
      );
      if (!conn) return { ok: false, error: "Workspace not connected" };
      try {
        const result = await deps.clip({
          accessToken: conn.accessToken,
          databaseId: payload.databaseId,
          title: payload.title,
          url: payload.url,
          note: payload.note,
          noteMarkdown: payload.noteMarkdown ?? false,
        });
        await deps.setLastDestination({
          workspaceId: payload.workspaceId,
          databaseId: payload.databaseId,
        });
        return { ok: true, result };
      } catch (err) {
        return {
          ok: false,
          error: errorMessage(err),
          ...(isUnauthorized(err) ? { needsReconnect: true } : {}),
        };
      }
    }
  }
}
