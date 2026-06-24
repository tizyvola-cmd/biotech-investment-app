/** v4/v5 accuracy metrics from the Accuracy sheet and historical JSON. */

export const ACCURACY_OFFSETS = [-60, -30, -10, -7, -5, -3, 4, 7] as const;

export type AccuracyModelId = "v4" | "v5";

export type AccuracyMetricKind = "mae" | "hit" | "bias" | "rmse";

export type ModelLabParams = {
  models: AccuracyModelId[];
  horizons: number[];
  metric: AccuracyMetricKind;
  hitFlatBandPp: number;
  pastOnly: boolean;
  minSamples: number;
  sponsorFilter: "all" | "exact_partial" | "exact";
  compareModels: boolean;
  dataSource: "sheet" | "summary" | "monitor";
};

export const DEFAULT_MODEL_LAB_PARAMS: ModelLabParams = {
  models: ["v4", "v5"],
  horizons: [...ACCURACY_OFFSETS],
  metric: "mae",
  hitFlatBandPp: 0.5,
  pastOnly: true,
  minSamples: 3,
  sponsorFilter: "all",
  compareModels: true,
  dataSource: "sheet",
};

const STORAGE_KEY = "supernova_model_lab_params";

export function loadModelLabParams(): ModelLabParams {
  if (typeof window === "undefined") return { ...DEFAULT_MODEL_LAB_PARAMS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MODEL_LAB_PARAMS };
    const p = JSON.parse(raw) as Partial<ModelLabParams>;
    return {
      ...DEFAULT_MODEL_LAB_PARAMS,
      ...p,
      models: Array.isArray(p.models) ? (p.models as AccuracyModelId[]) : DEFAULT_MODEL_LAB_PARAMS.models,
      horizons: Array.isArray(p.horizons)
        ? p.horizons.map(Number).filter((n) => ACCURACY_OFFSETS.includes(n as (typeof ACCURACY_OFFSETS)[number]))
        : [...ACCURACY_OFFSETS],
    };
  } catch {
    return { ...DEFAULT_MODEL_LAB_PARAMS };
  }
}

export function saveModelLabParams(p: ModelLabParams): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function offsetTail(off: number): string {
  return off > 0 ? `+${off}` : String(off);
}

export function storicoColumn(off: number): string {
  return `Storico %\nvs T−60\nT${offsetTail(off)}`;
}

export function v4PredColumn(off: number): string {
  return `Δ% vs Pred−60\nPred\n${offsetTail(off)}`;
}

export function v5PredColumn(off: number): string {
  return `Pred v5\nq50\n${offsetTail(off)}`;
}

export function predColumn(model: AccuracyModelId, off: number): string {
  return model === "v4" ? v4PredColumn(off) : v5PredColumn(off);
}

export function horizonLabel(off: number): string {
  return off > 0 ? `T+${off}` : `T${off}`;
}

/**
 * Per-horizon weights used in the global "weighted" KPI of the Predictive
 * diagnostics.
 *
 * Rationale: the prediction is based on the trend of the pre-CD curve, so
 * the nodes closer to the CD (T−3, T−5, T−7) are the ones directly relevant
 * for the "entry before catalyst" signal. Post-CD horizons (T+4, T+7) fall
 * in the zone where accuracy approaches 50% (random) and are weighted less.
 *
 *   T−60 / T−30  →  1.0   (historical context, baseline trend)
 *   T−10         →  1.0
 *   T−7  / T−5   →  1.5   (optimal entry zone)
 *   T−3          →  2.0   (max information: imminent setup)
 *   T+4  / T+7   →  0.3   (post-CD: prediction tends to 50% — random zone)
 */
export const HORIZON_WEIGHTS: Readonly<Record<number, number>> = Object.freeze({
  [-60]: 1.0,
  [-30]: 1.0,
  [-10]: 1.0,
  [-7]: 1.5,
  [-5]: 1.5,
  [-3]: 2.0,
  4: 0.3,
  7: 0.3,
});

export function horizonWeight(off: number): number {
  return HORIZON_WEIGHTS[off] ?? 1.0;
}

/** A horizon is considered post-CD if its offset is positive (T+x). */
export function isPostCdOffset(off: number): boolean {
  return off > 0;
}

/**
 * Half-width of the "random zone" around 50% in percentage points.
 * Hit% values in [50 − ε, 50 + ε] are indistinguishable from chance (post-CD
 * typically falls here).
 */
export const ACCURACY_RANDOM_ZONE_HALFWIDTH_PP = 5.0;

/** Minimum threshold to declare "solid directional edge". */
export const ACCURACY_SOLID_EDGE_PP = 60.0;

/** Hit% indistinguishable from chance? (50 ± random zone). */
export function isInRandomZone(hit: number | null | undefined): boolean {
  if (hit == null || !Number.isFinite(hit)) return false;
  return Math.abs(hit - 50) <= ACCURACY_RANDOM_ZONE_HALFWIDTH_PP;
}

export function parseNum(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—" || raw === "-") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/%/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Excel %: fraction (0.0615 → 6.15 pp) or already in percentage points. */
export function parseSheetPct(raw: unknown): number | null {
  const n = parseNum(raw);
  if (n === null) return null;
  if (Math.abs(n) <= 1.5 && !String(raw).includes("%")) return n * 100;
  return n;
}

export function directionHit(
  pred: number,
  actual: number,
  flatBand: number
): boolean {
  if (Math.abs(actual) < flatBand) return Math.abs(pred) < flatBand;
  if (pred > 0 && actual > 0) return true;
  if (pred < 0 && actual < 0) return true;
  if (Math.abs(pred) < flatBand) return Math.abs(actual) < flatBand;
  return false;
}

export type HorizonAgg = {
  offset: number;
  label: string;
  n: number;
  mae: number | null;
  hitPct: number | null;
  bias: number | null;
  rmse: number | null;
};

export type ModelAgg = {
  model: AccuracyModelId;
  horizons: HorizonAgg[];
  global: { n: number; mae: number | null; hitPct: number | null; bias: number | null };
  /**
   * KPI weighted across horizons (greater weight for offsets close to CD,
   * reduced weight for post-CD offsets). Weighted MAE = sumW(MAE_h × w_h × n_h) /
   * sumW(w_h × n_h). Weighted Hit% = sumW(Hit_h × w_h × n_h) / sumW(w_h × n_h).
   */
  globalWeighted: {
    mae: number | null;
    hitPct: number | null;
  };
};

/**
 * Summary of the accuracy curve vs distance from CD for a model.
 * Used for the "Accuracy vs days from CD" chart.
 */
export type AccuracyDecayPoint = {
  offset: number;
  label: string;
  n: number;
  mae: number | null;
  hitPct: number | null;
  bias: number | null;
  rmse: number | null;
  /** True if hitPct falls inside the random zone (50 ± ε). */
  randomZone: boolean;
  /** Weight applied to the global weighted KPI. */
  weight: number;
  /** Side relative to CD ("pre" if offset < 0, "cd" if 0, "post" if > 0). */
  side: "pre" | "cd" | "post";
};

export function buildAccuracyDecayPoints(agg: ModelAgg): AccuracyDecayPoint[] {
  return agg.horizons.map((h) => ({
    offset: h.offset,
    label: h.label,
    n: h.n,
    mae: h.mae,
    hitPct: h.hitPct,
    bias: h.bias,
    rmse: h.rmse,
    randomZone: isInRandomZone(h.hitPct),
    weight: horizonWeight(h.offset),
    side: h.offset < 0 ? "pre" : h.offset > 0 ? "post" : "cd",
  }));
}

function sponsorOk(row: Record<string, unknown>, filter: ModelLabParams["sponsorFilter"]): boolean {
  const sm = String(row["Exact·Partial vs Unmatch"] ?? row["Sponsor Match"] ?? "").trim().toLowerCase();
  if (filter === "all") return true;
  if (filter === "exact") return sm === "exact";
  return sm === "exact" || sm === "partial";
}

export function rowIsPast(row: Record<string, unknown>): boolean {
  const cd = String(row["Completion Date"] ?? row.CD ?? "").trim();
  if (!cd || cd === "—" || cd === "-") return false;

  let dt: Date | null = null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cd);
  if (dmy) {
    dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(cd);
    if (iso) {
      dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    } else {
      const ms = Date.parse(cd);
      if (Number.isFinite(ms)) dt = new Date(ms);
    }
  }

  if (!dt || Number.isNaN(dt.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return dt.getTime() < today.getTime();
}

export function aggregateFromAccuracySheet(
  rows: Record<string, unknown>[],
  params: ModelLabParams
): ModelAgg[] {
  const out: ModelAgg[] = [];

  for (const model of params.models) {
    const horizonStats: HorizonAgg[] = params.horizons.map((off) => ({
      offset: off,
      label: horizonLabel(off),
      n: 0,
      mae: null,
      hitPct: null,
      bias: null,
      rmse: null,
    }));
    const absAll: number[] = [];
    const signedAll: number[] = [];
    const hitsAll: boolean[] = [];

    const perHorizon: { abs: number[]; signed: number[]; hits: boolean[] }[] = params.horizons.map(
      () => ({ abs: [], signed: [], hits: [] })
    );

    for (const row of rows) {
      const tk = String(row.Ticker ?? "").trim().toUpperCase();
      if (!tk || tk.startsWith("──")) continue;
      if (params.pastOnly && !rowIsPast(row)) continue;
      if (!sponsorOk(row, params.sponsorFilter)) continue;

      for (let hi = 0; hi < params.horizons.length; hi++) {
        const off = params.horizons[hi];
        const actual = parseNum(row[storicoColumn(off)]);
        const pred = parseNum(row[predColumn(model, off)]);
        if (actual === null || pred === null) continue;

        const signed = pred - actual;
        perHorizon[hi].abs.push(Math.abs(signed));
        perHorizon[hi].signed.push(signed);
        perHorizon[hi].hits.push(directionHit(pred, actual, params.hitFlatBandPp));
        absAll.push(Math.abs(signed));
        signedAll.push(signed);
        hitsAll.push(directionHit(pred, actual, params.hitFlatBandPp));
      }
    }

    for (let hi = 0; hi < horizonStats.length; hi++) {
      const h = horizonStats[hi];
      const bucket = perHorizon[hi];
      h.n = bucket.abs.length;
      if (h.n < params.minSamples) continue;
      h.mae = bucket.abs.reduce((a, b) => a + b, 0) / h.n;
      h.bias = bucket.signed.reduce((a, b) => a + b, 0) / h.n;
      h.rmse = Math.sqrt(bucket.signed.reduce((a, b) => a + b * b, 0) / h.n);
      h.hitPct = (100 * bucket.hits.filter(Boolean).length) / h.n;
    }

    const globalN = absAll.length;

    // Per-horizon weighted KPIs: weight MAE and Hit% by (w_h × n_h) — horizons
    // close to CD (T−3, T−5, T−7) have weight > 1, post-CD weight 0.3.
    let wMaeNum = 0;
    let wMaeDen = 0;
    let wHitNum = 0;
    let wHitDen = 0;
    for (const h of horizonStats) {
      if (h.n < params.minSamples) continue;
      const w = horizonWeight(h.offset);
      if (h.mae != null) {
        wMaeNum += h.mae * w * h.n;
        wMaeDen += w * h.n;
      }
      if (h.hitPct != null) {
        wHitNum += h.hitPct * w * h.n;
        wHitDen += w * h.n;
      }
    }

    out.push({
      model,
      horizons: horizonStats,
      global: {
        n: globalN,
        mae: globalN ? absAll.reduce((a, b) => a + b, 0) / globalN : null,
        bias: globalN ? signedAll.reduce((a, b) => a + b, 0) / globalN : null,
        hitPct: globalN ? (100 * hitsAll.filter(Boolean).length) / globalN : null,
      },
      globalWeighted: {
        mae: wMaeDen > 0 ? wMaeNum / wMaeDen : null,
        hitPct: wHitDen > 0 ? wHitNum / wHitDen : null,
      },
    });
  }

  return out;
}

/** Extracts MAE/Hit from a model block in the summary JSON (v4/v5/v5_raw). */
export function metricsFromSummaryBlock(
  model: AccuracyModelId,
  block: Record<string, unknown> | undefined,
  horizons: number[]
): HorizonAgg[] {
  const mb =
    model === "v4"
      ? (block?.v4 as Record<string, unknown>)
      : (block?.v5 as Record<string, unknown>);
  if (!mb || typeof mb !== "object") return [];

  const maeMap = (mb.mae as Record<string, number | null>) ?? {};
  const maeN = (mb.mae_n as Record<string, number>) ?? {};
  const hitMap = (mb.hit_pct as Record<string, number | null>) ?? {};

  return horizons.map((off) => {
    const lbl = horizonLabel(off);
    return {
      offset: off,
      label: lbl,
      n: Number(maeN[lbl] ?? 0),
      mae: maeMap[lbl] ?? null,
      hitPct: hitMap[lbl] ?? null,
      bias: null,
      rmse: null,
    };
  });
}

export type SummaryRun = {
  runIso: string;
  total: Record<string, unknown> | null;
  byQuarter: Record<string, Record<string, unknown>>;
};

/** Parseable timestamp for run ordering (``run_iso`` / ``generated_at``). */
export function runIsoToTime(iso: string): number {
  if (!iso || iso === "latest") return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Newest refresh/run first (descending ISO timestamp). */
export function compareRunsNewestFirst(a: string, b: string): number {
  return runIsoToTime(b) - runIsoToTime(a);
}

export function sortSummaryRuns(
  runs: SummaryRun[],
  newestFirst = true
): SummaryRun[] {
  const dir = newestFirst ? -1 : 1;
  return [...runs].sort(
    (a, b) => dir * (runIsoToTime(a.runIso) - runIsoToTime(b.runIso))
  );
}

export type TemporalModelRow = {
  runIso: string;
  model: AccuracyModelId | "v5 raw";
  nRows: number | null;
  horizons: HorizonAgg[];
  maeGlobal: number | null;
  hitGlobal: number | null;
};

const TEMPORAL_MODEL_ORDER: Record<TemporalModelRow["model"], number> = {
  v4: 0,
  v5: 1,
  "v5 raw": 2,
};

/** Sort flat temporal table rows by run date, keeping v4/v5/v5 raw grouped per run. */
export function sortTemporalModelRows(
  rows: TemporalModelRow[],
  newestFirst = true
): TemporalModelRow[] {
  const dir = newestFirst ? -1 : 1;
  return [...rows].sort((a, b) => {
    const byRun = dir * (runIsoToTime(a.runIso) - runIsoToTime(b.runIso));
    if (byRun !== 0) return byRun;
    return (
      (TEMPORAL_MODEL_ORDER[a.model] ?? 99) - (TEMPORAL_MODEL_ORDER[b.model] ?? 99)
    );
  });
}

export function parseSummaryRuns(doc: {
  history?: unknown[];
  latest?: Record<string, unknown>;
}): SummaryRun[] {
  const byIso = new Map<string, SummaryRun>();
  const hist = Array.isArray(doc.history) ? doc.history : [];
  for (const entry of hist) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const runIso = String(e.run_iso ?? e.generated_at ?? "").trim();
    if (!runIso) continue;
    byIso.set(runIso, {
      runIso,
      total: (e.total as Record<string, unknown>) ?? null,
      byQuarter: (e.by_quarter as Record<string, Record<string, unknown>>) ?? {},
    });
  }
  if (doc.latest && typeof doc.latest === "object") {
    const lat = doc.latest as Record<string, unknown>;
    const runIso = String(lat.generated_at ?? "latest").trim();
    if (runIso) {
      byIso.set(runIso, {
        runIso,
        total: (lat.total as Record<string, unknown>) ?? lat,
        byQuarter: (lat.by_quarter as Record<string, Record<string, unknown>>) ?? {},
      });
    }
  }
  return Array.from(byIso.values());
}

export type MonitorEntry = {
  runIso: string;
  accV4Pct: number | null;
  accV4SimPct: number | null;
  nEval: number | null;
  nEvalSim: number | null;
  nSimPending: number | null;
  m2Mae7: number | null;
  m2HitD5: number | null;
  m2Bias7: number | null;
  affMisurata: number | null;
  gapAff: number | null;
  trigger?: string;
  invalid?: boolean;
};

export function isMonitorEntryValid(e: MonitorEntry): boolean {
  return (e.nEval ?? 0) > 0 && e.accV4Pct != null;
}

export function sortMonitorEntries(entries: MonitorEntry[]): MonitorEntry[] {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.runIso);
    const tb = Date.parse(b.runIso);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
    return a.runIso.localeCompare(b.runIso);
  });
}

export function parseMonitorEntries(doc: { entries?: unknown[] }): MonitorEntry[] {
  const raw = Array.isArray(doc.entries) ? doc.entries : [];
  return sortMonitorEntries(
    raw
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => {
        const entry: MonitorEntry = {
          runIso: String(e.run_iso ?? ""),
          accV4Pct: parseNum(e.acc_v4_pct),
          accV4SimPct: parseNum(e.acc_v4_sim_pct),
          nEval: parseNum(e.n_evaluable_ok_v4),
          nEvalSim: parseNum(e.n_evaluable_ok_v4_sim),
          nSimPending: parseNum(e.n_sim_pending),
          m2Mae7: parseNum(e.m2_mae_7_pp),
          m2HitD5: parseNum(e.m2_hit_rate_d5_pct),
          m2Bias7: parseNum(e.m2_bias_signed_7_pp),
          affMisurata: parseNum(e.aff_misurata_7_pp),
          gapAff: parseNum(e.gap_aff_stim_minus_misur_pp),
          trigger: e.snapshot_trigger != null ? String(e.snapshot_trigger) : undefined,
        };
        entry.invalid = !isMonitorEntryValid(entry);
        return entry;
      })
      .filter((e) => e.runIso)
  );
}

export function metricValue(h: HorizonAgg, kind: AccuracyMetricKind): number | null {
  switch (kind) {
    case "mae":
      return h.mae;
    case "hit":
      return h.hitPct;
    case "bias":
      return h.bias;
    case "rmse":
      return h.rmse;
    default:
      return h.mae;
  }
}

/** Rows for the «Accuratezza temporale» tab (from ``accuracy_v4_v5_summary.json``). */
export function buildTemporalRowsFromSummary(
  doc: {
    history?: unknown[];
    latest?: Record<string, unknown>;
  },
  newestFirst = true
): TemporalModelRow[] {
  const runs = sortSummaryRuns(parseSummaryRuns(doc), newestFirst);
  const out: TemporalModelRow[] = [];

  for (const run of runs) {
    const total = run.total;
    if (!total || typeof total !== "object") continue;
    const nRows = parseNum(total.n_rows);

    for (const model of ["v4", "v5"] as const) {
      const mb = total[model];
      if (!mb || typeof mb !== "object") continue;
      const block = mb as Record<string, unknown>;
      out.push({
        runIso: run.runIso,
        model,
        nRows,
        horizons: metricsFromSummaryBlock(model, total, [...ACCURACY_OFFSETS]),
        maeGlobal: parseNum(block.mae_global),
        hitGlobal: parseNum(block.hit_pct_global),
      });
    }

    const v5raw = total.v5_raw;
    if (v5raw && typeof v5raw === "object") {
      const block = v5raw as Record<string, unknown>;
      if (block.mae_global != null) {
        const maeMap = (block.mae as Record<string, number | null>) ?? {};
        const maeN = (block.mae_n as Record<string, number>) ?? {};
        const hitMap = (block.hit_pct as Record<string, number | null>) ?? {};
        out.push({
          runIso: run.runIso,
          model: "v5 raw",
          nRows,
          horizons: [...ACCURACY_OFFSETS].map((off) => {
            const lbl = horizonLabel(off);
            return {
              offset: off,
              label: lbl,
              n: Number(maeN[lbl] ?? 0),
              mae: maeMap[lbl] ?? null,
              hitPct: hitMap[lbl] ?? null,
              bias: null,
              rmse: null,
            };
          }),
          maeGlobal: parseNum(block.mae_global),
          hitGlobal: parseNum(block.hit_pct_global),
        });
      }
    }
  }

  return sortTemporalModelRows(out, newestFirst);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatPp(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} pp`;
}
