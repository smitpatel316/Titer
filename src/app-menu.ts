// The native menu bar of a project window, set by the window in front (the bar is
// the app's, not a window's) and set again when what it shows changes (active table
// type, selection, unsaved state, recent files, theme) or another window comes to
// the front. Its project-free parts are in menus.ts.
import { WIZARDS } from "./views/analyses/wizards";
import * as React from "react";
import { isNative, onFocusChange, setTheme, type Theme } from "./native";
import { projectItems, separator as sep, setMenuBar } from "./menus";
import { useProjectStore } from "./store/use-project-store";
import { useLayout } from "./store/use-layout";
import { removeWithConfirm, type DocumentActions } from "./store/use-document";
import { NODE_NAMES, type GraphType, type NodeType } from "./store/types";
import { TABLE_TYPE_OPTIONS } from "./views/tables";
import { analysisOptionsForTable, analysisOptionsKey } from "./views/analyses";
import { GRAPH_OPTIONS_BY_TABLE } from "./views/graphs";
import { useStartAnalysis } from "./views/analyses/use-analysis-launcher";
import { SECTIONS } from "./views/graphs/format-panel";

const THEME_KEY = "titer.theme";

/** The appearance chosen in View ▸ Appearance, which every window shares. */
function savedTheme(): Theme {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system";
  }
}

/** Text-editing commands go to a focused text field natively, everything else to the
 *  table grid (whose idle input, marked `data-grid-idle`, doesn't count as a text field).
 *  Undo and Redo go to the field being typed in, else to the project (the store). */
export type EditCommand = "delete" | "select-all" | "fill-down" | "exclude" | "find" | "find-next" | "find-previous";
const TEXT_COMMANDS: EditCommand[] = ["delete", "select-all"];

/** Where the keyboard is: a text field, the data grid, or elsewhere. */
function focusKind(): "text" | "grid" | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  return el.hasAttribute("data-grid-idle") ? "grid" : "text";
}

function edit(command: EditCommand) {
  if (focusKind() === "text" && TEXT_COMMANDS.includes(command)) {
    document.execCommand(command === "select-all" ? "selectAll" : command);
  } else {
    window.dispatchEvent(new CustomEvent<EditCommand>("titer:edit", { detail: command }));
  }
}

export function useAppMenu(doc: DocumentActions) {
  const store = useProjectStore();
  const startAnalysis = useStartAnalysis();
  const { sidebar, inspector, panel, inspectorHere, settingsHere, setLayout, setOpenSections, setFoldedTables } =
    useLayout();
  // What the right panel shows, if shown: the note, or the settings where there are some.
  const shown = !inspector ? null : panel === "settings" && settingsHere ? "settings" : "notes";
  const panelItem = (view: "notes" | "settings", label: string, accelerator: string, enabled: boolean) => ({
    text: `${shown === view ? "Hide" : "Show"} ${label}`,
    accelerator,
    enabled,
    action: () => setLayout(shown === view ? { inspector: false } : { inspector: true, panel: view }),
  });
  const [theme, setThemeState] = React.useState(savedTheme);

  // Menu actions run long after the menu was built: read everything through this ref.
  const latest = React.useRef({ store, doc, startAnalysis });
  React.useEffect(() => {
    latest.current = { store, doc, startAnalysis };
  });

  React.useEffect(() => {
    setTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not kept: the next launch follows the system.
    }
  }, [theme]);

  // Only the window in front sets the menu; it reads the theme again, which another window may have changed.
  const [focused, setFocused] = React.useState(false);
  React.useEffect(
    () =>
      onFocusChange((focus) => {
        setFocused(focus);
        if (focus) setThemeState(savedTheme());
      }),
    [],
  );

  const { activeTableId, activeNodeId, activeNode, isDirty, nodes, undoName, redoName } = store;

  // A text field being typed in has its own Undo, so the menu follows the focus.
  const [typing, setTyping] = React.useState(false);
  React.useEffect(() => {
    const update = () => setTimeout(() => setTyping(focusKind() === "text"));
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  const tableType = activeTableId ? nodes[activeTableId]?.tableType : undefined;
  const hasTable = activeTableId !== null;
  // Wand needs an example: another table with ≥ 1 analysis or graph child.
  const wandAvailable = Object.values(nodes).some(
    (n) =>
      n.type === "table" &&
      n.id !== activeTableId &&
      Object.values(nodes).some(
        (c) => c.parentId === n.id && (c.type === "analysis" || c.type === "graph"),
      ),
  );
  const tableCount = Object.values(nodes).filter((n) => n.type === "table").length;
  // The data-dependent Analysis items (three-way ANOVA, nested t-test/ANOVA)
  // change with the table data, not with any other dep below — without this
  // key the native menu goes stale once isDirty is true and consecutive edits
  // share an undoName (BUG-REPORT #16).
  const analysisKey = analysisOptionsKey(
    tableType,
    activeTableId ? nodes[activeTableId]?.data : undefined,
  );

  // A graph's Format panel shown, whose sections the View menu folds.
  const formatShown = activeNode?.type === "graph" && shown === "settings";

  React.useEffect(() => {
    if (!isNative || !focused) return;
    const run = (fn: (l: typeof latest.current, tableId: string) => void) => () => {
      const tableId = latest.current.store.activeTableId;
      if (tableId) fn(latest.current, tableId);
    };

    // Each menu deletes what it makes: the item selected, when it is of its kind (the last
    // table stays, so a project is never empty). ⌘⌫ goes to the one that can.
    const deleteItem = (type: NodeType) => {
      const enabled = activeNode?.type === type && (type !== "table" || tableCount > 1);
      return {
        text: `Delete ${NODE_NAMES[type]}…`,
        ...(activeNode?.type === type ? { accelerator: "CmdOrCtrl+Backspace" } : {}),
        enabled,
        action: () => {
          // In the grid ⌘⌫ clears the selected cells; it never deletes the table from there.
          const focus = focusKind();
          if (focus === "grid") edit("delete");
          if (focus) return;
          const { activeNode, removeNode, nodes } = latest.current.store;
          if (activeNode?.type === type)
            void removeWithConfirm(
              activeNode,
              removeNode,
              type === "table" &&
                Object.values(nodes).some((n) => n.parentId === activeNode.id && n.type === "analysis")
                ? "Its analyses will be kept as orphaned results and its graphs will be deleted. You can undo this."
                : undefined,
            );
        },
      };
    };

    const themeItem = (value: Theme, text: string) => ({
      text,
      checked: theme === value,
      action: () => setThemeState(value),
    });

    void setMenuBar([
      {
        text: "File",
        items: [
          ...projectItems(
            doc.recents,
            (entry) => latest.current.doc.forgetRecent(entry),
            () => latest.current.doc.clearRecents(),
            (entry) => latest.current.doc.openRemoteEntry(entry),
          ),
          // The Welcome dialog (seq 167): the template gallery + Graph
          // Portfolio + recents. It auto-shows on a fresh first window; this
          // opens it on demand (also the only way back after "don't show").
          { text: "Welcome…", action: () => latest.current.doc.openWelcome() },
          { text: "Open from Cloud…", action: () => latest.current.doc.openRemotePicker() },
          {
            text: "Connected Storage…",
            action: () => latest.current.store.openSelector({ kind: "cloud-settings" }),
          },
          { text: "Import Prism File…", action: () => void latest.current.doc.importPrism() },
          { text: "Import Data File…", action: () => void latest.current.doc.importData() },
          {
            text: "Convert…",
            action: () => latest.current.store.openSelector({ kind: "converter" }),
          },
          {
            text: "Run Script…",
            action: () => latest.current.store.openSelector({ kind: "script" }),
          },
          sep,
          { text: "Save", accelerator: "CmdOrCtrl+S", enabled: isDirty, action: () => latest.current.doc.save() },
          { text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: () => latest.current.doc.save(true) },
          sep,
          // Save Special (plan 38): a template / example / method file is this
          // project with a `template` envelope block, under a `.pzt`/`.pzm`
          // name. An example is saved from a graph, a method from a data
          // table (Prism's rules); a template from anywhere.
          {
            text: "Save As Template…",
            action: () => latest.current.store.openSelector({ kind: "save-template", templateKind: "template" }),
          },
          {
            text: "Save As Example…",
            enabled: activeNode?.type === "graph",
            action: () => latest.current.store.openSelector({ kind: "save-template", templateKind: "example" }),
          },
          {
            text: "Save As Method…",
            enabled: activeNode?.type === "table",
            action: () => latest.current.store.openSelector({ kind: "save-template", templateKind: "method" }),
          },
          sep,
          { item: "CloseWindow" },
        ],
      },
      {
        // Cut/Copy/Paste are native: WebKit turns them into DOM events the grid handles.
        text: "Edit",
        items: [
          {
            text: typing || !undoName ? "Undo" : `Undo ${undoName}`,
            accelerator: "CmdOrCtrl+Z",
            enabled: typing || Boolean(undoName),
            action: () => (focusKind() === "text" ? document.execCommand("undo") : latest.current.store.undo()),
          },
          {
            text: typing || !redoName ? "Redo" : `Redo ${redoName}`,
            accelerator: "CmdOrCtrl+Shift+Z",
            enabled: typing || Boolean(redoName),
            action: () => (focusKind() === "text" ? document.execCommand("redo") : latest.current.store.redo()),
          },
          sep,
          { item: "Cut" },
          { item: "Copy" },
          { item: "Paste" },
          sep,
          { text: "Delete", enabled: hasTable, action: () => edit("delete") },
          { text: "Select All", accelerator: "CmdOrCtrl+A", action: () => edit("select-all") },
          { text: "Fill Down", accelerator: "CmdOrCtrl+D", enabled: hasTable, action: () => edit("fill-down") },
          sep,
          { text: "Exclude / Include", accelerator: "CmdOrCtrl+E", enabled: hasTable, action: () => edit("exclude") },
          sep,
          { text: "Find…", accelerator: "CmdOrCtrl+F", enabled: hasTable, action: () => edit("find") },
          { text: "Find Next", accelerator: "CmdOrCtrl+G", enabled: hasTable, action: () => edit("find-next") },
          {
            text: "Find Previous",
            accelerator: "CmdOrCtrl+Shift+G",
            enabled: hasTable,
            action: () => edit("find-previous"),
          },
        ],
      },
      {
        text: "Table",
        items: [
          {
            text: "New Table…",
            accelerator: "CmdOrCtrl+Alt+T",
            action: () => latest.current.store.openSelector({ kind: "new-table" }),
          },
          sep,
          ...TABLE_TYPE_OPTIONS.map((o) => ({
            text: o.label,
            action: () => latest.current.store.createTable(o.value),
          })),
          sep,
          {
            text: "Duplicate Family",
            enabled: hasTable,
            action: run((l, id) => l.store.duplicateFamily(id)),
          },
          deleteItem("table"),
        ],
      },
      {
        text: "Analysis",
        items: [
          {
            text: "New Analysis…",
            accelerator: "CmdOrCtrl+Alt+A",
            enabled: hasTable,
            action: run((l, id) => l.store.openSelector({ kind: "new-analysis", tableId: id })),
          },
          {
            // Creates data, not a result — so it sits next to New Analysis…,
            // not inside the picker (see plan 22).
            text: "Simulate data…",
            enabled: hasTable,
            action: run((l, id) => l.store.openSelector({ kind: "simulate-data", tableId: id })),
          },
          {
            // Wand (plan 37): analyze + graph this table like another table.
            text: "Use Wand…",
            enabled: hasTable && wandAvailable,
            action: run((l, id) => l.store.openSelector({ kind: "wand", tableId: id })),
          },
          {
            // Applies a `.pzm` method file's analyses and graphs to the
            // active table (plan 38).
            text: "Apply Method…",
            enabled: activeNode?.type === "table",
            action: () => void latest.current.doc.applyMethod(),
          },
          sep,
          ...(tableType
            ? analysisOptionsForTable(tableType, activeTableId ? nodes[activeTableId]?.data : undefined)
            : []
          ).map((o) => ({
            // A test with questions asks before running: "…".
            text: o.value === "transform" || WIZARDS[o.value] ? `${o.label}…` : o.label,
            action: run((l, id) => l.startAnalysis(id, o.value)),
          })),
          sep,
          deleteItem("analysis"),
        ],
      },
      {
        text: "Graph",
        items: [
          {
            text: "New Graph…",
            accelerator: "CmdOrCtrl+Alt+G",
            enabled: hasTable,
            action: run((l, id) => l.store.openSelector({ kind: "new-graph", tableId: id })),
          },
          sep,
          ...(tableType ? GRAPH_OPTIONS_BY_TABLE[tableType] : []).map((o) => ({
            text: o.label,
            action: run((l, id) => l.store.createGraph(id, o.value as GraphType)),
          })),
          sep,
          deleteItem("graph"),
        ],
      },
      {
        text: "Figure",
        items: [
          {
            text: "New Figure…",
            accelerator: "CmdOrCtrl+Alt+F",
            enabled: Object.values(nodes).some((n) => n.type === "graph"),
            action: () => latest.current.store.createFigure(),
          },
          sep,
          deleteItem("figure"),
        ],
      },
      {
        text: "Info Sheet",
        items: [
          {
            text: "New Info Sheet…",
            accelerator: "CmdOrCtrl+Alt+I",
            action: () => latest.current.store.createInfoSheet(),
          },
          sep,
          deleteItem("info"),
        ],
      },
      {
        text: "Settings",
        items: [
          {
            text: "AI Connections…",
            accelerator: "CmdOrCtrl+,",
            action: () => latest.current.store.openSelector({ kind: "ai-connections" }),
          },
        ],
      },
      {
        text: "View",
        items: [
          {
            text: sidebar ? "Hide Sidebar" : "Show Sidebar",
            accelerator: "CmdOrCtrl+B",
            action: () => setLayout({ sidebar: !sidebar }),
          },
          panelItem("notes", "Notes", "CmdOrCtrl+Alt+N", inspectorHere),
          panelItem("settings", "Inspector", "CmdOrCtrl+Alt+I", settingsHere),
          sep,
          // Every table, or every section of a graph's Format panel, at once (⌥ on a triangle too).
          { text: "Expand All Tables", enabled: tableCount > 0, action: () => setFoldedTables(new Set()) },
          {
            text: "Collapse All Tables",
            enabled: tableCount > 0,
            action: () =>
              setFoldedTables(
                new Set(
                  Object.values(latest.current.store.nodes)
                    .filter((n) => n.type === "table")
                    .map((n) => n.id),
                ),
              ),
          },
          { text: "Expand All Sections", enabled: formatShown, action: () => setOpenSections(new Set(SECTIONS)) },
          { text: "Collapse All Sections", enabled: formatShown, action: () => setOpenSections(new Set()) },
          sep,
          {
            text: "Appearance",
            items: [themeItem("system", "Automatic"), themeItem("light", "Light"), themeItem("dark", "Dark")],
          },
          sep,
          { item: "Fullscreen" },
        ],
      },
    ]);
  }, [
    focused,
    tableType,
    hasTable,
    wandAvailable,
    analysisKey,
    activeNodeId !== null,
    activeNode?.type,
    tableCount,
    formatShown,
    inspectorHere,
    settingsHere,
    shown,
    isDirty,
    doc.recents,
    theme,
    sidebar,
    inspector,
    typing,
    undoName,
    redoName,
  ]);
}
