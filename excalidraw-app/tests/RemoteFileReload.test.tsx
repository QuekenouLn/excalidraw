import React from "react";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";

const mocks = vi.hoisted(() => ({
  listRemoteFiles: vi.fn(),
  loadRemoteFilePreview: vi.fn(),
  openRemoteFile: vi.fn(),
}));

vi.mock("../data/remoteFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/remoteFiles")>()),
  ...mocks,
}));

const filename = "reload-regression.excalidraw";

describe("reopening the active remote file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRemoteFiles.mockResolvedValue([
      {
        name: filename,
        size: 100,
        updatedAt: "2026-10-15T00:00:00Z",
        revision: "v1",
      },
    ]);
    mocks.loadRemoteFilePreview.mockResolvedValue(null);
    mocks.openRemoteFile.mockResolvedValue("v1");
  });

  afterEach(() => {
    unmountComponent();
  });

  const openFile = async () => {
    await render(<ExcalidrawApp />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remote files" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: filename }));
    await waitFor(() => expect(mocks.openRemoteFile).toHaveBeenCalledTimes(1));
    await screen.findByText(`Opened ${filename}`);
  };

  it.each([filename, "Refresh"])(
    "reloads the active canvas through %s",
    async (button) => {
      await openFile();
      mocks.openRemoteFile.mockResolvedValue("v2");
      const listCalls = mocks.listRemoteFiles.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: button }));
      await waitFor(() =>
        expect(mocks.openRemoteFile).toHaveBeenCalledTimes(2),
      );
      if (button === "Refresh") {
        expect(mocks.listRemoteFiles).toHaveBeenCalledTimes(listCalls + 1);
      }
    },
  );

  it.each([filename, "Refresh"])(
    "protects unsaved edits when reloading through %s",
    async (button) => {
      await openFile();
      await act(async () => {
        API.updateScene({
          elements: [API.createElement({ type: "rectangle" })],
        });
      });
      fireEvent.click(screen.getByRole("button", { name: button }));
      await screen.findByRole("heading", { name: "Unsaved changes" });
      expect(mocks.openRemoteFile).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      await waitFor(() =>
        expect(mocks.openRemoteFile).toHaveBeenCalledTimes(2),
      );
    },
  );
});
