// The first-run startup guide (seq 454, 2.0 launch): a short skippable
// tour — import/open data → run an analysis → make a graph → export —
// then where to get help. It auto-shows once per user on a fresh first
// window (use-document decides when) and Help ▸ Startup Guide… re-opens
// it on demand.
//
// A plain fixed overlay, not a native <dialog> (seq 397): on Mac WebKit a
// showModal() dialog takes keyboard but not pointer events, so its buttons
// take no clicks — normal DOM buttons take clicks everywhere. The overlay
// sits above the app's own layers (z-50; the app's highest is z-30) and
// the backdrop eats clicks behind it, so the page behind stays inert while
// the tour stands.
//
// Closing is always "seen": Skip tour, the backdrop, Escape, or Done on
// the last step all call onClose, which marks the guide seen — the tour
// never reappears once finished, skipped or dismissed, and never blocks
// the app: Back/Next move one step, Return advances, and every step has
// its Skip control.
import * as React from "react";
import { Button } from "../ui/controls";
import { GUIDE_STEPS } from "../lib/startup-guide";
import { isNative, openSupportEmail } from "../native";
import { SendFeedbackButton } from "./send-feedback-dialog";

export function StartupGuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = React.useState(0);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const last = GUIDE_STEPS.length - 1;
  const current = GUIDE_STEPS[Math.min(step, last)];

  // Start at the first step whenever the tour opens.
  React.useEffect(() => {
    if (open) setStep(0);
  }, [open ]);

  // Focus the panel when the tour opens, so Escape/Return work
  // immediately; Tab stays inside the sheet while it stands. The listeners
  // live only while the sheet is open — the component stays mounted with
  // no tour the rest of the time, and must not answer keys then.
  React.useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open ]);
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // A top-layer <dialog> (SendFeedbackDialog, WhatsNewDialog,
      // FeedbackConsentDialog) owns its own keys while open: never steal
      // Enter/Escape from it — and never act on keys typed into a field or
      // outside this panel (the listener is on window, so it sees them all).
      if (document.querySelector("dialog[open]")) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (panelRef.current && target instanceof Node && !panelRef.current.contains(target)) return;
      const targetIsButton = target instanceof HTMLButtonElement;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter" && !targetIsButton) {
        e.preventDefault();
        if (step >= last) onClose();
        else setStep(step + 1);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll("button")).filter((b) => !b.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const lastButton = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastButton.focus();
      } else if (!e.shiftKey && document.activeElement === lastButton) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, step, last]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-guide-title"
        className="w-[520px] rounded-xl bg-surface p-5 text-primary shadow-2xl ring-1 ring-separator outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="startup-guide-title" className="text-large-strong">
              {current.title}
            </h2>
            <p className="text-small text-secondary">
              Step {step + 1} of {GUIDE_STEPS.length}
            </p>
          </div>
          <p className="text-regular text-primary">{current.body}</p>
          {current.link && (
            <p className="text-regular">
              <a
                className="underline"
                href={current.link.href}
                onClick={
                  // Tauri's .on_navigation policy (main.rs) only allows the
                  // tauri: scheme, so a mailto: href is silently blocked in
                  // the native shell — route it through the shell's
                  // open_support_email command instead, like Help ▸ Contact
                  // Support. In a browser the plain mailto: href works as-is.
                  current.link.href.startsWith("mailto:") && isNative
                    ? (e) => {
                        e.preventDefault();
                        void openSupportEmail();
                      }
                    : undefined
                }
              >
                {current.link.label}
              </a>
            </p>
          )}
          {current.id === "help" && (
            <p className="text-regular">
              <SendFeedbackButton />
            </p>
          )}
          <div className="flex justify-end gap-2">
            <div className="mr-auto">
              <Button onClick={onClose}>Skip tour</Button>
            </div>
            <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            {step >= last ? (
              <Button variant="accent" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button variant="accent" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
