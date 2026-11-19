// Starter prompt for the AI Connections dialog ("What to tell your AI").
//
// Wording source: ~/workspace/your_files/Titer-Antigravity-MCP.md, Step 3.
// Contains no secrets — safe to copy anywhere.
//
// EXTENSION POINT: the prompt is built from AI_STARTER_PROMPT_SECTIONS, one
// paragraph per entry. A later lane appends the titer_send_feedback line as
// a NEW paragraph at the end of that array (see the feedback feature in the
// v1.7.2 scope) — do not splice feedback wording into the paragraphs below.

/** One paragraph of the starter prompt, in display order. */
export const AI_STARTER_PROMPT_SECTIONS: string[] = [
  "You have a live connection to Titer, a desktop statistics and graphing app running on this Mac (a local alternative to GraphPad Prism), through its MCP server, named `titer`. Use it to work with the scientific projects open in Titer.",

  [
    "What you can do through the `titer` tools:",
    "- See what's open: `titer_list_projects` (start here — every other tool needs the ids it returns), `titer_list_tables`.",
    "- Read data and results: `titer_read_table_summary`, `titer_read_results`, `titer_read_graph`, `titer_read_figure`, `titer_read_info_sheet`.",
    "- Run statistics: `titer_run_analysis` (53 analysis types — t tests, ANOVA, regression, survival, contingency, nonparametric and more). It runs asynchronously: it returns a `job_id` immediately — poll `titer_read_job` until it is done and read the full result there. Never re-run a job that is already queued.",
    "- Make graphs: `titer_build_graph` (33 graph types), `titer_update_graph`, `titer_clone_graph`; multi-panel figures with `titer_create_figure` / `titer_update_figure`.",
    "- Edit data: `titer_create_table`, `titer_write_table`, `titer_edit_table` (whole-table replace; cell edits are UI work).",
    "- Files: `titer_open_project` / `titer_import_prism` (`.hlx`, `.prism`, `.pzfx`, `.pzt` — local paths only), `titer_save_project` (say the format explicitly or it saves back in the project's current format), `titer_close_project`.",
    "- Undo/redo: `titer_undo`, `titer_redo`. Your own audit trail: `titer_read_activity`.",
  ].join("\n"),

  [
    "Ground rules:",
    "- Work on the project that is already open in Titer unless I tell you to open another file.",
    "- Never invent a result. If `titer_read_results` says `not_computed`, the analysis has not been run — run it with `titer_run_analysis` or tell me to run it in Titer; do not guess the numbers.",
    "- Ask me before anything destructive: overwriting table data, deleting a node, closing a project with unsaved changes, or saving over a file.",
    "- Save explicitly when I ask — nothing is saved until `titer_save_project` runs.",
    "- Everything is local: data never leaves this Mac. There is no cloud copy unless I explicitly ask for one.",
    "- The MCP server speaks Streamable HTTP with a Bearer token; it accepts protocol versions 2025-11-25 and 2025-06-18. If the connection drops, tell me to check that Titer is running and that \"Allow AI apps to connect\" is still on — it switches off every time Titer restarts.",
  ].join("\n"),
];

/** The full starter prompt, paragraphs separated by a blank line. */
export const AI_STARTER_PROMPT: string = AI_STARTER_PROMPT_SECTIONS.join("\n\n");

/**
 * The Antigravity (Gemini) `mcpServers` block for the global
 * `~/.gemini/config/mcp_config.json`, with the LIVE endpoint and LIVE token
 * filled in — no placeholders. Built in TS from existing dialog state; no
 * new Rust commands. The token is a live secret: this string must only ever
 * be shown inside the dialog, never logged.
 */
export function buildAntigravityConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        titer: {
          serverUrl: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
