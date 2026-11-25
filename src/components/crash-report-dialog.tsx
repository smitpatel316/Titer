// Crash-report dialog (seq 453, 2.0 launch): the crash-on-startup
// path, tied to the anonymous-logging lane (seq 452). On launch the
// shell knows whether the previous run exited cleanly (the
// clean-shutdown marker); this dialog asks the shell once on mount, and
// opens ONLY when a report is pending — unsent errors in the log after
// an unclean shutdown. A clean exit, or a crash with nothing captured,
// never shows it.
//
// Send posts the scrubbed log as one feedback entry (the Send click is
// the consent moment); Don't send dismisses it and leaves the log as it
// is. Either way the offer does not reappear this run.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/controls";
import { isNative, mcpCrashReportPending, mcpDismissCrashReport, mcpSendCrashReport } from "../native";

export function CrashReportDialog() {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState<boolean | null>(null);

  // Ask once on mount: the shell's pending count already encodes both
  // halves (unclean shutdown AND unsent errors), so the dialog only
  // opens when a report is genuinely pending.
  React.useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      try {
        const count = await mcpCrashReportPending();
        if (!cancelled && count > 0) {
          setPending(count);
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
      const out = await mcpSendCrashReport();
      setSent(out.sent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    try {
      await mcpDismissCrashReport();
    } catch {
      // The offer is gone for this run either way.
    } finally {
      setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => void dismiss()}
      title="Titer quit unexpectedly"
      description={`The last run ended without shutting down cleanly. ${pending} error${pending === 1 ? "" : "s"} were captured — send the report to help fix it?`}
      start={
        <Button disabled={busy} onClick={() => void dismiss()}>
          Don&apos;t send
        </Button>
      }
      footer={
        sent === null ? (
          <Button variant="accent" disabled={busy} onClick={() => void send()}>
            Send report
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
              Only the error report is sent — error type, message, and a scrubbed stack. No file names with your
              username, no file contents, no user data.
            </p>
            <p className="text-regular text-secondary">
              The report is saved on this Mac either way; sending files it with the Titer team so the crash can be
              fixed.
            </p>
          </>
        ) : (
          <p className="text-regular text-primary">
            {sent ? "Sent — thank you. The report is with the Titer team." : "The report couldn't be sent, but it is saved on this Mac — you can send it later from Settings → AI Connections."}
          </p>
        )}
        {error && <p className="text-regular text-red-600">{error}</p>}
      </div>
    </Dialog>
  );
}
