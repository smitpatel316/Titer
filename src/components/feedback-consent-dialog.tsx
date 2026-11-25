// First-run feedback-sharing prompt (seq 276, server mode): shown once per
// user, on the first launch of a version with this feature — any user with
// no consent record stored (fresh install or upgrade). Never re-prompts
// after they've answered: the choice is recorded in the app-data `mcp/`
// folder (mcp_set_feedback_consent) before the dialog closes, and the MCP
// server reads the same record to gate the server POST. Dismissing is
// impossible without choosing — there is no "later": the user picks Share
// or Don't share, and the default (nothing chosen yet) is Don't share.
//
// Every project window mounts this (see app-shell); the 2-second re-check
// while open closes it in a window where another window already answered,
// so the user is never asked twice.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/controls";
import { isNative, mcpFeedbackConsent, mcpSetErrorLogConsent, mcpSetFeedbackConsent } from "../native";

export function FeedbackConsentDialog() {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Anonymous error reports (seq 452): offered here alongside feedback
  // sharing, same default-off model, separate record — sharing feedback
  // does not imply sharing error reports.
  const [shareErrors, setShareErrors] = React.useState(false);

  // Show once, only when no consent record exists yet.
  React.useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      try {
        if ((await mcpFeedbackConsent()) === null && !cancelled) setOpen(true);
      } catch {
        // No record readable — leave the prompt for the next launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While open, re-check: another window may have answered meanwhile.
  React.useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          if ((await mcpFeedbackConsent()) !== null) setOpen(false);
        } catch {
          // Keep asking.
        }
      })();
    }, 2000);
    return () => clearInterval(timer);
  }, [open ]);

  const choose = async (sharing: boolean) => {
    setBusy(true);
    try {
      await mcpSetFeedbackConsent(sharing);
    } catch {
      // The record didn't stick — the prompt shows again next launch
      // (no record means never answered), so the choice isn't lost.
    }
    try {
      // The error-reports choice rides on the same prompt, not a second
      // one — but it is a separate record, so the user can change it
      // independently in Settings → AI Connections.
      await mcpSetErrorLogConsent(shareErrors);
    } catch {
      // Unrecorded means off (the default) — the Settings toggle can
      // still turn it on later.
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Help improve Titer?"
      description="When your AI reports a missing feature or a bug, Titer can send that report to us so we can fix it."
      start={
        <Button disabled={busy} onClick={() => void choose(false)}>
          Don&apos;t share
        </Button>
      }
      footer={
        <Button disabled={busy} onClick={() => void choose(true)}>
          Share feedback
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-regular text-primary">
          What is shared: only the feedback text your AI sends — a short summary and description of what&apos;s
          missing or broken.
        </p>
        <p className="text-regular text-primary">
          What is not shared: no project data, no file contents, no personal information.
        </p>
        <label className="flex items-start gap-2 text-regular text-primary">
          <input
            type="checkbox"
            checked={shareErrors}
            disabled={busy}
            onChange={(event) => setShareErrors(event.target.checked)}
          />
          <span>
            Also send anonymous error reports when Titer hits an error or crashes — only the error type, a
            scrubbed message and stack, the app version, and what was open. No file paths, no file contents, no
            personal information. You can turn this off anytime in Settings → AI Connections.
          </span>
        </label>
        <p className="text-regular text-secondary">
          Sharing is off until you choose Share. You can change this anytime in Settings → AI Connections.
        </p>
      </div>
    </Dialog>
  );
}
