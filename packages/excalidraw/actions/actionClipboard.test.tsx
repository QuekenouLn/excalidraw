import { queryByTestId, queryByText } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Pointer, UI } from "../tests/helpers/ui";
import { render } from "../tests/test-utils";

vi.mock("../clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../clipboard")>()),
  probablySupportsClipboardBlob: true,
  probablySupportsClipboardWriteText: true,
}));

const mouse = new Pointer("mouse");
const originalIsSecureContext = window.isSecureContext;

const setIsSecureContext = (isSecureContext: boolean) => {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: isSecureContext,
  });
};

describe("clipboard export actions", () => {
  afterEach(() => {
    setIsSecureContext(originalIsSecureContext);
    mouse.reset();
  });

  it("shows clearly labeled export copy actions in a secure context", async () => {
    setIsSecureContext(true);
    await render(
      <Excalidraw
        initialData={{ elements: [API.createElement({ type: "rectangle" })] }}
      />,
    );

    mouse.rightClickAt(0, 0);

    const contextMenu = UI.queryContextMenu()!;
    expect(queryByText(contextMenu, "Copy exported PNG")).not.toBeNull();
    expect(queryByText(contextMenu, "Copy exported SVG")).not.toBeNull();
  });

  it("hides export copy actions in an insecure context", async () => {
    setIsSecureContext(false);
    await render(
      <Excalidraw
        initialData={{ elements: [API.createElement({ type: "rectangle" })] }}
      />,
    );

    mouse.rightClickAt(0, 0);

    const contextMenu = UI.queryContextMenu()!;
    expect(queryByTestId(contextMenu, "copyAsPng")).toBeNull();
    expect(queryByTestId(contextMenu, "copyAsSvg")).toBeNull();
  });
});
