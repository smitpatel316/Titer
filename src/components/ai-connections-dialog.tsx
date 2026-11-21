// Settings → AI connections (v3 Phase 1): the switch that starts the
// in-process MCP server, the local token, the one Claude Code command, and
// the Activity log. The server is off by default and only ever starts
// from here — an agent cannot change any of this (roadmap §3).
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button, Input, Switch } from "../ui/controls";
import {
  isNative,
  mcpActivity,
  mcpAllowlist,
  mcpClaudeCodeCommand,
  mcpConnectAntigravity,
  mcpFeedback,
  mcpFeedbackConsent,
  mcpOpenAntigravity,
  mcpRegenerateToken,
  mcpSetAllowlist,
  mcpSetEnabled,
  mcpSetFeedbackConsent,
  mcpStatus,
  mcpToken,
  openGithubIssue,
  type FeedbackEntry,
  type McpAllowlistGroup,
  type McpStatus,
} from "../native";
import { useProjectStore } from "../store/use-project-store";
import { AI_STARTER_PROMPT, buildAntigravityConfig } from "../lib/ai-prompt";

/** One Activity-log line, read for a person: "14:02 titer_read_tables ✓". */
function activityLine(line: string): string {
  try {
    const entry = JSON.parse(line) as { ts?: number; tool?: string; event?: string; ok?: boolean };
    const time = entry.ts ? new Date(entry.ts * 1000).toLocaleTimeString() : "";
    const what = entry.tool ?? entry.event ?? "?";
    const mark = entry.ok === undefined ? "" : entry.ok ? " ✓" : " ✗";
    return `${time} ${what}${mark}`;
  } catch {
    return line.slice(0, 200);
  }
}

/** A labelled block of the dialog, full-width (unlike Field, whose children
 *  sit in a 160 px box for small controls). */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-regular text-primary">{label}</p>
      {children}
    </div>
  );
}

/** The context lines of a feedback entry, as plain text (kind first). */
function feedbackIssueBody(entry: FeedbackEntry): string {
  const meta = [
    `Kind: ${entry.kind}`,
    entry.context.app_version
      ? `App: Titer ${entry.context.app_version} on ${entry.context.os ?? "unknown OS"}`
      : null,
    entry.context.project_file ? `Project file: ${entry.context.project_file}` : null,
    entry.context.failed_tool ? `Failed tool/step: ${entry.context.failed_tool}` : null,
    entry.context.recent_activity?.length
      ? `Recent activity: ${entry.context.recent_activity
          .map((a) => `${a.tool}${a.ok === undefined ? "" : a.ok ? " ✓" : " ✗"}`)
          .join(", ")}`
      : null,
  ].filter((l): l is string => l !== null);
  return [...meta, "", "Details:", entry.details].join("\n");
}

/** The whole entry as plain text, for Copy. */
function feedbackText(entry: FeedbackEntry): string {
  return `[${entry.kind}] ${entry.summary}\n${new Date(entry.ts * 1000).toLocaleString()}\n\n${feedbackIssueBody(entry)}`;
}

/** The pre-filled GitHub issue URL for one entry. The user reviews and
 *  submits it in the browser — nothing is sent from here. */
function feedbackIssueUrl(entry: FeedbackEntry): string {
  const title = `[feedback] ${entry.summary}`;
  return `https://github.com/smitpatel316/Titer/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(feedbackIssueBody(entry))}`;
}

export function AiConnectionsDialog() {
  const { selector, closeSelector } = useProjectStore();
  const open = selector?.kind === "ai-connections";
  const [status, setStatus] = React.useState<McpStatus | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [showToken, setShowToken] = React.useState(false);
  const [command, setCommand] = React.useState<string | null>(null);
  const [activity, setActivity] = React.useState<string[]>([]);
  const [feedback, setFeedback] = React.useState<FeedbackEntry[]>([]);
  const [feedbackSharing, setFeedbackSharing] = React.useState<boolean | null>(null);
  const [allowlist, setAllowlist] = React.useState<McpAllowlistGroup[] | null>(null);
  const [copiedFeedback, setCopiedFeedback] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState<"token" | "command" | "antigravity" | "prompt" | null>(null);
  const [confirmRegen, setConfirmRegen] = React.useState(false);
  const [antigravityConsent, setAntigravityConsent] = React.useState(false);
  const [antigravityMessage, setAntigravityMessage] = React.useState("");

  // Live Antigravity config (endpoint + token filled in, no placeholders);
  // null unless the server is running with a known endpoint and token.
  const antigravityConfig =
    status?.running && status.endpoint && token ? buildAntigravityConfig(status.endpoint, token) : null;

  const refresh = React.useCallback(async () => {
    if (!isNative) return;
    try {
      const next = await mcpStatus();
      setStatus(next);
      setError("");
      if (next.has_token) setToken(await mcpToken());
      setCommand(next.running ? await mcpClaudeCodeCommand() : null);
      setActivity(await mcpActivity(10));
      setFeedback(await mcpFeedback());
      setFeedbackSharing(await mcpFeedbackConsent());
      setAllowlist(await mcpAllowlist());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setShowToken(false);
    setConfirmRegen(false);
    setCopied(null);
    setCopiedFeedback(null);
    setAntigravityConsent(false);
    setAntigravityMessage("");
    void refresh();
  }, [open, refresh]);

  const copy = async (what: "token" | "command" | "antigravity" | "prompt", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  };

  const copyFeedback = async (entry: FeedbackEntry) => {
    await navigator.clipboard.writeText(feedbackText(entry));
    setCopiedFeedback(entry.feedback_id);
    setTimeout(() => setCopiedFeedback((c) => (c === entry.feedback_id ? null : c)), 2000);
  };

  const sendFeedbackToGithub = async (entry: FeedbackEntry) => {
    try {
      await openGithubIssue(feedbackIssueUrl(entry));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await mcpSetEnabled(enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** The feedback-sharing choice (first-run prompt, or this toggle): what
   *  `titer_send_feedback` does with a report once it is saved locally. */
  const toggleSharing = async (sharing: boolean) => {
    setBusy(true);
    try {
      setFeedbackSharing(await mcpSetFeedbackConsent(sharing));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** One allowlist group toggle: what the AI may do beyond reading.
   *  The server reads the choice when an AI app connects, so a change
   *  applies on reconnect — no restart needed. */
  const toggleAllowlistGroup = async (id: string, enabled: boolean) => {
    if (!allowlist) return;
    setBusy(true);
    try {
      const groups = enabled
        ? [...new Set([...allowlist.filter((g) => g.enabled).map((g) => g.id), id])]
        : allowlist.filter((g) => g.enabled && g.id !== id).map((g) => g.id);
      setAllowlist(await mcpSetAllowlist(groups));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!confirmRegen) {
      setConfirmRegen(true);
      setTimeout(() => setConfirmRegen(false), 4000);
      return;
    }
    setConfirmRegen(false);
    setBusy(true);
    try {
      setToken(await mcpRegenerateToken());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** One-click Antigravity setup, after the consent panel: turns the server
   *  on (persisted opt-in) and writes the stdio `titer` entry into
   *  Antigravity's config — no token anywhere. */
  const connectAntigravity = async () => {
    setBusy(true);
    try {
      const result = await mcpConnectAntigravity();
      setAntigravityConsent(false);
      setAntigravityMessage(
        result.outcome === "already_connected"
          ? "Already connected — Titer is already in Antigravity's MCP config."
          : "Connected — open Antigravity and click Refresh under Installed MCP Servers.",
      );
      setError("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openAntigravity = async () => {
    try {
      await mcpOpenAntigravity();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      dismissLabel="Done"
      title="AI Connections"
      description="Let an AI app you already use (Claude Code, Claude Desktop, Antigravity / Gemini, …) work with what's open in Titer — through a local server only. By default it can only read your project; the groups below decide what else it may do."
    >
      {!isNative ? (
        <p className="text-regular text-secondary">
          AI connections need the Titer app — this is the web preview, which has no local server.
        </p>
      ) : (
        <>
          <Section label="Allow AI apps to connect">
            <div className="flex items-center gap-3">
              <Switch
                checked={status?.enabled ?? false}
                disabled={busy || status === null}
                onChange={(v) => void toggle(v)}
              />
              <span className="text-regular text-secondary">
                {status === null
                  ? "Checking…"
                  : status.running
                    ? `On — listening on ${status.endpoint}`
                    : "Off — no AI app can reach Titer."}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setAntigravityMessage("");
                    setAntigravityConsent(true);
                  }}
                >
                  Connect to Antigravity
                </Button>
              </div>
              <p className="text-small text-secondary">
                One-click setup for Antigravity (Gemini) — no token to copy: Titer adds itself to
                Antigravity&apos;s MCP config, and turns “Allow AI apps to connect” on if it isn&apos;t
                already.
              </p>
              {antigravityConsent && (
                <div className="flex flex-col gap-2 rounded-md bg-control p-3">
                  <p className="text-regular text-primary">
                    Titer will add itself to Antigravity&apos;s MCP config
                    (~/.gemini/config/mcp_config.json). Nothing else in that file changes. You can remove it
                    anytime from Antigravity&apos;s Installed MCP Servers.
                  </p>
                  <p className="text-small text-secondary">
                    This also turns on “Allow AI apps to connect” above, so the local server keeps running
                    after restarts.
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => void connectAntigravity()}>
                      Connect
                    </Button>
                    <Button disabled={busy} onClick={() => setAntigravityConsent(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {antigravityMessage && (
                <div className="flex flex-col gap-2">
                  <p className="text-regular text-primary">{antigravityMessage}</p>
                  <div className="flex gap-2">
                    <Button onClick={() => void openAntigravity()}>Open Antigravity</Button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section label="What your AI can do">
            <p className="text-small text-secondary">
              By default your AI can only read your project. Each group below unlocks more tools —
              the server advertises only what is on, and refuses the rest. A change applies the
              next time your AI app connects.
            </p>
            {allowlist === null ? (
              <p className="text-regular text-secondary">Checking…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {allowlist.map((group) => (
                  <div key={group.id} className="flex items-start gap-3">
                    <Switch
                      checked={group.enabled}
                      disabled={busy}
                      onChange={(v) => void toggleAllowlistGroup(group.id, v)}
                    />
                    <span className="text-regular text-secondary">
                      <span className="text-primary">{group.label}</span> — {group.description}{" "}
                      <span className="text-small">({group.tools.length} tools)</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {status?.enabled && token && (
            <Section label="Local token (keep it private — it lets an app on this Mac read and change your open projects)">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={showToken ? token : "•".repeat(12)}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 font-mono"
                />
                <Button onClick={() => setShowToken((s) => !s)}>{showToken ? "Hide" : "Show"}</Button>
                <Button onClick={() => void copy("token", token)}>{copied === "token" ? "Copied" : "Copy"}</Button>
              </div>
              <div className="mt-2">
                <Button disabled={busy || status.running} onClick={() => void regenerate()}>
                  {confirmRegen ? "Click again to confirm" : "Regenerate token"}
                </Button>
                {status.running && (
                  <p className="mt-1 text-small text-secondary">
                    Stop the server first, then regenerate — clients must re-pair after a rotation.
                  </p>
                )}
              </div>
            </Section>
          )}

          {status?.running && command && (
            <Section label="Claude Code — run once in a terminal">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={command}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 font-mono"
                />
                <Button onClick={() => void copy("command", command)}>
                  {copied === "command" ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-1 text-small text-secondary">
                New Claude Code sessions will see the Titer tools — check with /mcp. Claude Desktop connects through the
                stdio bridge, which ships with Titer.
              </p>
            </Section>
          )}

          {antigravityConfig && (
            <Section label="Antigravity (Gemini) — paste into `~/.gemini/config/mcp_config.json`">
              <pre className="max-h-64 overflow-auto rounded-md bg-control p-3 text-small whitespace-pre-wrap">
                {antigravityConfig}
              </pre>
              <div className="flex gap-2">
                <Button onClick={() => void copy("antigravity", antigravityConfig)}>
                  {copied === "antigravity" ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-1 text-small text-secondary">
                Use the global file, never a repo&apos;s `.agents/mcp_config.json` — the token is a live secret and must
                never be committed to a repo. Restart Antigravity (or open the MCP manager with `/mcp`) after editing.
              </p>
            </Section>
          )}

          <Section label="What to tell your AI — paste into Gemini (or any AI app)">
            <pre className="max-h-64 overflow-auto rounded-md bg-control p-3 text-small whitespace-pre-wrap">
              {AI_STARTER_PROMPT}
            </pre>
            <div className="flex gap-2">
              <Button onClick={() => void copy("prompt", AI_STARTER_PROMPT)}>
                {copied === "prompt" ? "Copied" : "Copy"}
              </Button>
            </div>
          </Section>

          <Section label="Recent agent activity">
            {activity.length === 0 ? (
              <p className="text-regular text-secondary">No agent activity yet.</p>
            ) : (
              <div className="flex flex-col gap-1 font-mono text-small">
                {activity.map((line, i) => (
                  <p key={i}>{activityLine(line)}</p>
                ))}
              </div>
            )}
          </Section>

          <Section label="Feedback from your AI">
            <div className="flex items-center gap-3">
              <Switch checked={feedbackSharing ?? false} disabled={busy} onChange={(v) => void toggleSharing(v)} />
              <span className="text-regular text-secondary">
                {feedbackSharing === null
                  ? "Not asked yet — reports stay on this Mac until you choose."
                  : feedbackSharing
                    ? "On — reports your AI sends are also sent to the Titer team."
                    : "Off — reports stay on this Mac only."}
              </span>
            </div>
            <p className="text-small text-secondary">
              Only the feedback text is ever shared — no project data, no file contents, no personal information.
            </p>
            {feedback.length === 0 ? (
              <p className="text-regular text-secondary">
                No feedback yet — your AI can report a missing feature or a bug with titer_send_feedback, and it will
                show up here for you to review.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {feedback.map((entry) => (
                  <div key={entry.feedback_id} className="flex flex-col gap-1">
                    <p className="text-regular text-primary">
                      [{entry.kind}] {entry.summary} — {new Date(entry.ts * 1000).toLocaleString()}
                    </p>
                    <p className="text-small text-secondary">{entry.details}</p>
                    <div className="flex gap-2">
                      <Button onClick={() => void copyFeedback(entry)}>
                        {copiedFeedback === entry.feedback_id ? "Copied" : "Copy"}
                      </Button>
                      <Button onClick={() => void sendFeedbackToGithub(entry)}>Send to GitHub</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-small text-secondary">
              Reports are always saved on this Mac first. With sharing on, a report is also sent to the Titer team
              when your AI sends one; with sharing off, nothing leaves this Mac — use “Send to GitHub” to share one
              yourself, which opens a pre-filled issue in your browser for you to review and submit.
            </p>
          </Section>

          <p className="text-small text-secondary">
            Local only: the server binds 127.0.0.1, needs the token above, and never sends data anywhere — except
            feedback reports, and only when you turn sharing on above. By default your AI can only read your
            project (6 read tools). The groups above unlock more — up to 58 tools, 19 read-only and 39 that
            change your project: run an analysis, build a graph, export, save or delete. Only switch groups on
            for an app you trust. It cannot change these settings.
          </p>

          {error && <p className="text-regular text-red-600">{error}</p>}
        </>
      )}
    </Dialog>
  );
}
