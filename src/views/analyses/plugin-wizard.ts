// The wizard for a plugin analysis, on the existing wizard plumbing —
// no second wizard. The picker opens the same `Steps` dialog first-party
// wizards use; the questions come from the SDK's `toWizardQuestions`
// (the spec's serialisable questions, with `"columns"` options resolved
// to this table's data-column names) and the answers become the run's
// params through `answersToParams`, over the declared defaults. The
// runner re-checks every value before running, as first-party wizards do.
import { answersToParams, getPluginAnalysis, pluginParamDefaults, toWizardQuestions, type PluginParamValues } from "../../plugins";
import type { Answers, Question } from "./wizards";

/** The wizard questions for a plugin analysis on this table. Empty when
 *  the analysis asks nothing — the picker then runs it directly. */
export function pluginWizardQuestions(id: string, columnNames: string[]): Question[] {
  const entry = getPluginAnalysis(id);
  if (!entry) return [];
  return toWizardQuestions(entry.spec, columnNames);
}

/** Whether the plugin analysis asks anything (a picker/menu entry with
 *  questions shows "…" after its label, like a first-party wizard). */
export function pluginHasQuestions(id: string): boolean {
  return (getPluginAnalysis(id)?.spec.questions.length ?? 0) > 0;
}

/** Wizard answers → the run's parameter values: each answer filed under
 *  its parameter key, unanswered parameters on their defaults. */
export function pluginWizardFinish(id: string, answers: Answers): PluginParamValues {
  const entry = getPluginAnalysis(id);
  if (!entry) return {};
  return { ...pluginParamDefaults(entry.spec.parameters), ...answersToParams(entry.spec, answers) };
}
