import { getNonDeletedElements } from "@excalidraw/element";
import { exportToSvg } from "@excalidraw/utils/export";

import type { RemoteFileDocument } from "./remoteFiles";

const sanitizeStaticSvg = (svg: SVGSVGElement) => {
  svg
    .querySelectorAll("script, foreignObject, iframe, object, embed")
    .forEach((node) => node.remove());
  svg.querySelectorAll("a").forEach((anchor) => {
    anchor.replaceWith(...Array.from(anchor.childNodes));
  });

  [svg, ...Array.from(svg.querySelectorAll("*"))].forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
      if (
        ["href", "xlink:href"].includes(attribute.name) &&
        !attribute.value.startsWith("#") &&
        !attribute.value.startsWith("data:image/")
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return svg;
};

export const renderRemoteFilePreviewSvg = async (
  document: RemoteFileDocument,
) => {
  const svg = await exportToSvg({
    elements: getNonDeletedElements(document.elements),
    appState: {
      ...document.appState,
      exportEmbedScene: false,
    },
    files: document.files,
    renderEmbeddables: false,
    skipInliningFonts: true,
  });

  return sanitizeStaticSvg(svg);
};
