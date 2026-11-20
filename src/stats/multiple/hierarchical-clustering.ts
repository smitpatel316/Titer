// Hierarchical clustering on a Multiple Variables table: hclust() (base R
// `stats`) on the complete cases, standardised (z-scores) by default or in
// the original units — Prism 10's hierarchical clustering, which Titer's
// K-means-only offering lacked (seq 160). Bespoke runner (not
// ColumnTestSpec) — the result is a tree plus cluster assignments, not
// per-column scalars. Two evalNamedVector calls returning flat named vectors
// (no matrices cross the WebR boundary, only a named vector — the same
// flat-map rule as correlation-matrix.ts): one for the tree (merge matrix,
// heights, leaf order) and cutree assignments for every k in the
// choosing-k range, one for the Gap statistic's uniform reference sets.
// The Elbow (within SS) and Silhouette diagnostics are computed here in
// TypeScript from the assignments and the distance matrix, so they agree
// exactly with the Gap statistic's within SS (same pairwise definition).
import type {
  AnalysisOutcome,
  ChoosingKRow,
  Column,
  HclustAssignmentRow,
  HclustClusterRow,
  HclustDendrogram,
  HclustDistance,
  HclustLinkage,
  HclustParams,
} from "../types";
import { dataGroups, describe, incompleteRows, pairedGroups, rVec } from "../column/base";
import { mean, sd } from "../../lib/summary";
import { evalNamedVector, type RVector } from "../webr";

/** The most clusters the choosing-k diagnostics cover (k = 2..KMAX). */
export const HCLUST_MAX_K = 10;
/** Uniform reference sets for the Gap statistic (Tibshirani et al. 2001). */
const GAP_REFERENCES = 10;
/** The fixed seed, so the same table + params always give the same Gap
 *  statistic — hclust itself is deterministic and needs no seed. */
const SEED = 1;

/** The pairwise distances between rows of `points` (one row per complete
 *  observation, one entry per variable), Euclidean or Manhattan. */
export function hclustDistanceMatrix(points: number[][], distance: HclustDistance): number[][] {
  const n = points.length;
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let v = 0;
      for (let p = 0; p < points[i].length; p++) {
        const diff = Math.abs(points[i][p] - points[j][p]);
        v += distance === "manhattan" ? diff : diff * diff;
      }
      d[i][j] = distance === "manhattan" ? v : Math.sqrt(v);
      d[j][i] = d[i][j];
    }
  }
  return d;
}

/** Within-cluster sum of squares for one partition: the pairwise form
 *  W = Σ_clusters (1 / 2n_r) Σ_{i<i′ in cluster} d(i, i′)² — for Euclidean
 *  distances this is exactly Σ_clusters Σ_{i in cluster} ‖x_i − x̄_r‖², and
 *  for Manhattan it is the same quantity's natural generalisation, so the
 *  Elbow values agree with the Gap statistic's log W. */
export function hclustWithinSs(assign: number[], dist: number[][]): number {
  const clusters = new Map<number, number[]>();
  assign.forEach((c, i) => {
    const members = clusters.get(c) ?? [];
    members.push(i);
    clusters.set(c, members);
  });
  let w = 0;
  for (const members of clusters.values()) w += hclustClusterWithinSs(members, dist);
  return w;
}

/** One cluster's within-cluster sum of squares: (1 / 2n) Σ_{i<i′} d(i, i′)²
 *  over its members — 0 for a singleton. */
export function hclustClusterWithinSs(members: number[], dist: number[][]): number {
  if (members.length < 2) return 0;
  let s = 0;
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      const d = dist[members[a]][members[b]];
      s += d * d;
    }
  }
  return s / (2 * members.length);
}

/** The average silhouette width of one partition (Rousseeuw 1987): for each
 *  point, a = its mean distance to its own cluster, b = its smallest mean
 *  distance to another cluster, s = (b − a) / max(a, b) — 0 for a singleton
 *  cluster, 0 when a and b are both 0 (identical points). Near 1 is a clean
 *  partition, near 0 overlapping clusters, negative a misassignment. */
export function hclustAvgSilhouette(assign: number[], dist: number[][]): number {
  const n = assign.length;
  if (n < 2) return 0;
  const clusters = new Map<number, number[]>();
  assign.forEach((c, i) => {
    const members = clusters.get(c) ?? [];
    members.push(i);
    clusters.set(c, members);
  });
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = clusters.get(assign[i]) ?? [];
    if (own.length < 2) continue; // singleton: s = 0, contributes nothing
    const a = own.reduce((s, j) => s + (j === i ? 0 : dist[i][j]), 0) / (own.length - 1);
    let b = Infinity;
    for (const [c, members] of clusters) {
      if (c === assign[i]) continue;
      const m = members.reduce((s, j) => s + dist[i][j], 0) / members.length;
      if (m < b) b = m;
    }
    const m = Math.max(a, b);
    total += m === 0 ? 0 : (b - a) / m;
  }
  return total / n;
}

/** The smallest k the Gap 1-SE rule picks (Tibshirani et al. 2001): the
 *  smallest k whose Gap is within one standard error of the next k's Gap.
 *  Null when no Gap value is usable, or the range's top k when no k
 *  qualifies. */
export function hclustSuggestedK(rows: ChoosingKRow[]): number | null {
  const usable = rows.filter((r) => r.gap != null && r.gapSe != null);
  if (usable.length < 2) return null;
  for (let i = 0; i < usable.length - 1; i++) {
    if ((usable[i].gap ?? 0) >= (usable[i + 1].gap ?? 0) - (usable[i + 1].gapSe ?? 0)) {
      return usable[i].k;
    }
  }
  return usable[usable.length - 1].k;
}

export async function runHierarchicalClustering(
  columns: Column[],
  params: HclustParams | undefined,
  titles?: (string | null)[],
): Promise<AnalysisOutcome> {
  const vars = dataGroups(columns);
  if (vars.length < 2) {
    return { error: "Hierarchical clustering needs at least 2 variables containing numeric data." };
  }
  const k = params?.clusters ?? 2;
  if (!Number.isInteger(k) || k < 2) {
    return { error: "Hierarchical clustering needs at least 2 clusters." };
  }
  // A file's value outside the choices takes the default (see types.ts):
  // an unknown linkage or distance reads as complete / Euclidean.
  const linkage: HclustLinkage =
    params?.linkage === "average" || params?.linkage === "single" || params?.linkage === "ward.D2"
      ? params.linkage
      : "complete";
  const distance: HclustDistance = params?.distance === "manhattan" ? "manhattan" : "euclidean";
  if (linkage === "ward.D2" && distance === "manhattan") {
    return {
      error:
        "Ward's linkage needs Euclidean distances — it measures the increase in within-cluster variance, " +
        "which is only defined for straight-line distances. Pick Euclidean distance, or another linkage.",
    };
  }
  // Standardise by default (Prism's default): z-score each variable first.
  const standardise = params?.standardise !== false;
  // Complete cases: the rows where every variable used has a value.
  const aligned = pairedGroups(vars).map((g) => g.values);
  const n = aligned[0].length;
  const p = vars.length;
  const dropped = incompleteRows(vars);
  if (n < 2) {
    return { error: "Hierarchical clustering needs at least 2 complete rows (rows measured in every variable)." };
  }
  if (k >= n) {
    return {
      error: `Hierarchical clustering needs fewer clusters than observations (k = ${k}, ${n} complete rows).`,
    };
  }
  // A constant variable has SD 0: z-scoring divides by zero, so name it
  // before calling R (same convention as K-means). In the original units a
  // constant variable is fine — it just contributes nothing to the
  // distances — so the check only applies when standardising.
  if (standardise) {
    const constantIdx = aligned.findIndex((col) => sd(col) === 0);
    if (constantIdx >= 0) {
      const constant = vars[constantIdx];
      return {
        error:
          `“${constant.name}” is constant — Hierarchical clustering cannot standardise a variable with no ` +
          `variation. Remove it from the table, or run without standardisation instead.`,
      };
    }
  }

  // The choosing-k range: k = 2..KMAX, capped by the observations.
  const kMax = Math.min(HCLUST_MAX_K, n - 1);
  const ks = Array.from({ length: kMax - 1 }, (_, i) => i + 2);

  // The matrix fills column by column (R's default), and `aligned` is one
  // group (column) per entry — so the flat group-major vector lands as the
  // table's columns, no byrow needed.
  const decls = `m<-matrix(${rVec(aligned.flat())},nrow=${n},ncol=${p})`;
  const scaled = standardise ? "m<-scale(m);" : "";
  const treeCode = `${decls};${scaled}d<-dist(m,method="${distance}");hc<-hclust(d,method="${linkage}");` +
    `mg<-as.vector(hc$merge);hg<-hc$height;od<-hc$order;` +
    ks.map((kk) => `ct${kk}<-cutree(hc,k=${kk});`).join("");
  const mergeKeys = Array.from({ length: 2 * (n - 1) }, (_, i) => `mg${i}=mg[${i + 1}]`);
  const heightKeys = Array.from({ length: n - 1 }, (_, i) => `hg${i}=hg[${i + 1}]`);
  const orderKeys = Array.from({ length: n }, (_, i) => `od${i}=od[${i + 1}]`);
  const assignKeys = ks.flatMap((kk) => Array.from({ length: n }, (_, i) => `a${kk}_${i}=ct${kk}[${i + 1}]`));
  const v: RVector = await evalNamedVector(
    `${treeCode}c(${[...mergeKeys, ...heightKeys, ...orderKeys, ...assignKeys].join(",")})`,
  );

  // The merge matrix is column-major in the flat vector: mg[j*(n-1)+i] is
  // merge step i's j-th entry. R's convention is kept as-is: a negative
  // entry −i is leaf i (1-based), a positive entry j is merge step j
  // (1-based) — the sign is what tells a leaf from a step.
  const merge: number[][] = Array.from({ length: n - 1 }, (_, i) =>
    [0, 1].map((j) => v[`mg${j * (n - 1) + i}`] ?? 0),
  );
  const heights = Array.from({ length: n - 1 }, (_, i) => v[`hg${i}`] ?? 0);
  // R's order is 1-based leaf numbers; the dendrogram stores 0-based
  // indices into the complete rows.
  const order = Array.from({ length: n }, (_, i) => (v[`od${i}`] ?? i + 1) - 1);
  const assignmentsByK = new Map<number, number[]>(
    ks.map((kk) => [kk, Array.from({ length: n }, (_, i) => v[`a${kk}_${i}`] ?? 1)]),
  );

  // The clustered space, in row order: z-scores when standardising (with
  // the sample SD R's scale() uses), else the original units — the same
  // values the distances were computed from.
  const means = aligned.map((col) => mean(col));
  const sds = aligned.map((col) => sd(col));
  const points: number[][] = Array.from({ length: n }, (_, i) =>
    aligned.map((col, j) => (standardise ? (col[i] - means[j]) / sds[j] : col[i])),
  );
  const dist = hclustDistanceMatrix(points, distance);

  // The choosing-k diagnostics for every k in the range.
  const choosingK: ChoosingKRow[] = ks.map((kk) => ({
    k: kk,
    withinSs: hclustWithinSs(assignmentsByK.get(kk) ?? [], dist),
    avgSilhouette: hclustAvgSilhouette(assignmentsByK.get(kk) ?? [], dist),
    gap: null,
    gapSe: null,
  }));

  // The Gap statistic (Tibshirani et al. 2001): log W of the observed tree
  // against B uniform reference sets over each variable's range, in the
  // clustered space. A second R call — the reference trees are new hclusts,
  // not cut from the observed one. If it fails, the Gap column stays null
  // and the note says so, instead of failing the whole analysis.
  let gapFailed = false;
  try {
    const wkFn =
      `wk<-function(x,cl){s<-0;for(r in unique(cl)){idx<-which(cl==r);m<-length(idx);` +
      `if(m>1){dd<-dist(x[idx,,drop=FALSE],method="${distance}");s<-s+sum(dd^2)/(2*m)}};s};`;
    // The reference loop indexes ks by position, so build its body with
    // the position-matched k values.
    const refLoop = ks.map((kk, q) => `ref[b,${q + 1}]<-log(wk(u,cutree(hu,k=${kk})))`).join(";");
    const gapCode =
      `${decls};${scaled}d<-dist(m,method="${distance}");hc<-hclust(d,method="${linkage}");${wkFn}` +
      `set.seed(${SEED});B<-${GAP_REFERENCES};lo<-apply(m,2,min);hi<-apply(m,2,max);` +
      `ref<-matrix(0,nrow=B,ncol=${ks.length});` +
      `for(b in 1:B){u<-matrix(runif(${n}*${p}),nrow=${n});` +
      `for(j in 1:${p})u[,j]<-lo[j]+u[,j]*(hi[j]-lo[j]);` +
      `du<-dist(u,method="${distance}");hu<-hclust(du,method="${linkage}");${refLoop}};` +
      `gap<-colMeans(ref)-c(${ks.map((kk) => `log(wk(m,cutree(hc,k=${kk})))`).join(",")});` +
      `se<-sqrt(1+1/B)*apply(ref,2,sd);` +
      `c(${ks.map((kk, q) => `g${kk}=gap[${q + 1}],e${kk}=se[${q + 1}]`).join(",")})`;
    const g: RVector = await evalNamedVector(gapCode);
    for (const row of choosingK) {
      row.gap = g[`g${row.k}`] ?? null;
      row.gapSe = g[`e${row.k}`] ?? null;
    }
  } catch {
    gapFailed = true;
  }
  const suggestedK = hclustSuggestedK(choosingK);
  // When every within-cluster sum of squares is 0 (e.g. all rows
  // identical), log W is −Inf, so the Gap statistic is not defined for any
  // k — the table shows nulls, and the note says why instead of claiming
  // the Gap column is covered.
  const gapAllNull = choosingK.every((r) => r.gap == null);

  // Cluster labels are arbitrary (R numbers clusters by leaf order): the
  // chosen k's clusters are canonicalised by sorting on their centroid's
  // first coordinate (ascending), then the next coordinates — the same
  // convention as K-means — so a stored result is stable and two runs agree.
  const chosenAssign = assignmentsByK.get(k) ?? [];
  const completeRows = vars[0].rows.filter((r) => vars.every((c) => c.byRow[r] != null));
  const labels = completeRows.map((r) => titles?.[r]?.trim() || `Row ${r + 1}`);
  const centroidOf = (members: number[]): (number | null)[] =>
    aligned.map((col) => (members.length ? mean(members.map((i) => col[i])) : null));
  const clusterIds = [...new Set(chosenAssign)].sort((a, b) => a - b);
  const centroids = new Map(clusterIds.map((c) => [c, centroidOf(chosenAssign.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0))]));
  const order2 = [...clusterIds].sort((a, b) => {
    const ca = centroids.get(a) ?? [];
    const cb = centroids.get(b) ?? [];
    for (let j = 0; j < p; j++) {
      const d = (ca[j] ?? 0) - (cb[j] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  const relabel = new Map(order2.map((old, idx) => [old, idx + 1]));
  const clusters: HclustClusterRow[] = order2.map((old, idx) => {
    const members = chosenAssign.map((a, i) => (a === old ? i : -1)).filter((i) => i >= 0);
    return {
      cluster: `Cluster ${idx + 1}`,
      centroid: centroids.get(old) ?? [],
      n: members.length,
      withinSs: hclustClusterWithinSs(members, dist),
    };
  });
  const assignments: HclustAssignmentRow[] = labels.map((row, i) => ({
    row,
    cluster: relabel.get(chosenAssign[i]) ?? 1,
  }));

  // The tree is cut for k clusters between the (n−k)-th and (n−k+1)-th
  // merge heights (0-based heights[n−k−1] and heights[n−k]): the midpoint.
  const cutHeight = (heights[n - k - 1] + heights[n - k]) / 2;
  const dendrogram: HclustDendrogram = { merge, heights, order, labels, cutHeight };

  const { groups: described } = await describe(pairedGroups(vars));
  const linkageLabel =
    linkage === "complete"
      ? "complete linkage (farthest pair)"
      : linkage === "average"
        ? "average linkage (mean pair distance)"
        : linkage === "single"
          ? "single linkage (nearest pair)"
          : "Ward's linkage (smallest increase in within-cluster variance)";
  const notes: string[] = [
    standardise
      ? "Hierarchical clustering on standardised variables (z-scores) — each variable scaled to mean 0, SD 1 before clustering. Cluster centroids are reported back-transformed to the original units."
      : "Hierarchical clustering on the variables in their original units.",
    `Agglomerative clustering, ${linkageLabel}, ${distance === "euclidean" ? "Euclidean" : "Manhattan"} distances. ` +
      `The clustering is deterministic — the same table and settings always give the same tree.`,
    dropped > 0
      ? `Uses ${n} complete rows (${dropped} row${dropped === 1 ? "" : "s"} left out for missing data).`
      : `Uses ${n} complete rows.`,
    gapFailed
      ? `Choosing k covers k = 2–${kMax} (within-cluster sum of squares and average silhouette width); the Gap statistic could not be computed for this data.`
      : gapAllNull
        ? `Choosing k covers k = 2–${kMax} (within-cluster sum of squares and average silhouette width); the Gap statistic is not defined for this data (every within-cluster sum of squares is 0).`
        : `Choosing k covers k = 2–${kMax}: within-cluster sum of squares (Elbow), average silhouette width, and the Gap statistic against ${GAP_REFERENCES} uniform reference sets (seed 1).` +
          (suggestedK != null ? ` The Gap 1-SE rule suggests k = ${suggestedK}.` : ""),
  ];
  return {
    testType: "hierarchical-clustering",
    subtitle: "Hierarchical clustering",
    stats: [
      { label: "Number of clusters (k)", value: k },
      { label: "Complete rows (n)", value: n },
      { label: "Variables (p)", value: p },
      { label: "Suggested k (Gap 1-SE rule)", value: suggestedK },
    ],
    groups: described,
    notes: notes.join(" "),
    hclustClusters: clusters,
    hclustAssignments: assignments,
    hclustDendrogram: dendrogram,
    choosingK,
  };
}
