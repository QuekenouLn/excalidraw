import {
  convertToExcalidrawElements,
  Fonts,
  restoreElements,
} from "@excalidraw/excalidraw";
import { arrayToMap } from "@excalidraw/common";
import {
  distanceToElement,
  isArrowElement,
  isTextElement,
  LinearElementEditor,
  Scene,
  updateBoundElements,
} from "@excalidraw/element";

import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { renderRemoteFilePreviewSvg } from "./remoteFilePreview";

export type RemoteFileDocument = Awaited<ReturnType<typeof loadFromBlob>>;

export type RemoteFile = {
  name: string;
  size: number;
  updatedAt: string;
  revision: string;
};

export type RemoteFileHistoryEntry = {
  revision: string;
  size: number;
  updatedAt: string;
  current: boolean;
};

export const isValidRemoteFileName = (name: string) =>
  name.length >= 12 &&
  name.length <= 128 &&
  /^[\p{L}\p{N}][\p{L}\p{N} ._-]*\.excalidraw$/u.test(name);

export const getRenamedRemoteFileState = (
  activeName: string | null,
  activeRevision: string | null,
  dirty: boolean,
  oldName: string,
  renamed: RemoteFile,
) =>
  activeName === oldName
    ? { activeName: renamed.name, activeRevision: renamed.revision, dirty }
    : { activeName, activeRevision, dirty };

type RemoteFileHistoryResponseEntry = {
  revision: string;
  size: number;
  archivedAt: string;
};

export class RemoteFileRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly revision: string | null = null,
  ) {
    super(message);
    this.name = "RemoteFileRequestError";
  }
}

const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}`;

const fileRevisionUrl = (name: string, revision: string) =>
  `${fileUrl(name)}/history/${encodeURIComponent(revision)}`;

const assertOk = async (response: Response) => {
  if (!response.ok) {
    throw new RemoteFileRequestError(
      (await response.text()) || `Request failed: ${response.status}`,
      response.status,
      response.headers.get("ETag")?.replaceAll('"', "") || null,
    );
  }
};

const assertExpectedRevision = (
  response: Response,
  expectedRevision: string | null,
) => {
  const responseRevision = response.headers.get("ETag")?.replaceAll('"', "");
  if (
    expectedRevision &&
    responseRevision &&
    responseRevision !== expectedRevision
  ) {
    throw new Error("File changed since history was opened");
  }
};

const prepareRemoteFile = async (response: Response) => {
  const contents = await response.text();
  const document = JSON.parse(contents);
  const blob = new Blob([contents], {
    type: response.headers.get("Content-Type") || "application/json",
  });

  if (
    typeof document.source !== "string" ||
    !document.source.startsWith("excalidraw-mcp") ||
    !Array.isArray(document.elements)
  ) {
    return blob;
  }

  const elements = document.elements.filter(
    (element: { type: string }) =>
      !["cameraUpdate", "delete", "restoreCheckpoint"].includes(element.type),
  );
  const isCompleteNativeScene = elements.every(
    (element: { version?: unknown; versionNonce?: unknown }) =>
      Number.isInteger(element.version) &&
      Number.isInteger(element.versionNonce),
  );

  document.elements = isCompleteNativeScene
    ? elements
    : convertToExcalidrawElements(elements, { regenerateIds: false });

  return new Blob([JSON.stringify(document)], { type: "application/json" });
};

const areBoundElementsEqual = (
  first: readonly { id: string; type: string }[] | null | undefined,
  second: readonly { id: string; type: string }[] | null | undefined,
) =>
  (first?.length ?? 0) === (second?.length ?? 0) &&
  (first ?? []).every(
    (boundElement, index) =>
      boundElement.id === second?.[index]?.id &&
      boundElement.type === second[index].type,
  );

const refreshRemoteSceneElements = async (
  elements: RemoteFileDocument["elements"],
) => {
  await Fonts.loadElementsFonts(elements);

  const refreshedElements = restoreElements(elements, null, {
    repairBindings: true,
    refreshDimensions: true,
  });
  const refreshedScene = new Scene(refreshedElements);

  for (const element of refreshedScene.getNonDeletedElements()) {
    if (
      element.boundElements?.some(
        (boundElement) => boundElement.type === "arrow",
      )
    ) {
      updateBoundElements(element, refreshedScene);
    }
  }

  const refreshedElementsMap = refreshedScene.getElementsMapIncludingDeleted();
  const originalElementsMap = arrayToMap(
    elements.filter((element) => !element.isDeleted),
  );

  return elements.map((element) => {
    const refreshedElement = refreshedElementsMap.get(element.id);

    if (!refreshedElement) {
      return element;
    }

    const boundElements = refreshedElement.boundElements;

    if (isTextElement(element) && isTextElement(refreshedElement)) {
      const isLayoutStale =
        element.containerId &&
        (Math.abs(
          element.x +
            element.width / 2 -
            (refreshedElement.x + refreshedElement.width / 2),
        ) > 1 ||
          Math.abs(
            element.y +
              element.height / 2 -
              (refreshedElement.y + refreshedElement.height / 2),
          ) > 1);

      if (!isLayoutStale) {
        return areBoundElementsEqual(element.boundElements, boundElements)
          ? element
          : { ...element, boundElements };
      }

      return {
        ...element,
        x: refreshedElement.x,
        y: refreshedElement.y,
        width: refreshedElement.width,
        height: refreshedElement.height,
        text: refreshedElement.text,
        boundElements,
      };
    }

    if (isArrowElement(element) && isArrowElement(refreshedElement)) {
      const hasDetachedBinding = (
        binding: typeof element.startBinding,
        pointIndex: number,
      ) => {
        if (!binding) {
          return false;
        }

        const boundElement = originalElementsMap.get(binding.elementId);

        return (
          !boundElement ||
          distanceToElement(
            boundElement,
            originalElementsMap,
            LinearElementEditor.getPointAtIndexGlobalCoordinates(
              element,
              pointIndex,
              originalElementsMap,
            ),
          ) > 1
        );
      };

      if (
        !hasDetachedBinding(element.startBinding, 0) &&
        !hasDetachedBinding(element.endBinding, -1)
      ) {
        return areBoundElementsEqual(element.boundElements, boundElements)
          ? element
          : { ...element, boundElements };
      }

      return {
        ...element,
        x: refreshedElement.x,
        y: refreshedElement.y,
        width: refreshedElement.width,
        height: refreshedElement.height,
        points: refreshedElement.points,
        startBinding: refreshedElement.startBinding,
        endBinding: refreshedElement.endBinding,
        boundElements,
      };
    }

    return areBoundElementsEqual(element.boundElements, boundElements)
      ? element
      : { ...element, boundElements };
  });
};

export const listRemoteFiles = async (): Promise<RemoteFile[]> => {
  const response = await fetch("/api/files");
  await assertOk(response);
  return response.json();
};

export const listRemoteFileHistory = async (
  name: string,
): Promise<RemoteFileHistoryEntry[]> => {
  const response = await fetch(`${fileUrl(name)}/history`);
  await assertOk(response);
  const history = (await response.json()) as RemoteFileHistoryResponseEntry[];
  return history.map(({ revision, size, archivedAt }) => ({
    revision,
    size,
    updatedAt: archivedAt,
    current: false,
  }));
};

export const fetchRemoteFileRevisionBlob = async (
  name: string,
  revision: string,
) => {
  const response = await fetch(fileRevisionUrl(name, revision));
  await assertOk(response);
  assertExpectedRevision(response, revision);
  return prepareRemoteFile(response);
};

export const loadRemoteFileRevision = async (
  name: string,
  revision: string | null,
  expectedRevision: string | null = revision,
): Promise<RemoteFileDocument> =>
  loadFromBlob(
    revision
      ? await fetchRemoteFileRevisionBlob(name, revision)
      : await fetchRemoteFileBlob(name, expectedRevision),
    null,
    null,
  );

const fetchRemoteFileBlob = async (
  name: string,
  expectedRevision: string | null = null,
) => {
  const response = await fetch(fileUrl(name));
  await assertOk(response);
  assertExpectedRevision(response, expectedRevision);
  return prepareRemoteFile(response);
};

export const loadRemoteFilePreview = async (
  name: string,
  revision: string | null,
  expectedRevision: string = revision || "",
) => {
  const document = await loadRemoteFileRevision(
    name,
    revision,
    expectedRevision,
  );
  return document.elements.some((element) => !element.isDeleted)
    ? renderRemoteFilePreviewSvg(document)
    : null;
};

export const openRemoteFile = async (
  name: string,
  excalidrawAPI: ExcalidrawImperativeAPI,
) => {
  const response = await fetch(fileUrl(name));
  await assertOk(response);
  const revision = response.headers.get("ETag")?.replaceAll('"', "") || "";
  const scene = await loadFromBlob(
    await prepareRemoteFile(response),
    excalidrawAPI.getAppState(),
    excalidrawAPI.getSceneElements(),
  );
  const elements = await refreshRemoteSceneElements(scene.elements);

  if (scene.files) {
    excalidrawAPI.addFiles(Object.values(scene.files));
  }
  excalidrawAPI.updateScene({
    elements,
    appState: { ...scene.appState, fileHandle: null },
  });
  excalidrawAPI.history.clear();
  return revision;
};

export const saveRemoteFile = async (
  name: string,
  excalidrawAPI: ExcalidrawImperativeAPI,
  expectedRevision: string | null,
) => {
  const body = serializeAsJSON(
    excalidrawAPI.getSceneElements(),
    excalidrawAPI.getAppState(),
    excalidrawAPI.getFiles(),
    "local",
  );
  const response = await fetch(fileUrl(name), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": expectedRevision || "*",
    },
    body,
  });
  await assertOk(response);
  return (await response.json()) as { revision: string };
};

export const renameRemoteFile = async (
  name: string,
  newName: string,
  expectedRevision: string,
): Promise<RemoteFile> => {
  const response = await fetch(fileUrl(name), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match": expectedRevision,
    },
    body: JSON.stringify({ name: newName }),
  });
  await assertOk(response);
  return response.json();
};

export const restoreRemoteFileRevision = async (
  name: string,
  revision: string,
  currentRevision: string,
) => {
  const response = await fetch(
    `${fileUrl(name)}/history/${encodeURIComponent(revision)}/restore`,
    {
      method: "POST",
      headers: { "If-Match": currentRevision },
    },
  );
  await assertOk(response);
  return (await response.json()) as { revision: string };
};

export const deleteRemoteFile = async (name: string, revision: string) => {
  const response = await fetch(fileUrl(name), {
    method: "DELETE",
    headers: { "If-Match": revision },
  });
  await assertOk(response);
};
