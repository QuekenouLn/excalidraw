import { describe, expect, it } from "vitest";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { Scene } from "../../packages/element/src/Scene";
import { dragSelectedElements } from "../../packages/element/src/dragElements";
import { restoreElements } from "../../packages/excalidraw/data/restore";
import { convertElementsForStorage } from "../../integrations/excalidraw-mcp/src/server-element-conversion";

const skeleton = [
  { type: "rectangle", id: "source", x: 0, y: 0, width: 200, height: 80 },
  { type: "rectangle", id: "target", x: 400, y: 0, width: 200, height: 80 },
  {
    type: "arrow",
    id: "connection",
    x: 200,
    y: 40,
    width: 200,
    height: 0,
    points: [[0, 0], [200, 0]],
    startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
    endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
  },
];

const dragSource = (elements: any[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  const source = scene.getElement("source")! as any;
  const arrowBefore = scene.getElement("connection")! as any;
  const before = {
    x: arrowBefore.x,
    points: JSON.parse(JSON.stringify(arrowBefore.points)),
  };

  dragSelectedElements(
    { originalElements: new Map([[source.id, { ...source }]]) } as any,
    [source],
    { x: 100, y: 0 },
    scene,
    { x: 0, y: 0 },
    null,
  );

  const arrowAfter = scene.getElement("connection")! as any;
  return {
    before,
    after: {
      x: arrowAfter.x,
      points: JSON.parse(JSON.stringify(arrowAfter.points)),
    },
  };
};

describe("MCP remote file round trip", () => {
  it("keeps native bindings interactive when conversion is bypassed", () => {
    const native = restoreElements(
      convertElementsForStorage(skeleton as any[]),
      null,
      { repairBindings: true },
    );
    const result = dragSource(native as any[]);
    expect(result.after).not.toEqual(result.before);
  });

  it("reproduces legacy reconversion clearing arrow bindings", () => {
    const native = convertElementsForStorage(skeleton as any[]);
    const reconverted = convertToExcalidrawElements(native as any, {
      regenerateIds: false,
    });
    const source = reconverted.find((element) => element.id === "source")!;
    const arrow = reconverted.find((element) => element.id === "connection")!;
    const result = dragSource(reconverted as any[]);

    expect(source.boundElements).toEqual(
      expect.arrayContaining([{ id: "connection", type: "arrow" }]),
    );
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
    expect(result.after).toEqual(result.before);
  });
});
