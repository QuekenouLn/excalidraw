import type { ExcalidrawElement } from "@excalidraw/element/types";

const SESSION_KEY = "excalidraw-remote-file-session";

type Scene = {
  elements?: readonly ExcalidrawElement[] | null;
  appState?: { viewBackgroundColor?: string } | null;
};

export const getRemoteSceneSignature = (scene: Scene) =>
  JSON.stringify({
    elements: (scene.elements ?? [])
      .filter((element) => !element.isDeleted)
      .map(({ id, version, versionNonce }) => ({ id, version, versionNonce })),
    viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
  });

type RemoteFileSession = {
  name: string;
  revision: string | null;
  sceneSignature: string;
  savedSignature: string;
};

export const saveRemoteFileSession = (session: RemoteFileSession | null) => {
  try {
    if (session) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Storage restrictions must not prevent saving the local drawing.
  }
};

export const restoreRemoteFileSession = (scene: Scene) => {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    if (
      session &&
      typeof session.name === "string" &&
      session.name.endsWith(".excalidraw") &&
      (session.revision === null || typeof session.revision === "string") &&
      typeof session.savedSignature === "string" &&
      session.sceneSignature === getRemoteSceneSignature(scene)
    ) {
      return session as RemoteFileSession;
    }
  } catch {
    // Ignore unavailable storage or malformed session data.
  }
  return null;
};
