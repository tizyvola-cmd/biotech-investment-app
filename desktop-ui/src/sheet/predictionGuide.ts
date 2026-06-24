/**
 * Prediction Guide — μ macro-group curves around the CD (alignment with the Simulation sheet / charts).
 * Client-side aggregation from the Accuracy sheet; reference μ from simulation_charts when present.
 */

import type { ChartBundle, ChartSeries } from "../types";
import { api } from "../api/supernova";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import {
  ACCURACY_OFFSETS,
  parseSheetPct,
  rowIsPast,
  storicoColumn,
} from "./accuracyMetrics";

export const GUIDE_OFFSETS = [...ACCURACY_OFFSETS] as const;

/** Post-CD threshold: post mean − pre mean (pp), like PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP. */
export const POST_CD_EPS_PP = 0.25;

/** Pre-CD (~2 months): T−10 vs T−60 change (pp). */
export const PRE_CD_RALLY_PP = 5;
export const PRE_CD_FALL_PP = -5;

const PRE_CD_WINDOW = [-7, -5, -3] as const;
const POST_CD_WINDOW = [4, 7] as const;

export type PostCdClass = "rialzo" | "ribasso" | "neutro";
export type PreCdClass = "pre_rally" | "pre_fall" | "pre_flat";

export type MacroGroupId =
  | "globale"
  | "cluster0"
  | "cluster1"
  | "post_rialzo"
  | "post_ribasso"
  | "post_neutro"
  | "pre_rally"
  | "pre_fall"
  | "pre_flat";

export const MACRO_GROUP_LABELS: Record<MacroGroupId, string> = {
  globale: "Global (primary cohort)",
  cluster0: "Cluster 0 (majority)",
  cluster1: "SuperNova (cl.1)",
  post_rialzo: "Post-CD rise",
  post_ribasso: "Post-CD decline",
  post_neutro: "Post-CD neutral",
  pre_rally: "Pre-CD rise (~2 months)",
  pre_fall: "Pre-CD decline (~2 months)",
  pre_flat: "Pre-CD flat (~2 months)",
};

export const MACRO_GROUP_COLORS: Record<MacroGroupId, string> = {
  globale: "#94a3b8",
  cluster0: "#9ca3af",
  cluster1: "#c8ff00",
  post_rialzo: "#00c896",
  post_ribasso: "#fb7185",
  post_neutro: "#a8b0bc",
  pre_rally: "#78c8ff",
  pre_fall: "#af8cff",
  pre_flat: "#64748b",
};

export type GuideCurvePoint = {
  offset: number;
  xLabel: string;
  meanPct: number | null;
  n: number;
};

export type PredictionGuideSnapshot = {
  computedAt: string;
  nEligible: number;
  nClassifiedPost: number;
  groupCounts: Partial<Record<MacroGroupId, number>>;
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>;
  /** μ from chart JSON (ref:…) — overrides only series with matching names. */
  refCurves: Partial<Record<string, GuideCurvePoint[]>>;
  refSource: string;
  dataSource: string;
  signature: string;
};

export type WeeklyGuideEntry = {
  weekKey: string;
  computedAt: string;
  nSamples: number;
  signature: string;
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>;
  groupCounts: Partial<Record<MacroGroupId, number>>;
};

const WEEKLY_STORAGE_KEY = "supernova_prediction_guide_weekly_v1";

function resolveSponsorColumn(columns?: string[]): string | null {
  const candidates = [
    "Exact·Partial vs Unmatch",
    "Sponsor Match",
    "Sponsor match",
    "Sponsor\nmatch",
  ];
  for (const c of candidates) {
    if (columns?.includes(c)) return c;
  }
  if (columns) {
    for (const col of columns) {
      const norm = col.replace(/\s/g, "").toLowerCase();
      if (norm.includes("sponsormatch") || norm.includes("exactpartial")) return col;
    }
  }
  return null;
}

function sponsorPrimary(row: Record<string, unknown>, columns?: string[]): boolean {
  const sponsorCol = resolveSponsorColumn(columns);
  const sm = String(
    (sponsorCol ? row[sponsorCol] : null) ??
      row["Exact·Partial vs Unmatch"] ??
      row["Sponsor Match"] ??
      row["Sponsor match"] ??
      row["Sponsor\nmatch"] ??
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/·/g, " ")
    .replace(/\s+/g, " ");
  if (!sm || sm === "n/d" || sm === "—") return true;
  if (sm === "exact" || sm === "partial") return true;
  if (sm.startsWith("exact") || sm.startsWith("partial")) return true;
  return false;
}

/** Find Storico % column for offset (tolerant to − vs - and spaces). */
export function resolveStoricoColumn(columns: string[] | undefined, off: number): string {
  const canonical = storicoColumn(off);
  if (!columns?.length) return canonical;
  if (columns.includes(canonical)) return canonical;

  const tail = off > 0 ? `+${off}` : String(off);
  const tailUnicode = off > 0 ? `+${off}` : `−${Math.abs(off)}`;

  for (const col of columns) {
    if (!/storico/i.test(col)) continue;
    const norm = col.replace(/\s/g, "").replace(/−/g, "-");
    if (
      col.includes(`T${tail}`) ||
      col.includes(`T${tailUnicode}`) ||
      col.endsWith(tail) ||
      col.endsWith(tailUnicode) ||
      norm.includes(`T${tail}`) ||
      norm.includes(`T${tailUnicode}`)
    ) {
      return col;
    }
  }
  return canonical;
}

function trajectoryFromRow(
  row: Record<string, unknown>,
  columns?: string[]
): Map<number, number> | null {
  const map = new Map<number, number>();
  for (const off of GUIDE_OFFSETS) {
    const col = resolveStoricoColumn(columns, off);
    const v = parseSheetPct(row[col]);
    if (v !== null) map.set(off, v);
  }
  return map.size >= 4 ? map : null;
}

export type GuideBuildDiagnostics = {
  nRows: number;
  nPastCd: number;
  nSponsorOk: number;
  nWithTrajectory: number;
};

function normalizeRefLabel(label: string): string {
  return label.trim().toLowerCase().replace(/^μ\s+/, "").replace(/\s+/g, " ");
}

function macroGroupFromRefLabel(label: string, sid: string): MacroGroupId | undefined {
  const direct = REF_LABEL_TO_GROUP[label];
  if (direct) return direct;

  const norm = normalizeRefLabel(label);
  const sidNorm = normalizeRefLabel(sid.replace(/^ref:/, ""));

  if (norm.includes("globale") || norm.includes("primaria") || sidNorm.includes("primary")) {
    return "globale";
  }
  if (norm.includes("post-cd") && norm.includes("rialzo")) return "post_rialzo";
  if (norm.includes("post-cd") && norm.includes("ribasso")) return "post_ribasso";
  if (norm.includes("post-cd") && norm.includes("neutro")) return "post_neutro";
  if (norm.includes("supernova") || norm.includes("cl.1") || norm.includes("cluster 1")) {
    return "cluster1";
  }
  if (norm.includes("cluster 0") || norm.includes("cluster0")) return "cluster0";
  return undefined;
}

function avg(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function classifyPostCd(traj: Map<number, number>): PostCdClass | null {
  const pre = PRE_CD_WINDOW.map((o) => traj.get(o)).filter((v): v is number => v != null);
  const post = POST_CD_WINDOW.map((o) => traj.get(o)).filter((v): v is number => v != null);
  if (pre.length < 2 || post.length < 1) return null;
  const dlt = avg(post) - avg(pre);
  if (dlt > POST_CD_EPS_PP) return "rialzo";
  if (dlt < -POST_CD_EPS_PP) return "ribasso";
  return "neutro";
}

export function classifyPreCd(traj: Map<number, number>): PreCdClass | null {
  const v60 = traj.get(-60);
  const v10 = traj.get(-10);
  if (v60 == null || v10 == null) return null;
  const d = v10 - v60;
  if (d > PRE_CD_RALLY_PP) return "pre_rally";
  if (d < PRE_CD_FALL_PP) return "pre_fall";
  return "pre_flat";
}

function aggregateCurves(
  buckets: Map<MacroGroupId, Map<number, number[]>>
): Partial<Record<MacroGroupId, GuideCurvePoint[]>> {
  const out: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
  for (const [gid, byOff] of buckets) {
    const points: GuideCurvePoint[] = [];
    for (const off of GUIDE_OFFSETS) {
      const vals = byOff.get(off);
      if (!vals?.length) {
        points.push({
          offset: off,
          xLabel: off > 0 ? `+${off}` : String(off),
          meanPct: null,
          n: 0,
        });
        continue;
      }
      points.push({
        offset: off,
        xLabel: off > 0 ? `+${off}` : String(off),
        meanPct: vals.reduce((a, b) => a + b, 0) / vals.length,
        n: vals.length,
      });
    }
    out[gid] = points;
  }
  return out;
}

export function buildPredictionGuideFromAccuracy(
  rows: Record<string, unknown>[],
  dataSource = "foglio Accuracy",
  columns?: string[]
): PredictionGuideSnapshot & { diagnostics: GuideBuildDiagnostics } {
  const diag: GuideBuildDiagnostics = {
    nRows: 0,
    nPastCd: 0,
    nSponsorOk: 0,
    nWithTrajectory: 0,
  };
  const buckets = new Map<MacroGroupId, Map<number, number[]>>();
  const groupCounts: Partial<Record<MacroGroupId, number>> = {};
  let nEligible = 0;
  let nClassifiedPost = 0;

  const ensure = (gid: MacroGroupId) => {
    if (!buckets.has(gid)) buckets.set(gid, new Map());
    groupCounts[gid] = (groupCounts[gid] ?? 0) + 1;
  };

  const pushTraj = (gid: MacroGroupId, traj: Map<number, number>) => {
    ensure(gid);
    const byOff = buckets.get(gid)!;
    for (const [off, v] of traj) {
      if (!byOff.has(off)) byOff.set(off, []);
      byOff.get(off)!.push(v);
    }
  };

  for (const row of rows) {
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.startsWith("──")) continue;
    diag.nRows += 1;
    if (!rowIsPast(row)) continue;
    diag.nPastCd += 1;
    if (!sponsorPrimary(row, columns)) continue;
    diag.nSponsorOk += 1;

    const traj = trajectoryFromRow(row, columns);
    if (!traj) continue;
    diag.nWithTrajectory += 1;

    nEligible += 1;
    pushTraj("globale", traj);

    const post = classifyPostCd(traj);
    if (post) {
      nClassifiedPost += 1;
      pushTraj(`post_${post}` as MacroGroupId, traj);
    }

    const pre = classifyPreCd(traj);
    if (pre) pushTraj(pre, traj);
  }

  const signature = `acc:${nEligible}:${rows.length}`;
  return {
    computedAt: new Date().toISOString(),
    nEligible,
    nClassifiedPost,
    groupCounts,
    curves: aggregateCurves(buckets),
    refCurves: {},
    refSource: "",
    dataSource,
    signature,
    diagnostics: diag,
  };
}

const REF_LABEL_TO_GROUP: Record<string, MacroGroupId> = {
  "Globale primaria": "globale",
  "μ Globale primaria": "globale",
  "Cluster 0": "cluster0",
  "μ Cluster 0": "cluster0",
  "SuperNova (cl.1)": "cluster1",
  "μ SuperNova (cl.1)": "cluster1",
  "Post-CD rialzo": "post_rialzo",
  "Post-CD ribasso": "post_ribasso",
  "μ Post-CD rialzo": "post_rialzo",
  "μ Post-CD ribasso": "post_ribasso",
  "Post-CD neutro": "post_neutro",
  "μ Post-CD neutro": "post_neutro",
};

function curvePeakPct(points: GuideCurvePoint[] | undefined): number | null {
  if (!points?.length) return null;
  const vals = points
    .map((p) => p.meanPct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  return vals.length ? Math.max(...vals) : null;
}

/** k-means id 1 = minority by count; swap μ refs when minority curve is flatter. */
export function fixInvertedClusterRefCurves(
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>,
): Partial<Record<MacroGroupId, GuideCurvePoint[]>> {
  const c0 = curves.cluster0;
  const c1 = curves.cluster1;
  const p0 = curvePeakPct(c0);
  const p1 = curvePeakPct(c1);
  if (p0 == null || p1 == null || p0 <= p1 + 8) return curves;
  return { ...curves, cluster0: c1, cluster1: c0 };
}

export function refCurvesFromChartBundle(bundle: ChartBundle | null): {
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>;
  source: string;
} {
  if (!bundle?.series) return { curves: {}, source: "" };
  const out: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
  let n = 0;

  for (const [sid, meta] of Object.entries(bundle.series)) {
    if (meta.kind !== "control") continue;
    const label = meta.label || sid.replace(/^ref:/, "");
    const gid = macroGroupFromRefLabel(label, sid);
    if (!gid) continue;
    const points = seriesToGuidePoints(meta);
    if (points.some((p) => p.meanPct != null)) {
      out[gid] = points;
      n += 1;
    }
  }

  const curves = fixInvertedClusterRefCurves(out);

  return {
    curves,
    source: n > 0 ? `simulation_charts (${n} μ)` : "",
  };
}

/** Loads reference μ curves: local snapshot → simulation API → restricted API. */
export async function loadPredictionGuideRefCurves(): Promise<{
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>;
  source: string;
}> {
  const local = await loadSimulationChartsBundle();
  let ref = refCurvesFromChartBundle(local.bundle);
  if (ref.source) return ref;

  for (const path of ["/api/charts/simulation", "/api/charts/ristretta"] as const) {
    try {
      const bundle = await api<ChartBundle>(path, undefined, { timeoutMs: 8_000 });
      ref = refCurvesFromChartBundle(bundle);
      if (ref.source) {
        return {
          curves: ref.curves,
          source: `${ref.source} · ${path}`,
        };
      }
    } catch {
      /* API not available */
    }
  }

  return { curves: {}, source: "" };
}

function seriesToGuidePoints(meta: ChartSeries): GuideCurvePoint[] {
  return GUIDE_OFFSETS.map((off) => {
    const pt = (meta.points ?? []).find((p) => p.offset === off);
    const v =
      pt?.pct_curva ?? pt?.pct_reale ?? pt?.pct_modello ?? null;
    return {
      offset: off,
      xLabel: off > 0 ? `+${off}` : String(off),
      meanPct: v != null && v === v ? Number(v) : null,
      n: v != null ? 1 : 0,
    };
  });
}

export function mergeGuideWithRefs(
  base: PredictionGuideSnapshot,
  refCurves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>,
  refSource: string
): PredictionGuideSnapshot {
  return {
    ...base,
    refCurves,
    refSource,
  };
}

export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

type WeeklyStore = { weeks: WeeklyGuideEntry[] };

function loadWeeklyStore(): WeeklyStore {
  if (typeof window === "undefined") return { weeks: [] };
  try {
    const raw = localStorage.getItem(WEEKLY_STORAGE_KEY);
    if (!raw) return { weeks: [] };
    const p = JSON.parse(raw) as WeeklyStore;
    return Array.isArray(p.weeks) ? p : { weeks: [] };
  } catch {
    return { weeks: [] };
  }
}

function saveWeeklyStore(store: WeeklyStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WEEKLY_STORAGE_KEY, JSON.stringify(store));
}

export type WeeklyGuideState = {
  thisWeek: WeeklyGuideEntry | null;
  lastWeek: WeeklyGuideEntry | null;
  newThisWeek: number;
  deltaVsLastWeek: number | null;
};

/** Keeps at most 2 weeks (current + previous). */
export function persistWeeklyGuide(snapshot: PredictionGuideSnapshot): WeeklyGuideState {
  const weekKey = isoWeekKey();
  const store = loadWeeklyStore();
  const existingIdx = store.weeks.findIndex((w) => w.weekKey === weekKey);
  const prevEntry = existingIdx >= 0 ? store.weeks[existingIdx] : null;
  const nAtWeekStart = prevEntry?.nSamples ?? snapshot.nEligible;

  const entry: WeeklyGuideEntry = {
    weekKey,
    computedAt: snapshot.computedAt,
    nSamples: snapshot.nEligible,
    signature: snapshot.signature,
    curves: snapshot.curves,
    groupCounts: snapshot.groupCounts,
  };

  let weeks = [...store.weeks];
  if (existingIdx >= 0) weeks[existingIdx] = entry;
  else weeks.push(entry);

  weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  weeks = weeks.slice(0, 2);

  saveWeeklyStore({ weeks });

  const thisWeek = weeks.find((w) => w.weekKey === weekKey) ?? null;
  const lastWeek = weeks.find((w) => w.weekKey !== weekKey) ?? null;

  return {
    thisWeek,
    lastWeek,
    newThisWeek: Math.max(0, snapshot.nEligible - nAtWeekStart),
    deltaVsLastWeek: lastWeek ? snapshot.nEligible - lastWeek.nSamples : null,
  };
}

export function guideToChartRows(
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>,
  ids: MacroGroupId[]
): Record<string, string | number>[] {
  const byOff = new Map<number, Record<string, string | number>>();
  for (const id of ids) {
    for (const pt of curves[id] ?? []) {
      if (pt.meanPct == null) continue;
      let rec = byOff.get(pt.offset);
      if (!rec) {
        rec = { offset: pt.offset, xLabel: pt.xLabel };
        byOff.set(pt.offset, rec);
      }
      rec[id] = pt.meanPct;
    }
  }
  return [...byOff.values()].sort((a, b) => Number(a.offset) - Number(b.offset));
}

/** Post-CD macro-groups in the Distribution & curves panel. */
export const GUIDE_POST_MACRO_GROUPS: MacroGroupId[] = [
  "globale",
  "cluster0",
  "cluster1",
  "post_rialzo",
  "post_ribasso",
  "post_neutro",
];

/** Pre-CD macro-groups (~2 months). */
export const GUIDE_PRE_MACRO_GROUPS: MacroGroupId[] = ["pre_rally", "pre_fall", "pre_flat"];

/** Only μ JSON — no empirical Accuracy aggregation. */
export const GUIDE_REF_ONLY_MACRO_GROUPS = new Set<MacroGroupId>(["cluster0", "cluster1"]);

export type GuideCurveVisibilityPrefs = {
  post: Partial<Record<MacroGroupId, boolean>>;
  pre: Partial<Record<MacroGroupId, boolean>>;
};

const VISIBILITY_STORAGE_KEY = "supernova_prediction_guide_visible_v1";

function defaultVisibility(all: MacroGroupId[]): Partial<Record<MacroGroupId, boolean>> {
  const out: Partial<Record<MacroGroupId, boolean>> = {};
  for (const id of all) out[id] = true;
  return out;
}

export function loadGuideCurveVisibility(): GuideCurveVisibilityPrefs {
  if (typeof window === "undefined") {
    return {
      post: defaultVisibility(GUIDE_POST_MACRO_GROUPS),
      pre: defaultVisibility(GUIDE_PRE_MACRO_GROUPS),
    };
  }
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return {
        post: defaultVisibility(GUIDE_POST_MACRO_GROUPS),
        pre: defaultVisibility(GUIDE_PRE_MACRO_GROUPS),
      };
    }
    const p = JSON.parse(raw) as Partial<GuideCurveVisibilityPrefs>;
    return {
      post: { ...defaultVisibility(GUIDE_POST_MACRO_GROUPS), ...(p.post ?? {}) },
      pre: { ...defaultVisibility(GUIDE_PRE_MACRO_GROUPS), ...(p.pre ?? {}) },
    };
  } catch {
    return {
      post: defaultVisibility(GUIDE_POST_MACRO_GROUPS),
      pre: defaultVisibility(GUIDE_PRE_MACRO_GROUPS),
    };
  }
}

export function saveGuideCurveVisibility(prefs: GuideCurveVisibilityPrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(prefs));
}

export function filterVisibleGuideGroups(
  all: MacroGroupId[],
  vis: Partial<Record<MacroGroupId, boolean>>
): MacroGroupId[] {
  return all.filter((id) => vis[id] !== false);
}

export type GuideVisibilityPreset =
  | "all"
  | "none"
  | "noSupernova"
  | "noCluster"
  | "postCdOnly"
  | "empiricalOnly";

export function visibilityForGuidePreset(
  preset: GuideVisibilityPreset,
  chart: "post" | "pre"
): Partial<Record<MacroGroupId, boolean>> {
  const all = chart === "post" ? GUIDE_POST_MACRO_GROUPS : GUIDE_PRE_MACRO_GROUPS;
  const out = defaultVisibility(all);
  if (preset === "all") return out;
  if (preset === "none") {
    for (const id of all) out[id] = false;
    return out;
  }
  if (chart === "post") {
    if (preset === "noSupernova") out.cluster1 = false;
    if (preset === "noCluster") {
      out.cluster0 = false;
      out.cluster1 = false;
    }
    if (preset === "postCdOnly") {
      out.globale = false;
      out.cluster0 = false;
      out.cluster1 = false;
    }
    if (preset === "empiricalOnly") {
      out.cluster0 = false;
      out.cluster1 = false;
    }
  }
  return out;
}
