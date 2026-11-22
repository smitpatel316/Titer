// The right panel: each item's note, or a graph's or a grouped table's settings (Format,
// Groups) plus the app-wide Auto-save setting, full height like the sidebar, and the
// building blocks its sections share.
import * as React from "react";
import { Button, cn, IconButton, NumberInput, Switch } from "../ui/controls";
import {
  CaretRightIcon,
  MinusIcon,
  NoteBlankIcon,
  NoteIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { SidePanel, Toolbar } from "../ui/layout";
import { clampWidth, INSPECTOR_WIDTH, useLayout } from "../store/use-layout";
import { clamp, type ProjectNode } from "../store/types";
import { useProjectActions } from "../store/use-project-store";
import { AUTOSAVE_DEBOUNCE_MS, isAutosaveEnabled, setAutosaveEnabled } from "../lib/autosave";
import {
  BACKUP_MAX_INTERVAL_MINUTES,
  BACKUP_MIN_INTERVAL_MINUTES,
  BACKUP_RETENTION_DAYS,
  backupIntervalMinutes,
  clampBackupIntervalMinutes,
  isBackupEnabled,
  isBackupOnSheetSwitch,
  setBackupEnabled,
  setBackupIntervalMinutes,
  setBackupOnSheetSwitch,
} from "../lib/backup";

type View = "notes" | "settings";

/** A view with the right panel: its toolbar and content on the left, the panel on the right,
 *  showing the item's note or its `settings` (where it has some) plus the app-wide
 *  Auto-save setting. The panel's two buttons, Notes then Settings, stay at the window's
 *  top right: in the panel when it's shown, in the toolbar when it's hidden. */
export function WithInspector({
  title,
  tag,
  node,
  settings,
  actions,
  children,
}: {
  title: string;
  tag?: string;
  node: ProjectNode;
  settings?: React.ReactNode;
  /** Buttons at the toolbar's right end, beside the panel's buttons (Titer: freeze,
   *  floating-note buttons). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { inspector: open, panel, inspectorWidth, setLayout, setInspectorHere, setSettingsHere } = useLayout();
  // The Settings view always has content — the Auto-save section below — even
  // for items with no settings of their own (a plain table, an analysis, an
  // info sheet). Auto-save is app-wide, not per-item, so confining it to the
  // per-item settings (a graph's Format, a grouped table's Groups) would hide
  // it for most selections; the item's own settings still render above it
  // where they exist. The Settings button and View ▸ Inspector are therefore
  // always enabled now, where they used to be only for items with settings.
  const hasSettings = true;
  // While shown, the window keeps room for the panel in its layout (`fitWidths`), and the
  // View menu offers the settings where there are some.
  React.useLayoutEffect(() => {
    setInspectorHere(true);
    setSettingsHere(hasSettings);
    return () => {
      setInspectorHere(false);
      setSettingsHere(false);
    };
  }, [setInspectorHere, setSettingsHere, hasSettings]);
  const shown: View = panel === "settings" && hasSettings ? "settings" : "notes";
  const buttons = <PanelButtons shown={open ? shown : null} hasNote={Boolean(node.notes)} hasSettings={hasSettings} />;
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          title={title}
          tag={tag}
          actions={
            <>
              {actions}
              {!open && buttons}
            </>
          }
        />
        {children}
      </div>
      <SidePanel
        side="right"
        pane="inspector"
        open={open}
        width={inspectorWidth}
        minWidth={INSPECTOR_WIDTH.min}
        onResize={(width, open) => setLayout({ inspector: open, inspectorWidth: clampWidth(width, INSPECTOR_WIDTH) })}
        header={buttons}
      >
        {shown === "settings" ? (
          <>
            {settings}
            <AutosaveSection />
            <BackupSection />
          </>
        ) : (
          <Notes node={node} />
        )}
      </SidePanel>
    </div>
  );
}

/** Notes, then Settings (also View ▸ Show Notes ⌥⌘N, Show Inspector ⌥⌘I): each shows the
 *  panel with its view, or hides it when shown (gray, as the sidebar's button). The note's icon has
 *  lines once the item has a note. */
function PanelButtons({ shown, hasNote, hasSettings }: { shown: View | null; hasNote: boolean; hasSettings: boolean }) {
  const { setLayout } = useLayout();
  const button = (view: View, label: string, icon: React.ReactNode, enabled = true) => (
    <IconButton
      aria-label={`${shown === view ? "Hide" : "Show"} ${label}`}
      aria-pressed={shown === view}
      disabled={!enabled}
      onClick={() => setLayout(shown === view ? { inspector: false } : { inspector: true, panel: view })}
    >
      {icon}
    </IconButton>
  );
  return (
    <div className="flex gap-1">
      {button("notes", "Notes", hasNote ? <NoteIcon /> : <NoteBlankIcon />)}
      {button("settings", "Inspector", <SlidersHorizontalIcon />, hasSettings)}
    </div>
  );
}

/** The item's note: plain text, saved in the project as it is typed (one Undo step for a
 *  burst of typing; ⌘Z in the field is the field's own). */
function Notes({ node }: { node: ProjectNode }) {
  const { setNotes } = useProjectActions();
  return (
    <textarea
      aria-label="Notes"
      value={node.notes ?? ""}
      onChange={(e) => setNotes(node.id, e.target.value)}
      placeholder="Write a note…"
      className="block h-full w-full resize-none bg-transparent px-3 py-2 text-regular outline-none placeholder:text-secondary"
    />
  );
}

/** App-wide auto-save (1.7.3): one on/off toggle, on by default, read and written
 *  through the autosave module — the interval is fixed, not user-adjustable, so it
 *  is shown as text. The engine itself (Lane A) lives in src/lib/autosave.ts. */
function AutosaveSection() {
  const [enabled, setEnabled] = React.useState(() => isAutosaveEnabled());
  return (
    <Section title="Auto-save">
      <label className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onChange={(v) => {
            setAutosaveEnabled(v);
            setEnabled(v);
          }}
        />
        <span className="text-regular text-primary">Auto-save {enabled ? "on" : "off"}</span>
      </label>
      <p className="text-small text-secondary">
        Saves {AUTOSAVE_DEBOUNCE_MS / 1000} seconds after your last edit, when you switch sheets, and when you quit —
        only for projects that already have a file or cloud location.
      </p>
    </Section>
  );
}

/** App-wide automatic backup (1.8.0, seq 226): a separate copy of the
 *  project, kept apart from its file, so a crash leaves something to come
 *  back to — Prism's automatic backup, not auto-save (which saves in
 *  place). One on/off toggle, on by default; the interval in minutes (1–60,
 *  default 10, Prism's default); and the sheet-switch trigger, on by
 *  default. The engine reads these through the backup module; a change here
 *  takes effect on the next edit, not mid-cycle. Backups are kept
 *  {BACKUP_RETENTION_DAYS} days and deleted when the project is saved and
 *  closed normally. */
function BackupSection() {
  const [enabled, setEnabled] = React.useState(() => isBackupEnabled());
  const [interval, setInterval] = React.useState(() => backupIntervalMinutes());
  const [onSheetSwitch, setOnSheetSwitch] = React.useState(() => isBackupOnSheetSwitch());
  return (
    <Section title="Automatic backup">
      <label className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onChange={(v) => {
            setBackupEnabled(v);
            setEnabled(v);
          }}
        />
        <span className="text-regular text-primary">Automatic backup {enabled ? "on" : "off"}</span>
      </label>
      <label className="flex items-center gap-2 text-regular text-primary">
        <NumberInput
          className="w-16"
          aria-label="Backup every (minutes)"
          min={BACKUP_MIN_INTERVAL_MINUTES}
          max={BACKUP_MAX_INTERVAL_MINUTES}
          value={interval}
          disabled={!enabled}
          onChange={(v) => {
            // Null while the field is empty or invalid: keep the last good
            // value on screen, and only store a real number.
            if (v === null) return;
            const clamped = clampBackupIntervalMinutes(v);
            setBackupIntervalMinutes(clamped);
            setInterval(clamped);
          }}
        />
        <span>minutes between backups</span>
      </label>
      <label className="flex items-center gap-3">
        <Switch
          checked={onSheetSwitch}
          disabled={!enabled}
          onChange={(v) => {
            setBackupOnSheetSwitch(v);
            setOnSheetSwitch(v);
          }}
        />
        <span className="text-regular text-primary">Also back up when switching sheets</span>
      </label>
      <p className="text-small text-secondary">
        Keeps a separate copy of your project — including unsaved work — every {interval}{" "}
        {interval === 1 ? "minute" : "minutes"}
        {onSheetSwitch ? " and whenever you switch sheets" : ""}. If Titer crashes, the backup is offered when you
        reopen the project. Backups are kept {BACKUP_RETENTION_DAYS} days and deleted when you save and close
        normally.
      </p>
    </Section>
  );
}

/** A titled inspector group with a hairline divider. With `onToggle`, clicking
 *  the title collapses or expands it (`all`: with ⌥, its siblings too). */
export function Section({
  title,
  icon,
  action,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  /** Shown before the title, as the sidebar's icons. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  collapsed?: boolean;
  onToggle?: (all: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-separator px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => onToggle?.(e.altKey)}
          disabled={!onToggle}
          className="flex items-center gap-1.5 text-small-strong uppercase tracking-wide text-primary"
        >
          {onToggle && (
            <CaretRightIcon className={cn("size-3.5 text-secondary transition-transform", !collapsed && "rotate-90")} />
          )}
          {icon && <span className="text-secondary [&_svg]:size-4">{icon}</span>}
          {title}
        </button>
        {action}
      </div>
      {!collapsed && <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/** A stacked label + control row. The label names the controls for VoiceOver. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <span id={id} className="text-small text-secondary">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A minimalist −/value/+ stepper (native +/- buttons) for a bounded numeric option.
 *  `step` may be fractional, so results are rounded to avoid float drift (0.5 + 0.5 …). */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className="flex items-center justify-between">
      <span className="text-small text-secondary">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          disabled={value <= min}
          onClick={() => onChange(clamp(round(value - step), { min, max }))}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <span className="w-9 text-center text-small tabular-nums">{value}</span>
        <Button
          size="icon"
          disabled={value >= max}
          onClick={() => onChange(clamp(round(value + step), { min, max }))}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
