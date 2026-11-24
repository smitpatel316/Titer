// Unified Preferences (seq 225): the settings that were scattered —
// autosave (General), the theme (View ▸ Appearance), AI Connections and
// feedback sharing (Settings), and the print setup (File ▸ Page Setup) —
// in one dialog, Settings ▸ Preferences… (⌘,). Every control writes
// through the same store its old home used, so changing it here and
// changing it there can never disagree.
import * as React from "react";
import { Button, Checkbox, Field, NumberInput, RadioList, Segmented, Select, Switch } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import type { PreferenceSection } from "../store/use-project-store";
import { AUTOSAVE_DEBOUNCE_MS, isAutosaveEnabled, setAutosaveEnabled } from "../lib/autosave";
import { loadTheme, saveTheme, type Theme } from "../lib/theme";
import {
  loadPrintSettings,
  savePrintSettings,
  type PaperSize,
  type PrintOrientation,
  type PrintSettings,
} from "../lib/print-settings";
import {
  loadDecimalSeparator,
  saveDecimalSeparator,
  type DecimalSeparator,
} from "../lib/decimal-format";
import { loadCategoryAutocomplete, saveCategoryAutocomplete } from "../lib/category-autocomplete";
import { isNative, mcpFeedbackConsent, mcpSetFeedbackConsent } from "../native";

function Section({ id, title, children }: { id: PreferenceSection; title: string; children: React.ReactNode }) {
  return (
    <section data-section={id} className="flex flex-col gap-2">
      <h3 className="text-regular font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function PreferencesDialog() {
  const { selector, closeSelector, openSelector } = useProjectStore();
  const open = selector?.kind === "preferences";
  const section = open ? (selector.section ?? "general") : "general";

  const [autosave, setAutosave] = React.useState(isAutosaveEnabled);
  const [theme, setThemeState] = React.useState<Theme>(loadTheme);
  const [print, setPrint] = React.useState<PrintSettings>(loadPrintSettings);
  const [decimalSeparator, setDecimalSeparator] = React.useState<DecimalSeparator>(loadDecimalSeparator);
  const [categoryAutocomplete, setCategoryAutocomplete] = React.useState(loadCategoryAutocomplete);
  const [feedbackSharing, setFeedbackSharing] = React.useState<boolean | null>(null);
  const [feedbackBusy, setFeedbackBusy] = React.useState(false);

  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Re-read every setting on open: another window may have changed one.
  React.useEffect(() => {
    if (!open) return;
    setAutosave(isAutosaveEnabled());
    setThemeState(loadTheme());
    setPrint(loadPrintSettings());
    setDecimalSeparator(loadDecimalSeparator());
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      try {
        const consent = await mcpFeedbackConsent();
        if (!cancelled) setFeedbackSharing(consent);
      } catch {
        // No record readable — the section says so.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open ]);

  // Page Setup… opens the dialog on the Print section.
  React.useEffect(() => {
    if (!open) return;
    bodyRef.current
      ?.querySelector(`[data-section="${section}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [open, section]);

  const changePrint = (patch: Partial<PrintSettings>) => {
    const next = { ...print, ...patch };
    setPrint(next);
    savePrintSettings(next);
  };

  const toggleFeedback = async (sharing: boolean) => {
    setFeedbackBusy(true);
    try {
      await mcpSetFeedbackConsent(sharing);
      setFeedbackSharing(sharing);
    } catch {
      // The record didn't stick — the switch stays where it was.
    } finally {
      setFeedbackBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      dismissLabel="Done"
      title="Preferences"
      description="Settings for this Mac — they travel with neither the project nor its file."
    >
      <div ref={bodyRef} className="flex max-h-[60vh] flex-col gap-5 overflow-auto pr-1">
        <Section id="general" title="General">
          <label className="flex items-center gap-2 text-regular">
            <Checkbox
              checked={autosave}
              onChange={(v) => {
                setAutosave(v);
                setAutosaveEnabled(v);
              }}
            />
            Autosave
          </label>
          <p className="text-small text-secondary">
            {autosave
              ? `Saves ${AUTOSAVE_DEBOUNCE_MS / 1000} seconds after you stop editing.`
              : "Off — remember to save (⌘S) or your changes are lost when the window closes."}
          </p>
        </Section>

        <Section id="data-entry" title="Data Entry">
          <Field label="Decimal separator">
            <Segmented<DecimalSeparator>
              value={decimalSeparator}
              onChange={(v) => {
                setDecimalSeparator(v);
                saveDecimalSeparator(v);
              }}
              options={[
                { value: ".", label: "Period (1.5)" },
                { value: ",", label: "Comma (1,5)" },
              ]}
            />
          </Field>
          <p className="text-small text-secondary">
            How numbers are entered, pasted, shown, copied and exported as text. Stored values always keep full
            precision with a period.
          </p>
          <label className="flex items-center justify-between gap-4 text-regular">
            Suggest categories while typing
            <Checkbox
              checked={categoryAutocomplete}
              onChange={(v) => {
                setCategoryAutocomplete(v);
                saveCategoryAutocomplete(v);
              }}
            />
          </label>
          <p className="text-small text-secondary">
            In a categorical column, typing offers the column's existing levels, so a typo can't silently make a
            second level.
          </p>
        </Section>

        <Section id="appearance" title="Appearance">
          <RadioList<Theme>
            value={theme}
            onChange={(v) => {
              setThemeState(v);
              saveTheme(v);
            }}
            options={[
              { value: "system", label: "Automatic (follow the system)" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Section>

        <Section id="ai" title="AI Connections">
          <p className="text-regular text-secondary">
            The MCP server, its token, and which tools an AI assistant may use.
          </p>
          <div>
            <Button
              onClick={() => {
                closeSelector();
                openSelector({ kind: "ai-connections" });
              }}
            >
              Open AI Connections…
            </Button>
          </div>
        </Section>

        <Section id="feedback" title="Feedback">
          <label className="flex items-center justify-between gap-4 text-regular">
            Share anonymous feedback with the Titer team
            <Switch checked={feedbackSharing ?? false} disabled={feedbackBusy || !isNative} onChange={(v) => void toggleFeedback(v)} />
          </label>
          <p className="text-small text-secondary">
            {feedbackSharing === null
              ? "Not set yet — feedback stays on this Mac until you choose."
              : feedbackSharing
                ? "On — feedback you send also goes to the Titer team."
                : "Off — feedback is saved on this Mac for you to review."}
          </p>
        </Section>

        <Section id="print" title="Print">
          <p className="text-small text-secondary">File ▸ Print prints the sheet as shown, on this paper.</p>
          <Field label="Paper size">
            <Select<PaperSize>
              value={print.paperSize}
              onChange={(v) => changePrint({ paperSize: v })}
              options={[
                { value: "letter", label: "US Letter" },
                { value: "a4", label: "A4" },
              ]}
            />
          </Field>
          <Field label="Orientation">
            <Segmented<PrintOrientation>
              value={print.orientation}
              onChange={(v) => changePrint({ orientation: v })}
              options={[
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
            />
          </Field>
          <Field label="Margins (mm)">
            <NumberInput
              value={print.marginMm}
              onChange={(v) => v !== null && changePrint({ marginMm: Math.min(25, Math.max(0, v)) })}
            />
          </Field>
          <Field label="Scale (%)">
            <NumberInput
              value={Math.round(print.scale * 100)}
              onChange={(v) => v !== null && changePrint({ scale: Math.min(2, Math.max(0.5, v / 100)) })}
            />
          </Field>
        </Section>
      </div>
    </Dialog>
  );
}
