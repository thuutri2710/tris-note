import type {
  ClipMessage,
  ConnectMessage,
  GetStateMessage,
  ListDatabasesMessage,
  RequestMessage,
} from "./types";

export function getStateMessage(): GetStateMessage {
  return { type: "getState" };
}

export function connectMessage(): ConnectMessage {
  return { type: "connect" };
}

export function listDatabasesMessage(workspaceId: string): ListDatabasesMessage {
  return { type: "listDatabases", workspaceId };
}

export function clipMessage(payload: ClipMessage["payload"]): ClipMessage {
  return { type: "clip", payload };
}

const KNOWN_TYPES = new Set([
  "getState",
  "connect",
  "listDatabases",
  "clip",
]);

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string" &&
    KNOWN_TYPES.has((value as { type: string }).type)
  );
}
