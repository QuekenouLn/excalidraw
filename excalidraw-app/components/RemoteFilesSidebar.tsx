import { useCallback, useEffect, useState } from "react";

import ConfirmDialog from "@excalidraw/excalidraw/components/ConfirmDialog";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";

import {
  deleteRemoteFile,
  listRemoteFiles,
  type RemoteFile,
} from "../data/remoteFiles";

export const filterRemoteFiles = (files: RemoteFile[], query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? files.filter((file) =>
        file.name.toLocaleLowerCase().includes(normalizedQuery),
      )
    : files;
};

export const copyRemoteFilename = (name: string) =>
  copyTextToSystemClipboard(name);

export const RemoteFilesSidebar = ({
  activeFile,
  isDirty,
  onDelete,
  onOpen,
  revision,
}: {
  activeFile: string | null;
  isDirty: boolean;
  onDelete: (name: string) => void;
  onOpen: (name: string) => void;
  revision: number;
}) => {
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<RemoteFile | null>(null);

  const visibleFiles = filterRemoteFiles(files, query);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setFiles(await listRemoteFiles());
      setError("");
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, revision]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }
    try {
      await deleteRemoteFile(pendingDelete.name, pendingDelete.revision);
      setFiles((files) =>
        files.filter((file) => file.name !== pendingDelete.name),
      );
      onDelete(pendingDelete.name);
      setError("");
      setPendingDelete(null);
    } catch (error: any) {
      setError(error.message);
      setPendingDelete(null);
    }
  }, [onDelete, pendingDelete]);

  const copyFilename = useCallback(async (name: string) => {
    try {
      await copyRemoteFilename(name);
      setError("");
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  return (
    <div className="remote-files-sidebar">
      <div className="remote-files-sidebar__header">
        <div>
          <strong>Remote files</strong>
          {activeFile && (
            <div className="remote-files-sidebar__active">
              {activeFile}
              {isDirty ? " · Unsaved" : ""}
            </div>
          )}
        </div>
        <button onClick={refresh}>Refresh</button>
      </div>
      {files.length > 0 && (
        <TextField
          className="remote-files-search"
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="Search remote files"
          fullWidth
        />
      )}
      {loading && <p className="remote-files-status">Loading…</p>}
      {error && <p className="remote-files-error">{error}</p>}
      {!loading && !error && files.length === 0 && (
        <p className="remote-files-status">No remote files yet.</p>
      )}
      {!loading && !error && files.length > 0 && visibleFiles.length === 0 && (
        <p className="remote-files-status">
          No remote files match “{query.trim()}”.
        </p>
      )}
      <div className="remote-files-list">
        {visibleFiles.map((file) => (
          <div
            className={`remote-files-item${
              file.name === activeFile ? " remote-files-item--active" : ""
            }`}
            key={file.name}
          >
            <button
              className="remote-files-name"
              onClick={() => onOpen(file.name)}
            >
              {file.name}
            </button>
            <span>{new Date(file.updatedAt).toLocaleString()}</span>
            <button
              type="button"
              aria-label={`Copy filename ${file.name}`}
              title="Copy filename"
              onClick={() => copyFilename(file.name)}
            >
              Copy
            </button>
            <button
              type="button"
              className="remote-files-delete"
              onClick={() => setPendingDelete(file)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete remote file?"
          confirmText="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        >
          This will permanently delete “{pendingDelete.name}”. This action
          cannot be undone.
        </ConfirmDialog>
      )}
    </div>
  );
};
