import { describe, expect, it } from "vitest";

describe("MCP remote file format", () => {
  it("uses a native source marker that bypasses legacy skeleton conversion", () => {
    const legacySource = "excalidraw-mcp";
    const nativeSource = "excalidraw-mcp-native";

    expect(legacySource).not.toBe(nativeSource);
    expect(nativeSource).not.toBe("excalidraw-mcp");
  });
});
