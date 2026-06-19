/**
 * Fase 5 — backtest watch Enter policy on completed catalyst price anchors.
 *
 * Uses ``past_catalyst_predictions.json`` session closes at T−60…T−3.
 * Watch zone (T−61…T−120) is proxied at T−60/T−90/T−110 anchors (same m60
 * price — policy thresholds differ by daysToCd).
 *
 * 24h gainer label: avg daily drift to the next checkpoint toward CD ≥ 0.5%.
 */
import {
  inMissedOppOperationalWindow,
  inMissedOppWatchWindow,
  MISSED_OPP_GAIN_24H_MIN_PCT,
} from "./missedOpportunityAudit";
import { computeEntryOutlook } from "./recoveryProbability";
import {
  inWatchEntryWindow,
  qualifiesWatchZoneEnter,
  resolveWatchEntryThresholds,
  resolveWatchTimingPredMin,
  WATCH_ENTRY_MIN_DAYS,
  WATCH_P_ENTRY_MIN,
  type WatchEntryThresholds,
} from "./watchZoneEntryPolicy";
import {
  type BacktestPolygonMatchMap,
  resolveBacktestPolygonMatchPct,
} from "./cdPatternPolygonRetro";
import { resolveWatchProvisionalTarget } from "./watchZoneProvisionalTarget";

export type PastCatalystCloseRecord = {
  ticker?: string;
  completion_date?: string;
  close_m60?: number | null;
  close_m30?: number | null;
  close_m10?: number | null;
  close_m7?: number | null;
  close_m5?: number | null;
  close_m4?: number | null;
  close_m3?: number | null;
  model_dm60_pct?: number | null;
  model_dm30_pct?: number | null;
  model_dm10_pct?: number | null;
  model_dm7_pct?: number | null;
  score_v4?: number | null;
  affidabilita?: number | null;
  slope_5d?: number | null;
  slope_20d?: number | null;
  d5_pct?: number | null;
  dir_v4?: string | null;
};

export type BacktestAnchorId = "T-90" | "T-30" | "T-14";

export type WatchBacktestEvalPoint = {
  key: string;
  ticker: string;
  completionDate: string;
  anchor: BacktestAnchorId;
  daysToCd: number;
  zone: "watch" | "hot" | "other";
  dailyDriftPct: number | null;
  isGainer: boolean;
  forwardPct: number | null;
  targetProvisional: boolean;
  probPct: number | null;
  enterDecision: "hold" | "review" | "exit";
  qualifiedWatch: boolean;
  matchPct: number | null;
  roiToCdPct: number | null;
  roiToM30Pct: number | null;
  roiToM14Pct: number | null;
};

export type WatchBacktestZoneMetrics = {
  zone: "watch" | "hot";
  gainersN: number;
  enterN: number;
  detectedN: number;
  missedN: number;
  falsePositiveN: number;
  recallPct: number | null;
  precisionPct: number | null;
  medianRoiToCdPct: number | null;
  medianRoiEnterToCdPct: number | null;
};

export type WatchBacktestSummary = {
  evaluatedAt: string;
  cohortN: number;
  evalPointsN: number;
  watch: WatchBacktestZoneMetrics;
  hot: WatchBacktestZoneMetrics;
  thresholds: {
    pEntryMin: number;
    timingPredMin: number;
  };
  acceptance: {
    watchRecallOk: boolean;
    watchPrecisionOk: boolean;
    hotRecallBaseline: number | null;
    hotRecallOk: boolean;
  };
  recommendationIt: string;
  recommendationEn: string;
  sampleRows: WatchBacktestEvalPoint[];
};

export type WatchBacktestThresholdSweep = {
  pEntryMin: number;
  timingPredMin: number;
  watchRecallPct: number | null;
  watchPrecisionPct: number | null;
  watchEnterN: number;
};

const ANCHORS: {
  id: BacktestAnchorId;
  daysToCd: number;
  entryKey: keyof PastCatalystCloseRecord;
  nextKey: keyof PastCatalystCloseRecord;
  cdKey: keyof PastCatalystCloseRecord;
}[] = [
  { id: "T-90", daysToCd: 90, entryKey: "close_m60", nextKey: "close_m30", cdKey: "close_m7" },
  { id: "T-30", daysToCd: 30, entryKey: "close_m30", nextKey: "close_m10", cdKey: "close_m7" },
  { id: "T-14", daysToCd: 14, entryKey: "close_m10", nextKey: "close_m7", cdKey: "close_m7" },
];

const MAX_DAILY_DRIFT_PCT = 15;
const MAX_ROI_PCT = 200;

function isSanityPricePath(rec: PastCatalystCloseRecord): boolean {
  const c60 = num(rec.close_m60);
  const c30 = num(rec.close_m30);
  const c7 = num(rec.close_m7);
  if (!c60 || !c30 || !c7 || c60 <= 0 || c30 <= 0 || c7 <= 0) return false;
  const r1 = c30 / c60;
  const r2 = c7 / c60;
  if (r1 < 0.15 || r1 > 5 || r2 < 0.15 || r2 > 8) return false;
  return true;
}

function capDrift(drift: number | null): number | null {
  if (drift == null || !Number.isFinite(drift)) return null;
  return Math.min(MAX_DAILY_DRIFT_PCT, Math.max(-MAX_DAILY_DRIFT_PCT, drift));
}

function capRoi(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.min(MAX_ROI_PCT, Math.max(-MAX_ROI_PCT, n));
}

function offsetFromCloseKey(key: string): number {
  const m = key.match(/close_m(\d+)/);
  return m ? Number(m[1]) : 0;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseAffidPct(rec: PastCatalystCloseRecord): number | null {
  const a = num(rec.affidabilita);
  if (a == null) return null;
  if (a > 1 && a <= 100) return a;
  if (a <= 1) return a * 100;
  return a;
}

function dailyDriftPct(entry: number, exit: number, daysBetween: number): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || daysBetween <= 0) {
    return null;
  }
  return (Math.pow(exit / entry, 1 / daysBetween) - 1) * 100;
}

function roiPct(entry: number, exit: number): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) return null;
  return ((exit - entry) / entry) * 100;
}

function resolveZone(daysToCd: number): "watch" | "hot" | "other" {
  if (inMissedOppWatchWindow(daysToCd)) return "watch";
  if (inMissedOppOperationalWindow(daysToCd)) return "hot";
  return "other";
}

function modelForwardPct(rec: PastCatalystCloseRecord, daysToCd: number): number | null {
  if (daysToCd >= 55) return num(rec.model_dm60_pct) ?? num(rec.model_dm30_pct);
  if (daysToCd >= 20) return num(rec.model_dm30_pct) ?? num(rec.model_dm10_pct);
  return num(rec.model_dm10_pct) ?? num(rec.model_dm7_pct);
}

function resolveMatchPctForAnchor(
  rec: PastCatalystCloseRecord,
  anchor: BacktestAnchorId,
  polygonMatchMap?: BacktestPolygonMatchMap | null,
): number | null {
  const ticker = String(rec.ticker ?? "").trim().toUpperCase();
  const cd = String(rec.completion_date ?? "").slice(0, 10);
  return resolveBacktestPolygonMatchPct(ticker, cd, anchor, polygonMatchMap, num(rec.score_v4))
    .matchPct;
}

function buildSimRow(rec: PastCatalystCloseRecord, dailyDrift: number | null): Record<string, unknown> {
  const affid = parseAffidPct(rec);
  return {
    "Var. Giorn. %": dailyDrift ?? 0,
    "R²": affid != null ? Math.min(0.95, affid / 100 + 0.1) : 0.35,
    "Affidabilità %": affid ?? 50,
    "Slope 5g": rec.slope_5d ?? 0.05,
    "Slope 20g": rec.slope_20d ?? 0.05,
    "Completion Date": rec.completion_date ?? "",
  };
}

function isPastCompletionDate(cd: string, today = new Date()): boolean {
  const d = cd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < today.toISOString().slice(0, 10);
}

export function evaluateWatchBacktestPoint(
  rec: PastCatalystCloseRecord,
  anchor: (typeof ANCHORS)[number],
  opts?: {
    pEntryMin?: number;
    timingPredMin?: number;
    chartPoints?: null;
    polygonMatchMap?: BacktestPolygonMatchMap | null;
  },
): WatchBacktestEvalPoint | null {
  const ticker = String(rec.ticker ?? "").trim().toUpperCase();
  const cd = String(rec.completion_date ?? "").slice(0, 10);
  if (!ticker || !cd) return null;

  const entry = num(rec[anchor.entryKey]);
  const next = num(rec[anchor.nextKey]);
  const cdClose = num(rec[anchor.cdKey]);
  if (entry == null || entry <= 0) return null;

  const daysBetween = Math.max(
    1,
    offsetFromCloseKey(String(anchor.entryKey)) - offsetFromCloseKey(String(anchor.nextKey)),
  );
  const driftRaw =
    next != null
      ? dailyDriftPct(entry, next, Math.max(1, daysBetween))
      : null;
  const drift = capDrift(driftRaw);
  const isGainer = drift != null && drift >= MISSED_OPP_GAIN_24H_MIN_PCT;

  const zone = resolveZone(anchor.daysToCd);
  const forwardFromPrice =
    next != null ? roiPct(entry, next) : modelForwardPct(rec, anchor.daysToCd);
  let forwardPct = forwardFromPrice;
  let targetProvisional = false;
  const matchPct = resolveMatchPctForAnchor(rec, anchor.id, opts?.polygonMatchMap);
  const simRow = buildSimRow(rec, drift);

  if (zone === "watch" && inWatchEntryWindow(anchor.daysToCd)) {
    const prov = resolveWatchProvisionalTarget(simRow, null, anchor.daysToCd, {
      dailyPct24h: drift,
      matchPct,
    });
    if (prov && (forwardPct == null || forwardPct < prov.targetReturnPct)) {
      forwardPct = Math.min(MAX_ROI_PCT, prov.targetReturnPct);
      targetProvisional = true;
    }
  }

  const outlook = computeEntryOutlook({
    lang: "en",
    forwardPct,
    curveGapPct: 0,
    matchPct,
    sdsScore: null,
    sdsVeto: false,
    miiAngleDeg: null,
    stabilityVerdict: "persistent",
    curveRisingHold: (rec.slope_20d ?? rec.slope_5d ?? 0) > 0,
    daysToCd: anchor.daysToCd,
    targetProvisional,
    dailyPct24h: drift,
  });

  const thOverrides: Partial<WatchEntryThresholds> = {};
  if (opts?.pEntryMin != null) thOverrides.pEntryMin = opts.pEntryMin;
  if (opts?.timingPredMin != null) thOverrides.timingPredMin = opts.timingPredMin;

  const qualifiedWatch =
    zone === "watch"
      ? qualifiesWatchZoneEnter({
          daysToCd: anchor.daysToCd,
          probPct: outlook.probabilityPct,
          forwardPct,
          dailyPct24h: drift,
          matchPct,
          targetProvisional,
          simRow,
        }).qualified
      : false;

  let enterDecision = outlook.suggestedDecision;

  if (zone === "watch") {
    if (opts?.pEntryMin != null) {
      const th = resolveWatchEntryThresholds(anchor.daysToCd, {
        targetProvisional,
        dailyPct24h: drift,
        matchPct,
      });
      const eff = th ? { ...th, ...thOverrides } : null;
      const pass =
        eff != null &&
        outlook.probabilityPct >= eff.pEntryMin &&
        forwardPct != null &&
        forwardPct >= eff.fwdMin &&
        qualifiedWatch;
      enterDecision = pass ? "hold" : "exit";
    } else if (qualifiedWatch && outlook.suggestedDecision === "hold") {
      enterDecision = "hold";
    } else if (qualifiedWatch && outlook.suggestedDecision === "review") {
      enterDecision = "review";
    } else {
      enterDecision = "exit";
    }
  }

  return {
    key: `${ticker}|${cd}|${anchor.id}`,
    ticker,
    completionDate: cd,
    anchor: anchor.id,
    daysToCd: anchor.daysToCd,
    zone,
    dailyDriftPct: drift,
    isGainer,
    forwardPct,
    targetProvisional,
    probPct: outlook.probabilityPct,
    enterDecision,
    qualifiedWatch,
    matchPct,
    roiToCdPct: capRoi(cdClose != null ? roiPct(entry, cdClose) : num(rec.d5_pct)),
    roiToM30Pct: capRoi(num(rec.close_m30) != null ? roiPct(entry, num(rec.close_m30)!) : null),
    roiToM14Pct: capRoi(num(rec.close_m10) != null ? roiPct(entry, num(rec.close_m10)!) : null),
  };
}

function aggregateZoneMetrics(
  points: WatchBacktestEvalPoint[],
  zone: "watch" | "hot",
): WatchBacktestZoneMetrics {
  const rows = points.filter((p) => p.zone === zone);
  const gainers = rows.filter((r) => r.isGainer);
  const enterRows = rows.filter((r) => r.enterDecision === "hold");
  const detected = gainers.filter((r) => r.enterDecision === "hold");
  const missed = gainers.filter((r) => r.enterDecision !== "hold");
  const falsePositiveN = enterRows.filter((r) => !r.isGainer).length;

  const recallPct =
    gainers.length > 0
      ? Math.round((detected.length / gainers.length) * 1000) / 10
      : null;
  const precisionPct =
    enterRows.length > 0
      ? Math.round(((enterRows.length - falsePositiveN) / enterRows.length) * 1000) / 10
      : null;

  const roiEnter = enterRows
    .map((r) => r.roiToCdPct)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const roiAll = rows
    .map((r) => r.roiToCdPct)
    .filter((n): n is number => n != null && Number.isFinite(n));

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  return {
    zone,
    gainersN: gainers.length,
    enterN: enterRows.length,
    detectedN: detected.length,
    missedN: missed.length,
    falsePositiveN,
    recallPct,
    precisionPct,
    medianRoiToCdPct: median(roiAll) != null ? Math.round(median(roiAll)! * 10) / 10 : null,
    medianRoiEnterToCdPct: median(roiEnter) != null ? Math.round(median(roiEnter)! * 10) / 10 : null,
  };
}

export function buildWatchEnterBacktest(
  rows: Record<string, PastCatalystCloseRecord>,
  opts?: {
    pEntryMin?: number;
    timingPredMin?: number;
    today?: Date;
    sampleLimit?: number;
    polygonMatchMap?: BacktestPolygonMatchMap | null;
  },
): WatchBacktestSummary {
  const today = opts?.today ?? new Date();
  const evalPoints: WatchBacktestEvalPoint[] = [];
  let cohortN = 0;

  for (const rec of Object.values(rows)) {
    const cd = String(rec.completion_date ?? "").slice(0, 10);
    if (!isPastCompletionDate(cd, today)) continue;
    if (!num(rec.close_m60) || !num(rec.close_m30) || !num(rec.close_m7)) continue;
    if (!isSanityPricePath(rec)) continue;
    cohortN += 1;

    for (const anchor of ANCHORS) {
      const pt = evaluateWatchBacktestPoint(rec, anchor, {
        pEntryMin: opts?.pEntryMin,
        timingPredMin: opts?.timingPredMin,
        polygonMatchMap: opts?.polygonMatchMap,
      });
      if (pt && pt.zone !== "other") evalPoints.push(pt);
    }
  }

  const watch = aggregateZoneMetrics(evalPoints, "watch");
  const hot = aggregateZoneMetrics(evalPoints, "hot");

  const sampleRows = evalPoints
    .filter((p) => p.isGainer || p.enterDecision === "hold")
    .sort((a, b) => {
      if (a.zone !== b.zone) return a.zone === "watch" ? -1 : 1;
      return (b.dailyDriftPct ?? 0) - (a.dailyDriftPct ?? 0);
    })
    .slice(0, opts?.sampleLimit ?? 40);

  let recommendationIt = "";
  let recommendationEn = "";
  if ((watch.recallPct ?? 0) < 40) {
    recommendationIt =
      "Recall watch sotto 40% sul cohort storico — priorità target provvisorio e match polygon; non alzare WATCH_P_ENTRY_MIN.";
    recommendationEn =
      "Watch recall below 40% on historical cohort — prioritize provisional target and polygon match; do not raise WATCH_P_ENTRY_MIN yet.";
  } else if ((watch.precisionPct ?? 0) < 55) {
    recommendationIt =
      "Precision watch sotto 55% — stringere timing predictability e forward min prima del rollout.";
    recommendationEn =
      "Watch precision below 55% — tighten timing predictability and forward min before rollout.";
  } else {
    recommendationIt = "Metriche watch accettabili — rollout graduale consigliato.";
    recommendationEn = "Watch metrics acceptable — gradual rollout recommended.";
  }

  return {
    evaluatedAt: new Date().toISOString(),
    cohortN,
    evalPointsN: evalPoints.length,
    watch,
    hot,
    thresholds: {
      pEntryMin: opts?.pEntryMin ?? WATCH_P_ENTRY_MIN,
      timingPredMin:
        opts?.timingPredMin ??
        resolveWatchTimingPredMin({ daysToCd: WATCH_ENTRY_MIN_DAYS + 29 }),
    },
    acceptance: {
      watchRecallOk: (watch.recallPct ?? 0) >= 40,
      watchPrecisionOk: (watch.precisionPct ?? 0) >= 55,
      hotRecallBaseline: hot.recallPct,
      hotRecallOk: hot.recallPct == null || hot.recallPct >= 35,
    },
    recommendationIt,
    recommendationEn,
    sampleRows,
  };
}

export function sweepWatchEnterThresholds(
  rows: Record<string, PastCatalystCloseRecord>,
  grid?: { pEntryMin?: number[]; timingPredMin?: number[] },
  opts?: { polygonMatchMap?: BacktestPolygonMatchMap | null },
): WatchBacktestThresholdSweep[] {
  const pGrid = grid?.pEntryMin ?? [52, 55, 58, 60, 62, 65];
  const tGrid = grid?.timingPredMin ?? [35, 40, 45, 50];
  const out: WatchBacktestThresholdSweep[] = [];
  for (const pEntryMin of pGrid) {
    for (const timingPredMin of tGrid) {
      const summary = buildWatchEnterBacktest(rows, {
        pEntryMin,
        timingPredMin,
        sampleLimit: 0,
        polygonMatchMap: opts?.polygonMatchMap,
      });
      out.push({
        pEntryMin,
        timingPredMin,
        watchRecallPct: summary.watch.recallPct,
        watchPrecisionPct: summary.watch.precisionPct,
        watchEnterN: summary.watch.enterN,
      });
    }
  }
  return out.sort((a, b) => {
    const scoreA = (a.watchPrecisionPct ?? 0) * 0.6 + (a.watchRecallPct ?? 0) * 0.4;
    const scoreB = (b.watchPrecisionPct ?? 0) * 0.6 + (b.watchRecallPct ?? 0) * 0.4;
    return scoreB - scoreA;
  });
}
