import { Excalidraw } from "../index";
import {
  createMarkdownFrameHtml,
  DEFAULT_MARKDOWN,
  isMarkdownFrameElement,
  MARKDOWN_FRAME_TOOL,
  renderMarkdown,
} from "../markdownFrame";

import { Pointer } from "./helpers/ui";
import { fireEvent, render } from "./test-utils";

describe("Markdown Frame", () => {
  it("renders a safe Markdown subset", () => {
    const html = createMarkdownFrameHtml(
      "# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("--aurora-bg: #23262e");
    expect(html).toContain("padding: 12px");
    expect(html).toContain(".markdown-frame > :first-child { margin-top: 0; }");
    expect(html).not.toContain("markdown-zoom");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<p><script>");
    expect(html).toContain('href="#"');
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
  });
});
