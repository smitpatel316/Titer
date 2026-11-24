// Enable review dialog — marketplace M3 (seq 435).
//
// The grant-subset UI for the enable review step: the plugin's name,
// version, author and license, its permissions as plain-language lines
// with a checkbox each (nothing ticked by default), the safety
// scorecard when one is available, and the capability-boundary note
// (a boundary, not a sandbox — said plainly, per the roadmap).
//
// Hook-up to the loader (M1, loader.ts) — the parent does this, the
// dialog only reports the chosen grant:
//
//   const pending = requestEnable(record); // "disabled" → "pending-review"
//   <PluginEnableReview
//     manifest={pending.manifest}
//     scorecard={scorecard}
//     onConfirm={(granted) => {
//       const enabled = confirmEnable(pending, granted, appVersion);
//       // confirmEnable rejects grants outside the manifest, so the
//       // dialog's grant is validated twice: here (grantSubsetIsValid)
//       // and at the loader.
//     }}
//     onCancel={() => setPending(null)}
//   />
//
// Install stays disabled-by-default until this step grants: cancelling
// leaves the plugin "pending-review" (or "disabled" if the parent
// re-disables it) and nothing of the plugin's runs.

import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/controls";
import type { PluginManifest, PluginPermission } from "./manifest";
import { grantSubsetIsValid, permissionChoices } from "./review";
import type { SafetyScorecard } from "./scorecard";
import { SafetyScorecardView } from "./scorecard-view";
import { PluginIsolationNotice } from "./isolation-view";

export function PluginEnableReview({
  manifest,
  scorecard,
  initialGranted = [],
  onConfirm,
  onCancel,
}: {
  manifest: PluginManifest;
  scorecard?: SafetyScorecard | null;
  initialGranted?: readonly PluginPermission[];
  onConfirm: (granted: PluginPermission[]) => void;
  onCancel: () => void;
}) {
  const [granted, setGranted] = React.useState<readonly PluginPermission[]>(initialGranted);
  const [error, setError] = React.useState<string | null>(null);
  const choices = permissionChoices(manifest, granted);

  const toggle = (permission: PluginPermission) => {
    setError(null);
    setGranted((prev) => (prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]));
  };

  const confirm = () => {
    const valid = grantSubsetIsValid(manifest, granted);
    if (!valid.ok) {
      setError(valid.reason);
      return;
    }
    onConfirm(valid.granted);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Enable ${manifest.name}?`}
      description={`${manifest.name} ${manifest.version} by ${manifest.author} — License: ${manifest.license}`}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={confirm}>Enable with these permissions</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {scorecard && <SafetyScorecardView scorecard={scorecard} />}
        {choices.length === 0 ? (
          <p className="text-sm text-primary">This plugin asks for no permissions.</p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-primary">This plugin can:</legend>
            {choices.map((choice) => (
              <label key={choice.permission} className="flex items-start gap-2 text-sm text-primary">
                <input type="checkbox" checked={choice.granted} onChange={() => toggle(choice.permission)} />
                <span>{choice.description}</span>
              </label>
            ))}
            <p className="text-xs text-secondary">
              Tick only what you want this plugin to do. Unticked permissions stay off — the plugin cannot use them, and
              you can change this later by disabling and re-enabling it.
            </p>
          </fieldset>
        )}
        <PluginIsolationNotice />
        {error && <p className="text-sm text-primary">{error}</p>}
      </div>
    </Dialog>
  );
}
