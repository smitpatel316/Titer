// File ▸ Save As Template / Example / Method (plan 38): the template's
// name, description and instructions — metadata carried in the file's
// `template` envelope block, shown when the template is opened. The name is
// metadata, not the file name: the save panel asks where to put the file, so
// nobody expects this to rename anything. Follows save-prompt-dialog.tsx
// (controlled inputs, `Dialog` wrapper); caps are enforced here on save and
// forgivingly on read (see parseTemplateInfo).
import * as React from "react";
import { Button } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { TEMPLATE_NAME_MAX, TEMPLATE_TEXT_MAX, type TemplateInfo, type TemplateKind } from "../lib/template";

const FIELD = "w-full rounded-md bg-control px-2 py-1.5 text-regular outline-none focus:ring-2 focus:ring-accent";

const KIND_LABEL: Record<TemplateKind, string> = {
  template: "Template",
  example: "Example",
  method: "Method",
};

export function TemplateDialog({
  defaultName,
  onSave,
}: {
  /** The project title: the Name field starts as this. */
  defaultName: string;
  onSave: (kind: TemplateKind, info: TemplateInfo) => void;
}) {
  const { selector, closeSelector } = useProjectStore();
  const kind = selector?.kind === "save-template" ? selector.templateKind : null;
  const [name, setName] = React.useState(defaultName);
  const [description, setDescription] = React.useState("");
  const [instructions, setInstructions] = React.useState("");

  // A fresh dialog starts from the project title, with the other fields blank.
  React.useEffect(() => {
    if (kind) {
      setName(defaultName);
      setDescription("");
      setInstructions("");
    }
  }, [kind, defaultName]);

  if (!kind) return null;
  const label = KIND_LABEL[kind];

  const save = () => {
    const info: TemplateInfo = { kind };
    const trimmedName = name.trim().slice(0, TEMPLATE_NAME_MAX);
    const trimmedDescription = description.trim().slice(0, TEMPLATE_TEXT_MAX);
    const trimmedInstructions = instructions.trim().slice(0, TEMPLATE_TEXT_MAX);
    if (trimmedName) info.name = trimmedName;
    if (trimmedDescription) info.description = trimmedDescription;
    if (trimmedInstructions) info.instructions = trimmedInstructions;
    closeSelector();
    onSave(kind, info);
  };

  return (
    <Dialog
      open
      onClose={closeSelector}
      title={`Save As ${label}`}
      description={`Save this project as a ${label.toLowerCase()} file, with its analyses and graphs, to reuse on new data. The name below is shown when the ${label.toLowerCase()} is opened — it is not the file name; the save panel asks where to put the file.`}
      footer={
        <Button variant="accent" onClick={save}>
          Save {label}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-regular">
          Name
          <input
            className={FIELD}
            value={name}
            maxLength={TEMPLATE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5 text-regular">
          Description <span className="text-small text-secondary">(optional)</span>
          <textarea
            className={FIELD}
            rows={2}
            value={description}
            maxLength={TEMPLATE_TEXT_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-regular">
          Instructions <span className="text-small text-secondary">(optional — shown when the {label.toLowerCase()} is opened)</span>
          <textarea
            className={FIELD}
            rows={3}
            value={instructions}
            maxLength={TEMPLATE_TEXT_MAX}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should someone do with this template first?"
          />
        </label>
      </div>
    </Dialog>
  );
}
