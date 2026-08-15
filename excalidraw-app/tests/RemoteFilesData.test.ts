import {
  listRemoteFileHistory,
  RemoteFileRequestError,
  restoreRemoteFileRevision,
} from "../data/remoteFiles";

describe("Remote files data layer", () => {
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
