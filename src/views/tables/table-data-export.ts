// Exporting the active data table as a file (seq 164): File ▸ Export
// Table Data. The MCP tool `titer_export_table_data` already wrote these
// files; the UI had no path to them. This is the same export through the
// native save dialog — the same serializers (`tableToCsv` / `tableToTxt` /
// `tableToXlsx` / `tableToXml` in `src/store/mcp-export.ts`), so a file written from the
// menu is byte-identical to one written by the tool: excluded cells empty,
// cell values kept as stored strings (an ID like "0123" never becomes 123).
import { alert, pickSavePath, writeFile } from "../../native";
import { loadDecimalSeparator } from "../../lib/decimal-format";
import {
  sanitizeFileStem,
  tableToCsv,
  tableToTxt,
  tableToXml,
  tableToXlsx,
  TABLE_DATA_FORMATS,
  type TableDataFormat,
} from "../../store/mcp-export";
import type { ProjectNode, TableData } from "../../store/types";

export { TABLE_DATA_FORMATS, type TableDataFormat };

/** The formats the menu offers, in the order it offers them. */
export const TABLE_DATA_EXPORT_FORMATS: { value: TableDataFormat; label: string; ext: string; filter: string }[] = [
  { value: "csv", label: "CSV (.csv)", ext: "csv", filter: "CSV" },
  { value: "xlsx", label: "Excel Workbook (.xlsx)", ext: "xlsx", filter: "Excel Workbook" },
  { value: "txt", label: "Tab-delimited Text (.txt)", ext: "txt", filter: "Tab-delimited Text" },
  { value: "xml", label: "Prism XML (.xml)", ext: "xml", filter: "Prism XML" },
];

const FORMAT_OF: Record<TableDataFormat, (typeof TABLE_DATA_EXPORT_FORMATS)[number]> = {
  csv: TABLE_DATA_EXPORT_FORMATS[0],
  xlsx: TABLE_DATA_EXPORT_FORMATS[1],
  txt: TABLE_DATA_EXPORT_FORMATS[2],
  xml: TABLE_DATA_EXPORT_FORMATS[3],
};

// The folder of the last export, offered again for the next one this session.
let lastFolder: string | null = null;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The native IO an export needs, injectable so the node test harness
 *  can drive it without a webview (defaults: the real save dialog and
 *  `write_file` call). */
export interface TableDataExportIo {
  pickSavePath: (title: string, defaultPath: string, name: string, ext: string) => Promise<string | null>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<unknown>;
  alert: (title: string, detail?: string, kind?: "info" | "warning" | "error") => Promise<unknown>;
}

export const defaultTableDataExportIo: TableDataExportIo = { pickSavePath, writeFile, alert };

/** One table's data as file bytes in `format` — the MCP export's
 *  serializers, nothing else. An unknown format is a plain error, not a
 *  silently wrong file. Prism XML needs the table type (it decides the
 *  Prism `TableType` written); anything else defaults to Column. */
export async function serializeTableData(
  data: TableData,
  name: string,
  format: TableDataFormat,
  tableType: ProjectNode["tableType"] = "column",
): Promise<string | Uint8Array> {
  if (format === "csv") return tableToCsv(data, loadDecimalSeparator());
  if (format === "txt") return tableToTxt(data, loadDecimalSeparator());
  if (format === "xlsx") return tableToXlsx(data, name, loadDecimalSeparator());
  if (format === "xml") return tableToXml(data, name, tableType);
  throw new Error(`has no table format “${String(format)}” — the formats are csv, xlsx, txt, xml.`);
}

/** Export one table node through the save dialog: serialize, ask where,
 *  write. Cancel writes nothing; a failed write says so. A table with no
 *  data yet exports its header row (the MCP export's rule: an empty table
 *  is `columns` only, never an error). */
export async function exportTableData(
  table: ProjectNode,
  format: TableDataFormat,
  io: TableDataExportIo = defaultTableDataExportIo,
): Promise<void> {
  const spec = FORMAT_OF[format];
  if (!spec) throw new Error(`has no table format “${String(format)}” — the formats are csv, xlsx, txt, xml.`);
  try {
    const data = table.data ?? { columns: ["Title"], rows: [] };
    const bytes = await serializeTableData(data, table.name, format, table.tableType ?? "column");
    const fileName = `${sanitizeFileStem(table.name, "Table")}.${spec.ext}`;
    const path = await io.pickSavePath(
      "Export Table Data",
      lastFolder ? `${lastFolder}/${fileName}` : fileName,
      spec.filter,
      spec.ext,
    );
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await io.writeFile(path, bytes);
  } catch (err) {
    await io.alert("Couldn't Export the Table Data", reason(err), "error");
  }
}
