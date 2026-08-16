import { queryByTestId } from "@testing-library/react";
import React from "react";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Pointer, UI } from "../tests/helpers/ui";
import { render } from "../tests/test-utils";

const mouse = new Pointer("mouse");

describe("export copy context menu actions", () => {
  it("shows explicit PNG and SVG export copy actions", async () => {
    await render(
      <Excalidraw
        initialData={{
          elements: [API.createElement({ type: "rectangle" })],
        }}
      />,
    );

    mouse.rightClickAt(0, 0);

    const contextMenu = UI.queryContextMenu()!;
    expect(queryByTestId(contextMenu, "copyAsPng")).toHaveTextContent(
      "Copy exported PNG",
    );
    expect(queryByTestId(contextMenu, "copyAsSvg")).toHaveTextContent(
      "Copy exported SVG",
    );
  });
});
