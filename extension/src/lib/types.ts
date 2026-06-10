/** One connected Notion workspace (one OAuth grant). */
export type Connection = {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  accessToken: string;
  botId: string;
};

/** A Notion icon: either an emoji glyph or an image URL. */
export type NotionIcon =
  | { kind: "emoji"; value: string }
  | { kind: "url"; value: string };

/** A database the integration can write to, shown in the "Add to" picker. */
export type DatabaseOption = {
  id: string;
  title: string;
  icon: NotionIcon | null;
};

/** Restores the user's last choice across popup opens. */
export type Destination = {
  workspaceId: string;
  databaseId: string;
};

/** Worker /clip response. */
export type ClipResult = {
  ok: boolean;
  pageUrl: string;
  fallback: boolean;
};

/** The raw Notion OAuth token bundle the Worker returns from /oauth/exchange. */
export type NotionTokenBundle = {
  access_token: string;
  workspace_id: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  bot_id: string;
};

// --- Messages: popup -> background ----------------------------------------

export type GetStateMessage = { type: "getState" };
export type ConnectMessage = { type: "connect" };
export type ListDatabasesMessage = { type: "listDatabases"; workspaceId: string };
export type ClipMessage = {
  type: "clip";
  payload: {
    workspaceId: string;
    databaseId: string;
    title: string;
    url: string;
    note: string;
    noteMarkdown?: boolean;
  };
};

export type RequestMessage =
  | GetStateMessage
  | ConnectMessage
  | ListDatabasesMessage
  | ClipMessage;

// --- Responses: background -> popup ----------------------------------------

export type GetStateResponse = {
  ok: true;
  connections: Connection[];
  lastDestination: Destination | null;
};
export type ConnectResponse =
  | { ok: true; connection: Connection }
  | { ok: false; error: string };
export type ListDatabasesResponse =
  | { ok: true; databases: DatabaseOption[] }
  | { ok: false; error: string; needsReconnect?: boolean };
export type ClipResponse =
  | { ok: true; result: ClipResult }
  | { ok: false; error: string; needsReconnect?: boolean };

export type ResponseFor<M extends RequestMessage> = M extends GetStateMessage
  ? GetStateResponse
  : M extends ConnectMessage
    ? ConnectResponse
    : M extends ListDatabasesMessage
      ? ListDatabasesResponse
      : M extends ClipMessage
        ? ClipResponse
        : never;
