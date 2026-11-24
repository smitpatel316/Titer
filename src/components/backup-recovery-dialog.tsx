// The crash-recovery offer (Plane seq 226, 1.8.0): after a crash the backup
// remains, and the next launch offers to restore it. Restore loads the
// backup's bytes as this window's project (edited, so saving writes it
// back); Discard deletes the backup and keeps the current file; Keep
// current file dismisses the offer and leaves the backup on disk — it is
// offered again on the next launch, or pruned after 4 days. The dialog has
// no silent dismiss: Esc and the backdrop keep the current file, they never
// delete a backup.
//
// Seq 397: the sheet was a native <dialog> shown with showModal(), and live
// on Mac its buttons took no HID clicks (Escape did dismiss) — the top-layer
// dialog takes keyboard but not pointer events on this Mac WebKit. The sheet
// is a plain fixed overlay instead: normal DOM buttons, which take clicks
// everywhere else in the app. The overlay sits above the app's own layers
// (z-50; the app's highest is z-30) and the backdrop eats clicks behind
// it, so the page behind stays inert while the offer stands. A modal
// <dialog> open over it would still hide it — the offer closes the Welcome
// dialog first (use-document), the only dialog that auto-shows at launch.
import * as React from "react";
import { Button } from "../ui/controls";
import type { BackupEntry } from "../native";

export type BackupRecoveryChoice = "restore" | "discard" | "keep";

/** The sheet's four buttons, in order: Cancel first, as on macOS. Cancel
 *  and Keep current file both keep the file (Cancel is the dismiss button,
 *  Keep is the explicit one); only Discard removes the backup. Pure data,
 *  so checks.ts pins the labels, choices and order. */
export const RECOVERY_SHEET_BUTTONS: {
  label: string;
  choice: BackupRecoveryChoice;
  variant: "accent" | "default";
}[] = [
  { label: "Cancel", choice: "keep", variant: "default" },
  { label: "Restore backup", choice: "restore", variant: "accent" },
  { label: "Keep current file", choice: "keep", variant: "default" },
  { label: "Discard backup", choice: "discard", variant: "default" },
];

/** What a keypress on the sheet does — the Dialog's contract, kept: Escape
 *  keeps the file (never deletes a backup); Return restores, unless the
 *  focus is on a button, which takes Return itself. Anything else does
 *  nothing. Pure, so checks.ts pins it. */
export function recoverySheetKeyAction(key: string, targetIsButton: boolean): BackupRecoveryChoice | null {
  if (key === "Escape") return "keep";
  if (key === "Enter" && !targetIsButton) return "restore";
  return null;
}

export function BackupRecoveryDialog({
  recovery,
  onChoose,
}: {
  recovery: { identity: string; entry: BackupEntry } | null;
  onChoose: (choice: BackupRecoveryChoice) => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Focus the panel on open, so Escape/Return work immediately; Tab stays
  // inside the sheet while it stands.
  React.useEffect(() => {
    panelRef.current?.focus();
  }, []);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = recoverySheetKeyAction(e.key, e.target instanceof HTMLButtonElement);
      if (action) {
        e.preventDefault();
        onChoose(action);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll("button")).filter((b) => !b.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChoose]);

  if (!recovery) return null;
  const { entry } = recovery;
  const when = new Date(entry.saved_at_ms).toLocaleString();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => onChoose("keep")}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="backup-recovery-title"
        aria-describedby="backup-recovery-description"
        className="w-[520px] rounded-xl bg-surface p-5 text-primary shadow-2xl ring-1 ring-separator outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="backup-recovery-title" className="text-large-strong">
              Recovered backup found
            </h2>
            <p id="backup-recovery-description" className="text-regular text-secondary">
              Titer found a backup of “{entry.display_name}” from {when} — saved after the copy on disk. Restore it to
              pick up where you left off, or keep the file as it is now.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            {RECOVERY_SHEET_BUTTONS.map((b) => (
              <Button key={b.label} variant={b.variant} onClick={() => onChoose(b.choice)}>
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
