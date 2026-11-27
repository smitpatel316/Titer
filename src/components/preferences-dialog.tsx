// Unified Preferences (seq 225): the settings that were scattered —
// autosave (General), the theme (View ▸ Appearance), AI Connections and
// feedback sharing (Settings), and the print setup (File ▸ Page Setup) —
// in one dialog, Settings ▸ Preferences… (⌘,). Every control writes
// through the same store its old home used, so changing it here and
// changing it there can never disagree. The seq 225 remainder adds the
// per-Mac preferences Prism offers that Titer was missing: note and
// default fonts, measurement units, title autocomplete, graph alerts, new
// graph defaults, P-value format, file locations, clipboard options, info
// auto-create, the extended log, and the print options.
import * as React from "react";
import { Button, Checkbox, Field, Input, NumberInput, RadioList, Segmented, Select, Switch } from "../ui/controls";
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
import {
  loadAutoCreateInfo,
  loadAutocompleteTitles,
  loadClipboardOptions,
  loadDefaultFont,
  loadDefaultLocations,
  loadExtendedLog,
  loadGraphAlerts,
  loadMeasurementUnit,
  loadNewGraphDefaults,
  loadNoteFont,
  loadPValueFormat,
  saveAutoCreateInfo,
  saveAutocompleteTitles,
  saveClipboardOptions,
  saveDefaultFont,
  saveDefaultLocations,
  saveExtendedLog,
  saveGraphAlerts,
  saveMeasurementUnit,
  saveNewGraphDefaults,
  saveNoteFont,
  savePValueFormat,
  type ClipboardOptions,
  type DefaultFont,
  type DefaultLocations,
  type MeasurementUnit,
  type NewGraphDefaults,
  type NoteFont,
  type PValueFormat,
} from "../lib/preferences";
import { resetAllZooms } from "../store/use-zoom";
import { isNative, mcpFeedbackConsent, mcpSetFeedbackConsent, pickFolder } from "../native";

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
  const [noteFont, setNoteFont] = React.useState<NoteFont>(loadNoteFont);
  const [defaultFont, setDefaultFont] = React.useState<DefaultFont>(loadDefaultFont);
  const [measurementUnit, setMeasurementUnit] = React.useState<MeasurementUnit>(loadMeasurementUnit);
  const [autocompleteTitles, setAutocompleteTitles] = React.useState(loadAutocompleteTitles);
  const [graphAlerts, setGraphAlerts] = React.useState(loadGraphAlerts);
  const [newGraphDefaults, setNewGraphDefaults] = React.useState<NewGraphDefaults>(loadNewGraphDefaults);
  const [pValueFormat, setPValueFormat] = React.useState<PValueFormat>(loadPValueFormat);
  const [defaultLocations, setDefaultLocations] = React.useState<DefaultLocations>(loadDefaultLocations);
  const [clipboardOptions, setClipboardOptions] = React.useState<ClipboardOptions>(loadClipboardOptions);
  const [autoCreateInfo, setAutoCreateInfo] = React.useState(loadAutoCreateInfo);
  const [extendedLog, setExtendedLog] = React.useState(loadExtendedLog);
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
    setCategoryAutocomplete(loadCategoryAutocomplete());
    setNoteFont(loadNoteFont());
    setDefaultFont(loadDefaultFont());
    setMeasurementUnit(loadMeasurementUnit());
    setAutocompleteTitles(loadAutocompleteTitles());
    setGraphAlerts(loadGraphAlerts());
    setNewGraphDefaults(loadNewGraphDefaults());
    setPValueFormat(loadPValueFormat());
    setDefaultLocations(loadDefaultLocations());
    setClipboardOptions(loadClipboardOptions());
    setAutoCreateInfo(loadAutoCreateInfo());
    setExtendedLog(loadExtendedLog());
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

  const changeNewGraphDefaults = (patch: Partial<NewGraphDefaults>) => {
    const next = { ...newGraphDefaults, ...patch };
    setNewGraphDefaults(next);
    saveNewGraphDefaults(next);
  };

  const changeClipboardOptions = (patch: Partial<ClipboardOptions>) => {
    const next = { ...clipboardOptions, ...patch };
    setClipboardOptions(next);
    saveClipboardOptions(next);
  };

  const changeDefaultLocations = (patch: Partial<DefaultLocations>) => {
    const next = { ...defaultLocations, ...patch };
    setDefaultLocations(next);
    saveDefaultLocations(next);
  };

  const chooseFolder = async (kind: "projects" | "exports") => {
    const folder = await pickFolder(
      kind === "projects" ? "Choose the projects folder" : "Choose the exports folder",
      kind === "projects" ? defaultLocations.projectsFolder : defaultLocations.exportsFolder,
    );
    if (folder !== null) changeDefaultLocations({ [kind === "projects" ? "projectsFolder" : "exportsFolder"]: folder });
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
          <label className="flex items-center justify-between gap-4 text-regular">
            Create an Info sheet with each new data table
            <Checkbox
              checked={autoCreateInfo}
              onChange={(v) => {
                setAutoCreateInfo(v);
                saveAutoCreateInfo(v);
              }}
            />
          </label>
          <p className="text-small text-secondary">
            Off — a new table starts bare, as before. On — it gets a linked Info sheet for its constants and notes,
            as in Prism.
          </p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-regular">Zoom</span>
            <Button onClick={() => resetAllZooms()}>Reset zoom</Button>
          </div>
          <p className="text-small text-secondary">Every graph and figure sheet back to its fit, at once.</p>
          <label className="flex items-center justify-between gap-4 text-regular">
            Extended log file
            <Checkbox
              checked={extendedLog}
              onChange={(v) => {
                setExtendedLog(v);
                saveExtendedLog(v);
              }}
            />
          </label>
          <p className="text-small text-secondary">
            On — error reports carry the browser and location with them, so the local log file says where an error
            happened, not just what it was.
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
          <p className="text-regular font-medium">Clipboard</p>
          <label className="flex items-center justify-between gap-4 text-regular">
            Include column titles when copying
            <Checkbox
              checked={clipboardOptions.includeColumnTitles}
              onChange={(v) => changeClipboardOptions({ includeColumnTitles: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-regular">
            Include row titles when copying
            <Checkbox
              checked={clipboardOptions.includeRowTitles}
              onChange={(v) => changeClipboardOptions({ includeRowTitles: v })}
            />
          </label>
          <p className="text-small text-secondary">
            A table copy pastes as plain text; with titles on, the column names head the copied cells and the row
            titles ride beside them.
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
          <Field label="Default font">
            <Select<DefaultFont>
              value={defaultFont}
              onChange={(v) => {
                setDefaultFont(v);
                saveDefaultFont(v);
              }}
              options={[
                { value: "arial", label: "Arial" },
                { value: "helvetica", label: "Helvetica" },
                { value: "times", label: "Times New Roman" },
                { value: "courier", label: "Courier New" },
              ]}
            />
          </Field>
          <p className="text-small text-secondary">The font new graphs and figures are set in.</p>
          <Field label="Note Font">
            <Select<NoteFont>
              value={noteFont}
              onChange={(v) => {
                setNoteFont(v);
                saveNoteFont(v);
              }}
              options={[
                { value: "system", label: "System font" },
                { value: "arial", label: "Arial" },
                { value: "times", label: "Times New Roman" },
                { value: "courier", label: "Courier New" },
              ]}
            />
          </Field>
          <p className="text-small text-secondary">The font Info sheets and floating notes are set in.</p>
          <Field label="Measurement units">
            <Segmented<MeasurementUnit>
              value={measurementUnit}
              onChange={(v) => {
                setMeasurementUnit(v);
                saveMeasurementUnit(v);
              }}
              options={[
                { value: "in", label: "Inches" },
                { value: "cm", label: "Centimeters" },
              ]}
            />
          </Field>
          <p className="text-small text-secondary">The unit figure sizes are shown in.</p>
        </Section>

        <Section id="graphs" title="Graphs">
          <label className="flex items-center justify-between gap-4 text-regular">
            Autocomplete titles
            <Checkbox
              checked={autocompleteTitles}
              onChange={(v) => {
                setAutocompleteTitles(v);
                saveAutocompleteTitles(v);
              }}
            />
          </label>
          <p className="text-small text-secondary">
            On — a new graph's title is suggested from its source table. Off — new graphs start with a blank title.
          </p>
          <label className="flex items-center justify-between gap-4 text-regular">
            Graph alerts
            <Checkbox
              checked={graphAlerts}
              onChange={(v) => {
                setGraphAlerts(v);
                saveGraphAlerts(v);
              }}
            />
          </label>
          <p className="text-small text-secondary">
            On — a graph with nothing to draw says so on its canvas, instead of leaving bare axes.
          </p>
          <p className="text-regular font-medium">New graphs</p>
          <label className="flex items-center justify-between gap-4 text-regular">
            Show data points on new graphs
            <Checkbox
              checked={newGraphDefaults.showPoints}
              onChange={(v) => changeNewGraphDefaults({ showPoints: v })}
            />
          </label>
          <Field label="Error bars on new graphs">
            <Segmented<"sem" | "none">
              value={newGraphDefaults.error}
              onChange={(v) => changeNewGraphDefaults({ error: v })}
              options={[
                { value: "sem", label: "SEM" },
                { value: "none", label: "None" },
              ]}
            />
          </Field>
          <Field label="P-value format">
            <Select<PValueFormat>
              value={pValueFormat}
              onChange={(v) => {
                setPValueFormat(v);
                savePValueFormat(v);
              }}
              options={[
                { value: "p<0.0001", label: "P < 0.0001" },
                { value: "p<0.001", label: "P < 0.001" },
                { value: "exact", label: "Exact P values" },
              ]}
            />
          </Field>
          <p className="text-small text-secondary">
            How a small P value is written everywhere — below the threshold it shows as “&lt;”, or exactly as computed.
          </p>
        </Section>

        <Section id="files" title="File locations">
          <Field label="Projects folder">
            <div className="flex gap-2">
              <Input
                value={defaultLocations.projectsFolder}
                placeholder="Default — wherever the system puts it"
                onChange={(e) => changeDefaultLocations({ projectsFolder: e.target.value })}
              />
              <Button disabled={!isNative} onClick={() => void chooseFolder("projects")}>
                Choose…
              </Button>
            </div>
          </Field>
          <Field label="Exports folder">
            <div className="flex gap-2">
              <Input
                value={defaultLocations.exportsFolder}
                placeholder="Default — wherever the system puts it"
                onChange={(e) => changeDefaultLocations({ exportsFolder: e.target.value })}
              />
              <Button disabled={!isNative} onClick={() => void chooseFolder("exports")}>
                Choose…
              </Button>
            </div>
          </Field>
          <p className="text-small text-secondary">
            Where new projects are saved and exports go, when a folder is set — otherwise the system picks.
          </p>
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
          <label className="flex items-center justify-between gap-4 text-regular">
            Grid lines
            <Checkbox checked={print.gridLines} onChange={(v) => changePrint({ gridLines: v })} />
          </label>
          <label className="flex items-center justify-between gap-4 text-regular">
            Column titles
            <Checkbox checked={print.columnTitles} onChange={(v) => changePrint({ columnTitles: v })} />
          </label>
          <p className="text-small text-secondary">
            Grid lines draw the data grid's cell borders on the printed page; column titles off hides the grid's
            header row.
          </p>
          <Field label="Header text">
            <Input
              value={print.headerText}
              placeholder="Printed at the top of every page"
              onChange={(e) => changePrint({ headerText: e.target.value })}
            />
          </Field>
        </Section>
      </div>
    </Dialog>
  );
}
