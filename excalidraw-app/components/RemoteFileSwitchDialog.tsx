export const RemoteFileSwitchDialog = ({
  currentFile,
  nextFile,
  onSave,
  onDiscard,
  onCancel,
}: {
  currentFile: string;
  nextFile: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) => {
  return (
    <div className="remote-switch-backdrop" onMouseDown={onCancel}>
      <section
        className="remote-switch-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>Unsaved changes</h2>
        <p>
          Save changes to <strong>{currentFile}</strong> before opening{" "}
          <strong>{nextFile}</strong>?
        </p>
        <div className="remote-switch-dialog__actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onDiscard}>Discard</button>
          <button className="remote-switch-dialog__save" onClick={onSave}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
};
