import { describe, expect, it } from "vitest";
import { convertElementsForStorage } from "../../integrations/excalidraw-mcp/src/server-element-conversion";

describe("convertElementsForStorage", () => {
  it("creates native labels and two-way arrow bindings", () => {
    const elements = convertElementsForStorage([
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
        points: [[0, 0], [200, 0]],
        startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
        endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
      },
    ]);

    const source = elements.find((element) => element.id === "source")!;
    const target = elements.find((element) => element.id === "target")!;
    const arrow = elements.find((element) => element.id === "connection")!;
    const sourceLabel = elements.find(
      (element) => element.containerId === "source",
    )!;
    const targetLabel = elements.find(
      (element) => element.containerId === "target",
    )!;

    expect(arrow.startBinding).toEqual({
      elementId: "source",
      mode: "orbit",
      fixedPoint: [1, 0.5001],
    });
    expect(arrow.endBinding).toEqual({
      elementId: "target",
      mode: "orbit",
      fixedPoint: [0, 0.5001],
    });
    expect(arrow).toMatchObject({
      x: 200.5,
      y: 40,
      points: [[0, 0], [199, 0]],
      roundness: { type: 2 },
      moveMidPointsWithElement: false,
    });
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
      type: "text",
      textAlign: "center",
      verticalAlign: "middle",
      version: 1,
    });
  });

  it("preserves explicit sharp arrows", () => {
    const [arrow] = convertElementsForStorage([
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

  it("measures CJK labels at full-width and keeps them centered", () => {
    const elements = convertElementsForStorage([
      {
        type: "rectangle",
        id: "card",
        x: 100,
        y: 100,
        width: 220,
        height: 80,
        label: { text: "企业级 AI 平台", fontSize: 20 },
      },
    ]);
    const text = elements.find((element) => element.containerId === "card")!;

    expect(text.width).toBeCloseTo(136.4, 1);
    expect(text.x + text.width / 2).toBeCloseTo(210, 5);
  });

  it("wraps long mixed labels within the container", () => {
    const elements = convertElementsForStorage([
      {
        type: "rectangle",
        id: "card",
        x: 0,
        y: 0,
        width: 180,
        height: 80,
        label: {
          text: "MCP Tool Gateway 搜索数据库业务系统",
          fontSize: 18,
        },
      },
    ]);
    const text = elements.find((element) => element.containerId === "card")!;

    expect(text.text).toContain("\n");
    expect(text.width).toBeLessThanOrEqual(170);
    expect(text.originalText).toBe("MCP Tool Gateway 搜索数据库业务系统");
  });

  it("keeps a complete native scene unchanged", () => {
    const native = [{
      id: "shape",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      version: 2,
      versionNonce: 3,
    }];
    expect(convertElementsForStorage(native)).toBe(native);
  });

  it("normalizes incomplete native text elements", () => {
    const [text] = convertElementsForStorage([{
      id: "title",
      type: "text",
      x: 20,
      y: 30,
      text: "MCP 架构",
      fontSize: 24,
      version: 2,
      versionNonce: 3,
    }]);

    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
    expect(text.fontFamily).toBe(11);
    expect(text.lineHeight).toBe(1.2);
    expect(text.textAlign).toBe("center");
  });

  it("forces explicit text and label alignment to center", () => {
    const elements = convertElementsForStorage([
      {
        id: "title",
        type: "text",
        x: 0,
        y: 0,
        text: "Title",
        fontSize: 20,
        textAlign: "right",
        verticalAlign: "bottom",
      },
      {
        id: "card",
        type: "rectangle",
        x: 0,
        y: 60,
        width: 160,
        height: 80,
        label: {
          text: "Card",
          textAlign: "left",
          verticalAlign: "top",
        },
      },
    ]);
    const title = elements.find((element) => element.id === "title")!;
    const label = elements.find((element) => element.containerId === "card")!;

    expect(title).toMatchObject({
      textAlign: "center",
      verticalAlign: "bottom",
    });
    expect(label).toMatchObject({
      textAlign: "center",
      verticalAlign: "top",
    });
  });

  it("applies Maple, thin, and soft defaults", () => {
    const elements = convertElementsForStorage([
      {
        id: "rect",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 80,
        label: { text: "默认样式" },
      },
      {
        id: "diamond",
        type: "diamond",
        x: 220,
        y: 0,
        width: 120,
        height: 100,
      },
      {
        id: "arrow",
        type: "arrow",
        x: 160,
        y: 40,
        width: 60,
        height: 0,
      },
    ]);

    const rectangle = elements.find((element) => element.id === "rect")!;
    const diamond = elements.find((element) => element.id === "diamond")!;
    const arrow = elements.find((element) => element.id === "arrow")!;
    const label = elements.find((element) => element.containerId === "rect")!;

    expect(rectangle).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 3, value: 12 },
    });
    expect(diamond).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 2, value: 0.1 },
    });
    expect(arrow).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 2, value: 0.1 },
    });
    expect(label.fontFamily).toBe(11);
  });

  it("preserves explicit style overrides", () => {
    const elements = convertElementsForStorage([
      {
        id: "rect",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 80,
        strokeWidth: 4,
        roundness: null,
        label: { text: "Override", fontFamily: 5 },
      },
    ]);

    const rectangle = elements.find((element) => element.id === "rect")!;
    const label = elements.find((element) => element.containerId === "rect")!;
    expect(rectangle.strokeWidth).toBe(4);
    expect(rectangle.roundness).toBeNull();
    expect(label.fontFamily).toBe(5);
  });
});
