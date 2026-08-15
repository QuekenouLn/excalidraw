import { useMemo, useState } from "react";

import {
  MAX_MARKDOWN_FRAME_BYTES,
  createMarkdownFrameHtml,
} from "../markdownFrame";

import { Dialog } from "./Dialog";
import DialogActionButton from "./DialogActionButton";

import "./MarkdownFrameEditorDialog.scss";

export type MarkdownFrameSaveResult =
  | "saved"
  | "unchanged"
  | "conflict"
  | "missing";

type MarkdownFrameEditorDialogProps = {
  initialMarkdown: string;
  contentScale: number;
  onSave: (markdown: string) => MarkdownFrameSaveResult;
  onClose: () => void;
};

export const MarkdownFrameEditorDialog = ({
  initialMarkdown,
  contentScale,
  onSave,
  onClose,
}: MarkdownFrameEditorDialogProps) => {
  const [draft, setDraft] = useState(initialMarkdown);
  const [error, setError] = useState<string | null>(null);
  const byteLength = new TextEncoder().encode(draft).length;
  const isTooLarge = byteLength > MAX_MARKDOWN_FRAME_BYTES;
  const preview = useMemo(
    () => createMarkdownFrameHtml(draft, contentScale),
    [contentScale, draft],
  );

  const save = () => {
    if (isTooLarge) {
      setError("Markdown must be 1 MiB or smaller.");
      return;
    }
    const result = onSave(draft);
    if (result === "saved" || result === "unchanged") {
      onClose();
      return;
    }
    setError(
      result === "conflict"
        ? "This Markdown Frame changed while you were editing. Reopen it to use the latest content."
        : "This Markdown Frame is no longer available.",
    );
  };

  return (
    <Dialog
      title={false}
      size={1280}
      closeOnClickOutside={false}
      onCloseRequest={onClose}
    >
      <div className="MarkdownFrameEditorDialog__header">
        <h2>Edit Markdown</h2>
        <div className="MarkdownFrameEditorDialog__actions">
          <DialogActionButton label="Cancel" onClick={onClose} />
          <DialogActionButton
            label="Save"
            actionType="primary"
            disabled={isTooLarge}
            onClick={save}
          />
        </div>
      </div>
      {error && (
        <div className="MarkdownFrameEditorDialog__error" role="alert">
          {error}
        </div>
      )}
      <div className="MarkdownFrameEditorDialog">
        <label className="MarkdownFrameEditorDialog__pane">
          <textarea
            aria-label="Markdown"
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                save();
              }
            }}
          />
        </label>
        <div className="MarkdownFrameEditorDialog__pane">
          <iframe
            data-testid="markdown-frame-editor-preview"
            title="Markdown preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={preview}
          />
        </div>
      </div>
    </Dialog>
  );
};
