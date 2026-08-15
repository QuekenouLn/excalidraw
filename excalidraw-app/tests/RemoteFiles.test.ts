import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";

import { deleteRemoteFile, type RemoteFile } from "../data/remoteFiles";
import {
  copyRemoteFilename,
  filterRemoteFiles,
} from "../components/RemoteFilesSidebar";

vi.mock("@excalidraw/excalidraw/clipboard", () => ({
  copyTextToSystemClipboard: vi.fn(),
}));

const files: RemoteFile[] = [
  {
    name: "Architecture.excalidraw",
    size: 10,
    updatedAt: "2026-08-14T00:00:00Z",
    revision: "revision-a",
  },
  {
    name: "notes.excalidraw",
    size: 20,
    updatedAt: "2026-08-13T00:00:00Z",
    revision: "revision-b",
  },
];

describe("Remote files", () => {
  it("filters filenames case-insensitively", () => {
    expect(filterRemoteFiles(files, "  ARCH  ")).toEqual([files[0]]);
    expect(filterRemoteFiles(files, "")).toEqual(files);
    expect(filterRemoteFiles(files, "missing")).toEqual([]);
  });

  it("deletes with the listed revision", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await deleteRemoteFile("Architecture.excalidraw", "revision-a");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/Architecture.excalidraw",
      {
        method: "DELETE",
        headers: { "If-Match": "revision-a" },
      },
    );
    fetchMock.mockRestore();
  });

  it("copies the complete filename", async () => {
    await copyRemoteFilename("Architecture.excalidraw");

    expect(copyTextToSystemClipboard).toHaveBeenCalledWith(
      "Architecture.excalidraw",
    );
  });
});
