import { describe, expect, it } from "vitest";
import { convertRawElements } from "../../integrations/excalidraw-mcp/src/element-conversion";

describe("convertRawElements", () => {
  it("preserves labels while creating native two-way arrow bindings", () => {
    const converted = convertRawElements([
      {
        type: "rectangle",
        id: "source",
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        label: { text: "Source" },
      },
      {
        type: "rectangle",
        id: "target",
        x: 400,
        y: 0,
        width: 200,
        height: 80,
        label: { text: "Target" },
      },
      {
        type: "arrow",
        id: "connection",
        x: 200,
        y: 40,
        width: 200,
        height: 0,
        points: [
          [0, 0],
          [200, 0],
        ],
        startBinding: {
          elementId: "source",
          fixedPoint: [1, 0.5],
        },
        endBinding: {
          elementId: "target",
          fixedPoint: [0, 0.5],
        },
      },
    ]);

    const source = converted.find((element) => element.id === "source")!;
    const target = converted.find((element) => element.id === "target")!;
    const arrow = converted.find((element) => element.id === "connection")!;
    const sourceLabel = converted.find(
      (element) => element.type === "text" && element.containerId === "source",
    )!;
    const targetLabel = converted.find(
      (element) => element.type === "text" && element.containerId === "target",
    )!;

    expect(arrow.startBinding).toMatchObject({ elementId: "source" });
    expect(arrow.endBinding).toMatchObject({ elementId: "target" });
    expect(arrow.roundness).toEqual({ type: 2, value: 0.1 });
    expect(source.boundElements).toEqual(
      expect.arrayContaining([
        { id: sourceLabel.id, type: "text" },
        { id: "connection", type: "arrow" },
      ]),
    );
    expect(target.boundElements).toEqual(
      expect.arrayContaining([
        { id: targetLabel.id, type: "text" },
        { id: "connection", type: "arrow" },
      ]),
    );
    expect(sourceLabel).toMatchObject({
      textAlign: "center",
      verticalAlign: "middle",
    });
    expect(targetLabel).toMatchObject({
      textAlign: "center",
      verticalAlign: "middle",
    });
  });

  it("preserves an explicit sharp arrow edge", () => {
    const [arrow] = convertRawElements([
      {
        type: "arrow",
        id: "sharp",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        roundness: null,
      },
    ]);

    expect(arrow.roundness).toBeNull();
  });

  it("does not reconvert a persisted native scene", () => {
    const nativeElements = [
      {
        type: "rectangle",
        id: "source",
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        version: 2,
        versionNonce: 10,
        boundElements: [{ id: "connection", type: "arrow" }],
      },
      {
        type: "arrow",
        id: "connection",
        x: 200,
        y: 40,
        width: 100,
        height: 0,
        version: 3,
        versionNonce: 11,
        startBinding: {
          elementId: "source",
          focus: 0,
          gap: 1,
          fixedPoint: [1, 0.5],
        },
        endBinding: null,
      },
    ];

    expect(convertRawElements(nativeElements)).toEqual(nativeElements);
  });
});
