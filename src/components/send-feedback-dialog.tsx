// Send Feedback dialog (seq 453, 2.0 launch): feedback reachable for
// every user — Help ▸ Send Feedback opens this, no AI needed. Three
// kinds (bug report / feature request / question); the report is saved
// on this Mac and, when the user has turned feedback sharing on, also
// sent to the Titer team through the feedback channel — the same
// consent-gated path `titer_send_feedback` uses. Sharing off means
// saved locally, nothing leaves the machine, and the dialog says so.
//
// The dialog opens on the feedback bus (src/lib/feedback-ui.ts), so
// the Help menu and the startup guide's button reach it without React
// state. `SendFeedbackButton` is the button the startup guide renders.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button, Input, RadioList } from "../ui/controls";
import { isNative, mcpSendFeedback } from "../native";
import { onSendFeedbackRequest, openSendFeedback } from "../lib/feedback-ui";

/** The three user-facing kinds, and the server's kind each maps to (the
 *  server's accepted enum is bug | missing-feature | other). */
const KINDS = [
  { label: "Bug report", value: "bug" },
  { label: "Feature request", value: "missing-feature" },
  { label: "Question", value: "other" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

/** A button that opens the Send Feedback dialog — for the startup
 *  guide's help step (seq 454). */
export function SendFeedbackButton() {
  return <Button onClick={openSendFeedback}>Send Feedback</Button>;
}

export function SendFeedbackDialog() {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<Kind>("bug");
  const [summary, setSummary] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<{ sent: boolean; note?: string } | null>(null);

  React.useEffect(() => onSendFeedbackRequest(() => setOpen(true)), []);

  // A fresh form every time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setKind("bug");
    setSummary("");
    setDetails("");
    setError("");
    setResult(null);
  }, [open ]);

  const send = async () => {
    if (!isNative) {
      setError("Sending feedback needs the desktop app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const out = await mcpSendFeedback(kind, summary, details);
      setResult({ sent: out.sent, note: out.note });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSend = summary.trim().length > 0 && details.trim().length > 0 && !busy;

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Send Feedback"
      description="Tell the Titer team what's missing or broken. Only the text below is ever shared — no project data, no file contents, no personal information."
      footer={
        result ? (
          <Button onClick={() => setOpen(false)}>Close</Button>
        ) : (
          <Button variant="accent" disabled={!canSend} onClick={() => void send()}>
            Send feedback
          </Button>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2">
          <p className="text-regular text-primary">
            {result.sent
              ? "Sent — thank you. Your report is with the Titer team."
              : "Saved on this Mac. Sharing is off, so nothing left the machine — turn sharing on in Settings → AI Connections to send reports to the team."}
          </p>
          {result.note && <p className="text-small text-secondary">{result.note}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <RadioList
            value={kind}
            onChange={(v) => setKind(v)}
            options={KINDS.map((k) => ({ label: k.label, value: k.value }))}
          />
          <label className="flex flex-col gap-1.5 text-regular">
            Summary
            <Input
              value={summary}
              maxLength={200}
              placeholder="One short line — what's missing or broken?"
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-regular">
            Details
            <textarea
              className="w-full rounded-md bg-control px-2 py-1 text-regular outline-none focus:ring-2 focus:ring-accent"
              rows={4}
              value={details}
              maxLength={4000}
              placeholder="What did you try, what happened, and what did you expect?"
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>
          <p className="text-small text-secondary">
            Your report is always saved on this Mac first (Settings → AI Connections lists it). With sharing on, it
            is also sent to the Titer team; with sharing off, it stays here.
          </p>
          {error && <p className="text-regular text-red-600">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
