import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import App from "../src/popup/App.svelte";
import * as bridge from "../src/popup/lib-bridge";

vi.mock("../src/popup/lib-bridge", () => ({
  sendMessage: vi.fn(),
  getActiveTab: vi.fn(async () => ({ title: "Example Page", url: "https://example.com/" })),
}));

const conn = {
  workspaceId: "ws-a",
  workspaceName: "Workspace A",
  workspaceIcon: null,
  accessToken: "tok",
  botId: "bot",
};

function mockSend(impl: (msg: any) => any) {
  (bridge.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (msg: any) => impl(msg),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("App popup", () => {
  it("shows Connect when no workspace is connected", async () => {
    mockSend((msg) =>
      msg.type === "getState"
        ? { ok: true, connections: [], lastDestination: null }
        : { ok: false, error: "unexpected" },
    );
    render(App);
    expect(await screen.findByText("Connect Notion")).toBeInTheDocument();
  });

  it("prefills the title from the active tab and lists databases when connected", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const titleInput = (await screen.findByPlaceholderText(
      "Page title",
    )) as HTMLInputElement;
    expect(titleInput.value).toBe("Example Page");
    expect(await screen.findByText("Clips")).toBeInTheDocument();
  });

  it("dispatches a clip message and shows success", async () => {
    const sent: any[] = [];
    mockSend((msg) => {
      sent.push(msg);
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip")
        return { ok: true, result: { ok: true, pageUrl: "https://n/p", fallback: false } };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(screen.getByText("Saved to Notion.")).toBeInTheDocument(),
    );
    const clip = sent.find((m) => m.type === "clip");
    expect(clip.payload).toMatchObject({
      workspaceId: "ws-a",
      databaseId: "db-1",
      title: "Example Page",
      url: "https://example.com/",
    });
  });

  it("shows the bookmark-fallback notice when the worker reports fallback", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip")
        return { ok: true, result: { ok: true, pageUrl: "https://n/p", fallback: true } };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(
        screen.getByText("Saved as bookmark — content couldn't be extracted."),
      ).toBeInTheDocument(),
    );
  });

  it("shows an error banner when clip fails", async () => {
    mockSend((msg) => {
      if (msg.type === "getState")
        return { ok: true, connections: [conn], lastDestination: null };
      if (msg.type === "listDatabases")
        return { ok: true, databases: [{ id: "db-1", title: "Clips" }] };
      if (msg.type === "clip") return { ok: false, error: "server boom" };
      return { ok: false, error: "unexpected" };
    });
    render(App);
    const saveBtn = await screen.findByRole("button", { name: "Save page" });
    await fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(screen.getByText("server boom")).toBeInTheDocument(),
    );
  });
});
