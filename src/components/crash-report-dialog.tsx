// Crash-report dialog (seq 453, 2.0 launch): the crash-on-startup
// path, on seq 452's error log. The log path lives only in the shell
// (`<app_data>/mcp/error-log.jsonl`); the dialog reads it through
// `mcp_error_log` (newest first) and sends through `mcp_flush_error_log`.
//
// The signal is unsent entries (`sent: false`) from a previous run —
// NOT proof of a crash: sharing off or a failed send leaves the same
// trace, so the copy says so plainly. main.tsx already flushes at
// startup when sharing is on, so with sharing on this dialog normally
// never opens (only a backlog past the flush batch, or a failed send,
// reaches it). The dialog awaits that shared startup flush before
// reading the log — otherwise it pops up spuriously while the flush's
// POSTs are still in flight. With sharing off, Send flushes nothing —
// the dialog says so and offers to turn sharing on, an explicit opt-in,
// then flushes again. A flush that sends nothing because every entry
// was a duplicate says so, instead of claiming the send failed.
//
// Don't send leaves the entries unsent, so the offer reappears on the
// next launch — there is no dismissed-ids record to remember the
// choice (known limitation; a 452 follow-up could add one).
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/controls";
import {
  isNative,
  mcpErrorLog,
  mcpErrorLogConsent,
  mcpFlushErrorLog,
  mcpSetErrorLogConsent,
} from "../native";
import { awaitStartupErrorFlush } from "../lib/error-log";

export function CrashReportDialog() {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [sharing, setSharing] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState<number | null>(null);
  const [duplicates, setDuplicates] = React.useState(0);
  const [failed, setFailed] = React.useState(0);
  const [sharingOff, setSharingOff] = React.useState(false);

  // Ask once on mount: unsent entries are the offer. Await the shared
  // startup flush first — it is still in flight when this mounts, and
  // reading before it settles pops the dialog up over entries it was
  // about to send. What remains after it is the backlog / failed-send
  // / sharing-off remainder.
  React.useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      try {
        await awaitStartupErrorFlush();
        const [entries, consent] = await Promise.all([mcpErrorLog(), mcpErrorLogConsent()]);
        const unsent = entries.filter((e) => !e.sent).length;
        if (!cancelled && unsent > 0) {
          setPending(unsent);
          setSharing(consent);
          setOpen(true);
        }
      } catch {
        // No answer — leave the offer for the next launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await mcpFlushErrorLog();
      if (out.sharing === "disabled") {
        setSharingOff(true);
      } else {
        setSent(out.sent);
        setDuplicates(out.duplicates);
        setFailed(out.failed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enableSharingAndSend = async () => {
    setBusy(true);
    setError("");
    try {
      await mcpSetErrorLogConsent(true);
      setSharing(true);
      setSharingOff(false);
      const out = await mcpFlushErrorLog();
      setSent(out.sent);
      setDuplicates(out.duplicates);
      setFailed(out.failed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="Unsent error reports from a previous run"
      description={`Titer found ${pending} unsent error report${pending === 1 ? "" : "s"} from a previous run. Send them to help fix it?`}
      start={
        <Button disabled={busy} onClick={dismiss}>
          Don&apos;t send
        </Button>
      }
      footer={
        sent === null ? (
          <Button variant="accent" disabled={busy} onClick={() => void send()}>
            Send reports
          </Button>
        ) : (
          <Button onClick={() => setOpen(false)}>Close</Button>
        )
      }
    >
      <div className="flex flex-col gap-2">
        {sent === null ? (
          <>
            <p className="text-regular text-primary">
              Only the error reports are sent — error type, message, and a scrubbed stack. No file names with your
              username, no file contents, no user data.
            </p>
            <p className="text-regular text-secondary">
              These may be from a crash — or from a run where error sharing was off or a send failed. Titer can&apos;t
              tell which. The reports are saved on this Mac either way.
            </p>
            {sharing === false && !sharingOff && (
              <p className="text-regular text-secondary">
                Error sharing is currently off, so these reports were not sent automatically. Sending will ask you to
                turn sharing on first.
              </p>
            )}
            {sharingOff && (
              <>
                <p className="text-regular text-primary">
                  Error sharing is off, so nothing was sent yet. Turn it on to send these reports — future error
                  reports will be shared too, until you turn it off in Settings → AI Connections.
                </p>
                <Button disabled={busy} onClick={() => void enableSharingAndSend()}>
                  Turn on sharing &amp; send
                </Button>
              </>
            )}
          </>
        ) : (
          <p className="text-regular text-primary">
            {sent > 0
              ? `Sent ${sent} report${sent === 1 ? "" : "s"} — thank you. The reports are with the Titer team.`
              : failed > 0
                ? "The reports couldn't be sent, but they are saved on this Mac — you can send them later from Settings → AI Connections."
                : duplicates > 0
                  ? "These reports match ones already sent to the Titer team, so there's nothing new to send."
                  : "There's nothing left to send — these reports are already with the Titer team."}
          </p>
        )}
        {error && <p className="text-regular text-red-600">{error}</p>}
      </div>
    </Dialog>
  );
}
