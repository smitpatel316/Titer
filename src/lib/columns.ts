// Keys that tie cells, series, points and compared pairs of a table together.
// Reading the data itself is lib/dataset.ts.

/** Split a grouped sub-column name into its group key and sublabel, at the
 *  first ":" ("Group:Y1" → ["Group", "Y1"]); a name with no ":" is its own
 *  key and its own sublabel. */
export function splitGroupColumn(name: string): [string, string] {
  const sep = name.indexOf(":");
  return sep >= 0 ? [name.slice(0, sep), name.slice(sep + 1)] : [name, name];
}

/** A grouped table's groups as runs, from its data-column names in table
 *  order. A run is one group's sub-columns: the same group key may appear in
 *  several runs ("Group:Y1"… twice is two groups), and a run never holds one
 *  sublabel twice — a column whose sublabel its group already holds starts a
 *  new run of that name. Runs stay open across other groups' columns, so
 *  interleaved columns ("A:Y1", "B:Y1", "A:Y2") still read as two groups.
 *  Group identity is the run, not the name: keying off the name merges
 *  same-named groups and moves the second group's values into the first's
 *  columns. `split` is the key/sublabel split (first ":" by default; the
 *  .prism writer splits at the last ":"). */
export function groupRuns(
  names: string[],
  split: (name: string) => [string, string] = splitGroupColumn,
): { name: string; columns: number[] }[] {
  const runs: { name: string; columns: number[] }[] = [];
  const open = new Map<string, { run: { name: string; columns: number[] }; seen: Set<string> }>();
  names.forEach((name, i) => {
    const [key, sub] = split(name);
    let entry = open.get(key);
    if (!entry || entry.seen.has(sub)) {
      const run = { name: key, columns: [] as number[] };
      runs.push(run);
      entry = { run, seen: new Set<string>() };
      open.set(key, entry);
    }
    entry.run.columns.push(i);
    entry.seen.add(sub);
  });
  return runs;
}
export function excludedKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Series identity key for a column name: the group prefix before ":" for a
 *  Grouped table's "A:Y1"-style sub-columns, or the name itself otherwise. This
 *  is what a graph's hand-picked series colors are keyed by. */
export function seriesKeyOf(name: string): string {
  const sep = name.indexOf(":");
  return sep >= 0 ? name.slice(0, sep) : name;
}

/** Identity key for one data point (one cell): its exact column name + 0-based row
 *  index. This is what a graph's points styled one by one (`points`) are keyed by —
 *  distinct from `seriesKeyOf`, which collapses a Grouped table's replicate
 *  sub-columns down to their shared group prefix. */
export function pointKeyOf(column: string, row: number): string {
  return `${column}#${row}`;
}

/** Splits a point's key back into its column name and row index. */
export function parsePointKey(key: string): { column: string; row: number } {
  const i = key.lastIndexOf("#");
  return { column: key.slice(0, i), row: Number(key.slice(i + 1)) };
}

/** Key of a compared pair of columns (a graph's significance brackets). NUL-joined, so
 *  any column name is safe in it. */
export const pairKey = (a: string, b: string) => `${a}\u0000${b}`;
/** The two column names of a `pairKey`. */
export const pairOf = (key: string) => key.split("\u0000") as [string, string];
