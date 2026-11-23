// The grid's right-click menu (a native macOS menu). What it offers depends
// on where the click landed: a cell, a row number, or a column header.
// Deleting rows or columns is only offered from their own header, so a stray
// right-click on a cell can't lose data.
import { hasXColumn, type TableData, type TableType } from "../../store/types";
import type { TableMove } from "../../store/references";
import type { MenuItems } from "../../native";
import { isGrouped, isNested, leadOf } from "../../lib/dataset";
import { decimalsSupported, setDecimalPlaces } from "../../lib/decimal-format";
import {
  CELL_BACKGROUND_COLORS,
  CELL_BACKGROUND_LABELS,
  type CellBackgroundColor,
} from "../../lib/cell-colors";
import {
  convertCommaDecimals,
  deleteColumns,
  deleteRows,
  hasCommaDecimals,
  insertColumns,
  insertRows,
  isRangeExcluded,
  rangeCellBackground,
  rowsDeleted,
  rowsInserted,
  setCellBackground,
  toggleExcluded,
  type Range,
} from "./table-data";

export type MenuZone = "cell" | "row" | "column";

type Item = MenuItems[number];

const SEPARATOR = { item: "Separator" } as const;

/** Prism's paint-bucket (seq 325) as menu items: the 8 colors, checked on
 *  the range's uniform color, then None to clear. Shared by the data grid's
 *  context menu and the results tables' cell menu — the pick closes over
 *  the caller's update. */
export function cellBackgroundMenuItems(
  current: CellBackgroundColor | "mixed" | null,
  onPick: (color: CellBackgroundColor | null) => void,
): Item[] {
  return [
    ...CELL_BACKGROUND_COLORS.map(
      (color) =>
        ({
          text: CELL_BACKGROUND_LABELS[color],
          checked: current === color,
          action: () => onPick(color),
        }) as Item,
    ),
    SEPARATOR,
    {
      text: "None",
      enabled: current !== null,
      action: () => onPick(null),
    },
  ];
}

const plural = (n: number, word: string) => (n > 1 ? `${n} ${word}s` : word);

interface MenuContext {
  data: TableData;
  type: TableType;
  zone: MenuZone;
  range: Range;
  /** Applies an edit, named for Undo. */
  update: (next: TableData, label: string, move?: TableMove) => void;
  rename: (column: number) => void;
  /** Renames the top-level group of the column's group (Nested tables only). */
  renameGroup: (column: number) => void;
  /** Opens Create Series for the selection (Prism: Insert → Create Series…). */
  createSeries: (range: Range) => void;
  /** Shows a grouped table's Groups panel. */
  showGroups: () => void;
  /** The table is frozen: the mutating items are disabled (seq 165). */
  tableFrozen?: boolean;
  /** Pastes a picked file as a link at `range`'s top-left cell (seq 168). */
  pasteLink: (range: Range) => void;
  /** Re-reads the table's linked source into it (seq 168). */
  refreshLink: () => void;
  /** Drops the table's link, keeping its values (seq 168). */
  breakLink: () => void;
}

export function gridMenu({ data, type, zone, range, update, rename, renameGroup, showGroups, tableFrozen, pasteLink, refreshLink, breakLink, createSeries }: MenuContext): MenuItems {
  const nested = isNested(data);
  const grouped = isGrouped(data) || nested;
  const rows = range.r1 - range.r0 + 1;
  const cols = range.c1 - range.c0 + 1;
  // Row titles (and an X column) stay first: nothing is inserted before them or deletes them.
  const firstData = Math.max(hasXColumn(type) ? 2 : 1, range.c0);
  // Column actions need a stored column: the empty ones shown beyond have nothing to act on.
  const onCells = zone !== "row" && range.c0 < data.columns.length;
  const exclude = isRangeExcluded(data, range) ? "Include in Analysis" : "Exclude from Analysis";
  const items: Item[] = [
    {
      text: exclude,
      accelerator: "CmdOrCtrl+E",
      enabled: !tableFrozen,
      action: () => update(toggleExcluded(data, range), exclude),
    },
    // Prism's paint-bucket (seq 325): Titer has no Change menu, so the
    // grid's right-click menu carries it — beside Exclude, the other
    // per-cell flag.
    {
      text: "Cell Background Color",
      enabled: !tableFrozen,
      items: cellBackgroundMenuItems(rangeCellBackground(data, range), (color) =>
        update(
          setCellBackground(data, range, color),
          color === null ? "Clear Cell Background Color" : `Cell Background Color: ${CELL_BACKGROUND_LABELS[color]}`,
        ),
      ),
    } as Item,
    SEPARATOR,
    { item: "Cut" },
    { item: "Copy" },
    { item: "Paste" },
  ];

  // Linked paste (Prism 11, seq 168): a file pasted as a link at the
  // selection, or — when this table has one — its source re-read, or the
  // link broken (values stay). A cell menu only: a row or column menu's
  // range would anchor the paste over the row titles.
  if (zone === "cell") {
    items.push({ text: "Paste Link…", action: () => pasteLink(range) });
    if (data.linkedPaste) {
      items.push(
        { text: "Update Linked Data", action: refreshLink },
        { text: "Break Link", action: breakLink },
      );
    }
  }
  // Prism's Insert → Create Series…: fill the selection's column with an
  // arithmetic or geometric series, starting at the selection's top-left
  // cell. Row titles (column 0) take no series.
  if (zone === "cell" && onCells && range.c0 >= 1) {
    items.push(SEPARATOR, { text: "Create Series…", action: () => createSeries(range) });
  }

  if (zone !== "column") {
    items.push(
      SEPARATOR,
      {
        text: `Insert ${plural(rows, "Row")} Above`,
        enabled: !tableFrozen,
        action: () =>
          update(insertRows(data, range.r0, rows), `Insert ${plural(rows, "Row")}`, {
            rows: rowsInserted(range.r0, rows),
          }),
      },
      {
        text: `Insert ${plural(rows, "Row")} Below`,
        enabled: !tableFrozen,
        action: () =>
          update(insertRows(data, range.r1 + 1, rows), `Insert ${plural(rows, "Row")}`, {
            rows: rowsInserted(range.r1 + 1, rows),
          }),
      },
    );
  }

  if (onCells && !grouped) {
    items.push(
      SEPARATOR,
      {
        text: `Insert ${plural(cols, "Column")} Left`,
        enabled: !tableFrozen,
        action: () => update(insertColumns(data, firstData, cols, type), `Insert ${plural(cols, "Column")}`),
      },
      {
        text: `Insert ${plural(cols, "Column")} Right`,
        enabled: !tableFrozen,
        action: () => update(insertColumns(data, range.c1 + 1, cols, type), `Insert ${plural(cols, "Column")}`),
      },
    );
  }

  if (onCells) {
    items.push(SEPARATOR, {
      text:
        nested && range.c0 > 0
          ? "Rename Subgroup"
          : grouped && range.c0 >= leadOf(data)
            ? (type === "xy" ? "Rename Data Set" : "Rename Group")
            : "Rename Column",
      enabled: !tableFrozen,
      action: () => rename(range.c0),
    });
    // A Nested table has two renameable levels: the subgroup above, and the
    // top-level group it belongs to.
    if (nested && range.c0 > 0) {
      items.push({
        text: "Rename Group",
        enabled: !tableFrozen,
        action: () => renameGroup(range.c0),
      });
    }
  }

  // Per-column decimal places (Prism 11, seq 333): Default (full precision)
  // or 0–6 decimals, applied to every stored data column the selection
  // covers. Display-only — the values keep full precision. Not offered on
  // contingency or survival-Y tables.
  if (decimalsSupported(type) && zone !== "row" && onCells && range.c1 >= 1) {
    const first = Math.max(range.c0, 1);
    const last = Math.min(range.c1, data.columns.length - 1);
    if (first <= last) {
      const current = data.decimals?.[data.columns[first]];
      const setPlaces = (places: number | undefined) => {
        let next = data;
        for (let c = first; c <= last; c++) next = setDecimalPlaces(next, data.columns[c], places);
        update(next, places === undefined ? "Decimal Places: Default" : `Decimal Places: ${places}`);
      };
      items.push(SEPARATOR, {
        text: "Decimal Places",
        items: [
          {
            text: "Default (full precision)",
            checked: current === undefined,
            enabled: !tableFrozen,
            action: () => setPlaces(undefined),
          },
          ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({
            text: `${n} decimal${n === 1 ? "" : "s"}`,
            checked: current === n,
            enabled: !tableFrozen,
            action: () => setPlaces(n),
          })),
        ],
      });
    }
  }

  if (zone === "column" && range.c0 === 0) {
    items.push(SEPARATOR, {
      text: "Keep Visible When Scrolling",
      checked: Boolean(data.freezeTitle),
      enabled: !tableFrozen,
      action: () => update({ ...data, freezeTitle: data.freezeTitle ? undefined : true }, "Keep Visible"),
    });
  }

  if (grouped || type === "xy")
    items.push(SEPARATOR, { text: type === "xy" ? "Show Replicates" : "Show Groups", action: showGroups });

  if (zone === "row") {
    const text = `Delete ${plural(rows, "Row")}`;
    items.push(SEPARATOR, {
      text,
      enabled: !tableFrozen,
      action: () => update(deleteRows(data, range.r0, rows), text, { rows: rowsDeleted(range.r0, rows) }),
    });
  }
  if (zone === "column" && !grouped && onCells && range.c1 >= firstData) {
    const count = Math.min(range.c1, data.columns.length - 1) - firstData + 1;
    items.push(SEPARATOR, {
      text: `Delete ${plural(count, "Column")}`,
      enabled: !tableFrozen,
      action: () => update(deleteColumns(data, firstData, count), `Delete ${plural(count, "Column")}`),
    });
  }
  if (hasCommaDecimals(data)) {
    const text = "Convert Decimal Commas to Points";
    items.push(SEPARATOR, { text, enabled: !tableFrozen, action: () => update(convertCommaDecimals(data), text) });
  }
  return items;
}
