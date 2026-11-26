// What's New dialog (seq 453, 2.0 launch): the visible close of the
// feedback loop — what shipped, in the app. It auto-shows once per
// version after an update (the seen record in src/lib/whats-new.ts),
// and Help ▸ What's New re-opens it on demand through the feedback bus.
//
// What it shows is only the entries newer than the version whose news
// was last shown (most recent first, max 3): an every-release updater
// sees one entry; a skipper sees what they missed. An update with no
// new entry, or a downgrade, auto-shows nothing — never an empty
// dialog. On demand with nothing new it shows the current version's
// entry, so the dialog the user asked for is never empty; older notes
// live on GitHub releases, linked in the footer.
//
// Every project window mounts this; the 2-second re-check while an
// auto-shown dialog is open closes it in a window where another window
// already recorded the version as seen, so the user is never shown the
// same news twice (same shape as the feedback-consent dialog). An
// on-demand open never auto-closes: the user asked to see it.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import {
  WHAT_S_NEW,
  markWhatsNewSeen,
  readWhatsNewSeen,
  shouldShowWhatsNew,
  visibleWhatsNewEntries,
} from "../lib/whats-new";
import { onWhatsNewRequest } from "../lib/feedback-ui";
import { openLink } from "../native";

export function WhatsNewDialog() {
  const [open, setOpen] = React.useState(false);
  // Whether this open was the auto-show (true) or Help ▸ What's New (false).
  const [autoOpened, setAutoOpened] = React.useState(false);

  React.useEffect(
    () =>
      onWhatsNewRequest(() => {
        setAutoOpened(false);
        setOpen(true);
      }),
    [],
  );

  // Show once per version, only when there is news newer than the
  // version whose news was last shown.
  React.useEffect(() => {
    const seen = readWhatsNewSeen();
    if (!shouldShowWhatsNew(seen)) return;
    if (visibleWhatsNewEntries(seen).length === 0) return;
    setAutoOpened(true);
    setOpen(true);
  }, []);

  // While an auto-shown dialog is open, re-check: another window may
  // have recorded the version as seen meanwhile.
  React.useEffect(() => {
    if (!open || !autoOpened) return;
    const timer = setInterval(() => {
      if (!shouldShowWhatsNew(readWhatsNewSeen())) setOpen(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [open, autoOpened]);

  const close = () => {
    markWhatsNewSeen();
    setOpen(false);
  };

  // The entries for this open, recomputed each time it opens: the
  // entries newer than the seen record, or — on demand with nothing
  // new — the current version's entry.
  const entries = React.useMemo(() => {
    const shown = visibleWhatsNewEntries(readWhatsNewSeen());
    if (shown.length > 0) return shown;
    if (!autoOpened && WHAT_S_NEW[0]) return [WHAT_S_NEW[0]];
    return [];
  }, [open, autoOpened]);

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
        {entries.map((entry) => (
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
        <p className="text-small text-secondary">
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => void openLink("releases-list")}
          >
            Older release notes
          </button>
        </p>
      </div>
    </Dialog>
  );
}
