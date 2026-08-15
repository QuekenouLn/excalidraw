import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

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

const fileRevisionUrl = (name: string, revision: string) =>
  `${fileUrl(name)}/history/${encodeURIComponent(revision)}`;

const assertOk = async (response: Response) => {
  if (!response.ok) {
    throw new RemoteFileRequestError(
      (await response.text()) || `Request failed: ${response.status}`,
      response.status,
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
