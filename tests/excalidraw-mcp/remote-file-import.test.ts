import { describe, expect, it } from "vitest";

import { getDefaultAppState } from "../../packages/excalidraw/appState";
import { loadFromBlob } from "../../packages/excalidraw/data/blob";

describe("MCP remote file import", () => {
  it("calculates a finite viewport from restored elements", async () => {
    const blob = new Blob([
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "excalidraw-mcp-native",
        elements: [{
          id: "title",
          type: "text",
          x: 100,
          y: 80,
          text: "Architecture",
          fontSize: 24,
          version: 2,
          versionNonce: 3,
        }],
        appState: {},
        files: {},
      }),
    ], { type: "application/json" });

    const scene = await loadFromBlob(blob, getDefaultAppState(), null);

    expect(Number.isFinite(scene.appState.scrollX)).toBe(true);
    expect(Number.isFinite(scene.appState.scrollY)).toBe(true);
  });
});
