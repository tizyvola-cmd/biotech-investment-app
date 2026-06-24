import type { SdsRow } from "../api/supernova";
import type { ChartPoint, SheetTable } from "../types";
import { calendarOffsetsForValueCount } from "./chartNodes";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { recalibCurveVsM60 } from "./sdsCompareOverlay";
import {
  CD_PATTERN_RADAR_AXIS_ORDER,
  CD_PATTERN_RADAR_TARGET,
  type CdPatternRadarAxisId,
  type CdPatternWindow,
  eisCdDistanceFactor,
  resolveCdPatternWindow,
  windowAnchorLabel,
} from "./cdPatternHorizons";
import { buildMigSolidityByKey, type MigSoliditySnapshot } from "./entrySolidityMig";
import { buildSdsByTicker } from "./sdsTopOppGate";
import { computeRaScoreAsOfAnchor } from "./rascoreAnchorSolidity";
import { daysFromToday } from "./simulationPlanGain";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
import { buildTickerEisDetail, clinicalKpiFromSimRow, type TickerEisDetail } from "./tickerEisSummary";
import { extractCurveInputs } from "./precatCurve";
import { computeEisSuperScoreSync, type EisSuperScoreState } from "../api/eisSuperScore";
import type { ChartBundle } from "../types";

export type CdPatternAxisPoint = {
  id: CdPatternRadarAxisId;
  label: string;
  current: number;
  target: number;
  rawValue: number | null;
  threshold: number;
  unit: string;
};

export type CdPatternNearestEis = {
  score: number;
  superScore: number | null;
  eventDate: string | null;
  title: string;
  sourceLabel: string;
  daysBeforeCd: number | null;
  cdDistanceLabel: string;
  cdDistanceFactor: number;
  /** Base expected ΔP (pp) at T+1 from score magnitude. */
  baseExpectedPp: number | null;
  /** After CD-distance moderation. */
  moderatedExpectedPp: number | null;
  summary: string | null;
  link: string | null;
};

export type CdPatternTickerRecommendation = {
  key: string;
  ticker: string;
  company: string | null;
  completionDate: string | null;
  daysToCd: number | null;
  nowOffset: number | null;
  window: CdPatternWindow;
  arcPositionLabel: string;
  segmentRoiPct: number | null;
  radarCurrent: number[];
  radarTarget: number[];
  axes: CdPatternAxisPoint[];
  matchPct: number;
  verdict: "strong" | "watch" | "weak" | "blocked";
  nearestEis: CdPatternNearestEis | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function axisPct(value: number | null, min: number, higherIsBetter = true): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (min <= 0) {
    if (!higherIsBetter) return value <= min ? 100 : 0;
    return value >= 0 ? 100 : 0;
  }
  const ratio = value / min;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/** Model recalib curve Δ (% vs T−60) over the full active arc window — aligned with Supernova overlay. */
function segmentRoiPct(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
  window: CdPatternWindow,
): number | null {
  if (!chartPoints?.length) return null;
  const raw = recalibCurveVsM60(chartPoints, row, false);
  if (!raw) return null;
  const offsets = calendarOffsetsForValueCount(raw.length);
  const series = offsets.map((offset, i) => ({ offset, y: raw[i] ?? 0 }));
  const p0 = interpolateAtOffset(series, window.startOffset, { extrapolate: true });
  const p1 = interpolateAtOffset(series, window.endOffset, { extrapolate: true });
  if (p0 == null || p1 == null) return null;
  return round1(p1 - p0);
}

function baseExpectedPpFromEis(eisScore: number): number {
  return round1(eisScore * 0.2);
}

export function buildCdPatternNearestEis(
  ticker: string,
  cdIso: string | null,
  lang: "it" | "en",
  superScoreState?: EisSuperScoreState | null,
  sheetClinicalKpi?: number | null,
): CdPatternNearestEis | null {
  return pickNearestEis(ticker, cdIso, lang, superScoreState, sheetClinicalKpi);
}

function nearestEisFromScoreFallback(
  detail: Pick<TickerEisDetail, "score" | "sheetFallback" | "breakdownHint" | "feedLabels">,
  lang: "it" | "en",
  superScoreState?: EisSuperScoreState | null,
  daysBeforeCd: number | null = null,
): CdPatternNearestEis | null {
  if (detail.score == null || !Number.isFinite(detail.score)) return null;
  const score = detail.score;
  const superScore = computeEisSuperScoreSync(score, daysBeforeCd, superScoreState);
  const { label: cdDistanceLabel, factor } = eisCdDistanceFactor(daysBeforeCd);
  const base = baseExpectedPpFromEis(score);
  const moderated =
    base != null ? round1(base * factor * (superScore / Math.max(Math.abs(score), 1))) : null;
  return {
    score,
    superScore,
    eventDate: null,
    title:
      detail.sheetFallback
        ? lang === "it"
          ? "KPI clinico (foglio Simulation)"
          : "Clinical KPI (Simulation sheet)"
        : lang === "it"
          ? "EIS aggregato feed"
          : "Aggregated feed EIS",
    sourceLabel: detail.sheetFallback
      ? lang === "it"
        ? "Foglio Simulation"
        : "Simulation sheet"
      : detail.feedLabels.join(" · ") || (lang === "it" ? "Feed clinico" : "Clinical feed"),
    daysBeforeCd,
    cdDistanceLabel,
    cdDistanceFactor: factor,
    baseExpectedPp: base,
    moderatedExpectedPp: moderated,
    summary: detail.breakdownHint || null,
    link: null,
  };
}

function pickNearestEis(
  ticker: string,
  cdIso: string | null,
  lang: "it" | "en",
  superScoreState?: EisSuperScoreState | null,
  sheetClinicalKpi?: number | null,
): CdPatternNearestEis | null {
  const detail = buildTickerEisDetail(ticker, lang, sheetClinicalKpi);

  if (detail.events.length) {
    const today = Date.now();
    let best = detail.events[0]!;
    let bestDist = Infinity;
    for (const ev of detail.events) {
      const t = ev.eventDate ? Date.parse(ev.eventDate) : NaN;
      if (!Number.isFinite(t)) continue;
      const dist = Math.abs(t - today);
      if (dist < bestDist) {
        bestDist = dist;
        best = ev;
      }
    }

    const score = best.breakdown.score;
    let daysBeforeCd: number | null = null;
    if (cdIso && best.eventDate) {
      const cd = Date.parse(cdIso.slice(0, 10));
      const ed = Date.parse(best.eventDate.slice(0, 10));
      if (Number.isFinite(cd) && Number.isFinite(ed)) {
        daysBeforeCd = Math.round((cd - ed) / 86400000);
      }
    }

    const { label: cdDistanceLabel, factor } = eisCdDistanceFactor(daysBeforeCd);
    const superScore = computeEisSuperScoreSync(score, daysBeforeCd, superScoreState);
    const base = baseExpectedPpFromEis(score);
    const moderated = base != null ? round1(base * factor * (superScore / Math.max(Math.abs(score), 1))) : null;

    return {
      score,
      superScore,
      eventDate: best.eventDate,
      title: best.title,
      sourceLabel: best.sourceLabel,
      daysBeforeCd,
      cdDistanceLabel,
      cdDistanceFactor: factor,
      baseExpectedPp: base,
      moderatedExpectedPp: moderated,
      summary: best.summary,
      link: best.link,
    };
  }

  return nearestEisFromScoreFallback(detail, lang, superScoreState, null);
}

function buildAxes(
  window: CdPatternWindow,
  ra: number | null,
  sds: number | null,
  mig: MigSoliditySnapshot | null,
  slope20: number | null,
  lang: "it" | "en",
): CdPatternAxisPoint[] {
  const labels: Record<CdPatternRadarAxisId, string> =
    lang === "it"
      ? { ra: "RA score", sds: "SDS", mii: "MII °", calib: "Calib pre", slope: "Slope 20g" }
      : { ra: "RA score", sds: "SDS", mii: "MII °", calib: "Calib pre", slope: "Slope 20g" };

  const raw: Record<CdPatternRadarAxisId, { v: number | null; min: number; unit: string }> = {
    ra: { v: ra, min: window.raMin, unit: "/100" },
    sds: { v: sds, min: window.sdsMin, unit: "/100" },
    mii: { v: mig?.slopeAngleDeg ?? null, min: window.miiAngleMin, unit: "°" },
    calib: { v: mig?.calibPreScore ?? null, min: window.calibMin, unit: "/100" },
    slope: { v: slope20, min: window.slope20Min, unit: " pp/g" },
  };

  return CD_PATTERN_RADAR_AXIS_ORDER.map((id) => {
    const { v, min, unit } = raw[id];
    const current = axisPct(v, min, id !== "slope" || min <= 0 ? true : true);
    const slopeCurrent =
      id === "slope" && v != null && v < min ? Math.max(0, axisPct(v, min)) : current;
    return {
      id,
      label: labels[id],
      current: id === "slope" ? slopeCurrent : current,
      target: 100,
      rawValue: v,
      threshold: min,
      unit,
    };
  });
}

function verdictFromMatch(matchPct: number): CdPatternTickerRecommendation["verdict"] {
  if (matchPct >= 85) return "strong";
  if (matchPct >= 65) return "watch";
  if (matchPct >= 40) return "weak";
  return "blocked";
}

export function buildCdPatternTickerRecommendation(args: {
  row: Record<string, unknown>;
  chartPoints: ChartPoint[] | null | undefined;
  investInputs: InvestSimInputs;
  sdsRows: SdsRow[] | null | undefined;
  migByKey: Map<string, MigSoliditySnapshot>;
  lang?: "it" | "en";
  includeEis?: boolean;
  eisSuperScoreState?: EisSuperScoreState | null;
}): CdPatternTickerRecommendation | null {
  const lang = args.lang ?? "it";
  const ticker = String(args.row.Ticker ?? args.row.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker) return null;

  const cdRaw = String(args.row["Completion Date"] ?? "").trim();
  const daysToCd = daysFromToday(cdRaw);
  const nowOff = completionDateToNowOffset(args.row["Completion Date"]);
  const window = resolveCdPatternWindow(nowOff, daysToCd);
  if (!window) return null;

  const anchor = window.startOffset;
  const ra = computeRaScoreAsOfAnchor({
    simRow: args.row,
    mergedInputs: args.investInputs,
    chartPts: args.chartPoints,
    history: null,
    anchor,
    lang,
  });

  const sdsMap = buildSdsByTicker(args.sdsRows);
  const sds = sdsMap.get(ticker)?.sds ?? null;

  const migKey = normalizedRowKey(ticker, cdRaw);
  const mig = args.migByKey.get(migKey) ?? null;

  const { slope20d: slope20 } = extractCurveInputs(args.row);

  const axes = buildAxes(window, ra, sds, mig, slope20, lang);
  const radarCurrent = axes.map((a) => a.current);
  const matchPct = Math.round(radarCurrent.reduce((s, v) => s + v, 0) / radarCurrent.length);

  const arcEnd =
    nowOff != null && nowOff > window.startOffset && nowOff <= window.endOffset
      ? nowOff
      : window.endOffset;
  const arcPositionLabel =
    lang === "it"
      ? `${window.label} · posizione ${windowAnchorLabel(window.startOffset)} → ${windowAnchorLabel(arcEnd)}`
      : `${window.label} · position ${windowAnchorLabel(window.startOffset)} → ${windowAnchorLabel(arcEnd)}`;

  return {
    key: migKey,
    ticker,
    company: String(args.row.Company ?? args.row.company ?? "").trim() || null,
    completionDate: cdRaw || null,
    daysToCd,
    nowOffset: nowOff,
    window,
    arcPositionLabel,
    segmentRoiPct: segmentRoiPct(args.row, args.chartPoints, window),
    radarCurrent,
    radarTarget: [...CD_PATTERN_RADAR_TARGET],
    axes,
    matchPct,
    verdict: verdictFromMatch(matchPct),
    nearestEis: args.includeEis
      ? pickNearestEis(
          ticker,
          cdRaw || null,
          lang,
          args.eisSuperScoreState,
          clinicalKpiFromSimRow(args.row),
        )
      : null,
  };
}

export function buildCdPatternRecommendations(args: {
  simTable: SheetTable | null | undefined;
  chartsBySeriesKey: Map<string, ChartPoint[]>;
  investInputs: InvestSimInputs;
  sdsRows: SdsRow[] | null | undefined;
  chartsBundle: ChartBundle | null | undefined;
  lang?: "it" | "en";
  maxDaysToCd?: number;
  includeEis?: boolean;
  eisSuperScoreState?: EisSuperScoreState | null;
}): CdPatternTickerRecommendation[] {
  const lang = args.lang ?? "it";
  const maxDays = args.maxDaysToCd ?? 120;
  const migByKey = getCachedMigByKey(args.simTable ?? null, args.chartsBundle ?? null, args.sdsRows);
  const out: CdPatternTickerRecommendation[] = [];

  for (const row of args.simTable?.rows ?? []) {
    const cd = String(row["Completion Date"] ?? "").trim();
    const days = daysFromToday(cd);
    if (days == null || days < -7 || days > maxDays) continue;
    const sk = simulationRowSeriesKey(row);
    const pts = sk ? args.chartsBySeriesKey.get(sk) : undefined;
    const rec = buildCdPatternTickerRecommendation({
      row,
      chartPoints: pts,
      investInputs: args.investInputs,
      sdsRows: args.sdsRows,
      migByKey,
      lang,
      includeEis: args.includeEis,
      eisSuperScoreState: args.eisSuperScoreState,
    });
    if (rec) out.push(rec);
  }

  out.sort((a, b) => {
    const da = a.daysToCd ?? 999;
    const db = b.daysToCd ?? 999;
    if (da !== db) return da - db;
    return b.matchPct - a.matchPct;
  });
  return out;
}

let _migCacheKey = "";
let _migCache: Map<string, MigSoliditySnapshot> | null = null;

function getCachedMigByKey(
  simTable: SheetTable | null | undefined,
  chartsBundle: ChartBundle | null | undefined,
  sdsRows: SdsRow[] | null | undefined,
): Map<string, MigSoliditySnapshot> {
  const key = `${simTable?.rows?.length ?? 0}:${sdsRows?.length ?? 0}:${chartsBundle?.series ? Object.keys(chartsBundle.series).length : 0}`;
  if (_migCacheKey === key && _migCache) return _migCache;
  _migCache = buildMigSolidityByKey(simTable ?? null, chartsBundle ?? null, sdsRows);
  _migCacheKey = key;
  return _migCache;
}
