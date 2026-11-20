# MCP server contract — Titer (v1.6.0, Phase 2) ↔ stdio bridge

**Status:** Phase 2 + v1.7.4 P0 (56 tools: read, write, run, graph, export, cloud).
**Server branch:** `check/v16-mcp-phase2` (v1.6.0); the v1.7.4 P0 tools
(`titer_project_summary`, `titer_search`, `titer_get_analysis_params`,
`titer_rerun_analysis`, `await_result` on `titer_run_analysis`) were
added on `fix/174-p0-tools` and are marked "1.7.4" below.
**Spec:** MCP 2025-06-18 / 2025-11-25 ONLY. The 2026-07-28 revision is
deliberately not negotiated (clients lag it; the server's
`supported_protocol_versions` returns only the two 2025 revisions, and a
client offering only 2026-07-28 gets the server's latest supported version
in the `initialize` result, per the 2025-11-25 negotiation rules).

This document is the interface the **stdio-bridge lane** builds against
and the **terminal-CLI smoke** (`scripts/smoke-test-mcp-phase2.py`)
verifies against. The bridge is a separate small binary the MCP client
launches over stdio (Claude Desktop speaks stdio only to local servers);
it forwards to this HTTP endpoint. The `.mcpb` bundle for Claude Desktop
is the bridge lane's too — this lane only defines what it connects to.

Phase 1 (five read-only tools) is fully carried over unchanged, except
one additive change: `titer_list_projects` now also returns an
`info_sheets` array (§5.1). Everything in §§1–4 below is unchanged from
Phase 1 except where noted; the new material is the job model (§5),
the 50 Phase 2 + 1.7.4 tools (§§6–10), and the Phase 2 smoke (§11).

## 1. Endpoint

- **URL:** `http://127.0.0.1:<port>/mcp` — Streamable HTTP, one endpoint
  for POST (client → server), GET (server → client SSE stream, 2025-11-25
  sessions) and DELETE (session close). No other paths are served.
- **Bind:** `127.0.0.1` only. Nothing else listens.
- **Port selection:** the server tries `18741`–`18750` in order and takes
  the first free one. **The bridge MUST NOT assume a port** — read it from
  the discovery file (§2) every time it starts.
- **Off by default:** the server runs only while the user has turned on
  Settings → AI connections → "Allow AI apps to connect". If the bridge
  cannot reach the endpoint, the user-facing message is: "Turn on
  'Allow AI apps to connect' in Titer → Settings → AI connections, then
  try again." (The bridge must not start the server itself — starting it
  is a human action in Titer's Settings, never an agent action.)
- **Persisted opt-in:** turning the toggle on records the choice in
  `<app_data_dir>/mcp/mcp-opt-in.json` (`{"enabled": true, ...}`);
  turning it off records `false`. On launch Titer auto-starts the server
  when the record says `enabled: true` — no user action needed — so the
  toggle still shows ON after a restart. A missing or malformed record
  means off (fresh installs stay off). The record holds a boolean only,
  no secret. Re-enabling reuses the stored token (rotation is only via
  Regenerate in Settings, while the server is stopped).

## 2. Discovery — how the bridge finds the server

**File:** `<app_data_dir>/mcp/discovery.json`, owner-only (0600),
written on server start, removed on server stop.

```json
{
  "endpoint": "http://127.0.0.1:18741/mcp",
  "token": "<base64url bearer token>",
  "protocol_versions": ["2025-11-25", "2025-06-18"],
  "server": "titer",
  "version": "1.0.7"
}
```

- `<app_data_dir>` is the Tauri app-data directory
  (`~/Library/Application Support/net.smitpatel.helix` on macOS,
  `~/.local/share/net.smitpatel.helix` on Linux).
- The bridge runs as the user's own process, so it can read this file.
  **The token in it is a secret:** never print it, never log it, never
  put it in a URL query string, never pass it on the bridge's command
  line (visible in `ps`). Read it from the file, hold it in memory, send
  it only as the `Authorization: Bearer <token>` header.
- If the file is absent, the server is off (§1). If the file exists but
  the endpoint does not answer, the server is mid-start or mid-stop —
  retry briefly (a few seconds), then report it as off.
- **Token rotation:** the user can regenerate the token in Settings, but
  only while the server is stopped; a fresh start writes a fresh
  discovery file. The bridge reads the file at each launch, so rotation
  needs no bridge change — but a long-running bridge process must re-read
  the file (or restart) after a rotation, not cache the token forever.

## 3. Auth — every request

- Header: `Authorization: Bearer <token>` (from §2). Missing, malformed
  or wrong → `401`. The bridge surfaces a 401 as: "The token changed —
  restart the bridge (or re-check Titer → Settings → AI connections)."
- MCP headers (the Accept half is also what keeps browsers out — a browser
  sends `Accept: text/html` and gets a `400`):
  - `MCP-Protocol-Version: 2025-11-25` (or `2025-06-18`) — required on all
    requests AFTER `initialize` (spec 2025-11-25, "Protocol Version
    Header"); `initialize` itself negotiates the version in its body
    (`params.protocolVersion`), so the header is optional there and an
    absent header is NOT a 400. A post-`initialize` request with the header
    absent falls back to the negotiated session version, also not a 400.
    A header naming a version the server does not speak (e.g. `2026-07-28`)
    → `400`.
  - `Accept: application/json, text/event-stream` — required on every
    request; without it the server answers `400` ("Connect an MCP client,
    not a browser").
- The server sends **no CORS headers** and enforces a Host allowlist
  (`localhost`, `127.0.0.1`, `::1`): the bridge must send
  `Host: 127.0.0.1:<port>` (the default for the endpoint URL) and must not
  override it.
- **No OAuth.** This is a local bearer token by design (roadmap §1:
  Streamable HTTP's OAuth 2.1 flow is for remote servers; a local-only
  desktop app uses a local token). Do not implement an OAuth flow.
- **No outbound network, ever, from the server or the bridge** — except
  the cloud tools (§9), which reach the connected storage provider by
  design, and `titer_send_feedback` (§6), which POSTs the report to the
  feedback server only when the user has turned on feedback sharing.
  Those ten are the only tools with `open_world_hint: true`. The
  server only listens; the bridge only talks to `127.0.0.1` plus, for
  cloud tools, the provider the user connected in Settings.

## 4. JSON-RPC shape (Streamable HTTP, 2025-11-25)

Standard MCP over Streamable HTTP: each client message is one HTTP POST
with a JSON-RPC 2.0 body; the reply is `application/json` or a short
SSE stream (`text/event-stream`). Lifecycle:

1. `initialize` — client sends `protocolVersion` (`2025-11-25` or
   `2025-06-18`), `capabilities`, `clientInfo`. Server answers with its
   own `protocolVersion` (the negotiated one — the highest both support),
   `capabilities: { "tools": {} }`, `serverInfo: { "name": "titer",
   "version": "<app version>" }`, and `instructions` (the 56 tools:
   read-only vs mutating, the job model, cloud/export notes — the full
   text lives in `get_info` in `src-tauri/src/mcp.rs`).
2. `notifications/initialized` — client sends after `initialize`.
3. `tools/list` — returns all 56 tools in one page (`nextCursor`
   absent). No pagination.
4. `tools/call` — `{ "name": "<tool>", "arguments": { … } }`.
5. Sessions: 2025-11-25 clients use protocol-level sessions; the server
   issues an `Mcp-Session-Id` response header and expects it back on later
   requests. The bridge MUST echo the session id it is given, and send
   `DELETE` with it when the client disconnects (session close).

**Tool errors** come back as a normal tool result with `isError: true`
and a plain-language message (unknown id, no open project, …) — not as a
JSON-RPC protocol error. A tool that cannot answer (e.g. an analysis never
run in-session) returns a successful result with a `status` field saying
so (see §5.1) — the bridge passes that through unchanged. **Param
validation errors name the valid choices** (unknown param key, a choice
outside its list, a number outside its range) — they are never silently
defaulted, except the wizards' own documented auto-detects (e.g.
mixed-effects `subjectId` may be omitted; the runner derives it).

**Conventions for every tool:** `project_id` is the window label
(`project-1`, …); omit it for the front (most recently published)
project. A named window with no snapshot is closed (or never opened) —
a plain error, never the front project by surprise. Every call is
written to the Activity log (§10) with an args summary only — never
full table values, never the token. Tool outputs never echo the job
args (they can hold whole tables).

**Approvals are the calling AI tool's job, not Titer's (scope D4).**
The calling tool offers its own approval settings (ask every time vs
don't ask / bypass all). There is no Titer-side approval model: no tool
can change the safety settings (`mcp_set_enabled` /
`mcp_regenerate_token` are app commands, not tools), and no tool can
enable/disable the server, regenerate/show the token, connect or
disconnect cloud storage, update the app, or change local UI prefs
(theme, palettes, recents, layout).

## 5. The job model (L0 dispatch) — how mutating tools work

The project state lives in the webview (the TS store), which Rust cannot
read directly. The frontend publishes its project to Rust via
`mcp_publish_snapshot` on every revision change (debounced ~500 ms) and
publishes each analysis outcome it computes in-session via
`mcp_publish_result`. Read tools read ONLY those snapshots — the same
data the UI shows. They never re-read files and never run R.

Mutating tools run through the **Rust → frontend dispatch channel**:
the Rust handler enqueues a **job** (id `job-N`: target window, action,
args) and the frontend dispatcher executes the store call / `runAnalysis`
and reports completion back to Rust. The dispatcher ignores jobs for
closed windows and never runs a job twice (once-only discipline).
Jobs for a closed window are cancelled, not run.

### 5.1 Job states and the three job tools

A job's `status` is one of `queued`, `running`, `done`, `error`,
`cancelled` (terminal: done / error / cancelled). A job's full shape
(`titer_read_job`) is `{ job_id, status, project_id, action,
analysis_id?, created?, result?, error?, created_ts, started_ts?,
finished_ts? }`. `created` names what the job created when known (e.g.
`{ analysis_id, analysis_type }` for a run; data-op analyses carry no
`table_ids` — see §7). `result` is the job's outcome; `error` the
runner's message. `args` is never in a tool output.

| Tool | Arguments | Returns |
|---|---|---|
| `titer_read_job` | `{ job_id }` | The job (above). `done` carries the full result; `error` / `cancelled` carry the error. After eviction (§5.3) it answers "No job with id …" — an honest unknown, not a stale status. Read-only. |
| `titer_list_jobs` | `{ project_id? }` | `{ jobs: [{ job_id, status, project_id, action, analysis_id?, analysis_type?, created_ts, started_ts? }] }`, oldest first — active + recently finished, so a client that disconnected can recover instead of re-running. Omit `project_id` for the front project; with no project published at all, every project's jobs. Listing does NOT mark jobs read (§5.3). Read-only. |
| `titer_cancel_job` | `{ job_id }` | `{ job_id, status }`. Maps to the `cancel_r` path (drops only that job's requests; never another window's work). A job already `done` reports `done` instead of erroring. Mutating, `idempotent_hint: true`. |

### 5.2 Awaited tools vs the one async tool

Most mutating tools **enqueue and await**: the `tools/call` blocks
until the job reaches a terminal state, then returns the job's result
directly (no polling needed).

- Store / document / table / graph / figure / info-sheet / simulate /
  method / wand / script tools await up to **30 s**. A store dispatch
  is instant — the only wait is a busy dispatcher (e.g. a long analysis
  ahead of it in the window's serial queue).
- Export tools await up to **120 s** (rendering Plotly at up to 1200 DPI
  is slower than a store dispatch; the bridge allows 300 s per request).

On timeout the job keeps running and the error names its `job_id` —
**poll `titer_read_job` for it instead of re-running**; the create
still happens, nothing is lost or double-created.

The one exception is **`titer_run_analysis` (async by design)**: a first
run can install R packages (webR repo) and the webR queue is serial per
window, so a run can outlast the bridge's 300 s timeout — a synchronous
`tools/call` cannot hold it. The tool awaits only the *create* step
(up to 30 s, so param errors surface as tool errors) and returns
immediately with `{ job_id, status: "queued", analysis_id, project_id }`;
the client polls `titer_read_job`. On completion the run publishes via
`mcp_publish_result`, so `titer_read_results` serves agent-run results
exactly as it serves UI-run ones (see §6).

**Opt-in await (1.7.4):** `titer_run_analysis` and
`titer_rerun_analysis` accept `await_result: true` (default false) +
`await_seconds` (default 30, valid 1–120 — out of range is a tool error
naming the range, never a silent clamp). When set, the call blocks
until the run reaches a terminal state or the window elapses. A run
that finishes in time returns the result inline instead of the queued
shape: `{ job_id, status: "done", analysis_id, project_id, result }`
(`result` is the full `AnalysisResult`, same as `titer_read_results`
`"computed"`). A run still going when the window elapses returns the
queued shape plus a `note` naming the `job_id` to poll — **poll
`titer_read_job` for it instead of re-running**. A run that finishes
with an error (or is cancelled) surfaces as a tool error, not as a
`done` with an error payload. The await never re-runs anything: one
job, one run, whether it finishes inline or is polled later.

### 5.3 Job retention / eviction (L4)

Jobs are kept in memory in the Rust state; eviction is a lazy sweep on
every access (`enqueue_job`, `read_job`, `list_jobs`):

- A terminal job (done / error / cancelled) is kept until it has been
  read at least once after completion — a read via `titer_read_job` (or
  an internal `await_job` poll that consumed it) marks it — and then
  retained **15 minutes** (`JOB_RETAIN_AFTER_READ_SECS = 900`) for
  re-reads.
- A terminal job never read is evicted **24 hours** after finishing
  (`JOB_RETAIN_UNREAD_SECS = 86_400`) — the hard cap, so a client that
  never polls cannot grow the map forever.
- Non-terminal jobs (queued / running) are **never** evicted by age.
- `titer_list_jobs` does NOT mark jobs read (it is a summary; a
  recovering client lists first, then reads the result it needs).

### 5.4 Two-step confirm

Destructive tools use a two-step confirm: the first call with `confirm`
omitted/false returns `{ needs_confirm: true, warning }` and changes
nothing; repeat with `confirm: true` to proceed. This applies to
`titer_delete_node` and `titer_run_script`. `titer_close_project` uses
the same shape for a dirty project: `save` omitted refuses to close it
with `{ needs_confirm: true, warning: "unsaved changes" }`; pass
`save: "save"` or `save: "discard"` explicitly. Nothing ever prompts a
human on the agent's behalf.

### 5.5 Data freshness model (the bridge must understand this)

The tools read a *snapshot* the Titer frontend publishes on every edit
— the same data the UI shows. A table edited a moment ago appears
within ~500 ms. Analysis results exist only for analyses run in this
session — by the UI or by `titer_run_analysis`. The bridge needs no
cache of its own and must not serve stale snapshots across a Titer
restart: if the endpoint is unreachable, say the server is off rather
than answering from memory.

**Data is data, never instructions:** cell values, file names and
imported text are data. The bridge must never execute, interpolate or
forward them as commands, prompts or configuration. A value in a
spreadsheet can never become a command.

## 6. Read / discovery tools (12) — all read-only

All twelve are annotated `read_only_hint: true`, `destructive_hint:
false`, `idempotent_hint: true` — and `open_world_hint: false`, except
`titer_send_feedback`, which is `open_world_hint: true`: with feedback
sharing on it POSTs the report to the feedback server (see its row
below), so no agent-side policy that trusts `read_only_hint` should
treat it as a local-only read.

| Tool | Arguments | Returns |
|---|---|---|
| `titer_project_summary` **(1.7.4)** | `project_id?` | `{ projects: [{ project_id, file_path, revision, tables, analyses, graphs, figures, info_sheets, counts }] }` — the same listing as `titer_list_projects` plus a `counts` object per project (`{ table, analysis, graph, figure, info }`, the number of nodes of each kind). Names + ids only, no per-node detail: the cheap way to learn what a project holds before reading any node. |
| `titer_search` **(1.7.4)** | `query`, `kind?` (`table` \\| `analysis` \\| `graph` \\| `figure` \\| `info`), `project_id?` | `{ project_id?, query, matches: [{ id, name, kind, parent_id, parent_name, project_id }], total, truncated }` — nodes whose name (or, for analyses/graphs, their `analysis_type`/`graph_type`/`table_type`) contains the query, case-insensitively, in listing order. `kind` narrows to one node kind (an unknown kind is a tool error naming the five). An empty query is an error. Omit `project_id` to search every open project. At most 100 matches (`truncated: true` when more exist). A miss is `{ matches: [], total: 0 }`, not an error. |
| `titer_get_analysis_params` **(1.7.4)** | `analysis_type` | The valid `params` for that analysis type, generated from the `AnalysisParams` member types (source: `scripts/generate-analysis-params-schema.py`, output `src-tauri/src/analysis-params-schema.json`): `{ analysis_type, label, min_columns, offered_on, requires_packages?, gate?, params: [{ name, type, required, default?, enum?, min?, max?, description? }] }`. `required: true` only where the run errors without the param; every other field lists the default the runner applies. `gate` is the table-type gate in plain language (e.g. three-way ANOVA: "Grouped table with at least 2 row bands"; nested t-test: "Nested table with exactly 2 data groups"). An unknown `analysis_type` is a tool error naming the valid types. Use this before `titer_run_analysis` / `titer_rerun_analysis` instead of guessing param names. |

| Tool | Arguments | Returns |
|---|---|---|
| `titer_list_projects` | — | `{ projects: [{ project_id, file_path, revision, tables, analyses, graphs, figures, info_sheets }] }` — every node with `id`, `name`, and its kind (`table_type` / `analysis_type` / `graph_type`). The discovery call; the other tools' ids come from here. **Phase 2 addition:** the `info_sheets` array (GAP-3 fix — info nodes were previously dropped). |
| `titer_list_tables` | `project_id?` | `{ project_id, tables: [{ id, name, table_type, rows, data_columns }] }`. `table_type` is one of Column, XY, Grouped, Multiple variables, Contingency, Survival, Nested. |
| `titer_read_table_summary` | `project_id?`, `table_id`, `include_values?` (default false), `max_rows?` (default 100, max 1000) | Columns with `name`, `role` (derived from the table type — X / Y / dataset / group · replicate / variable / category / time …), `unit_hint` (parsed from header brackets, e.g. `[nM]` — Titer records no units field, so this is a hint, said as one), `numeric_values` / `missing_values` / `non_numeric_values`, `range` (`min`/`max`/`mean`, null when no numbers); `rows`, `data_columns`, `excluded_cells` (count — excluded cells are dropped from the ranges), `units_note`, `notes` (provenance, when the table has one), `structure` (groups/replicates/subgroups/rowGroups, Grouped/Nested only). With `include_values: true`, a `values` block: capped rows as `{ row, cells }` (row titles in column 0; excluded cells shown as null). |
| `titer_read_results` | `project_id?`, `analysis_id` | `{ status, project_id, analysis_id, name, analysis_type, … }`. `status: "computed"` carries the full cached result under `result` (statistics, p-values, CIs, notes — the `AnalysisResult` shape the app itself renders). `status: "not_computed"` means the analysis has not been run in this Titer session: the message says to open the analysis in Titer and run it — the bridge/client must NOT invent a result. `status: "error"` carries the run's error message. `status: "unknown_analysis"` / `"not_an_analysis"` mean the id is wrong. After Phase 2, a `titer_run_analysis` job's completion publishes here too, so this tool is the read path for agent-run results as well as UI-run ones. |
| `titer_read_graph` | `project_id?`, `graph_id` | `{ graph_type, source_table: { id, name, table_type }, title, x_label, y_label, linked_analyses: [{ link, analysis_id, analysis_name }], figures: [{ id, name }], export_state }`. `export_state` is a plain-language note: the v1.0 project model keeps no export history, so whether the graph has been exported is unknown to this tool. |
| `titer_read_figure` | `project_id?`, `figure_id` | `{ project_id, figure_id, name, panels: [{ graph_id, rect }], grid, title }`. Phase 1 had no figure reader; needed to verify a figure before exporting it. Shape follows the stored figure node. |
| `titer_read_info_sheet` | `project_id?`, `info_sheet_id` | `{ project_id, info_sheet_id, name, linked_table_id?, info }`. Pairs with the `info_sheets` array in `titer_list_projects`. |
| `titer_read_activity` | `limit?` (default 50, max 500) | `{ lines: string[] }` (newest last) — the agent's own audit trail (what it did, what failed). Lines are the stored JSONL as-is (§10). |
| `titer_send_feedback` | `kind` (`"bug"` \| `"missing-feature"` \| `"other"`), `summary` (short, required, at most 200 characters), `details` (required, at most 4000 characters — what was tried, what happened, what was expected), `failed_tool?` (the tool or step that failed, if any) | `{ feedback_id, received: true, sent: true/false, ... }`. Reports a missing feature or a bug to the Titer team — **read-only wrt the project**: it never touches a snapshot, a job, or a project file. **But it is `open_world_hint: true`, not a local-only read:** the report is always saved on this Mac first: one JSONL entry appended to `<app_data>/mcp/feedback.jsonl` (same 0700 directory as the token, §10), and the user reviews the entries in Settings → AI Connections, sending one to GitHub only by clicking "Send to GitHub" there. **Consent gate:** the entry is also POSTed to the feedback server (`POST https://feedback.smitpatel.net/api/v1/feedback`, 10 s timeout) only when the user has turned on feedback sharing — first-run prompt (Share / Don't share, default off) or the Settings toggle, recorded in `<app_data>/mcp/feedback-consent.json`. Sharing off → `{ feedback_id, received: true, sent: false, sharing: "disabled", note: "…" }` and no POST is attempted (the tool says sharing is disabled, never silently stays local). Sharing on + server 201 → `{ feedback_id, received: true, sent: true, issue_url: "…" }`. Sharing on + server unreachable / timeout / non-2xx → `{ feedback_id, received: true, sent: false, sharing: "enabled", error: "…" }` — the entry stays saved locally and the tool call still succeeds. The bridge auto-attaches minimal context only: app version, OS, the failed tool/step if any, and the last few Activity lines (tool names + ok flags only). **No table data values, no file paths beyond the project file name.** An unknown `kind`, an empty `summary`/`details`, or an over-long one is a plain-language tool error naming the valid choices. |

## 7. Analyses (53 types) — run, freeze, simulate, method, wand, script

All 53 `AnalysisType` values in `src/stats/types.ts` are runnable via
`titer_run_analysis`; `params` must match the `AnalysisParams` member
for the type (§4: unknown/out-of-range params are rejected with the
valid choices). **Do not guess params — ask first:**
`titer_get_analysis_params` (§6) returns the valid params, with types,
ranges, defaults and the table-type gate, for any of the 53 types. The
table-type gate applies: the analysis must be offered for the table's
type (`ANALYSIS_OPTIONS_BY_TABLE`, including the data-dependent gates
— three-way ANOVA needs ≥ 2 row bands; nested t-test needs exactly 2
data groups; nested ANOVA needs ≥ 3), otherwise the error names the
valid analyses for that table type.

- **Pass a concrete type, never the wizard value:**
  `compare-many-groups` → `anova` / `kruskal-wallis` / `rm-anova` /
  `friedman`; interpolation is `analysis_type: "nonlinear-regression"`
  + `params.interpolate` (standard-curve interpolation is not a
  separate analysis).
- **Capabilities that live inside an existing type (no separate type):**
  chi-square test for trend (`chi-square` + `params.trendOrdered:
  true`, Cochran–Armitage on a qualifying table); Grubbs (`outliers` +
  `params.method: "grubbs"`, ROUT is the other method); binding-
  saturation total/nonspecific/two-site (models `one-site-total`,
  `two-site-specific`, `one-site-total-and-ns`,
  `two-site-total-and-ns`); Morrison Ki (`enzyme-inhibition` model
  `"morrison"`); Lorentzian/sine curves (`nonlinear-regression` models
  `"lorentzian"` / `"sine-wave"`). The post-hoc suite is complete
  (`ANOVA_POSTHOCS` incl. Dunnett, Šídák, Holm–Šídák, Fisher LSD,
  Games-Howell, T3). `correlation` takes `XYCorrelationParams`;
  `correlation-matrix` takes `CorrelationParams`.

| Tool | Arguments | Returns |
|---|---|---|
| `titer_run_analysis` | `project_id?`, `table_id`, `analysis_type`, `params?`, `name?`, `await_result?` (default false), `await_seconds?` (default 30, 1–120) | `{ job_id, status: "queued", analysis_id, project_id }` — immediately (async, §5.2). Creates the analysis node (`createAnalysis` with `analysis_type` + `params`) and enqueues the run; poll `titer_read_job` — `done` carries the full `AnalysisResult` (same shape as `titer_read_results` `"computed"`). `name?` overrides the node's display name. `table_id` is required — every analysis has a parent table. With `await_result: true` a run that finishes within `await_seconds` returns inline instead: `{ job_id, status: "done", analysis_id, project_id, result }`; a run still going returns the queued shape plus a `note` naming the `job_id` to poll (§5.2). |
| `titer_rerun_analysis` **(1.7.4)** | `project_id?`, `analysis_id`, `params?` (overrides), `await_result?`, `await_seconds?` | `{ job_id, status: "queued", analysis_id, project_id }` — the same async shape as `titer_run_analysis`, but it runs an EXISTING analysis node: no new node is created. `params?` are overrides only, merged over the node's stored params and **saved on the node** (the next run and the UI see them); they are validated exactly like `titer_run_analysis` params — unknown/out-of-range keys are rejected naming the valid choices. A frozen analysis is refused ("unfreeze it with `titer_freeze_analysis`"); an orphaned analysis (its table was deleted) is refused — its params can't change. Same `await_result` / `await_seconds` semantics as `titer_run_analysis` (§5.2). This is the run path for method/wand-created analyses (see §11.3, now closed). |
| `titer_freeze_analysis` | `project_id?`, `analysis_id`, `frozen` (boolean) | `{ project_id, analysis_id, frozen }`. A frozen result survives later data edits; unfreezing re-runs on next read. Undoable via `frozen: false` / `titer_undo`. |
| `titer_simulate_data` | `project_id?`, `table_type` (`column` \| `grouped` \| `xy`), `distribution` (`gaussian` \| `lognormal` \| `uniform` \| `binomial` \| `poisson` \| `exponential`), `n` (values per dataset, ≥ 2), `datasets` (≥ 1), `seed` (integer), `mean?`/`sd?`, `meanlog?`/`sdlog?` (of the LOGGED values), `min?`/`max?`, `size?`/`prob?` (0–1), `lambda?`, `rate?` — flat args, no nested object; only the fields its distribution needs are read. | `{ project_id, table_id, rows, data_columns }` — the new table via `createSimulatedTable` ("Simulated data", numbered). `n`/`datasets`/`seed` must be whole numbers (20.0 is not one); the frontend validator (`validateSimulationSpec`, the same function the dialog uses) is the authority on ranges and per-distribution requirements, including the 100,000-value cap. Same seed + settings reproduces the table. Awaited (one webR round-trip), not polled. |
| `titer_apply_method` | `project_id?`, `table_id`, `path` | `{ project_id, table_id, created: { analyses: string[], graphs: string[] } }` (+ `skipped` with reasons, `dropped_links` naming graph links to analyses that weren't applied). Applies a `.pzm` method file's analyses + graphs to the table (Rust reads the file — local paths only, `.pzm` required; the frontend parses it). Only what the table offers is applied. **The created analyses are nodes with params, not runs** — run them with `titer_rerun_analysis` (§7; the §11.3 open item this closed in 1.7.4). A method file with no analyses/graphs at all is an error; a method with some, none of which fit this table, is a successful no-op (`created` empty + `skipped`). |
| `titer_apply_wand` | `project_id?`, `table_id`, `example_table_id`, `prefix?` | `{ project_id, table_id, created: { analyses: string[], graphs: string[] }, report }` — the existing `WandReport`. Analyse + graph this table like another table (one target table only). Example == target, example with no children, or target with no numeric data are reported as `skipped` entries, not errors. **Copied analyses are nodes with params, not runs** — run them with `titer_rerun_analysis` (§7; the §11.3 open item this closed in 1.7.4). |
| `titer_run_script` | `project_id?`, `script`, `confirm?` | `{ project_id, replaced: true, effects, effects_executed: false }` or `{ needs_confirm: true, warning }` (two-step confirm, §5.4). `script` is the script TEXT in Prism-script format (one command per line, `//` and `/* */` comments, `ForEach` loops with `%N`/`%S`, Prism coordinates: row 0 = title row, col −1 = row titles, col 0 = X, col ≥ 1 = Y sets). There is **no `path` form** — the UI dialog takes typed/pasted text, and so does this tool. The run replaces the current project content (tables, analyses, graphs, figures) as one Undo step; the old content survives as that Undo step but is not saved to disk. A run that hits an error changes nothing (the job errors with the log lines); a run that changes nothing applies no undo step. |

**Script effects are reported, not executed.** `runScript` returns
`effects` (`export-graph`, `write-text-file`, `save-project`, `print`,
`close-dialog`); the dialog executes them, the MCP job does not. The
tool returns them as `effects` + `effects_executed: false` with a note.
A script whose whole point is an export or a file write therefore gets
an honest "not executed" instead of a silent no-op. `Import` in a
script names files the engine cannot read in MCP context, so it errors
plainly ("couldn't read …") instead of silently skipping.

## 8. Project / document, data tables, graphs / figures / info sheets

### 8.1 Project / document — 5 tools

| Tool | Arguments | Returns |
|---|---|---|
| `titer_create_project` | `template?` | Without `template`: `{ project_id, file_path: null, blank: true }` — a new blank project window via the existing `new_project` path. With `template` (a built-in template id — `blank-column`, `blank-xy`, `blank-grouped`, `blank-nested`, `blank-multiple`, `blank-contingency`, `blank-survival`, `example-dose-response`, `example-two-group`, `example-survival`, `example-contingency`; seq 167): `{ project_id, template_id, template_name, table_id, name, table_type, rows, data_columns, graphs, replaced_pristine_table }` — the template replaces the new window's untouched table, so the project holds one table. An unknown template id is a plain error naming the ids that exist. Returns the window label; address it by `project_id` afterwards. |
| `titer_open_project` | `{ path }` | `{ project_id, file_path, format: "hlx" \| "pzt" \| "prism" \| "pzfx" }`. Rust-side: local `.hlx` / `.pzt` (untitled) opens as a project; `.prism` / `.pzfx` imports as a project (same as File ▸ Import Prism File). Path must be local — no URLs. Fails plainly on a missing/unreadable file. |
| `titer_save_project` | `project_id?`, `path?`, `format?: "hlx" \| "prism" \| "pzfx"` | `{ project_id, file_path, format, revision }`. Frontend dispatch (bytes are built by the TS writers — Rust has no serializer). `format` must be explicit — the save-nudge prompt never appears to an agent; omit it to save back in the project's current format (`.hlx`, or `.prism`/`.pzfx` for Prism-origin/remote projects). `path` = Save As. Resolution: explicit `format` > path extension > current file extension; a format/path mismatch is refused, never a silent `.hlx` save. Errors name the writer's failure (e.g. mixed Y formats cannot go to `.pzfx`) instead of silently saving as `.hlx`. A remote project with no local file errors plainly ("no file yet — pass path") — it cannot be saved back to the cloud; see §9. `.pzfx` writer coverage is data tables + info sheets only — analyses, graphs and layouts are never written to `.pzfx`. |
| `titer_import_prism` | `{ path }` | `{ project_id, file_path, imported_tables, warnings }`. Same as `titer_open_project` for a Prism path, kept separate so the intent is explicit. `warnings` carries the import report (what the converter skipped). |
| `titer_close_project` | `project_id?`, `save?: "save" \| "discard"` | `{ project_id, closed: true }`. `save` omitted = refuse to close a dirty project (`{ needs_confirm: true, warning: "unsaved changes" }`); pass `save: "save"` or `save: "discard"` explicitly. Never prompts. Closes the window; the snapshot is dropped. |

### 8.2 Data tables — 9 tools

| Tool | Arguments | Returns |
|---|---|---|
| `titer_create_table` | `project_id?`, `table_type` (`column` \| `xy` \| `grouped` \| `nested` \| `multiple` \| `contingency` \| `survival`), `name?`, `columns?: string[]`, `rows?: (string \| number \| null)[][]` | `{ project_id, table_id, name, table_type, rows, data_columns }`. Without `columns`/`rows` creates the empty table of that type (same as Table ▸ New Table). Column 0 is the row-title column; short rows pad with blanks. |
| `titer_write_table` | `project_id?`, `table_id`, `columns: string[]`, `rows: (string \| number \| null)[][]`, `label?`, `excluded?: string[]` | `{ project_id, table_id, rows, data_columns }`. Whole-data replace via `updateTable` (the agent sends the whole table; cell-level edits are UI granularity). Validates shape against the table type and returns the validation error instead of writing a broken table. `rows` must be non-empty — a write with zero rows is refused (to empty a table use `titer_edit_table` delete-rows; to start an empty table use `titer_create_table` with no columns or rows). Excluded-cell marks (`"row,col"`) are preserved unless the call passes `excluded`, which replaces them. `label` is the Undo label ("Edit Table" when omitted). Destructive. |
| `titer_edit_table` | `project_id?`, `table_id`, `op`, `...op_args` | `{ project_id, table_id, rows, data_columns }`. One tool for the grid-menu ops (`op` enum): `insert-rows { at, count? }`, `delete-rows { at, count? }`, `insert-columns { at, count? }`, `delete-columns { at, count? }`, `rename-column { column, name }`, `rename-group { column, name }`, `exclude-cells { cells: ["row,col", …] }`, `include-cells { cells: [...] }`, `freeze-title { frozen }`, `convert-comma-decimals {}`, `add-calculated-variable { name, formula }`, `set-calculated-variable { name, formula }`, `remove-calculated-variable { name }`. The calculated-variable ops only work on Multiple Variables tables (Prism 11, seq 156): whole-variable formulas (`=Dose * 2`), values recomputed live on every edit and usable in analyses like typed variables. Rows and columns are 0-based; column 0 holds the row titles; `count` defaults to 1. Destructive. |
| `titer_duplicate_table_family` | `project_id?`, `table_id` | `{ project_id, table_id (new), children: { analyses, graphs } }` — table + its analyses/graphs cloned (same as Table ▸ Duplicate Family). The copy opens after the source table. |
| `titer_rename_node` | `project_id?`, `node_id`, `name` | `{ project_id, node_id, name }` — any node type (table/analysis/graph/figure/info). |
| `titer_delete_node` | `project_id?`, `node_id`, `confirm?` | `{ project_id, node_id, deleted: true }` or `{ needs_confirm: true, warning }` (two-step confirm, §5.4). The warning names what goes with it (table with analyses → "analyses kept as orphaned results, graphs deleted"). The last table is refused — a project is never empty. Destructive. |
| `titer_reorder_nodes` | `project_id?`, `parent_id?`, `order: string[]` | `{ project_id, order }`. Reorders the project root (omit `parent_id`) or one table's children (its analyses and graphs). `order` must list exactly the current children. |
| `titer_undo` | `project_id?` | `{ project_id, undone: string \| null, can_redo: boolean }` — `undone` is the named undo label (null when nothing to undo). |
| `titer_redo` | `project_id?` | `{ project_id, redone: string \| null, can_undo: boolean }`. |

Excluded cells are dropped from every analysis, graph and range
(`titer_read_table_summary` already reflects this), and are written
empty by `titer_export_table_data` (§10), matching what analyses see.

### 8.3 Graphs, figures, info sheets — 7 tools

Graphs are built by pure-TS builders from table data + **cached**
analysis results — a graph never computes an analysis itself. If the
linked analysis is not computed, the graph shows it as missing; the
build tool says so in `warnings` (the agent should run it first).
Multi-table graphs are not in scope (the graph node has a single
`parentId`).

| Tool | Arguments | Returns |
|---|---|---|
| `titer_build_graph` | `project_id?`, `table_id`, `graph_type`, `options?`, `name?` | `{ project_id, graph_id, graph_type, warnings? }`. `graph_type` must be offered for the table's type (`GRAPH_OPTIONS_BY_TABLE` — 33 graph types; see below) — otherwise a plain error naming the valid types. `options` is a partial `GraphOptions` over the type's defaults; linked-analysis ids (`regAnalysisId`, `sigAnalysisId`, `demingAnalysisId`, `coxAnalysisId`, `ttestAnalysisId`, `poissonAnalysisId`, `pcaAnalysisId`, `kmeansAnalysisId`, …) must name existing analyses. **Synchronous** (builders are pure TS over table data + cached results). `warnings` says when a linked analysis is not computed yet, and when a `*Constant` hook names a constant that exists in no info sheet. |
| `titer_update_graph` | `project_id?`, `graph_id`, `options` | `{ project_id, graph_id }` — partial `GraphOptions` merged over the graph's current options (titles, axis limits, linked analyses, display choices). Same validation as build. |
| `titer_clone_graph` | `project_id?`, `graph_id`, `options?: { clearY?, clearX?, clearTitles? }` | `{ project_id, graph_id (new) }` — Prism's Clone Graph (same-table clone with changed options; defaults `clearY: true`, the rest false). The new table's id is visible via `titer_list_tables` afterwards. |
| `titer_create_figure` | `project_id?`, `graph_ids?: string[]`, `layout?` | `{ project_id, figure_id, panels }` — a multi-panel layout over the given graphs (default: **all** the project's graphs when omitted — a tool convenience; the UI's New Figure creates an empty figure). `layout` is the figure's grid/title shape: `grid`, `figureSize`, `labelStyle`, `figureTitle`, `sharedLegend`, `dpi` (a `panels` key is rejected here — use `titer_update_figure` to place panels by hand). |
| `titer_update_figure` | `project_id?`, `figure_id`, `layout` | `{ project_id, figure_id, panels }` — `layout` is the figure fields to change: `panels` (`FigurePanel[]`: `graphId`, `label`, `labelManual?`, `title`, `row`, `col`, `rowSpan`, `colSpan`), `grid` (`{ rows, cols }`, cols ≤ 6, rows × cols must fit the panels), `figureSize` (`{ widthIn, heightIn }`, 1–20 in each, aspect within 4:1), `labelStyle` (`{ position: "top-left" \| "top-right" \| "above-panel", fontSizePt, bold }`), `figureTitle` (string), `sharedLegend` (`"none" \| "shared"` — `"shared"` is refused when the panels' series differ), `dpi` (150/300/600/900/1200). |
| `titer_create_info_sheet` | `project_id?`, `linked_table_id?` | `{ project_id, info_sheet_id, name }` — optionally linked to a table, as the UI allows. A new sheet starts with Prism's six default constants, empty. |
| `titer_update_info_sheet` | `project_id?`, `info_sheet_id`, `info` | `{ project_id, info_sheet_id }` — partial `InfoSheetData` (`constants?`/`notes?`/`linkedTableId?`) merged over the current sheet. Constants replace the whole list when given (ids generated when omitted, values coerced from numbers/booleans to strings, duplicate names rejected); caps enforced (500 info sheets, 500 constants per sheet). Constants set here are what graphs hook axes to (`yMinConstant` etc.). |

**Graph types by table type** (`GRAPH_OPTIONS_BY_TABLE`, 33 types):
Column — individual, before-after, box-violin, mean-error,
estimation-plot, histogram, pie, donut, bland-altman, roc-curve,
monte-carlo-histogram. XY — xy-scatter, xy-bar, xy-area, schild-plot,
smooth-curve, logistic-curve, survival, volcano, bland-altman, roc-curve,
monte-carlo-histogram. Grouped — grouped-scatter, grouped-before-after,
grouped-box, grouped-bars, grouped-lines, grouped-stacked,
grouped-hbars, heatmap, volcano. Nested — grouped-bars, grouped-scatter,
grouped-lines. Multiple variables — xy-scatter, bubble-plot, histogram,
heatmap, volcano, forest-plot, observed-fitted, scree-plot, pca-biplot,
kmeans-scatter, survival. Contingency — grouped-bars, grouped-stacked,
grouped-hbars, heatmap. Survival — survival.

**Palette:** `GraphOptions` carries a palette, and the build/update-graph
tools accept it as part of the partial `GraphOptions`: a **string**
resolves against the built-in catalog only (15 palettes: okabe-ito,
tol-bright, tol-muted, tableau-10, grayscale, titer, viridis, cividis,
magma, batlow, coolwarm, fast, vik, vlag, rdbu — plus the `helix` →
`titer` alias; an unknown name errors naming the valid names), or a
**full object** `{ name, kind, colors, reversed? }` (`kind` in
categorical/sequential/diverging, `colors` a non-empty list of
`#RRGGBB` strings). My-palettes (user-saved palettes) are out of scope:
no name lookup against them — they live in localStorage/native prefs,
not in the store the dispatcher can see. A new graph's default palette
still comes from its type's catalog palette, exactly as the UI's
create-graph path does.

## 9. Cloud — 9 tools (Box only, today)

All nine are `open_world_hint: true` (they touch the network by design,
and say so). All return a plain error when no account of that provider
is connected — "Connect Box in Titer → Settings → Connected Storage
first" — they never start a connection themselves. `provider` is a
string today, but only `"box"` is live (`"mock"` is the test provider);
other providers return "not connected". When Dropbox/OneDrive/Drive
land, they take the same nine tools with no new names. No tokens ever
appear in any output. Box BYO credentials are secrets — never tool
arguments. There is no connect/disconnect tool (connect is interactive
OAuth in a browser, up to 5 min; disconnect revokes a sign-in —
human-only in Settings).

| Tool | Arguments | Returns |
|---|---|---|
| `titer_cloud_status` | — | `{ accounts: [{ provider, account_id, login, name }], box_has_credentials: boolean }`. Read-only. Wraps `cloud_status`. |
| `titer_cloud_list` | `provider`, `account_id`, `folder_id?` | `{ entries: [{ id, name, path, kind: "file" \| "folder" }] }`. Read-only. Wraps `cloud_list` (the remote picker). `folder_id` omitted = `"0"` (Box root). |
| `titer_cloud_download` | `provider`, `account_id`, `file_id` | `{ project_id, file_path, format }`. Downloads to the local cache and opens it in a window (same as the UI's remote open; `.hlx` / `.prism` / `.pzfx` remotes keep their format on save). Metadata is read first (name/format), so a non-project file is refused before any bytes move. Only project files open (`.hlx`, `.pzt`, `.prism`, `.pzfx`). Records the remote handle (see below), so a later `titer_cloud_upload` can update the same file. |
| `titer_cloud_upload` | `provider`, `account_id`, `file_id`, `project_id?` | `{ provider, file_id, version }`. Uploads the project's current on-disk bytes to the existing remote file, conditional on the version seen when it was downloaded (or at `upload_new`) — a version mismatch is a Conflict error naming the remote version, **never a silent overwrite**. Refuses a dirty (unsaved) project — save first with `titer_save_project`. The project must have been opened from that remote file with `titer_cloud_download` (or uploaded as new with `titer_cloud_upload_new`); a local project uploaded to an existing remote file is refused (no seen version — see the open item in §11). Destructive. |
| `titer_cloud_upload_new` | `provider`, `account_id`, `folder_id?`, `project_id?`, `name?` | `{ provider, file_id, name, path }`. Uploads the project as a new remote file. Same dirty refusal + on-disk bytes as `titer_cloud_upload`. `name` omitted = the local file's name. Afterwards the project is tied to the new remote file, so `titer_cloud_upload` can update it. |
| `titer_cloud_create_folder` | `provider`, `account_id`, `folder_id?`, `name` | `{ provider, file_id, name, path }`. `folder_id` omitted = root (`"0"`). |
| `titer_cloud_move` | `provider`, `account_id`, `file_id`, `folder_id?` | `{ provider, file_id, path }`. Metadata is read first to learn whether the entry is a file or folder (the tool takes no such arg). `folder_id` omitted = root (`"0"`). |
| `titer_cloud_metadata` | `provider`, `account_id`, `file_id` | `{ provider, file_id, name, path, version, modified? }`. Read-only. |
| `titer_cloud_revisions` | `provider`, `account_id`, `file_id` | `{ revisions: [{ version, modified?, size? }] }`. Read-only. (`size` is omitted — the provider's version record has none.) |

**Seen-version / conflict model (L9).** The version a project was
downloaded (or last uploaded) at lives in `McpState`, per window label
(`remote_handles`: provider, account_id, file_id, name, version) — not
in the snapshot, and not in a shared sidecar file (two windows must not
share one "seen" version). Upload reads it; a successful upload
advances it; window close drops it. The upload's bytes are the
project's on-disk file (`filePath`, or the cache copy when `filePath`
is null, i.e. a Prism-imported remote never saved locally). Before
reading the snapshot's `isDirty`, the upload tools wait up to 600 ms
for a publish that arrives after the call started — the snapshot
publishes on a 500 ms debounce, so an upload issued right after an edit
tool returns would otherwise read a pre-edit snapshot and upload stale
bytes. **Caveat:** `titer_save_project` cannot save a remote project
back to the cloud (no `filePath`), so "save first" for a remote project
means saving locally (Save As) — the upload then reads those on-disk
bytes. For a download-opened `.hlx` window, `filePath` IS the cache
path, so a plain save writes the cache and the upload picks it up.

## 10. Export — 4 tools + Activity log

### 10.1 Export

Rendered **offscreen** (GAP-2): the headless render path builds the
Plotly figure from the node + options (`buildPanelFigure`, the same
builder the figure panels use) and renders it into a detached div —
the graph or figure need not be open on screen. It runs in the project
window's webview (the dispatcher already runs there, so a DOM exists);
no hidden render window is needed. **Bytes never cross the MCP
boundary:** the frontend renders and writes the file itself via the
existing `write_file` command, exactly like the save job; the tools
return only the metadata (path, dimensions, capped). A 1200-DPI graph
is never base64'd through JSON. Export tools await up to 120 s (§5.2).

**Default output paths (L8's decision).** `path` given → used as-is;
the format extension is appended only when the basename has none (same
rule as the GUI's `ensureSaveExtension`); an explicit path overwrites.
`path` omitted → `<project file's folder>/<graph|figure|table name>.<ext>`
when the project has a saved file; otherwise `<Documents>/Titer
Exports/<name>.<ext>` (created if needed). The stem is the node name
sanitized (`/ \ : * ? " < > |` + control chars → `-`, trimmed,
fallback `graph`/`figure`/`table`). A default path that already exists
gets ` (2)`, ` (3)`, … — an agent re-export never silently overwrites
a file it did not name.

**Known delta (documented, not hidden):** the headless render draws the
graph's base chart only — the overlays that need React hooks
(significance brackets, regression / dose-response curves, forest /
scree / PCA / K-means overlays) are not built, exactly as figure panels
behave today. A plain graph with no linked-analysis overlays renders
identically to its on-screen view. The end-pass byte-equality proof
(300 DPI, §11) quantifies this per graph type; overlay graphs are
expected to differ until the shared `buildGraphFigure` follow-up lands.

| Tool | Arguments | Returns |
|---|---|---|
| `titer_export_graph` | `project_id?`, `graph_id`, `format: "png" \| "jpeg" \| "svg" \| "pdf" \| "tiff"`, `dpi?: "150" \| "300" \| "600" \| "900" \| "1200"` (default `"300"`), `path?`, `width_in?`, `height_in?` | `{ project_id, graph_id, format, dpi, path, width_px, height_px, capped?, reason? }`. The graph's size is its saved `GraphOptions.width/height` (96-DPI px, defaults 640×460, limits 150–2400 × 120–1800); `width_in`/`height_in` override it in inches (one alone derives the other from the saved aspect ratio; out-of-limits sizes are a plain error naming the limits). SVG ignores `dpi`; `width_px`/`height_px` for SVG are the 96-DPI layout size. PDF/TIFF are rendered as PNG then encoded (same as the GUI). `capped`/`reason` carry the max-pixels cap message when the export was shrunk — the headless path caps like the figure export does and reports it; it never refuses an over-large raster the way the GUI's graph export does. |
| `titer_export_figure` | `project_id?`, `figure_id`, `format`, `dpi?`, `path?` | `{ project_id, figure_id, format, dpi, path, width_px, height_px, missing?, capped? }` — same shape as graph export; `missing` counts panels whose graph could not be drawn (reported, not hidden). |
| `titer_export_office` | `project_id?`, `graph_id?`, `figure_id?`, `target: "word" \| "powerpoint"`, `dpi?` (default `"300"`), `path?` | `{ project_id, target, path, extension: "docx" \| "pptx" }` (+ the source id, `width_px`/`height_px`, `capped`/`reason`, and `missing` for a figure). Exactly one of `graph_id` / `figure_id`. One image per document (title + centred image), the GUI's one-click Send to Office driven headlessly: the same PNG render at `dpi`, embedded at its physical size. |
| `titer_export_table_data` | `project_id?`, `table_id`, `format?: "csv" \| "xlsx" \| "txt"` (default `"csv"`), `path?` | `{ project_id, table_id, format, path, rows }`. CSV generated from the snapshot (no UI CSV writer exists to reuse); TXT is tab-separated, same grid + quoting; XLSX is a minimal hand-built workbook (JSZip + inline strings, same pattern as the office export). Cells stay text — nothing is coerced to a number, so an ID like "0123" never becomes 123. Excluded cells are written empty, matching what analyses see. Empty cells are omitted from the XLSX (sparse). |

### 10.2 Activity log

Every tool call is appended (JSONL) to
`<app_data_dir>/mcp/activity.log`, one line per call:

```json
{ "ts": 1793412345, "tool": "titer_read_table_summary",
  "args": { "project_id": "project-1", "table_id": "t1", "include_values": false },
  "ok": true }
```

`ts` is Unix epoch seconds. `args` is a summary only — never full table
values, never the token. Server start/stop and token rotation are logged
as `{ "ts": …, "event": "server_started" | "server_stopped" |
"token_regenerated", "detail": { … } }`. The bridge does not write this
log; it only needs to know the server keeps it (and to keep its own
logging free of tokens and table values too). The agent reads its own
trail back with `titer_read_activity` (§6).

Feedback reports (`titer_send_feedback`, §6) are appended the same
way, to `<app_data_dir>/mcp/feedback.jsonl` — one JSON object per line
(`feedback_id`, `ts`, `kind`, `summary`, `details`, `context` with the
app version, OS, failed tool/step if any, the project file name only,
and the last few Activity lines as tool names + ok flags). The dialog
lists them (newest first) via the `mcp_feedback` app command. The file
is the record: the server copy is gated on the user's sharing choice
(`<app_data_dir>/mcp/feedback-consent.json`, `{"sharing": true|false}` —
missing means off), set by the first-run prompt or the Settings toggle
(`mcp_feedback_consent` / `mcp_set_feedback_consent` app commands).
Sharing off → no POST is attempted and the tool answer says so;
sharing on → the entry JSON is POSTed to
`https://feedback.smitpatel.net/api/v1/feedback` (10 s timeout), and a
201 returns the Plane issue URL in the tool answer. A failed POST never
fails the tool call — the local entry is the fallback. The user's
explicit "Send to GitHub" click opens a pre-filled issue in the browser.

### 10.3 Tool-count rollup

| Group | Tools |
|---|---|
| Read / discovery (Phase 1 + L1 + 1.7.4) | 12 |
| Jobs (`titer_read_job`, `titer_list_jobs`, `titer_cancel_job`) | 3 |
| Project / document | 5 |
| Data tables | 9 |
| Analyses (run + rerun + freeze + simulate + method + wand + script) | 7 |
| Graphs / figures / info sheets | 7 |
| Export | 4 |
| Cloud | 9 |
| **Total** | **56** |

Annotations: 18 tools are `read_only_hint: true` (the 12 read tools +
`read_job`/`list_jobs` + the 4 read-only cloud tools); the other 38
are mutating. `destructive_hint: true` on exactly six:
`titer_write_table`, `titer_edit_table`, `titer_delete_node`,
`titer_close_project`, `titer_run_script`, `titer_cloud_upload`.
`open_world_hint: true` on the nine cloud tools plus
`titer_send_feedback` (which POSTs to the feedback server when sharing
is on, §6); everything else is `false`. `idempotent_hint` is per-tool (e.g. `titer_save_project`,
`titer_rename_node`, `titer_reorder_nodes` are idempotent; create/undo/
redo/run tools are not).

The allowlist (§12) groups the 56 tools differently — by what the user
turns on, not by what they do. The two groupings overlap (e.g. the
`destructive` group holds the two tools that delete data or run
scripts); §12 is the
one that decides what a client can see and call.

## 11. Smoke test (Phase 2) + open items

### 11.1 Live smoke — `scripts/smoke-test-mcp-phase2.py`

The Phase 2 smoke runs against the **real server in a running Titer
app** via a terminal CLI client (no Claude Desktop sign-in needed).
It reads endpoint + token from `<app_data>/mcp/discovery.json`, speaks
Streamable HTTP directly (initialize → tools/list → tools/call across
all 56 tools), and prints a PASS/FAIL line per check; exit 0 only if
every check passes. **Prerequisite:** in Titer, Settings → AI
Connections, turn on every group under "What your AI can do" first —
by default the server advertises only the 5 read tools (§12), and this
smoke drives all 56. It drives one deterministic flow on a fresh project
it creates itself (no fixture ids — the ids it needs come from the
tools' own outputs), plus the `tests/testdata/survival.pzfx` public
fixture for the Prism-import step:

1. In Titer: Settings → AI connections → turn on. Note the endpoint.
2. `python3 scripts/smoke-test-mcp-phase2.py <app_data>/mcp/discovery.json [--out-dir <dir>]`
   (default out dir: a fresh temp dir; exports/saves land there).
3. `initialize` (`protocolVersion 2025-11-25`), then
   `notifications/initialized`, then `tools/list` — with every group on,
   expect all 56 tools, nothing else (with only the default groups, §12
   says 5).
4. Create a project → create an XY table → write data → summary with
   values → edit/rename/reorder/undo/redo/duplicate → simulate a
   second table.
5. Run an analysis → poll `titer_read_job` until done → read the
   result via `titer_read_results` → freeze it. List jobs (recovery
   path); cancel an already-done job (reports `done`).
5b. 1.7.4 tools on the same project: `titer_get_analysis_params`
   (`anova` → `posthoc` lists `tukey`; `three-way-anova` carries its
   table gate); `titer_search` (a hit by analysis type, a miss returns
   `[]`); `titer_rerun_analysis` with `await_result: true` on the run
   analysis (fast run returns `done` inline with the result);
   `titer_project_summary` (counts one analysis after the rerun — no
   duplicate node).
6. Build a graph → update it → clone it → figure (create/update/read)
   → info sheet (create/update/read). Apply the wand from one table to
   another; apply a method file (missing-file error path — no fixture
   `.pzm` is shipped); run a comment-only script through the two-step
   confirm (first call `needs_confirm`, then `confirm: true`).
7. Export the graph (PNG 300 DPI), the figure, the table (CSV + XLSX +
   TXT), and the graph to Word — assert the files exist with the right
   magic bytes. Default-path rule is exercised by one export with no
   `path` (beside the project file once saved).
8. Save the project as `.hlx` → reopen it → import `survival.pzfx` →
   close the extra windows (dirty-refusal path first, then `discard`).
9. Cloud: `titer_cloud_status` must succeed; with no account connected
   the other eight tools must fail plainly with the "Connect Box"
   message; with an account connected, `list`/`metadata` must succeed
   on it. (Live Box upload/download is out of the smoke — the mock
   provider covers the conflict path in the suite.)
10. `titer_read_activity` at the end must include the calls just made.
    `titer_send_feedback` is called once with a `missing-feature`
    report (and once with a bad `kind`, which must fail plainly), and
    `<app_data>/mcp/feedback.jsonl` must gain exactly one entry with
    the right shape (`feedback_id`, `kind`, `summary`, `details`,
    `context` with app version + OS, no file path beyond the project
    file name). With sharing off (the default — no consent record) the
    report's answer must be `{ received: true, sent: false, sharing:
    "disabled" }` and no POST may leave the machine; with sharing on
    and the mock endpoint up, the answer must be `{ received: true,
    sent: true, issue_url: "…" }`; with sharing on and the endpoint
    down, the answer must still succeed as `{ received: true, sent:
    false, sharing: "enabled", error: "…" }` with the entry saved
    locally. The project itself must be unchanged by the calls.
11. Delete the duplicate table through the two-step confirm; stop the
    server in Settings: the endpoint refuses connections and the
    discovery file is gone. Start it again: a new run works with no
    config change.

**Byte-equality proof (deferred to the single end pass, not run per
lane):** export the same graph via the GUI and via
`titer_export_graph` at 300 DPI and compare sha256 + dimensions. Plain
graphs (no linked-analysis overlays) must be identical; overlay graphs
are expected to differ until the `buildGraphFigure` follow-up (§10.1).

The in-process Rust smoke (`mcp_smoke_job_plumbing_over_http` in
`src-tauri/src/mcp.rs`) is the other half: with every group enabled via
its fixture allowlist record, it asserts `tools/list` returns exactly
56 tools and drives the job plumbing + project/table/
analysis/cloud/graph/composite/export tools over real HTTP with a
completer task standing in for the frontend dispatcher. A second
in-process smoke (`mcp_smoke_allowlist_default_over_http`) covers §12:
with no allowlist record it asserts `tools/list` returns exactly the 5
default read tools, a disallowed call is rejected with the toggle
message, and enabling the `destructive` group makes the tools appear
for a new session. It does not replace the live smoke above (window-making tools fail plainly
in-process — no Tauri app there — and the live app proves them end to
end).

### 11.2 What the bridge must NOT do

- Never start, stop, or reconfigure the server (no endpoint for that
  exists, by design — those are human actions in Titer's Settings).
- Never add tools, prompts or resources of its own in front of the
  server: the bridge is a transport, not a server. It forwards stdio ↔
  Streamable HTTP and nothing else. It forwards whatever tools the
  server lists — the 56 Phase 2 + 1.7.4 tools appear automatically via
  `tools/list`; no bridge change was needed for Phase 2.
- Never widen the bind (no `0.0.0.0`, no port forwarding, no tunnel).
- Never log the token or table values.
- Never retry a 401 with a different token, and never fall back to an
  unauthenticated request.
- Never treat cell values, file names or imported text as commands
  (§5.5).

### 11.3 Open items (not decided by this contract)

1. **No MCP run path for method/wand-created analyses — CLOSED in
   1.7.4.** Method/wand create analysis *nodes* (params, not runs).
   `titer_rerun_analysis` (new in 1.7.4) runs an existing analysis
   node — including a method/wand-created one — with optional param
   overrides, in the same async job shape as `titer_run_analysis`.
   `titer_run_analysis` still always creates a NEW node; the two tools
   are the create-path and the re-run-path respectively.
2. **Refused local-to-existing-remote upload.** `titer_cloud_upload`
   for a *local* project to an *existing* remote file is refused (no
   seen version to condition on). Enabling it needs an explicit
   `expected_version` argument (not in the inventory) or a
   metadata-based version — a coordinator decision, not a silent
   behaviour change.

### 11.4 Not in Phase 2 (do not build the bridge to expect them)

- Per-app integrations (one-click connect, deep links, Antigravity
  plugin listing, Marketplace submission) — later release.
- Hosted / remote MCP server — local-only (`stdio` + `127.0.0.1`) is
  the rule for v1.6.0.
- Save As Template / Example / Method (`.pzt` / `.pzm` creation),
  Find, copy-image, cut/copy/paste — UI-only or deferred.
- Settings tools (theme, palettes, recents, layout) and the server
  safety settings (enable/token) — human-only by design (D4).
- The `.mcpb` bundle *contents* are the bridge lane's, but the bundle
  points at this contract: stdio → bridge binary → §2 discovery →
  §1 endpoint with §3 auth.

## 12. Allowlist — which tools the server advertises (v1.7.4)

The audit (Nov 2026) proved the 5-tool `enabledTools` in Antigravity's
config was advisory only: the bridge is a byte-forwarder that never
reads it (by design, §11.2), the server advertised all 52 tools, and
Antigravity 2.33.0 enabled all of them — including the six destructive
tools and `titer_run_script`. The only gate was Antigravity's Ask-mode
approval. The allowlist makes the 5-tool list real, server-side.

### 12.1 Default set

By default only the five Phase 1 read tools are advertised or callable
— the same five as Antigravity's `enabledTools` and the one-click
"Connect to Antigravity" entry:

`titer_list_projects`, `titer_list_tables`, `titer_read_table_summary`,
`titer_read_results`, `titer_read_graph`.

Everything else is hidden until the user turns its group on.

### 12.2 Groups

Nine toggles in Settings → AI Connections ("What your AI can do"),
one per group. Every tool belongs to exactly one group (pinned by the
`allowlist_groups_cover_all_tools_once` unit test — a lane that adds a
tool must assign it a group, or the suite fails).

| Group | Tools | On by default |
|---|---|---|
| Read project data (`read`) | `titer_list_projects`, `titer_list_tables`, `titer_read_table_summary`, `titer_read_results`, `titer_read_graph` | yes |
| Read more (`read_more`) | `titer_read_figure`, `titer_read_info_sheet`, `titer_read_activity`, `titer_send_feedback` | no |
| Discover projects and params (`discovery`) | `titer_project_summary`, `titer_search`, `titer_get_analysis_params` | no |
| Open and save projects (`project`) | `titer_create_project`, `titer_open_project`, `titer_save_project`, `titer_close_project`, `titer_import_prism` | no |
| Edit tables (`tables`) | `titer_create_table`, `titer_write_table`, `titer_edit_table`, `titer_duplicate_table_family`, `titer_rename_node`, `titer_reorder_nodes`, `titer_undo`, `titer_redo` | no |
| Run analyses (`analyses`) | `titer_run_analysis`, `titer_rerun_analysis`, `titer_freeze_analysis`, `titer_simulate_data`, `titer_apply_method`, `titer_apply_wand`, `titer_read_job`, `titer_list_jobs`, `titer_cancel_job` | no |
| Build graphs and figures (`graphs`) | `titer_build_graph`, `titer_update_graph`, `titer_clone_graph`, `titer_create_figure`, `titer_update_figure`, `titer_create_info_sheet`, `titer_update_info_sheet` | no |
| Export (`export`) | `titer_export_graph`, `titer_export_figure`, `titer_export_office`, `titer_export_table_data` | no |
| Cloud (Box) (`cloud`) | `titer_cloud_status`, `titer_cloud_list`, `titer_cloud_metadata`, `titer_cloud_revisions`, `titer_cloud_download`, `titer_cloud_upload`, `titer_cloud_upload_new`, `titer_cloud_create_folder`, `titer_cloud_move` | no |
| Destructive actions (`destructive`) | `titer_delete_node`, `titer_run_script` | no |

The `destructive` group holds exactly the two tools that delete data
or run arbitrary scripts. Table writes and edits live in `tables`,
closing in `project`, cloud overwrites in `cloud` — each toggle grants
only its own area. (The six `destructive_hint` tools in §10.3 are the
annotation, not the group: four of them sit in the area group above.)
The job tools live in `analyses` because `titer_run_analysis` is the
only tool that creates pollable jobs; the cloud reads live in `cloud`
with the rest of Box, not in `read_more`.

### 12.3 Enforcement points (defense in depth)

1. **`tools/list` advertises only the allowed tools.** A client that
   lists tools sees exactly the enabled groups' tools, nothing else.
2. **A call to a disallowed tool is rejected server-side**, before the
   tool runs, with a tool-level error (`isError: true`) naming the tool
   and the group that gates it, and pointing at Settings → AI
   Connections. A client must not be able to call a tool that isn't
   listed. The rejection is written to the Activity log like any failed
   call. An unknown tool name (not a real tool at all) still answers
   "tool not found" — the allowlist message is only for real tools that
   are off.

### 12.4 Persistence and pickup

The choice is persisted as `<app_data>/mcp/mcp-allowlist.json`
(`{"groups": ["read", "analyses"], "ts": …}`, owner-only 0600, same
directory and shape as the opt-in and feedback-consent records).
Missing, unreadable, or malformed reads as the default (only `read`);
unknown group ids are dropped; an explicit empty list means nothing is
advertised. The server reads the record once per MCP session, so a
toggle change applies when the AI app reconnects — an already-connected
session keeps the allowlist it started with. Toggling the server off
and on re-reads it too.

No MCP tool can read or change the allowlist: the two Tauri commands
(`mcp_allowlist`, `mcp_set_allowlist`) are app commands, not tools —
the same human-only boundary as enable/token (D4).

### 12.5 What did NOT change

- The stdio bridge is untouched: it stays a byte-forwarder (§11.2)
  and naturally advertises only what the server advertises.
- Antigravity's `mcp_config.json` is untouched: it keeps its 5-tool
  `enabledTools`. The server-side allowlist now makes that list real
  instead of advisory; the config file format does not change.
- The server still *has* 56 tools. The allowlist decides which subset
  a given client sees — it does not remove tools from the server.
