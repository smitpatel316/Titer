// File ▸ Rename… (seq 297): the project's new name, same folder — the file
// keeps its extension, so the format never changes with the name. Follows
// template-dialog.tsx (controlled input, `Dialog` wrapper).
import * as React from "react";
import { Button } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { fileName } from "../lib/paths";

const FIELD = "w-full rounded-md bg-control px-2 py-1.5 text-regular outline-none focus:ring-2 focus:ring-accent";

export function RenameDialog({
  defaultName,
  onRename,
}: {
  /** The current file name, extension included: the Name field starts as this. */
  defaultName: string;
  onRename: (name: string) => void;
}) {
  const { selector, closeSelector } = useProjectStore();
  const open = selector?.kind === "rename-project";
  const [name, setName] = React.useState(defaultName);

  // A fresh dialog starts from the current file name.
  React.useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  if (!open) return null;
  const ext = fileName(defaultName).match(/\.[^.]+$/)?.[0] ?? "";

  const rename = () => {
    closeSelector();
    onRename(name);
  };

  return (
    <Dialog
      open
      onClose={closeSelector}
      onReturn={rename}
      title="Rename Project"
      description={`Rename the file on disk — the project stays in the same folder, with its unsaved changes kept. The file keeps its${ext ? ` ${ext}` : ""} extension.`}
      footer={
        <Button variant="accent" onClick={rename} disabled={!name.trim()}>
          Rename
        </Button>
      }
    >
      <label className="flex flex-col gap-1.5 text-regular">
        Name
        <input
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
    </Dialog>
  );
}
