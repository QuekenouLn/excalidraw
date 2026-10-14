import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  getRemoteSceneSignature,
  restoreRemoteFileSession,
  saveRemoteFileSession,
} from "../data/remoteFileSession";

describe("remote file session", () => {
  beforeEach(() => sessionStorage.clear());

  it("rejects an association when another tab replaced the local drawing", () => {
    const scene = { elements: [API.createElement({ type: "rectangle" })] };
    const signature = getRemoteSceneSignature(scene);
    saveRemoteFileSession({
      name: "drawing.excalidraw",
      revision: "v1",
      sceneSignature: signature,
      savedSignature: signature,
    });
    expect(restoreRemoteFileSession(scene)?.revision).toBe("v1");
    expect(restoreRemoteFileSession({ elements: [] })).toBeNull();
  });

  it("ignores deleted elements omitted by local persistence", () => {
    const rectangle = API.createElement({ type: "rectangle" });
    const deleted = API.createElement({ type: "ellipse", isDeleted: true });
    expect(getRemoteSceneSignature({ elements: [rectangle, deleted] })).toBe(
      getRemoteSceneSignature({ elements: [rectangle] }),
    );
  });

  it("can clear an association and tolerates malformed session data", () => {
    sessionStorage.setItem("excalidraw-remote-file-session", "broken json");
    expect(restoreRemoteFileSession({})).toBeNull();
    saveRemoteFileSession(null);
    expect(sessionStorage.getItem("excalidraw-remote-file-session")).toBeNull();
  });
});
