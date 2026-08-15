import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

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

type RemoteFileHistoryResponseEntry = {
  revision: string;
  size: number;
  archivedAt: string;
};

export class RemoteFileRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RemoteFileRequestError";
  }
}

const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}`;

const assertOk = async (response: Response) => {
  if (!response.ok) {
    throw new RemoteFileRequestError(
      (await response.text()) || `Request failed: ${response.status}`,
      response.status,
    );
  }
};

const prepareRemoteFile = async (response: Response) => {
  const blob = await response.blob();
  const document = JSON.parse(await blob.text());

  if (document.source !== "excalidraw-mcp") {
    return blob;
  }

  document.elements = convertToExcalidrawElements(
    document.elements.filter(
      (element: { type: string }) =>
        !["cameraUpdate", "delete", "restoreCheckpoint"].includes(element.type),
    ),
    { regenerateIds: false },
  );

  return new Blob([JSON.stringify(document)], { type: "application/json" });
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

  if (scene.files) {
    excalidrawAPI.addFiles(Object.values(scene.files));
  }
  excalidrawAPI.updateScene({
    elements: scene.elements,
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
