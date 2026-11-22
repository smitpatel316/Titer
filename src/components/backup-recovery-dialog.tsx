// The crash-recovery offer (Plane seq 226, 1.8.0): after a crash the backup
// remains, and the next launch offers to restore it. Restore loads the
// backup's bytes as this window's project (edited, so saving writes it
// back); Discard deletes the backup and keeps the current file; Keep
// current file dismisses the offer and leaves the backup on disk — it is
// offered again on the next launch, or pruned after 4 days. The dialog has
// no silent dismiss: Esc and the backdrop keep the current file, they never
// delete a backup.
import { Button } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import type { BackupEntry } from "../native";

export type BackupRecoveryChoice = "restore" | "discard" | "keep";

export function BackupRecoveryDialog({
  recovery,
  onChoose,
}: {
  recovery: { identity: string; entry: BackupEntry } | null;
  onChoose: (choice: BackupRecoveryChoice) => void;
}) {
  if (!recovery) return null;
  const { entry } = recovery;
  const when = new Date(entry.saved_at_ms).toLocaleString();
  return (
    <Dialog
      open
      onClose={() => onChoose("keep")}
      onReturn={() => onChoose("restore")}
      title="Recovered backup found"
      description={
        <>
          Titer found a backup of “{entry.display_name}” from {when} — saved after the copy on disk. Restore it to
          pick up where you left off, or keep the file as it is now.
        </>
      }
      footer={
        <>
          <Button variant="accent" onClick={() => onChoose("restore")}>
            Restore backup
          </Button>
          <Button onClick={() => onChoose("keep")}>Keep current file</Button>
          <Button onClick={() => onChoose("discard")}>Discard backup</Button>
        </>
      }
    />
  );
}
