// Asks an analysis's questions (wizards.ts) like a macOS assistant: one question at
// a time, Cancel, Back, then Next — or Run on the last one (Create for a transformed
// table). A "Not sure" answer runs Shapiro-Wilk and answers for the user. Mounts fresh for each analysis.
import * as React from "react";
import { Button, Checkbox, Field, Input, NumberInput, RadioList } from "../../ui/controls";
import { Dialog } from "../../ui/dialog";
import { readTable } from "../../lib/dataset";
import { validateAnalysisParams } from "../../lib/project-file";
import type { TableData, TableType } from "../../store/types";
import { useProjectActions, useProjectStore } from "../../store/use-project-store";
import { alert } from "../../native";
import { checkNormality } from "./normality-check";
import { useAnalysisLauncher } from "./use-analysis-launcher";
import { analysisLabel } from ".";
import { packageGate, titleAfterApply } from "../../stats";
import { ensurePackages } from "../../stats/webr";
import {
  answersFor,
  answersFromParams,
  chosenSets,
  parseUnknowns,
  toggled,
  TRANSFORM_WIZARD,
  WIZARDS,
  wizardForAnalysis,
  type Answer,
  type Answers,
  type Question,
  type Wizard,
} from "./wizards";

const NOT_SURE = { value: "check", label: "Not sure — check for normality first (Shapiro-Wilk)" };

export function AnalysisWizard() {
  const { nodes, selector, closeSelector } = useProjectStore();
  const { createTransformed, setAnalysisParams } = useProjectActions();
  const launch = useAnalysisLauncher();
  // Change Parameters (seq 373): the same wizard, pre-filled from the stored
  // params, applying in place instead of creating a node. The entry points
  // gate on canEditAnalysisParams, so this only ever sees a live node — the
  // guards below are for a stale selector (the node frozen or deleted since).
  if (selector?.kind === "edit-analysis-params") {
    const node = nodes[selector.nodeId];
    if (!node || node.type !== "analysis" || !node.analysisType) return null;
    // Hoisted: property narrowing on `node` doesn't survive into the onDone
    // closure below.
    const analysisType = node.analysisType;
    const storedParams = node.analysisParams ?? {};
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    const { data, tableType } = parent ?? {};
    if (!data) return null;
    const wizardKey = wizardForAnalysis(analysisType, storedParams);
    if (wizardKey === null) return null;
    const wizard = WIZARDS[wizardKey];
    if (!wizard) return null;
    const initial = answersFromParams(analysisType, storedParams, readTable(data), tableType);
    if (initial === null) return null;
    return (
      <Steps
        title={analysisLabel(analysisType)}
        data={data}
        tableType={tableType}
        onClose={closeSelector}
        wizard={wizard}
        initial={initial}
        done="Apply"
        finish={wizard.finish}
        onDone={(a) => {
          const table = readTable(data);
          const { type, params } = wizard.finish(a, table, tableType);
          // Every analysis wizard returns params; the type leaves it
          // optional, so this is only for the type checker.
          if (params === undefined) return;
          // The wizard can resolve a different test from changed answers
          // (parametric ↔ non-parametric); changing parameters keeps the
          // same test — a different test starts as a new analysis instead.
          if (type !== analysisType) {
            alert(
              "These answers would change the test",
              `“${analysisLabel(analysisType)}” would become “${analysisLabel(type)}”. Change Parameters keeps the same test — start the other test from the Analysis menu instead.`,
            );
            return;
          }
          const { errors, params: checked } = validateAnalysisParams(analysisType, params);
          if (errors.length) {
            alert("These parameters are not valid", errors.join(" "));
            return;
          }
          const next = checked ?? params;
          // Apply renames the node to match the new params (seq 373 follow-up) —
          // but only while its title is still the derived one for the old params;
          // a hand-renamed title keeps its name. The rename rides the same
          // undoable action as the params, so one undo restores both.
          const newTitle = titleAfterApply(analysisType, storedParams, node.name, next);
          setAnalysisParams(node.id, next, newTitle ?? undefined);
          closeSelector();
        }}
      />
    );
  }
  if (selector?.kind !== "analysis-params") return null;
  const { data, tableType } = nodes[selector.tableId] ?? {};
  if (!data) return null;
  const table = readTable(data);
  const steps = { title: analysisLabel(selector.testType), data, tableType, onClose: closeSelector };
  if (selector.testType === "transform")
    return (
      <Steps
        {...steps}
        wizard={TRANSFORM_WIZARD}
        initial={{}}
        done="Create"
        onDone={(a) => {
          createTransformed(selector.tableId, TRANSFORM_WIZARD.finish(a));
          closeSelector();
        }}
      />
    );
  const wizard = WIZARDS[selector.testType];
  if (!wizard) return null;
  return (
    <Steps
      {...steps}
      wizard={wizard}
      initial={answersFor(wizard, table, tableType, selector.forGraph?.sets)}
      done="Run"
      finish={wizard.finish}
      onDone={(a) => {
        const { type, params } = wizard.finish(a, table, tableType);
        launch(selector.tableId, type, params, selector.forGraph);
        closeSelector();
      }}
    />
  );
}

/** The answer a question starts with: the one given before (going back), else its first option.
 *  A choice with no options has no answer (null): the step is blocked with a
 *  message instead of throwing on `options[0]` (M18 — e.g. a second data set
 *  that does not exist). */
export function initialAnswer(q: Question, given: Answer | undefined): Answer | null {
  if (q.kind === "choice") return q.options.some((o) => o.value === given) ? given! : (q.options[0]?.value ?? null);
  if (q.kind === "number") return typeof given === "number" ? given : q.initial;
  if (q.kind === "text") return typeof given === "string" ? given : q.initial;
  return Array.isArray(given) ? given.filter((n) => q.options.includes(n)) : q.options;
}

/** A multi-select (`names`) answer below its minimum disables Next with no
 *  other explanation (F7 — enzyme `y`, dose `ys`, mixed `sets` never state
 *  the minimum): the hint names the minimum and how many are chosen so far,
 *  so the user knows what to fix. Null when the answer meets its minimum. */
export function namesShortfall(q: Question, value: Answer | null): string | null {
  if (q.kind !== "names" || !Array.isArray(value)) return null;
  const min = q.min ?? 1;
  return value.length < min ? `Choose at least ${min} — ${value.length} chosen.` : null;
}

function Steps({
  title,
  wizard,
  data,
  tableType,
  initial,
  done,
  finish,
  onDone,
  onClose,
}: {
  title: string;
  wizard: Pick<Wizard, "questions" | "checklist">;
  data: TableData;
  tableType?: TableType;
  /** Answers given beforehand (a graph's data sets), each question starting from its own. */
  initial: Answers;
  /** The last step's button: Run, Create. */
  done: string;
  /** The test the answers make, for the package gate (a transformed table has none). */
  finish?: Wizard["finish"];
  /** Every question answered. */
  onDone: (answers: Answers) => void;
  onClose: () => void;
}) {
  const table = readTable(data);
  const [answers, setAnswers] = React.useState<Answers>(initial);
  const [step, setStep] = React.useState(0);
  const [checking, setChecking] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  // The check in flight, while one is: Cancel/Escape aborts it (F14).
  const checkAbort = React.useRef<AbortController | null>(null);
  // Each question takes the keyboard (its chosen answer), so ↑↓ and Return go on working.
  const field = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const input = (selector: string) => field.current?.querySelector<HTMLInputElement>(selector);
    (input("input:checked") ?? input("input"))?.focus();
  }, [step]);
  const asked = (a: Answers) =>
    wizard.questions(a, table, tableType, data.rowGroups).filter((q): q is Question => q !== false);
  const q = asked(answers)[step];
  // A choice with no options (M18): nothing to pick, so the step is blocked
  // with an explanation — Next stays disabled (value is null) and the user
  // goes back or adds data instead of the wizard throwing.
  const emptyChoice = q.kind === "choice" && q.options.length === 0;
  const emptyMessage =
    "There's nothing to choose here — the table doesn't have the data this question needs. Go back and pick a different option, or add data to the table first.";
  const [value, setValue] = React.useState<Answer | null>(() => initialAnswer(q, initial[q.id]));
  // The checklist for the test being built, following the answers so far
  // (the current step's answer counts too, so the checklist switches branch
  // as soon as the user picks parametric vs non-parametric).
  const checklist = wizard.checklist?.({ ...answers, [q.id]: value ?? undefined }, table, tableType);

  const go = (to: number, a: Answers) => {
    const next = asked(a)[to];
    setAnswers(a);
    setStep(to);
    setValue(initialAnswer(next, a[next.id]));
  };
  const last = value !== NOT_SURE.value && asked({ ...answers, [q.id]: value ?? undefined }).length === step + 1;
  // The test this wizard would create once the step is answered (finish is a
  // pure mapping), so a required package that already failed to install
  // blocks Run before it is pressed — with Retry. A package that merely
  // is not loaded yet does not block: the analysis installs it on first run.
  const finished =
    last && value !== null && finish
      ? finish({ ...answers, [q.id]: value ?? undefined }, table, tableType)
      : null;
  const gate = finished
    ? packageGate(finished.type, finished.params)
    : { blocked: false, message: null, packages: [] as string[] };
  const retry = async () => {
    setRetrying(true);
    try {
      await ensurePackages(gate.packages);
    } catch {
      // The gate recomputes from packageStatus on the next render.
    }
    setRetrying(false);
  };

  const next = async () => {
    let answer = value!;
    if (answer === NOT_SURE.value) {
      // F14: while the check runs the dialog used to be un-dismissable — no
      // Cancel button, Escape a no-op — so a stalled WebR stranded the user
      // until the 5-minute eval watchdog fired. Cancelling the check returns
      // to this question (the "Not sure" answer stays selected); the wizard
      // itself is closed with Cancel/Escape once the check is gone.
      const controller = new AbortController();
      checkAbort.current = controller;
      setChecking(true);
      const gaussian = await checkNormality(data, chosenSets(answers), { signal: controller.signal });
      checkAbort.current = null;
      setChecking(false);
      if (gaussian == null) return;
      answer = gaussian ? "yes" : "no";
    }
    const a = { ...answers, [q.id]: answer };
    if (asked(a).length > step + 1) go(step + 1, a);
    else {
      if (finish) {
        const { type, params } = finish(a, table, tableType);
        if (packageGate(type, params).blocked) return; // re-checked: Run was disabled, but status can change
      }
      onDone(a);
    }
  };

  // Cancelling the check (Cancel button or Escape — the Dialog renders its
  // Cancel button whenever `onClose` is set, so one is visible while the
  // check runs) aborts the in-flight R evaluation and returns to the
  // question; it never closes the wizard, which would discard the answers.
  const cancelCheck = () => {
    checkAbort.current?.abort();
  };

  // A free-text answer only counts once it parses: a question with its own
  // `parse` (the spline's spar: blank = automatic) uses that, otherwise the
  // text must be comma-separated numbers (the standard-curve unknowns); its
  // error, when the user has typed something, replaces the question text.
  const parseText = (value: string): string | null =>
    q.kind === "text" ? ((q.parse?.(value) ?? parseUnknowns(value)).error ?? null) : null;
  const textError = q.kind === "text" && String(value ?? "").trim() !== "" ? parseText(String(value ?? "")) : null;
  // A number answer only counts once it passes its question's validation;
  // its error, like the free-text one, replaces the question text.
  const numberError = q.kind === "number" && typeof value === "number" ? (q.validate?.(value) ?? null) : null;
  const ready =
    value !== null &&
    !(Array.isArray(value) && value.length < (q.kind === "names" ? (q.min ?? 1) : 1)) &&
    !(q.kind === "text" && parseText(String(value ?? ""))) &&
    !numberError;

  return (
    <Dialog
      open
      onClose={checking ? cancelCheck : onClose}
      onReturn={ready && !checking ? () => void next() : undefined}
      title={title}
      description={
        gate.blocked
          ? gate.message!
          : checking
            ? "Running the Shapiro-Wilk normality test…"
            : emptyChoice
              ? (q.kind === "choice" && q.emptyMessage) || emptyMessage
              : (textError ?? numberError ?? namesShortfall(q, value) ?? q.ask)
      }
      footer={
        !checking && (
          <>
            {step > 0 && <Button onClick={() => go(step - 1, answers)}>Back</Button>}
            {gate.blocked && (
              <Button disabled={retrying} onClick={() => void retry()}>
                {retrying ? "Retrying…" : "Retry installing packages"}
              </Button>
            )}
            <Button variant="accent" disabled={!ready || gate.blocked} onClick={() => void next()}>
              {last ? done : "Next"}
            </Button>
          </>
        )
      }
    >
      {!checking && (
        <div ref={field}>
          <AnswerField question={q} value={value} onChange={setValue} />
          {checklist && (
            <section className="mt-4 rounded-lg border border-separator px-4 py-3">
              <p className="text-strong">{checklist.title}</p>
              <p className="mt-1 text-small text-secondary">{checklist.whenToUse}</p>
              <ul className="mt-2 list-disc pl-5 marker:text-secondary">
                {checklist.items.map((item) => (
                  <li key={item.assumption} className="mt-1 text-regular">
                    {item.assumption}
                    {item.ifNot && <span className="block text-small text-secondary">If not: {item.ifNot}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}

function AnswerField({
  question: q,
  value,
  onChange,
}: {
  question: Question;
  value: Answer | null;
  onChange: (value: Answer | null) => void;
}) {
  if (q.kind === "choice") {
    return (
      <RadioList
        value={value as string}
        onChange={onChange}
        options={q.normality ? [...q.options, NOT_SURE] : q.options}
      />
    );
  }
  if (q.kind === "number") {
    return (
      <Field label={q.label}>
        <NumberInput value={value as number | null} onChange={onChange} min={q.min} max={q.max} step={q.step} />
      </Field>
    );
  }
  if (q.kind === "text") {
    return (
      <Field label={q.label}>
        <Input
          value={(value as string | null) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
        />
      </Field>
    );
  }
  const ticked = value as string[];
  return (
    <div className="flex flex-col gap-2">
      {q.options.map((name) => (
        <label key={name} className="flex items-center gap-2 text-regular">
          <Checkbox checked={ticked.includes(name)} onChange={(on) => onChange(toggled(q.options, ticked, name, on))} />
          {name}
        </label>
      ))}
    </div>
  );
}
