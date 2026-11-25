// What's New dialog (seq 453, 2.0 launch): the visible close of the
// feedback loop — what shipped, in the app. It auto-shows once per
// version after an update (the seen record in src/lib/whats-new.ts),
// and Help ▸ What's New re-opens it on demand through the feedback bus.
//
// Every project window mounts this; the 2-second re-check while open
// closes it in a window where another window already recorded the
// version as seen, so the user is never shown the same news twice
// (same shape as the feedback-consent dialog).
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { WHAT_S_NEW, markWhatsNewSeen, readWhatsNewSeen, shouldShowWhatsNew } from "../lib/whats-new";
import { onWhatsNewRequest } from "../lib/feedback-ui";

export function WhatsNewDialog() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => onWhatsNewRequest(() => setOpen(true)), []);

  // Show once per version, only when the record does not already name it.
  React.useEffect(() => {
    if (!shouldShowWhatsNew(readWhatsNewSeen())) return;
    if (WHAT_S_NEW.length === 0) return;
    setOpen(true);
  }, []);

  // While open, re-check: another window may have recorded the version
  // as seen meanwhile.
  React.useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      if (!shouldShowWhatsNew(readWhatsNewSeen())) setOpen(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [open ]);

  const close = () => {
    markWhatsNewSeen();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      onReturn={close}
      dismissLabel="OK"
      title="What's New in Titer"
      description="What shipped recently — including fixes and features from your feedback."
    >
      <div className="flex flex-col gap-4">
        {WHAT_S_NEW.map((entry) => (
          <div key={entry.version} className="flex flex-col gap-1.5">
            <p className="text-strong text-primary">{entry.title}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {entry.items.map((item, i) => (
                <li key={i} className="text-regular text-primary">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-small text-secondary">
          Something still missing or broken? Help ▸ Send Feedback tells us, or write to smit@muse.ai.
        </p>
      </div>
    </Dialog>
  );
}
