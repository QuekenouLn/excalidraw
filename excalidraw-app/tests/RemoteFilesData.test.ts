import {
  fetchRemoteFileRevisionBlob,
  getRenamedRemoteFileState,
  listRemoteFileHistory,
  loadRemoteFileRevision,
  openRemoteFile,
  renameRemoteFile,
  RemoteFileRequestError,
  restoreRemoteFileRevision,
  saveRemoteFile,
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

  it("renames a remote file with revision protection", async () => {
    const renamed = {
      name: "Renamed plan.excalidraw",
      size: 42,
      updatedAt: "2026-08-22T10:00:00Z",
      revision: "current-revision",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(renamed));

    await expect(
      renameRemoteFile(
        "Team plan.excalidraw",
        "Renamed plan.excalidraw",
        "current-revision",
      ),
    ).resolves.toEqual(renamed);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/Team%20plan.excalidraw",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": "current-revision",
        },
        body: JSON.stringify({ name: "Renamed plan.excalidraw" }),
      },
    );
  });

  it("updates only matching active-file identity and preserves dirty state", () => {
    const renamed = {
      name: "Renamed plan.excalidraw",
      size: 42,
      updatedAt: "2026-08-22T10:00:00Z",
      revision: "new-revision",
    };
    expect(
      getRenamedRemoteFileState(
        "Team plan.excalidraw",
        "old-revision",
        true,
        "Team plan.excalidraw",
        renamed,
      ),
    ).toEqual({
      activeName: renamed.name,
      activeRevision: renamed.revision,
      dirty: true,
    });
    expect(
      getRenamedRemoteFileState(
        "Other plan.excalidraw",
        "other-revision",
        false,
        "Team plan.excalidraw",
        renamed,
      ),
    ).toEqual({
      activeName: "Other plan.excalidraw",
      activeRevision: "other-revision",
      dirty: false,
    });
  });

  it("preserves rename conflict errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Target file already exists", { status: 409 }),
    );
    await expect(
      renameRemoteFile("Team plan.excalidraw", "Taken.excalidraw", "revision"),
    ).rejects.toMatchObject({
      status: 409,
      message: "Target file already exists",
    });
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

  it("preserves complete native MCP elements when opening on WEB", async () => {
    const elements = [
      {
        id: "container",
        type: "rectangle",
        x: 100,
        y: 200,
        width: 240,
        height: 100,
        version: 3,
        versionNonce: 10,
        boundElements: [{ id: "label", type: "text" }],
      },
      {
        id: "label",
        type: "text",
        x: 170,
        y: 238,
        width: 100,
        height: 24,
        version: 3,
        versionNonce: 11,
        text: "平台防御",
        originalText: "平台防御",
        fontSize: 20,
        fontFamily: 11,
        lineHeight: 1.2,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: "container",
        autoResize: true,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        type: "excalidraw",
        version: 2,
        source: "excalidraw-mcp-native",
        elements,
        appState: {},
        files: {},
      }),
    );

    await loadRemoteFileRevision("MCP native.excalidraw", "revision-a");

    const [blob] = blobMocks.loadFromBlob.mock.calls[0];
    const document = JSON.parse(await readBlob(blob));
    expect(document.elements).toEqual(elements);
  });

  it("round-trips a copied high-version native scene without losing bindings", async () => {
    const elements = [
      {
        id: "source",
        type: "rectangle",
        x: 100,
        y: 200,
        width: 240,
        height: 100,
        version: 187,
        versionNonce: 9187,
        boundElements: [
          { id: "source-label", type: "text" },
          { id: "connector", type: "arrow" },
        ],
      },
      {
        id: "source-label",
        type: "text",
        x: 166,
        y: 238,
        width: 108,
        height: 24,
        version: 203,
        versionNonce: 9203,
        text: "平台防御",
        originalText: "平台防御",
        fontSize: 20,
        fontFamily: 11,
        lineHeight: 1.2,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: "source",
        autoResize: true,
      },
      {
        id: "target",
        type: "rectangle",
        x: 500,
        y: 200,
        width: 240,
        height: 100,
        version: 164,
        versionNonce: 9164,
        boundElements: [{ id: "connector", type: "arrow" }],
      },
      {
        id: "connector",
        type: "arrow",
        x: 340,
        y: 250,
        width: 160,
        height: 0,
        points: [
          [0, 0],
          [160, 0],
        ],
        version: 241,
        versionNonce: 9241,
        startBinding: {
          elementId: "source",
          focus: 0,
          gap: 0,
          fixedPoint: [1, 0.5],
          mode: "orbit",
        },
        endBinding: {
          elementId: "target",
          focus: 0,
          gap: 0,
          fixedPoint: [0, 0.5],
          mode: "orbit",
        },
        startArrowhead: null,
        endArrowhead: "arrow",
      },
    ];
    let savedDocument: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        savedDocument = JSON.parse(init.body as string);
        return Response.json({ revision: "saved-revision" });
      }
      return new Response(JSON.stringify(savedDocument), {
        headers: { ETag: '"saved-revision"' },
      });
    });
    blobMocks.loadFromBlob.mockImplementation(async (blob: Blob) =>
      JSON.parse(await readBlob(blob)),
    );
    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => elements,
      getAppState: () => ({ viewBackgroundColor: "#ffffff" }),
      getFiles: () => ({}),
      addFiles: vi.fn(),
      updateScene,
      history: { clear: vi.fn() },
    } as any;

    await saveRemoteFile(
      "Eval 系统答辩知识导图.excalidraw",
      excalidrawAPI,
      null,
    );
    await openRemoteFile("Eval 系统答辩知识导图.excalidraw", excalidrawAPI);

    expect(savedDocument.elements).toEqual(elements);
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements }),
    );
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

  it("preserves the current revision for overwrite confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("File already exists", {
        status: 412,
        headers: { ETag: '"current-revision"' },
      }),
    );

    const error = await restoreRemoteFileRevision(
      "Team plan.excalidraw",
      "archived-revision",
      "stale-current-revision",
    ).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(RemoteFileRequestError);
    expect(error).toMatchObject({
      message: "File already exists",
      status: 412,
      revision: "current-revision",
    });
  });
});
