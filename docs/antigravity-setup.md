# Titer + Antigravity (Gemini) — one-click setup

Written for Titer **1.8.0** (the one-click flow itself is since 1.7.3).
One click, no token to copy. Everything here is local: Antigravity talks
to Titer on your own machine over loopback only — your data never leaves
your computer.

Source of truth for the behaviour below is the code:
`src-tauri/src/mcp.rs` (`mcp_connect_antigravity`, the allowlist in
`ALLOWLIST_GROUPS`, contract §12) and `src/lib/ai-prompt.ts`
(the starter prompt). The server contract is
`docs/mcp-server-contract.md`; the stdio bridge is
`docs/stdio-bridge.md`; the plugin path and both transports in depth are
in `docs/antigravity.md`.

## Step 1 — Connect from Titer (one click)

1. Open Titer.
2. Press Cmd+, (Settings) → **AI Connections** → **"Connect to Antigravity"** → **Connect**.
   - The consent panel says what happens: Titer adds itself to
     Antigravity's MCP config (`~/.gemini/config/mcp_config.json`),
     nothing else in that file changes, and you can remove it anytime
     from Antigravity's Installed MCP Servers.
   - It also turns on **"Allow AI apps to connect"** if it isn't already
     — and since 1.7.3 that stays on across restarts (no more re-flipping
     the toggle every launch).

That's it for Titer. No endpoint, no token, nothing to paste.

What the click actually writes: a stdio `titer` entry pointing at the
`titer-stdio-bridge` binary shipped next to Titer — the bridge reads the
endpoint and token from Titer's own files at runtime, so **no token ever
appears in the config**. Only the `titer` key changes, and the previous
config is kept next to it as `mcp_config.json.titer-bak`. After
connecting, Titer offers an **Open Antigravity** button.

## Step 2 — See it in Antigravity

- Open Antigravity (or, if it's already open, click **Refresh** under
  **Installed MCP Servers**). `titer` shows up with **5 tools**.
- Ask Gemini to work with Titer, e.g. **"List my Titer projects"**.

The 5 are the read group — the default. The server has 56 tools in
total, but since the allowlist landed it only advertises the groups you
have turned on (in 1.7.3 it advertised all 52 — that count is out of
date; see the version note below).

## More tools — turn on groups

By default your AI can only read your project. Each group below unlocks
more tools. The server advertises only what is on, and refuses the rest
— a refused tool names the group to turn on instead of working around
it. A change applies the next time your AI app connects.

| Group (Settings → AI Connections) | Tools | What it unlocks |
|---|---|---|
| Read project data (on by default) | 5 | List projects and tables; read summaries, results and graphs |
| Read more | 4 | Figures, info sheets, the activity log, job status and feedback |
| Discover projects and params | 3 | Project summaries, search, an analysis type's valid params |
| Open and save projects | 5 | Create, open, save, close and import projects |
| Edit tables | 8 | Create, write, edit, duplicate, rename and reorder tables; undo and redo |
| Run analyses | 9 | Run and re-run analyses, simulate data, methods and the wand; job status |
| Build graphs and figures | 7 | Build, update and clone graphs; make figures and info sheets |
| Export | 4 | Export graphs, figures and tables to files |
| Cloud (Box) | 9 | List, download and upload files in connected Box storage |
| Destructive actions | 2 | Delete nodes and run scripts |

Two groups worth knowing about: **"Read more"** is what lets Gemini
report a problem with `titer_send_feedback` (see Step 3), and
**"Destructive actions"** is the only group that can delete anything or
run a script — leave it off unless you mean it.

## Step 3 — Tell Gemini the ground rules

In the same AI Connections dialog, under **"What to tell your AI — paste
into Gemini (or any AI app)"**, there is an AI starter prompt with a copy
button. Paste it into Gemini. In short, it tells Gemini:

- Work on the project already open in Titer unless you say otherwise.
- Never invent a result — if a result says `not_computed`, the analysis hasn't run yet.
- Ask before anything destructive: overwriting data, deleting a node, closing with unsaved changes, saving over a file.
- Save only when you ask — nothing is saved until `titer_save_project` runs.
- Everything is local: data never leaves this Mac.
- If something is missing or broken, report it with `titer_send_feedback` instead of working around it silently.
- Only the tool groups enabled in Settings → AI Connections are available — by default just the five read tools. If a tool answers that it isn't enabled, Gemini should say which group to turn on instead of working around it.

**The dialog is the source of truth for the prompt** — copy it from
there rather than from an old copy of this doc. The prompt text itself
lives in `src/lib/ai-prompt.ts` (`AI_STARTER_PROMPT`) and is deliberately
not duplicated here, so the two can never drift apart.

## Manual setup (fallback only)

Only if the one-click flow isn't available (e.g. an older Titer). In
Titer, turn on **"Allow AI apps to connect"** in Settings → AI
Connections and copy the endpoint and token the panel shows — the dialog
also shows the ready-to-paste Antigravity block. Then add this to the
**global** config file `~/.gemini/config/mcp_config.json`, replacing the
token — use the global file, not a project's `.agents/mcp_config.json`,
since the token is a live secret and must never be committed to a repo:

```json
{
  "mcpServers": {
    "titer": {
      "serverUrl": "http://127.0.0.1:18741/mcp",
      "headers": {
        "Authorization": "Bearer PASTE_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Then restart Antigravity (or open the MCP manager with `/mcp` and enable `titer`).

- If port 18741 is busy, Titer tries 18742–18750. Always use the exact endpoint the panel shows.
- CLI alternative: `agy mcp add titer --type http --header "Authorization: Bearer <token>" http://127.0.0.1:18741/mcp`
- Claude Code equivalent (also shown in the Titer panel): `claude mcp add --transport http --scope user titer <endpoint> --header "Authorization: Bearer <token>"`

## Troubleshooting

- **401 / unauthorized:** the token is wrong, or MCP is off in Titer. Check "Allow AI apps to connect" in Settings → AI Connections (since 1.7.3 it stays on once flipped). If you regenerated the token, re-copy it (manual path only — the one-click stdio entry never holds a token).
- **Connection refused:** Titer isn't running, or it's on a different port. Check the endpoint in the AI Connections panel.
- **Tools don't show up in Antigravity:** restart Antigravity after connecting, or click Refresh under Installed MCP Servers, then check `/mcp` — `titer` should be listed and enabled.
- **A tool answers that it isn't enabled:** turn on the group it names in Settings → AI Connections, then reconnect your AI app. By default only the five read tools are on.
- **A long analysis seems stuck:** it runs as a job. Ask Gemini to poll `titer_read_job` instead of starting it again.
- **A result says `not_computed`:** the analysis hasn't been run in this Titer session. Run it in Titer (or ask Gemini to run it, with the Run analyses group on) — the agent must not invent a result.

## Version note

- **1.7.3:** the one-click flow landed; the server advertised all 52 tools and Antigravity enabled all of them, including destructive ones. Any doc that says "52 tools" describes 1.7.3.
- **1.8.0:** the server-side allowlist is enforced — `tools/list` advertises only the enabled groups (5 read tools by default), and `tools/call` refuses the rest by name. The server now has 56 tools in total. The one-click entry itself still allowlists exactly the five read tools.
