import React from "react";

import { Excalidraw } from "@excalidraw/excalidraw";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import {
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { deleteRemoteFile, type RemoteFile } from "../data/remoteFiles";
import {
  copyRemoteFilename,
  filterRemoteFiles,
  formatRemoteFileSize,
  RemoteFilesSidebar,
} from "../components/RemoteFilesSidebar";

const remoteFileMocks = vi.hoisted(() => ({
  listRemoteFileHistory: vi.fn(),
  listRemoteFiles: vi.fn(),
  restoreRemoteFileRevision: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw/clipboard", () => ({
  copyTextToSystemClipboard: vi.fn(),
}));

vi.mock("../data/remoteFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/remoteFiles")>()),
  ...remoteFileMocks,
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
  afterEach(() => {
    unmountComponent();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    remoteFileMocks.listRemoteFiles.mockResolvedValue(files);
  });

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

  it("formats history file sizes", () => {
    expect(formatRemoteFileSize(500)).toBe("500 B");
    expect(formatRemoteFileSize(1536)).toBe("1.5 KB");
    expect(formatRemoteFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  const renderSidebar = async (
    onRestore = vi.fn().mockResolvedValue(undefined),
    isDirty = false,
  ) => {
    await render(
      React.createElement(
        Excalidraw,
        null,
        React.createElement(RemoteFilesSidebar, {
          activeFile: "Architecture.excalidraw",
          isDirty,
          onDelete: vi.fn(),
          onOpen: vi.fn(),
          onRestore,
          revision: 0,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Architecture.excalidraw" }),
      ).toBeInTheDocument(),
    );
    return onRestore;
  };

  it("places History between Copy and Delete", async () => {
    await renderSidebar();

    const item = screen
      .getByRole("button", { name: "Architecture.excalidraw" })
      .closest(".remote-files-item")!;
    const actions = Array.from(item.querySelectorAll("button")).map(
      (button) => button.textContent,
    );

    expect(actions).toEqual([
      "Architecture.excalidraw",
      "Copy",
      "History",
      "Delete",
    ]);
  });

  it("shows loading and empty file history states", async () => {
    let resolveHistory: (value: []) => void = () => {};
    remoteFileMocks.listRemoteFileHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    await renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);

    expect(screen.getByText("File history")).toBeInTheDocument();
    expect(screen.getByText("Loading file history…")).toBeInTheDocument();

    resolveHistory([]);
    await waitFor(() =>
      expect(screen.getByText("No previous versions.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows file history errors", async () => {
    remoteFileMocks.listRemoteFileHistory.mockRejectedValue(
      new Error("History unavailable"),
    );
    await renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);

    await waitFor(() =>
      expect(screen.getByText("History unavailable")).toBeInTheDocument(),
    );
  });

  it("renders duplicate archived revisions", async () => {
    remoteFileMocks.listRemoteFileHistory.mockResolvedValue([
      {
        revision: "revision-old",
        size: 1024,
        updatedAt: "2026-08-12T00:00:00Z",
        current: false,
      },
      {
        revision: "revision-old",
        size: 1024,
        updatedAt: "2026-08-11T00:00:00Z",
        current: false,
      },
    ]);
    await renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(
        2,
      ),
    );
  });

  it("warns before discarding unsaved active-file changes", async () => {
    remoteFileMocks.listRemoteFileHistory.mockResolvedValue([
      {
        revision: "revision-old",
        size: 1024,
        updatedAt: "2026-08-12T00:00:00Z",
        current: false,
      },
    ]);
    await renderSidebar(vi.fn().mockResolvedValue(undefined), true);

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    await waitFor(() => screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(
      screen.getByText(/Your unsaved changes will be discarded\./),
    ).toBeInTheDocument();
    expect(remoteFileMocks.restoreRemoteFileRevision).not.toHaveBeenCalled();
  });

  it("restores only after confirmation and refreshes history", async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    remoteFileMocks.listRemoteFileHistory
      .mockResolvedValueOnce([
        {
          revision: "revision-old",
          size: 1024,
          updatedAt: "2026-08-12T00:00:00Z",
          current: false,
        },
      ])
      .mockResolvedValueOnce([]);
    remoteFileMocks.restoreRemoteFileRevision.mockResolvedValue({
      revision: "revision-restored",
    });
    remoteFileMocks.listRemoteFiles
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce([
        { ...files[0], revision: "revision-restored" },
        files[1],
      ]);
    await renderSidebar(onRestore);

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Restore" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.getByText("Restore file version?")).toBeInTheDocument();
    expect(remoteFileMocks.restoreRemoteFileRevision).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[1]);

    await waitFor(() =>
      expect(remoteFileMocks.restoreRemoteFileRevision).toHaveBeenCalledWith(
        "Architecture.excalidraw",
        "revision-old",
        "revision-a",
      ),
    );
    expect(onRestore).toHaveBeenCalledWith(
      "Architecture.excalidraw",
      "revision-restored",
    );
    await waitFor(() =>
      expect(remoteFileMocks.listRemoteFileHistory).toHaveBeenCalledTimes(2),
    );
  });

  it("shows restore errors", async () => {
    remoteFileMocks.listRemoteFileHistory.mockResolvedValue([
      {
        revision: "revision-old",
        size: 1024,
        updatedAt: "2026-08-12T00:00:00Z",
        current: false,
      },
    ]);
    remoteFileMocks.restoreRemoteFileRevision.mockRejectedValue(
      new Error("Restore failed"),
    );
    await renderSidebar();

    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    await waitFor(() => screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[1]);

    await waitFor(() =>
      expect(screen.getByText("Restore failed")).toBeInTheDocument(),
    );
  });
});
