import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { renderRemoteFilePreviewSvg } from "../data/remoteFilePreview";

import type { RemoteFileDocument } from "../data/remoteFiles";

const exportMocks = vi.hoisted(() => ({
  exportToSvg: vi.fn(),
}));

vi.mock("@excalidraw/utils/export", () => exportMocks);

describe("Remote file preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders scene state and files as a safe static SVG", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("onload", "alert('unsafe')");
    svg.innerHTML = [
      '<a href="https://example.com"><rect onmouseover="alert(1)" /></a>',
      '<image href="https://example.com/tracker.png" />',
      '<use href="javascript:alert(1)" />',
      "<foreignObject><div>embed</div></foreignObject>",
      "<script>alert(1)</script>",
    ].join("");
    exportMocks.exportToSvg.mockResolvedValue(svg);

    const elements = convertToExcalidrawElements([
      {
        id: "rectangle",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    ]);
    const appState = {
      ...getDefaultAppState(),
      exportEmbedScene: true,
      viewBackgroundColor: "#abcdef",
    };
    const files = {};
    const scene = { elements, appState, files } as RemoteFileDocument;

    const result = await renderRemoteFilePreviewSvg(scene);

    expect(exportMocks.exportToSvg).toHaveBeenCalledWith({
      elements,
      appState: { ...appState, exportEmbedScene: false },
      files,
      renderEmbeddables: false,
      skipInliningFonts: true,
    });
    expect(result).toBe(svg);
    expect(result.querySelector("a")).toBeNull();
    expect(result.querySelector("foreignObject")).toBeNull();
    expect(result.querySelector("script")).toBeNull();
    expect(result.querySelector("image")?.hasAttribute("href")).toBe(false);
    expect(result.querySelector("use")?.hasAttribute("href")).toBe(false);
    expect(result.hasAttribute("onload")).toBe(false);
    expect(result.querySelector("rect")?.hasAttribute("onmouseover")).toBe(
      false,
    );
  });
});
