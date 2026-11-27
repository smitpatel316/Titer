// The Welcome dialog (seq 167): what a fresh window opens with — Prism's
// Welcome dialog, Titer's shape. New project (one blank table per type),
// the template gallery (worked examples), the Graph Portfolio (one example
// per graph type), recent projects, and Open…. Picking a template replaces
// the fresh window's untouched table and adds one anywhere else (the plan
// in src/lib/templates.ts decides); the dialog itself never touches the
// project — it reports the choice and the owner applies it.
//
// The "Show this dialog when Titer starts" checkbox writes the same
// localStorage key the auto-show reads (WELCOME_KEY); unchecking it is the
// only way the dialog stops appearing, and File ▸ Welcome… brings it back.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/controls";
import {
  addTemplateFolder,
  parseTemplateFolders,
  removeTemplateFolder,
  serializeTemplateFolders,
  sharedTemplatesForFolder,
  templateFolderLabel,
  TEMPLATES,
  TEMPLATE_FOLDERS_KEY,
  WELCOME_KEY,
  graphPortfolio,
  parseWelcomeSetting,
  type SharedTemplateEntry,
  type TemplateFolder,
} from "../lib/templates";
import type { ClonableGraph } from "../lib/clone-graph";
import { TABLE_TYPE_OPTIONS } from "../views/tables";
import { chooseProject, listTemplateFiles, pickFolder } from "../native";
import { recentKey, recentLabel, type RecentEntry } from "../store/recents";

/** One gallery row: a label, a one-line description, and what picking it does. */
function Row({ label, description, onPick }: { label: string; description: string; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left outline-none focus:bg-accent focus:text-white"
        onClick={onPick}
      >
        <span className="block text-regular">{label}</span>
        <span className="block text-small text-secondary">{description}</span>
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-small-strong text-secondary">{title}</h3>
      <ul className="-mx-2 flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

/** The stored "show on startup" setting, or show when nothing is stored. Never throws. */
function readShowOnStartup(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return parseWelcomeSetting(localStorage.getItem(WELCOME_KEY));
  } catch {
    return true;
  }
}

/** The registered template folders, or none when nothing is stored. Never throws. */
function readTemplateFolders(): TemplateFolder[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return parseTemplateFolders(localStorage.getItem(TEMPLATE_FOLDERS_KEY));
  } catch {
    return [];
  }
}

/** Persists the registered template folders. Never throws. */
function writeTemplateFolders(folders: TemplateFolder[]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TEMPLATE_FOLDERS_KEY, serializeTemplateFolders(folders));
    }
  } catch {
    // A registry that can't be stored doesn't stick; the folders simply
    // aren't there next launch. Never throw on save.
  }
}

export function WelcomeDialog({
  open,
  onClose,
  onApplyTemplate,
  recents,
  onOpenRecent,
  clonableGraphs,
  onCloneGraph,
  onOpenSharedTemplate,
}: {
  open: boolean;
  onClose: () => void;
  /** The template to start from (a blank table type, or a gallery example). */
  onApplyTemplate: (templateId: string) => void;
  recents: RecentEntry[];
  onOpenRecent: (entry: RecentEntry) => void;
  /** The project's graphs, in sidebar order — the Clone a Graph section
   *  lists them; empty on a fresh project, where there is nothing to clone. */
  clonableGraphs: ClonableGraph[];
  /** Clone a graph (with its data table): opens the Clone dialog for it. */
  onCloneGraph: (graphId: string) => void;
  /** Open a shared template file: it opens as a new untitled project. */
  onOpenSharedTemplate: (path: string) => void;
}) {
  const [showOnStartup, setShowOnStartup] = React.useState(readShowOnStartup);
  const [folders, setFolders] = React.useState<TemplateFolder[]>(readTemplateFolders);
  const [sharedTemplates, setSharedTemplates] = React.useState<SharedTemplateEntry[]>([]);
  // Re-read when the dialog opens: another window may have changed the setting or the folders.
  React.useEffect(() => {
    if (open) {
      setShowOnStartup(readShowOnStartup());
      setFolders(readTemplateFolders());
    }
  }, [open ]);

  // The shared templates: each registered folder's .pzt files, re-listed
  // whenever the dialog opens or the folders change. A folder that can't
  // be read lists nothing under it instead of dropping out of the registry.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      folders.map((folder) =>
        listTemplateFiles(folder.path)
          .then((files) => sharedTemplatesForFolder(folder, files, {}))
          .catch(() => [] as SharedTemplateEntry[]),
      ),
    ).then((perFolder) => {
      if (!cancelled) setSharedTemplates(perFolder.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [open, folders]);

  const addFolder = () => {
    void pickFolder("Choose a template folder", "").then((picked) => {
      if (!picked) return;
      setFolders((current) => {
        const next = addTemplateFolder(current, { path: picked, shared: false });
        if (next !== current) writeTemplateFolders(next);
        return next;
      });
    });
  };

  const removeFolder = (path: string) => {
    setFolders((current) => {
      const next = removeTemplateFolder(current, path);
      if (next !== current) writeTemplateFolders(next);
      return next;
    });
  };

  const pick = (templateId: string) => {
    onApplyTemplate(templateId);
    onClose();
  };

  const setShow = (show: boolean) => {
    setShowOnStartup(show);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(WELCOME_KEY, show ? "true" : "false");
    } catch {
      // A setting that can't be stored doesn't stick; the dialog simply
      // appears again next launch. Never throw on save.
    }
  };

  const examples = TEMPLATES.filter((t) => t.kind === "example");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissLabel="Close"
      title="Welcome to Titer"
      description="Start a new project, open a template, or pick up where you left off."
      footer={
        <Button
          onClick={() => {
            void chooseProject();
            onClose();
          }}
        >
          Open…
        </Button>
      }
      start={
        <label className="flex cursor-pointer items-center gap-1.5 text-regular text-secondary">
          <input type="checkbox" checked={showOnStartup} onChange={(e) => setShow(e.target.checked)} />
          Show this dialog when Titer starts
        </label>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title="New project">
          {TABLE_TYPE_OPTIONS.map((type) => (
            <Row
              key={type.value}
              label={`${type.label} table`}
              description={`Start with an empty ${type.label} table.`}
              onPick={() => pick(`blank-${type.value}`)}
            />
          ))}
        </Section>

        <Section title="Templates">
          {examples.map((template) => (
            <Row
              key={template.id}
              label={template.name}
              description={template.description}
              onPick={() => pick(template.id)}
            />
          ))}
        </Section>

        <Section title="Graph Portfolio">
          {graphPortfolio.map((entry) => (
            <Row
              key={entry.graphType}
              label={entry.label}
              description="Opens the example template that shows this graph."
              onPick={() => pick(entry.templateId)}
            />
          ))}
        </Section>

        {recents.length > 0 && (
          <Section title="Recent projects">
            {recents.slice(0, 5).map((entry) => (
              <Row
                key={recentKey(entry)}
                label={recentLabel(entry)}
                description={entry.kind === "local" ? "Open this project." : "Open this cloud project."}
                onPick={() => {
                  onOpenRecent(entry);
                  onClose();
                }}
              />
            ))}
          </Section>
        )}
      </div>
    </Dialog>
  );
}
