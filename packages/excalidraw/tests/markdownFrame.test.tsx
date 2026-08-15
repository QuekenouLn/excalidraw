import { Excalidraw } from "../index";
import {
  createMarkdownFrameHtml,
  DEFAULT_MARKDOWN,
  getMarkdownFrameData,
  getMarkdownFrameHtml,
  isMarkdownFrameElement,
  MARKDOWN_FRAME_TOOL,
  normalizeMarkdownFrameScale,
  renderMarkdown,
} from "../markdownFrame";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { fireEvent, render, waitFor } from "./test-utils";

describe("Markdown Frame", () => {
  const createMarkdownFrame = () => {
    fireEvent.click(
      document.querySelector(".App-toolbar__extra-tools-trigger")!,
    );
    fireEvent.click(
      document.querySelector('[data-testid="toolbar-markdown-frame"]')!,
    );
    const pointer = new Pointer("mouse");
    pointer.downAt(100, 100);
    pointer.move(320, 220);
    pointer.up();
    return window.h.elements.find(
      (candidate) => candidate.type === "iframe",
    ) as any;
  };

  it("renders a safe Markdown subset", () => {
    const html = createMarkdownFrameHtml(
      "# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("--aurora-bg: #23262e");
    expect(html).toContain("padding: 12px");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(".markdown-frame > :first-child { margin-top: 0; }");
    expect(html).not.toContain("markdown-zoom");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<p><script>");
    expect(html).toContain('href="#"');
  });

  it("normalizes imported Markdown Frame data", () => {
    expect(normalizeMarkdownFrameScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeMarkdownFrameScale(0.1)).toBe(0.5);
    expect(normalizeMarkdownFrameScale(3)).toBe(2);
    expect(
      getMarkdownFrameData({
        type: "iframe",
        customData: {
          markdownFrame: {
            markdown: "# Safe",
            contentScale: 3,
            theme: "aurora",
            version: 1,
          },
        },
      }),
    ).toMatchObject({ markdown: "# Safe", contentScale: 2 });
    expect(
      isMarkdownFrameElement({
        type: "iframe",
        customData: { markdownFrame: { markdown: 42 } },
      }),
    ).toBe(false);
  });

  it("renders lists and fenced code", () => {
    const html = renderMarkdown("- One\n- Two\n\n```js\nconst x = 1;\n```");

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<pre><code>const x = 1;</code></pre>");
  });

  it("places Markdown Frame immediately after Frame Tool", async () => {
    const { container } = await render(<Excalidraw />);
    fireEvent.click(
      container.querySelector(".App-toolbar__extra-tools-trigger")!,
    );
    const frame = document.querySelector('[data-testid="toolbar-frame"]')!;
    const markdown = document.querySelector(
      '[data-testid="toolbar-markdown-frame"]',
    )!;

    expect(frame.nextElementSibling).toBe(markdown);
  });

  it("creates a persistent iframe by dragging", async () => {
    const { container } = await render(<Excalidraw />);
    fireEvent.click(
      container.querySelector(".App-toolbar__extra-tools-trigger")!,
    );
    fireEvent.click(
      document.querySelector('[data-testid="toolbar-markdown-frame"]')!,
    );
    expect(window.h.state.activeTool).toMatchObject({
      type: "custom",
      customType: MARKDOWN_FRAME_TOOL,
    });

    const pointer = new Pointer("mouse");
    pointer.downAt(100, 100);
    pointer.move(320, 220);
    pointer.up();

    const element = window.h.elements.find(
      (candidate) => candidate.type === "iframe",
    ) as any;
    expect(element).toBeDefined();
    expect(element.customData.markdownFrame).toEqual({
      markdown: DEFAULT_MARKDOWN,
      contentScale: 1,
      theme: "aurora",
      version: 1,
    });
    expect(element.customData.generationData.html).toContain(
      "<h1>Markdown Frame</h1>",
    );
    expect(isMarkdownFrameElement(element)).toBe(true);
    expect(element.roundness).toBeNull();
    expect(element.width).toBe(320);
    expect(element.height).toBe(220);
    expect(document.querySelector('[title="Zoom out content"]')).not.toBeNull();
    expect(document.querySelector('[title="Zoom in content"]')).not.toBeNull();

    fireEvent.click(document.querySelector('[title="Zoom out content"]')!);
    const scaledElement = window.h.elements.find(
      (candidate) => candidate.id === element.id,
    ) as any;
    expect(scaledElement.customData.markdownFrame.contentScale).toBe(0.9);
    expect(scaledElement.customData.generationData.html).toContain(
      "--markdown-scale:0.9",
    );

    const undoCount = API.getUndoStack().length;
    fireEvent.click(document.querySelector('[title="Edit Markdown"]')!);
    const textarea = document.querySelector(
      'textarea[aria-label="Markdown"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_MARKDOWN);

    fireEvent.change(textarea, { target: { value: "# Edited locally" } });
    expect(
      (API.getElement(element) as any).customData.markdownFrame.markdown,
    ).toBe(DEFAULT_MARKDOWN);
    expect(API.getUndoStack()).toHaveLength(undoCount);

    fireEvent.click(document.querySelector('button[aria-label="Save"]')!);
    const editedElement = API.getElement(element) as any;
    expect(editedElement.customData.markdownFrame.markdown).toBe(
      "# Edited locally",
    );
    expect(editedElement.customData.generationData.html).toContain(
      "<h1>Edited locally</h1>",
    );
    expect(API.getUndoStack()).toHaveLength(undoCount + 1);
  });

  it("cancels a local draft without changing the scene", async () => {
    await render(<Excalidraw />);
    const element = createMarkdownFrame();

    fireEvent.click(document.querySelector('[title="Edit Markdown"]')!);
    fireEvent.change(
      document.querySelector('textarea[aria-label="Markdown"]')!,
      { target: { value: "# Discarded" } },
    );
    fireEvent.click(document.querySelector('button[aria-label="Cancel"]')!);

    expect(
      (API.getElement(element) as any).customData.markdownFrame.markdown,
    ).toBe(DEFAULT_MARKDOWN);
    await waitFor(() =>
      expect(
        document.querySelector('textarea[aria-label="Markdown"]'),
      ).toBeNull(),
    );
  });

  it("rejects a stale editor save", async () => {
    await render(<Excalidraw />);
    const element = createMarkdownFrame();
    const current = API.getElement(element);
    const baseVersion = current.version;
    const baseVersionNonce = current.versionNonce;

    API.updateElement(current, {
      customData: {
        ...(current as any).customData,
        generationData: {
          status: "done",
          html: createMarkdownFrameHtml("# Remote"),
        },
        markdownFrame: {
          ...(current as any).customData.markdownFrame,
          markdown: "# Remote",
        },
      },
    });

    expect(
      window.h.app.saveMarkdownFrame(
        element.id,
        baseVersion,
        baseVersionNonce,
        "# Local",
      ),
    ).toBe("conflict");
    expect(
      (API.getElement(element) as any).customData.markdownFrame.markdown,
    ).toBe("# Remote");
  });

  it("renders from Markdown instead of an imported HTML cache", () => {
    const html = getMarkdownFrameHtml({
      type: "iframe",
      customData: {
        generationData: {
          status: "done",
          html: '<script data-untrusted="true">alert(1)</script>',
        },
        markdownFrame: {
          markdown: "# Trusted source",
          contentScale: 1,
          theme: "aurora",
          version: 1,
        },
      },
    });
    expect(html).toContain("<h1>Trusted source</h1>");
    expect(html).not.toContain("data-untrusted");
  });
});
