/**
 * Predizione-guida — curve μ macro-gruppi attorno al CD (allineamento foglio / grafici Simulation).
 * Aggregazione client da foglio Accuracy; μ di riferimento da simulation_charts quando presenti.
 */

import type { ChartBundle, ChartSeries } from "../types";
import {
  ACCURACY_OFFSETS,
  parseSheetPct,
  rowIsPast,
  storicoColumn,
} from "./accuracyMetrics";

export const GUIDE_OFFSETS = [...ACCURACY_OFFSETS] as const;

/** Soglia Post-CD: media post − media pre (pp), come PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP. */
export const POST_CD_EPS_PP = 0.25;

/** Pre-CD (~2 mesi): variazione T−10 vs T−60 (pp). */
export const PRE_CD_RALLY_PP = 5;
export const PRE_CD_FALL_PP = -5;

const PRE_CD_WINDOW = [-7, -5, -3] as const;
const POST_CD_WINDOW = [4, 7] as const;

export type PostCdClass = "rialzo" | "ribasso" | "neutro";
export type PreCdClass = "pre_rally" | "pre_fall" | "pre_flat";

export type MacroGroupId =
  | "globale"
  | "post_rialzo"
  | "post_ribasso"
  | "post_neutro"
  | "pre_rally"
  | "pre_fall"
  | "pre_flat";

export const MACRO_GROUP_LABELS: Record<MacroGroupId, string> = {
  globale: "Globale (coorte primaria)",
  post_rialzo: "Post-CD rialzo",
  post_ribasso: "Post-CD ribasso",
  post_neutro: "Post-CD neutro",
  pre_rally: "Pre-CD rialzo (~2 mesi)",
  pre_fall: "Pre-CD ribasso (~2 mesi)",
  pre_flat: "Pre-CD laterale (~2 mesi)",
};

export const MACRO_GROUP_COLORS: Record<MacroGroupId, string> = {
  globale: "#94a3b8",
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
  /** μ da JSON grafici (ref:…) — sovrascrive solo le serie omonime. */
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

function sponsorPrimary(row: Record<string, unknown>): boolean {
  const sm = String(row["Exact·Partial vs Unmatch"] ?? row["Sponsor Match"] ?? "")
    .trim()
    .toLowerCase();
  return sm === "exact" || sm === "partial";
}

function trajectoryFromRow(row: Record<string, unknown>): Map<number, number> | null {
  const map = new Map<number, number>();
  for (const off of GUIDE_OFFSETS) {
    const v = parseSheetPct(row[storicoColumn(off)]);
    if (v !== null) map.set(off, v);
  }
  return map.size >= 4 ? map : null;
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
  dataSource = "foglio Accuracy"
): PredictionGuideSnapshot {
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
    if (!rowIsPast(row)) continue;
    if (!sponsorPrimary(row)) continue;

    const traj = trajectoryFromRow(row);
    if (!traj) continue;

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
  };
}

const REF_LABEL_TO_GROUP: Record<string, MacroGroupId> = {
  "Globale primaria": "globale",
  "μ Globale primaria": "globale",
  "Post-CD rialzo": "post_rialzo",
  "Post-CD ribasso": "post_ribasso",
  "μ Post-CD rialzo": "post_rialzo",
  "μ Post-CD ribasso": "post_ribasso",
  "Post-CD neutro": "post_neutro",
  "μ Post-CD neutro": "post_neutro",
};

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
    let gid: MacroGroupId | undefined;
    for (const [needle, id] of Object.entries(REF_LABEL_TO_GROUP)) {
      if (label.includes(needle) || needle.includes(label)) {
        gid = id;
        break;
      }
    }
    if (!gid) continue;
    const points = seriesToGuidePoints(meta);
    if (points.some((p) => p.meanPct != null)) {
      out[gid] = points;
      n += 1;
    }
  }

  return {
    curves: out,
    source: n > 0 ? `simulation_charts (${n} μ)` : "",
  };
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

/** Mantiene al massimo 2 settimane (corrente + precedente). */
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
