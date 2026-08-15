import { useCallback, useEffect, useState } from "react";

import ConfirmDialog from "@excalidraw/excalidraw/components/ConfirmDialog";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";

import {
  deleteRemoteFile,
  listRemoteFileHistory,
  listRemoteFiles,
  restoreRemoteFileRevision,
  type RemoteFile,
  type RemoteFileHistoryEntry,
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

export const formatRemoteFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

type FileHistoryEntry = RemoteFileHistoryEntry & { current: boolean };

const currentHistoryEntry = (file: RemoteFile): FileHistoryEntry => ({
  revision: file.revision,
  size: file.size,
  updatedAt: file.updatedAt,
  current: true,
});

export const RemoteFilesSidebar = ({
  activeFile,
  isDirty,
  onDelete,
  onOpen,
  onRestore,
  revision,
}: {
  activeFile: string | null;
  isDirty: boolean;
  onDelete: (name: string) => void;
  onOpen: (name: string) => void;
  onRestore: (name: string, revision: string) => Promise<void>;
  revision: number;
}) => {
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<RemoteFile | null>(null);
  const [historyFile, setHistoryFile] = useState<RemoteFile | null>(null);
  const [historyEntries, setHistoryEntries] = useState<FileHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<FileHistoryEntry | null>(
    null,
  );
  const [restoringRevision, setRestoringRevision] = useState<string | null>(
    null,
  );

  const visibleFiles = filterRemoteFiles(files, query);

  const refresh = useCallback(async (): Promise<RemoteFile[]> => {
    try {
      setLoading(true);
      const nextFiles = await listRemoteFiles();
      setFiles(nextFiles);
      setError("");
      return nextFiles;
    } catch (error: any) {
      setError(error.message);
      return [];
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

  const loadHistory = useCallback(async (file: RemoteFile) => {
    try {
      setHistoryLoading(true);
      const entries = await listRemoteFileHistory(file.name);
      setHistoryEntries([
        currentHistoryEntry(file),
        ...entries.map((entry) => ({ ...entry, current: false })),
      ]);
      setHistoryError("");
    } catch (error: any) {
      setHistoryEntries([]);
      setHistoryError(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = useCallback(
    (file: RemoteFile) => {
      setHistoryFile(file);
      setHistoryEntries([]);
      setHistoryError("");
      loadHistory(file);
    },
    [loadHistory],
  );

  const confirmRestore = useCallback(async () => {
    if (!historyFile || !pendingRestore) {
      return;
    }

    const file = historyFile;
    const entry = pendingRestore;
    setPendingRestore(null);
    setRestoringRevision(entry.revision);
    setHistoryError("");

    try {
      const result = await restoreRemoteFileRevision(
        file.name,
        entry.revision,
        file.revision,
      );
      await onRestore(file.name, result.revision);

      const nextFiles = await refresh();
      const nextFile = nextFiles.find(({ name }) => name === file.name);
      if (nextFile) {
        setHistoryFile(nextFile);
        await loadHistory(nextFile);
      }
    } catch (error: any) {
      setHistoryError(error.message);
    } finally {
      setRestoringRevision(null);
    }
  }, [historyFile, loadHistory, onRestore, pendingRestore, refresh]);

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
            <button type="button" onClick={() => openHistory(file)}>
              History
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
      {historyFile && (
        <Dialog
          className="remote-file-history"
          size="small"
          title="File history"
          onCloseRequest={() => {
            setHistoryFile(null);
            setPendingRestore(null);
          }}
        >
          <div className="remote-file-history__filename">
            {historyFile.name}
          </div>
          {historyLoading && (
            <p className="remote-files-status">Loading file history…</p>
          )}
          {historyError && <p className="remote-files-error">{historyError}</p>}
          {!historyLoading && !historyError && historyEntries.length > 0 && (
            <div className="remote-file-history__list">
              {historyEntries.map((entry, index) => (
                <div
                  className="remote-file-history__item"
                  key={`${entry.revision}-${entry.updatedAt}-${index}`}
                >
                  <div>
                    <time dateTime={entry.updatedAt}>
                      {new Date(entry.updatedAt).toLocaleString()}
                    </time>
                    <span>{formatRemoteFileSize(entry.size)}</span>
                  </div>
                  {entry.current ? (
                    <strong className="remote-file-history__current">
                      Current
                    </strong>
                  ) : (
                    <button
                      type="button"
                      disabled={restoringRevision !== null}
                      onClick={() => setPendingRestore(entry)}
                    >
                      {restoringRevision === entry.revision
                        ? "Restoring…"
                        : "Restore"}
                    </button>
                  )}
                </div>
              ))}
              {historyEntries.length === 1 && (
                <p className="remote-files-status">No previous versions.</p>
              )}
            </div>
          )}
          {!historyLoading && !historyError && historyEntries.length === 0 && (
            <p className="remote-files-status">No file history.</p>
          )}
        </Dialog>
      )}
      {historyFile && pendingRestore && (
        <ConfirmDialog
          title="Restore file version?"
          confirmText="Restore"
          onCancel={() => setPendingRestore(null)}
          onConfirm={confirmRestore}
        >
          Restore this version of “{historyFile.name}”? The current version will
          remain available in file history.
          {historyFile.name === activeFile && isDirty
            ? " Your unsaved changes will be discarded."
            : ""}
        </ConfirmDialog>
      )}
    </div>
  );
};
