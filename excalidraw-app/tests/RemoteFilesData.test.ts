import {
  fetchRemoteFileRevisionBlob,
  listRemoteFileHistory,
  loadRemoteFileRevision,
  RemoteFileRequestError,
  restoreRemoteFileRevision,
} from "../data/remoteFiles";

const blobMocks = vi.hoisted(() => ({
  loadFromBlob: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw/data/blob", () => blobMocks);

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

describe("Remote files data layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobMocks.loadFromBlob.mockResolvedValue({
      elements: [],
      appState: {},
      files: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists archived revisions using the history view model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        {
          revision: "archived-revision",
          size: 42,
          archivedAt: "2026-08-15T10:00:00Z",
        },
      ]),
    );

    await expect(
      listRemoteFileHistory("Team plan.excalidraw"),
    ).resolves.toEqual([
      {
        revision: "archived-revision",
        size: 42,
        updatedAt: "2026-08-15T10:00:00Z",
        current: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/Team%20plan.excalidraw/history",
    );
  });

  it("restores a revision only against the current revision", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ revision: "restored-revision" }));

    await expect(
      restoreRemoteFileRevision(
        "Team plan.excalidraw",
        "archived/revision",
        "current-revision",
      ),
    ).resolves.toEqual({ revision: "restored-revision" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/Team%20plan.excalidraw/history/archived%2Frevision/restore",
      {
        method: "POST",
        headers: { "If-Match": "current-revision" },
      },
    );
  });

  it("fetches a historical revision as a Blob", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "local",
          elements: [],
          appState: {},
          files: {},
        }),
        { headers: { "Content-Type": "application/vnd.excalidraw+json" } },
      ),
    );

    const blob = await fetchRemoteFileRevisionBlob(
      "Team plan.excalidraw",
      "archived/revision",
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(JSON.parse(await readBlob(blob))).toMatchObject({
      type: "excalidraw",
      source: "local",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/Team%20plan.excalidraw/history/archived%2Frevision",
    );
  });

  it("loads an isolated MCP revision with app state and files", async () => {
    const files = {
      image: {
        id: "image",
        dataURL: "data:image/png;base64,cHJldmlldw==",
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        type: "excalidraw",
        version: 2,
        source: "excalidraw-mcp-native",
        elements: [
          {
            id: "rectangle",
            type: "rectangle",
            x: 10,
            y: 20,
            width: 30,
            height: 40,
          },
          { type: "cameraUpdate" },
        ],
        appState: { viewBackgroundColor: "#abcdef" },
        files,
      }),
    );

    await loadRemoteFileRevision("MCP plan.excalidraw", "revision-a");

    expect(blobMocks.loadFromBlob).toHaveBeenCalledTimes(1);
    const [blob, localAppState, localElements] =
      blobMocks.loadFromBlob.mock.calls[0];
    const document = JSON.parse(await readBlob(blob));
    expect(localAppState).toBeNull();
    expect(localElements).toBeNull();
    expect(document.elements).toHaveLength(1);
    expect(document.elements[0]).toMatchObject({
      id: "rectangle",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(document.appState).toEqual({ viewBackgroundColor: "#abcdef" });
    expect(document.files).toEqual(files);
  });

  it("rejects a current preview that changed after history opened", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "local",
          elements: [],
          appState: {},
          files: {},
        }),
        { headers: { ETag: '"new-revision"' } },
      ),
    );

    await expect(
      loadRemoteFileRevision("Team plan.excalidraw", null, "listed-revision"),
    ).rejects.toThrow("File changed since history was opened");
    expect(blobMocks.loadFromBlob).not.toHaveBeenCalled();
  });

  it("preserves HTTP status for revision conflicts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("File changed since history was opened", { status: 412 }),
    );

    const error = await restoreRemoteFileRevision(
      "Team plan.excalidraw",
      "archived-revision",
      "stale-current-revision",
    ).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(RemoteFileRequestError);
    expect(error).toMatchObject({
      message: "File changed since history was opened",
      status: 412,
    });
  });
});
