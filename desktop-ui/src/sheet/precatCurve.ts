/**
 * precatCurve.ts — TypeScript port of prediction/curve_forecast.py
 *
 * Computes the pre-catalyst curve with confidence bands calibrated
 * on 5,330 historical biotech trajectories.
 *
 * Base sigma (RMSE, reference horizon 23d = T-30→T-7):
 *   flat     (run_up  -10 .. +10%)  : σ = 14.5 pp
 *   moderate (run_up  +10 .. +25%)  : σ = 21.6 pp
 *   btr      (run_up  ≥  +25%)      : σ = 27.4 pp
 *   ctr      (run_up  < -10%)       : σ = 26.7 pp
 *
 * σ_H = σ_base × √(H / 23)   where H = days from today to the waypoint
 * CI_68 = pred ± 1.00 σ_H
 * CI_90 = pred ± 1.65 σ_H
 */

import { t as tStatic } from "../shared/i18n";
import { interpolateAtOffset } from "./chartNowOffset";
import { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";

export type PrecatRegime = "flat" | "moderate" | "btr" | "ctr";
export type UncertaintyLabel = "BASSA" | "MEDIA" | "ALTA" | "MOLTO ALTA";

export type PrecatWaypoint = {
  /** Days relative to the CD (negative, e.g. -7 = T-7) */
  daysToCd: number;
  predPct: number;
  ci68Lo: number;
  ci68Hi: number;
  ci90Lo: number;
  ci90Hi: number;
  sigmaPp: number;
};

/**
 * Where the `effSlope` used for the median comes from:
 *   - measured_20d : slope_20d available (ideal case)
 *   - blended      : blend slope_20d × slope_5d (acceleration/deceleration)
 *   - proxy_5d     : only slope_5d (slope_20d missing)
 *   - inferred_runup : derived from run_up_30d (direct slopes missing)
 *   - none         : no data → flat median
 */
export type SlopeSource =
  | "measured_20d"
  | "blended"
  | "proxy_5d"
  | "inferred_runup"
  | "none";

export type PrecatCurve = {
  waypoints: PrecatWaypoint[];
  regime: PrecatRegime;
  sigmaBasePp: number;
  uncertaintyLabel: UncertaintyLabel;
  runUp30d: number | null;
  daysToCd: number;
  /** Effective slope used for the median (pp/day) */
  effSlope: number;
  /** Provenance of the effective slope (for UI: "measured" vs "inferred") */
  slopeSource: SlopeSource;
  notes: string[];
};

// ─── calibrated constants ─────────────────────────────────────────────────────
const H_REF = 23; // days: T-30 → T-7
const Z_68 = 1.0;
const Z_90 = 1.65;
const BLEND_THRESHOLD = 0.5; // pp/d: slope_5d vs slope_20d divergence

const SIGMA_BY_REGIME: Record<PrecatRegime, number> = {
  flat:     14.5,
  moderate: 21.6,
  btr:      27.4,
  ctr:      26.7,
};

const WAYPOINTS_CD = [-20, -15, -10, -7, -5, -3] as const;

/**
 * Damping of run_up_30d when used as a slope proxy.
 * The cumulative run-up is not linear and the momentum tends to decay
 * approaching the CD, so we cannot project the same average slope of
 * the last 30d over the next 20-30d. Calibrated on mean reversion
 * observed in historical pre-cat trajectories.
 */
const RUNUP_TO_SLOPE_DAMPING = 0.5;

/**
 * Minimum |slope| threshold to consider the slope as "non-flat".
 * Below this threshold we treat the median as stationary.
 */
const SLOPE_NOISE_FLOOR = 0.01; // pp/d

/**
 * Infers a slope (pp/d) from the run-up of the last 30d.
 * Returns null if run_up_30d is missing or produces a negligible value.
 *
 * Example: run_up_30d = +21% → inferred = +21/30 × 0.5 = +0.35 pp/d
 */
export function inferSlopeFromRunUp(runUp30d: number | null): number | null {
  if (runUp30d == null || !Number.isFinite(runUp30d)) return null;
  const raw = (runUp30d / 30) * RUNUP_TO_SLOPE_DAMPING;
  if (Math.abs(raw) < SLOPE_NOISE_FLOOR) return null;
  return raw;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function classifyRegime(runUp30d: number | null): PrecatRegime {
  if (runUp30d == null) return "flat";
  if (runUp30d >= 25) return "btr";
  if (runUp30d >= 10) return "moderate";
  if (runUp30d < -10) return "ctr";
  return "flat";
}

function uncertaintyLabel(sigmaBase: number): UncertaintyLabel {
  if (sigmaBase <= 16) return "BASSA";
  if (sigmaBase <= 23) return "MEDIA";
  if (sigmaBase <= 30) return "ALTA";
  return "MOLTO ALTA";
}

function sigmaAtHorizon(sigmaBase: number, hDays: number): number {
  if (hDays <= 0) return sigmaBase;
  return Math.max(0.1, sigmaBase * Math.sqrt(hDays / H_REF));
}

function r2(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Generates the pre-catalyst curve with calibrated CIs.
 *
 * @param slope20d  20d average slope (pp/day). null → median = 0.
 * @param slope5d   Recent 5d slope (optional, for blend).
 * @param runUp30d  Last 30 days % change (determines regime).
 * @param daysToCd  Days remaining to CD (positive, e.g. 25 = T-25).
 */
export function computePrecatCurve(
  slope20d: number | null,
  slope5d: number | null,
  runUp30d: number | null,
  daysToCd: number,
): PrecatCurve {
  const notes: string[] = [];
  const fmtSlope = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} pp/d`;

  // ── Fallback cascade for the effective slope ──────────────────────────────
  //
  // 1. slope_20d available → use it (possibly blended with slope_5d if it
  //    diverges over threshold, to capture accelerations/decelerations).
  // 2. only slope_5d → use it as a proxy of the recent slope.
  // 3. only run_up_30d → derive the slope by damping the cumulative momentum
  //    (raw ÷ 30 × 0.5). Marked as "inferred" in the notes.
  // 4. no data → flat median, but uncertainty bands remain.
  let effSlope: number;
  let slopeSource: SlopeSource;

  if (slope20d != null) {
    if (slope5d != null && Math.abs(slope5d - slope20d) > BLEND_THRESHOLD) {
      effSlope = 0.6 * slope20d + 0.4 * slope5d;
      slopeSource = "blended";
      const dir = slope5d > slope20d ? "acceleration" : "deceleration";
      notes.push(
        `recent ${dir} (slope5d=${fmtSlope(slope5d)} vs slope20d=${fmtSlope(slope20d)}) → blend → eff=${fmtSlope(effSlope)}`,
      );
    } else {
      effSlope = slope20d;
      slopeSource = "measured_20d";
    }
  } else if (slope5d != null) {
    effSlope = slope5d;
    slopeSource = "proxy_5d";
    notes.push(
      `slope_20d missing — using slope_5d as proxy (${fmtSlope(slope5d)}). Trend estimate based only on the last 5d.`,
    );
  } else {
    const inferred = inferSlopeFromRunUp(runUp30d);
    if (inferred != null) {
      effSlope = inferred;
      slopeSource = "inferred_runup";
      notes.push(
        `slope_20d and slope_5d missing — slope inferred from 30d run-up (${runUp30d! > 0 ? "+" : ""}${runUp30d!.toFixed(1)}% → ${fmtSlope(inferred)}, damped ×${RUNUP_TO_SLOPE_DAMPING}). Approximate estimate.`,
      );
    } else {
      effSlope = 0;
      slopeSource = "none";
      notes.push(
        "No slope data available (slope_20d, slope_5d and run_up_30d missing) — flat median, uncertainty bands only.",
      );
    }
  }

  const regime = classifyRegime(runUp30d);
  const sigmaBase = SIGMA_BY_REGIME[regime];

  // Generate waypoints
  const waypoints: PrecatWaypoint[] = [];
  for (const wpDays of WAYPOINTS_CD) {
    const hDays = daysToCd + wpDays; // wpDays is negative
    if (hDays <= 0) continue;

    const predPct = effSlope * hDays;
    const sigmaH = sigmaAtHorizon(sigmaBase, hDays);

    waypoints.push({
      daysToCd: wpDays,
      predPct: r2(predPct),
      ci68Lo: r2(predPct - Z_68 * sigmaH),
      ci68Hi: r2(predPct + Z_68 * sigmaH),
      ci90Lo: r2(predPct - Z_90 * sigmaH),
      ci90Hi: r2(predPct + Z_90 * sigmaH),
      sigmaPp: r2(sigmaH),
    });
  }

  return {
    waypoints,
    regime,
    sigmaBasePp: sigmaBase,
    uncertaintyLabel: uncertaintyLabel(sigmaBase),
    runUp30d,
    daysToCd,
    effSlope,
    slopeSource,
    notes,
  };
}

/** Readable label for the slope source (used in UI). */
export function slopeSourceLabel(src: SlopeSource): string {
  switch (src) {
    case "measured_20d":  return "measured (slope 20d)";
    case "blended":       return "blend slope 20d × 5d";
    case "proxy_5d":      return "proxy slope 5d";
    case "inferred_runup": return "inferred from run-up 30d";
    case "none":          return "n/a";
  }
}

/**
 * Extracts slope20d, slope5d, runUp30d from the raw fields of a SheetTable row.
 * Handles Italian/abbreviated column names used by the Simulation sheet.
 */
export function extractCurveInputs(
  row: Record<string, unknown>,
): {
  slope20d: number | null;
  slope5d: number | null;
  slope45d: number | null;
  runUp30d: number | null;
} {
  const n = (v: unknown): number | null => {
    if (v == null || v === "" || v === "—" || v === "-") return null;
    const num = typeof v === "number" ? v : Number(String(v).replace(/,/g, "."));
    return Number.isFinite(num) ? num : null;
  };

  // Search by column name (partial, case-insensitive matching)
  const find = (kw: string): unknown => {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    return key ? row[key] : undefined;
  };

  const direct = {
    slope20d: n(find("slope≈20") ?? find("slope_20") ?? find("slope20")),
    slope5d:  n(find("slope≈5")  ?? find("slope_5")  ?? find("slope5")),
    slope45d: n(find("slope≈45") ?? find("slope_45") ?? find("slope45")),
    runUp30d: n(find("run 30")   ?? find("run_30")   ?? find("run_up_30")),
  };

  const inferred = inferSlopesFromPredGrid(row);

  const useSlope = (directVal: number | null, inferredVal: number | null): number | null => {
    if (directVal != null && Math.abs(directVal) > 0.0001) return directVal;
    if (inferredVal != null && Math.abs(inferredVal) > 0.0001) return inferredVal;
    if (directVal != null && directVal === 0 && inferredVal != null) return inferredVal;
    return directVal ?? inferredVal;
  };

  return {
    slope20d: useSlope(direct.slope20d, inferred.slope20d),
    slope5d: useSlope(direct.slope5d, inferred.slope5d),
    slope45d: direct.slope45d ?? inferred.slope45d,
    runUp30d: direct.runUp30d ?? inferred.runUp30d,
  };
}

/** % curva modello (pp) da cella Pred offset — frazione o già in punti percentuali. */
function predOffsetPct(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-") return null;
  const num = typeof v === "number" ? v : Number(String(v).replace(/,/g, "."));
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) <= 1.5 ? num * 100 : num;
}

/**
 * Stima slope/run-up dalla griglia Δ% Pred (−60…+7) quando lo snapshot non ha slope≈5g/20g
 * (es. export Simulation 36 colonne senza refresh_live_signals).
 */
export function inferSlopesFromPredGrid(row: Record<string, unknown>): {
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  runUp30d: number | null;
} {
  const pts: { d: number; pct: number }[] = [];
  for (const [key, val] of Object.entries(row)) {
    const k = key.replace(/\s+/g, " ");
    if (!/pred/i.test(k)) continue;
    const m = k.match(/([−+-]?\d+)\s*$/);
    if (!m) continue;
    const d = Number(m[1].replace("−", "-").replace("+", ""));
    if (!Number.isFinite(d)) continue;
    const pct = predOffsetPct(val);
    if (pct == null) continue;
    pts.push({ d, pct });
  }
  if (pts.length < 2) {
    return { slope5d: null, slope20d: null, slope45d: null, runUp30d: null };
  }
  pts.sort((a, b) => a.d - b.d);

  const round2 = (x: number) => Math.round(x * 100) / 100;

  const slopeBetween = (d1: number, d2: number): number | null => {
    const p1 = pts.find((p) => p.d === d1);
    const p2 = pts.find((p) => p.d === d2);
    if (!p1 || !p2 || d2 === d1) return null;
    return round2((p2.pct - p1.pct) / (d2 - d1));
  };

  const slope5d =
    slopeBetween(-7, -3) ??
    slopeBetween(-10, -5) ??
    slopeBetween(-5, -3) ??
    null;

  const slope20d =
    slopeBetween(-30, -10) ??
    slopeBetween(-30, -7) ??
    slopeBetween(-10, -3) ??
    null;

  const pNear = pts.find((p) => p.d === -3) ?? pts.find((p) => p.d === -5) ?? pts[pts.length - 1];
  const pFar = pts.find((p) => p.d === -30) ?? pts[0];
  const runUp30d =
    pNear && pFar && pFar.d !== pNear.d
      ? round2(pNear.pct - pFar.pct)
      : null;

  return { slope5d, slope20d, slope45d: null, runUp30d };
}

/** Parsed Δ% Pred−60 grid points (offset days → % vs T−60). */
export function extractPredGridPoints(
  row: Record<string, unknown>,
): { d: number; pct: number }[] {
  const pts: { d: number; pct: number }[] = [];
  for (const [key, val] of Object.entries(row)) {
    const k = key.replace(/\s+/g, " ");
    if (!/pred/i.test(k) || !/vs\s+pred/i.test(k)) continue;
    const m = k.match(/([−+-]?\d+)\s*$/);
    if (!m) continue;
    const d = Number(m[1].replace("−", "-").replace("+", ""));
    if (!Number.isFinite(d)) continue;
    const pct = predOffsetPct(val);
    if (pct == null) continue;
    pts.push({ d, pct });
  }
  pts.sort((a, b) => a.d - b.d);
  return pts;
}

function slopeBetweenPts(
  pts: { d: number; pct: number }[],
  d1: number,
  d2: number,
): number | null {
  const p1 = pts.find((p) => p.d === d1);
  const p2 = pts.find((p) => p.d === d2);
  if (!p1 || !p2 || d2 === d1) return null;
  return Math.round(((p2.pct - p1.pct) / (d2 - d1)) * 100) / 100;
}

/** Model slopes (pp/d) at chart windows −5d / −20d / −45d from the pred grid. */
export function inferPredSlopesByWindows(row: Record<string, unknown>): {
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
} {
  const pts = extractPredGridPoints(row);
  if (pts.length < 2) {
    const fb = inferSlopesFromPredGrid(row);
    return { slope5d: fb.slope5d, slope20d: fb.slope20d, slope45d: fb.slope45d };
  }
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const slope5d =
    slopeBetweenPts(pts, -7, -3) ??
    slopeBetweenPts(pts, -10, -5) ??
    slopeBetweenPts(pts, -5, -3);
  const slope20d =
    slopeBetweenPts(pts, -30, -10) ??
    slopeBetweenPts(pts, -30, -7) ??
    slopeBetweenPts(pts, -10, -3);
  const slope45d =
    slopeBetweenPts(pts, -60, -30) ??
    slopeBetweenPts(pts, -45, -20);
  return {
    slope5d: slope5d != null ? round2(slope5d) : null,
    slope20d: slope20d != null ? round2(slope20d) : null,
    slope45d: slope45d != null ? round2(slope45d) : null,
  };
}

/** Linear % vs T−60 at calendar offset ``d`` (pred grid or chart nodes). */
export function interpolatePredPctAt(
  pts: { d: number; pct: number }[],
  d: number,
): number | null {
  if (!pts.length) return null;
  const sorted = [...pts].sort((a, b) => a.d - b.d);
  const exact = sorted.find((p) => p.d === d);
  if (exact) return exact.pct;
  if (d < sorted[0].d || d > sorted[sorted.length - 1].d) return null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (d >= a.d && d <= b.d && b.d !== a.d) {
      const t = (d - a.d) / (b.d - a.d);
      return r2(a.pct + t * (b.pct - a.pct));
    }
  }
  return null;
}

/**
 * % change vs today from pred nodes (% vs T−60 on the same calendar axis).
 * Keys = calendar offset (e.g. −7); values = % vs current price (aligned with median line).
 */
export function predPctVsTodayByOffset(
  pts: { d: number; pct: number }[],
  todayOffset: number,
): Map<number, number> {
  if (!pts.length) return new Map();
  const series = pts.map((p) => ({ offset: p.d, y: p.pct }));
  const base = interpolateAtOffset(series, todayOffset, { extrapolate: true });
  if (base == null || !Number.isFinite(base)) return new Map();
  const out = new Map<number, number>();
  const offsets = new Set<number>();
  for (const p of pts) {
    if (p.d >= todayOffset && p.d <= 0) offsets.add(p.d);
  }
  for (const d of [-60, -45, -30, -20, -15, -10, -7, -5, -3, 0]) {
    if (d >= todayOffset && d <= 0) offsets.add(d);
  }
  offsets.add(todayOffset);
  for (const d of [...offsets].sort((a, b) => a - b)) {
    const at = interpolateAtOffset(series, d, { extrapolate: true });
    if (at == null || !Number.isFinite(at)) continue;
    out.set(d, r2(at - base));
  }
  out.set(todayOffset, 0);
  return out;
}

/** Recalibrated path (% vs today) from Simulation pred grid columns. */
export function predGridPctVsToday(
  row: Record<string, unknown>,
  todayOffset: number,
): Map<number, number> {
  return predPctVsTodayByOffset(extractPredGridPoints(row), todayOffset);
}

/** Δ mod vs emp +5 (pp): model − empirical total return at +5d. */
export function readModelEmpDeltaPp(row: Record<string, unknown>): number | null {
  for (const [key, val] of Object.entries(row)) {
    const k = key.replace(/\s+/g, " ").toLowerCase();
    if (!k.includes("mod") || !k.includes("emp") || !k.includes("+5")) continue;
    const n = typeof val === "number" ? val : Number(String(val).replace(/,/g, "."));
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

/**
 * Calibrate model slope (pp/d): subtract share of model−emp bias at +5 spread over window.
 */
export function calibratePredSlopePpD(
  rawSlopePpD: number | null,
  modelMinusEmpPp: number | null,
  windowDays: number,
): number | null {
  if (rawSlopePpD == null) return null;
  if (modelMinusEmpPp == null || windowDays <= 0) return rawSlopePpD;
  return Math.round((rawSlopePpD - modelMinusEmpPp / windowDays) * 100) / 100;
}

/** Readable label for the regime. */
export function regimeLabel(regime: PrecatRegime, runUp30d: number | null): string {
  const ru = runUp30d != null ? ` (${runUp30d > 0 ? "+" : ""}${runUp30d.toFixed(1)}%)` : "";
  switch (regime) {
    case "btr":      return `Buy-the-Run${ru}`;
    case "ctr":      return `Counter-to-Run${ru}`;
    case "moderate": return `Moderate momentum${ru}`;
    case "flat":     return `Flat${ru}`;
  }
}

// ─── Probability of rise toward CD ───────────────────────────────────────────

/**
 * Normal CDF approximation (Abramowitz & Stegun).
 * Used to compute P(return > 0) given expected return and historical σ.
 */
function normCdf(z: number): number {
  const t  = 1 / (1 + 0.2316419 * Math.abs(z));
  const d  = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
  const p  = 1 - d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? p : 1 - p;
}

// ─── buildPrecatEntry ─────────────────────────────────────────────────────────

export type PrecatEntryKind =
  | "enter"      // optimal window, enter now
  | "accumulate" // good signal but still early, accumulate
  | "late"       // late entry, high risk
  | "sell"       // BTR terminal zone — sell
  | "too_early"  // too far from CD
  | "avoid";     // negative slope or past CD

export type PrecatEntrySignal = {
  kind: PrecatEntryKind;
  /** Short label for the badge in the card */
  label: string;
  /** Extended signal explanation */
  reason: string;
  /**
   * Expected return from the current moment to the CD:
   *   = effSlope × days (pp)
   * Positive = curve rising toward CD.
   */
  expectedReturnPct: number | null;
  /**
   * Probability (%) that the stock is above the current level at CD,
   * computed via normCdf(expectedReturn / σ_H) on the historical
   * distribution calibrated on 5,330 trajectories per regime.
   */
  probPositive: number | null;
  /** Suggestion when to exit the position */
  exitNote: string;
};

export type PrecatBuildOptions = {
  /** Portafoglio Simulation con capitale/prezzo acquisto attivi. */
  hasPosition?: boolean;
};

function precatAvoidSignal(
  slopeDesc: string,
  expectedReturnPct: number | null,
  probPositive: number | null,
  hasPosition: boolean,
): PrecatEntrySignal {
  if (hasPosition) {
    return {
      kind: "avoid",
      label: `↩ ${tStatic("signals.card.considerExit")}`,
      reason: tStatic("signals.card.considerExit.reason", { slope: slopeDesc }),
      expectedReturnPct,
      probPositive,
      exitNote: tStatic("signals.card.considerExit.exitNote"),
    };
  }
  return {
    kind: "avoid",
    label: `🚫 ${tStatic("signals.card.doNotAdd")}`,
    reason: tStatic("signals.card.doNotAdd.reason", { slope: slopeDesc }),
    expectedReturnPct,
    probPositive,
    exitNote: tStatic("signals.card.exit.monitor"),
  };
}

/**
 * Generates the pre-catalyst timing signal based on slope and regime.
 *
 * @param slope5d   Recent 5d slope (pp/d)
 * @param slope20d  20d average slope (pp/d)
 * @param runUp30d  Last 30 days % change (determines regime)
 * @param days      Days remaining to CD (> 0 = CD in the future)
 * @param opts      ``hasPosition`` adatta etichette (Non aggiungere vs Valuta uscita).
 */
export function buildPrecatEntry(
  slope5d:  number | null,
  slope20d: number | null,
  runUp30d: number | null,
  days:     number | null,
  opts?: PrecatBuildOptions,
): PrecatEntrySignal {
  const hasPosition = Boolean(opts?.hasPosition);
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  // ── Past or unknown CD ────────────────────────────────────────────────────
  if (days == null || days <= 0) {
    return {
      kind: "avoid", label: "— CD past",
      reason: "The catalyst has already occurred — no pre-cat window available.",
      expectedReturnPct: null, probPositive: null,
      exitNote: "—",
    };
  }

  const regime    = classifyRegime(runUp30d);
  const sigmaBase = SIGMA_BY_REGIME[regime];

  // Effective slope (same fallback cascade as computePrecatCurve).
  let effSlope: number;
  if (slope20d != null) {
    if (slope5d != null && Math.abs(slope5d - slope20d) > BLEND_THRESHOLD) {
      effSlope = 0.6 * slope20d + 0.4 * slope5d;
    } else {
      effSlope = slope20d;
    }
  } else if (slope5d != null) {
    effSlope = slope5d;
  } else {
    effSlope = inferSlopeFromRunUp(runUp30d) ?? 0;
  }

  const expectedReturnPct = r2(effSlope * days);
  const sigmaH            = sigmaAtHorizon(sigmaBase, days);
  const probPositive      = sigmaH > 0
    ? Math.min(99, Math.max(1, Math.round(normCdf(expectedReturnPct / sigmaH) * 100)))
    : (expectedReturnPct > 0 ? 95 : 5);

  const s5txt  = slope5d  != null ? ` slope5d ${fmt(slope5d)}`  : "";
  const s20txt = slope20d != null ? ` · slope20d ${fmt(slope20d)}` : "";

  // ── BTR terminal zone — sell ──────────────────────────────────────────────
  if (regime === "btr" && days <= 5) {
    return {
      kind: "sell",
      label: "🔴 Sell — BTR terminal",
      reason: `Run-up ${runUp30d != null ? `+${runUp30d.toFixed(1)}%` : "high"} (BTR) · ${days} d to CD · stock already priced in, sell-the-news imminent.`,
      expectedReturnPct, probPositive,
      exitNote: "Sell now — every additional day increases the risk of being flat/negative at CD.",
    };
  }

  // ── BTR risk zone — late entry ────────────────────────────────────────────
  if (regime === "btr" && days <= 15) {
    return {
      kind: "late",
      label: "⚠ Late — BTR risk",
      reason: `Run-up ${runUp30d != null ? `+${runUp30d.toFixed(1)}%` : "high"} (BTR) · ${days} d to CD · stock already priced in; the run-up may already be exhausted.`,
      expectedReturnPct, probPositive,
      exitNote: `Exit by T-3 (in ${Math.max(1, days - 3)} d) — don't wait for CD.`,
    };
  }

  // ── Unfavorable slope — avoid / valuta uscita se in portafoglio ───────────
  if (effSlope <= 0) {
    const slopeDesc = slope5d != null && slope5d < 0 && slope20d != null && slope20d > 0
      ? `${tStatic("signals.slopeDesc.reversal")} (${s5txt} vs${s20txt} pp/d)`
      : `${tStatic("signals.slopeDesc.nonPositive")} (${s5txt}${s20txt} pp/d)`;
    return precatAvoidSignal(slopeDesc, expectedReturnPct, probPositive, hasPosition);
  }

  // ── Too early (hot tail T−46…T−60) or watch accumulate (T−61…T−120) ─────
  if (days > 45) {
    const inWatch =
      days > SIM_HOT_ZONE_DAYS && days <= SIM_MONITOR_HORIZON_DAYS;
    if (inWatch) {
      return {
        kind: "accumulate",
        label: "📈 Watch — accumulate",
        reason: `CD in ${days} d · watch zone (T−61…T−120). Slope${s5txt}${s20txt} pp/d favorable — gradual build toward hot window.`,
        expectedReturnPct,
        probPositive,
        exitNote: `Monitor weekly — refine target as CD approaches T−${SIM_HOT_ZONE_DAYS}.`,
      };
    }
    const waitDays = Math.max(0, days - 40);
    return {
      kind: "too_early",
      label: "⏰ Too early",
      reason: `CD in ${days} d · optimal window T-30/T-40. Slope${s5txt}${s20txt} pp/d favorable but premature.`,
      expectedReturnPct, probPositive,
      exitNote: `Start accumulating in ${waitDays} d (T-40) — add when slope accelerates.`,
    };
  }

  // ── Optimal entry zone ────────────────────────────────────────────────────
  if (days >= 8 && days <= 45) {
    const isOptimal = days <= 25;
    const accel     = slope5d != null && slope20d != null && slope5d > slope20d + 0.3;
    const urgency   = days <= 14 ? "enter now" : days <= 25 ? "accumulate quickly" : "accumulate gradually";
    const accelNote = accel ? ` · slope accelerating (${fmt(slope5d!)} > ${fmt(slope20d!)})` : "";
    return {
      kind: isOptimal ? "enter" : "accumulate",
      label: isOptimal ? "✅ Enter now" : "📈 Accumulate",
      reason: `Slope${s5txt}${s20txt} pp/d · CD in ${days} d · regime ${regime}${accelNote}. ${isOptimal ? "Optimal" : "Favorable"} window — ${urgency}.`,
      expectedReturnPct, probPositive,
      exitNote: `Exit at T-3/T-5 (in ${Math.max(1, days - 5)}–${Math.max(1, days - 3)} d) or at the first slope reversal signal.`,
    };
  }

  // ── Late entry (days < 8) ─────────────────────────────────────────────────
  if (hasPosition) {
    return {
      kind: "late",
      label: `↩ ${tStatic("signals.card.considerExit")}`,
      reason: tStatic("signals.card.considerExit.lateReason", { days: String(days) }),
      expectedReturnPct,
      probPositive,
      exitNote: tStatic("signals.card.considerExit.exitNote"),
    };
  }
  return {
    kind: "late",
    label: "⚠ Late entry",
    reason: `Only ${days} d to CD · high probability of buying near the pre-CD top. Slope${s5txt} pp/d.`,
    expectedReturnPct, probPositive,
    exitNote: "If already in, exit before CD. If out, avoid new entries.",
  };
}
