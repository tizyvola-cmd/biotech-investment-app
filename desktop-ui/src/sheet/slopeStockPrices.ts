import type { ChartPoint } from "../types";
import type { UnifiedSlopeFeedRow } from "./slopeEventsFeed";
import { completionDateToNowOffset } from "./chartNowOffset";
import { forwardPred5PpFromRecalibCurve } from "./predictionCurveDailyRecalib";
import { readPred5Pp } from "./simulationPlanGain";
import { currentPriceFromRow } from "./simulationPosition";
import { slopesFromFeedRow } from "./slopeEventSummary";
import {
  buildSlopeTrajectory,
  slopeGapsFromTrajectory,
} from "./slopeRecalibCurve";
import type { InvestSimInputs } from "./investSimStorage";
import {
  computeSimulationPosition,
  rowHasActivePortfolio,
} from "./simulationPosition";
import {
  isStrongSlopeAcceleration,
  SLOPE_MIN_PRICE_GAP_USD,
  SLOPE_TRAJECTORY_GAP5_PP,
} from "./slopeThresholds";

/** Scostamento assoluto in USD tra prezzo modello T+5 e spot. */
export function slopeModelActualGapUsd(
  actual: number | null | undefined,
  expected: number | null | undefined,
): number | null {
  if (actual == null || expected == null) return null;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return null;
  return Math.abs(expected - actual);
}

/**
 * Sotto la soglia (quando noto) gli errori pendenza sono rumore di prezzo.
 * Gap sconosciuto (manca spot o Pred+5) → mantieni il segnale momentum (allineato tab Slope).
 */
export function isMaterialSlopePriceGap(
  actual: number | null | undefined,
  expected: number | null | undefined,
  minUsd = SLOPE_MIN_PRICE_GAP_USD,
): boolean {
  const gap = slopeModelActualGapUsd(actual, expected);
  if (gap == null) return true;
  return gap >= minUsd;
}

export type SlopeStockDisplay = {
  actual: number | null;
  /** Model-implied spot at T+5 (today × (1 + Pred+5 pp)). */
  expected: number | null;
  tone: string;
  pred5pp: number | null;
  /** actual − model (% vs today) on 5d trajectory window, when available. */
  gap5pp: number | null;
  /** Prezzo da foglio Simulation; ``detection`` = snapshot al rilevamento (titolo assente). */
  actualSource: "sheet" | "detection" | "chart" | null;
  /** Titolo non più presente nel foglio Simulation caricato (es. CD passato). */
  simRowStale: boolean;
};

function spotFromChartPoints(
  chartPoints: ChartPoint[] | null | undefined,
  cd: string | null | undefined,
): number | null {
  if (!chartPoints?.length) return null;
  const nowOff = cd ? completionDateToNowOffset(cd) : null;
  if (nowOff == null) return null;
  const hit =
    chartPoints.find((p) => p.offset === nowOff && p.price_usd != null) ??
    chartPoints.find((p) => p.price_usd != null);
  const px = hit?.price_usd;
  return px != null && Number.isFinite(px) && px > 0 ? px : null;
}

function pred5PpFromFeedRow(feedRow: UnifiedSlopeFeedRow | null | undefined): number | null {
  if (!feedRow) return null;
  if (feedRow.source === "contrarian") {
    const p = feedRow.contrarianEvent.pred5;
    return p != null && Number.isFinite(p) ? p : null;
  }
  const s5 = feedRow.slopeEvent.slope5d;
  if (s5 != null && Number.isFinite(s5)) return Math.round(s5 * 5 * 100) / 100;
  return null;
}

function actualFromFeedRow(
  feedRow: UnifiedSlopeFeedRow | null | undefined,
): number | null {
  if (!feedRow || feedRow.source !== "slope") return null;
  const px = feedRow.slopeEvent.price_at_detection;
  return px != null && Number.isFinite(px) && px > 0 ? px : null;
}

function readDaysToCd(simRow: Record<string, unknown> | null): number {
  if (!simRow) return 30;
  const raw = simRow["Completion Date"] ?? simRow.CD ?? simRow["Data CD"];
  if (!raw) return 30;
  const cd = new Date(`${String(raw).slice(0, 10)}T12:00:00`);
  const now = new Date();
  if (Number.isNaN(cd.getTime())) return 30;
  return Math.max(1, Math.round((cd.getTime() - now.getTime()) / 86400000));
}

/** Colore Modello T+5 $ allineato a errore pendenza + scostamento modello vs reale. */
export function slopeStockTone(opts: {
  kind: UnifiedSlopeFeedRow["kind"] | null;
  slope5d?: number | null;
  slope20d?: number | null;
  pred5pp?: number | null;
  gap5pp?: number | null;
  actual?: number | null;
  expected?: number | null;
}): string {
  const { kind, slope5d, slope20d, pred5pp, gap5pp, actual, expected } = opts;
  const strongAccel = isStrongSlopeAcceleration(kind, slope5d, slope20d);

  if (kind === "slope_rev") return "text-[rgb(var(--signal-down))]";
  if (kind === "contrarian") return "text-[rgb(var(--accent))]";

  if (strongAccel && expected != null && actual != null && expected > actual * 1.002) {
    if (gap5pp != null && gap5pp < -SLOPE_TRAJECTORY_GAP5_PP) return "text-[rgb(var(--warn))]";
    return "text-[rgb(var(--signal-up))]";
  }

  if (gap5pp != null && Number.isFinite(gap5pp)) {
    if (gap5pp < -SLOPE_TRAJECTORY_GAP5_PP) return "text-[rgb(var(--signal-down))]";
    if (gap5pp > SLOPE_TRAJECTORY_GAP5_PP) return "text-[rgb(var(--signal-up))]";
  }

  if (pred5pp != null && slope5d != null && Number.isFinite(pred5pp) && Number.isFinite(slope5d)) {
    const realized5 = slope5d * 5;
    if (!strongAccel && realized5 < pred5pp - 0.4) return "text-[rgb(var(--signal-down))]";
    if (realized5 > pred5pp + 0.4) return "text-[rgb(var(--signal-up))]";
  }

  if (kind === "slope_dec") return "text-[rgb(var(--warn))]";
  if (kind === "slope_acc") return "text-[rgb(var(--signal-up))]";

  if (expected != null && actual != null && expected > 0 && actual > 0) {
    if (expected > actual * 1.002) return "text-[rgb(var(--signal-up))]";
    if (expected < actual * 0.998) return "text-[rgb(var(--signal-down))]";
  }

  if (slope5d != null && slope20d != null && slope5d * slope20d < 0) {
    return "text-[rgb(var(--signal-down))]";
  }
  if (slope5d != null && slope5d < -0.08) return "text-[rgb(var(--signal-down))]";
  if (slope5d != null && slope5d > 0.08) return "text-[rgb(var(--signal-up))]";

  return "text-ink-muted";
}

export function resolveSlopeStockPrices(
  simRow: Record<string, unknown> | null,
  chartPoints: ChartPoint[] | null | undefined,
  feedRow?: UnifiedSlopeFeedRow | null,
  opts?: { simRowStale?: boolean; eventCd?: string | null },
): SlopeStockDisplay {
  const eventCd = opts?.eventCd ?? feedRow?.cd ?? null;
  let actualSource: SlopeStockDisplay["actualSource"] = null;
  let actual = simRow ? currentPriceFromRow(simRow) : null;
  if (actual != null) actualSource = "sheet";
  if (actual == null) {
    actual = spotFromChartPoints(chartPoints, eventCd);
    if (actual != null) actualSource = "chart";
  }
  if (actual == null) {
    actual = actualFromFeedRow(feedRow);
    if (actual != null) actualSource = "detection";
  }

  let pred5pp: number | null = null;
  if (simRow && chartPoints?.length) {
    pred5pp = forwardPred5PpFromRecalibCurve(simRow, chartPoints);
  }
  if (pred5pp == null && chartPoints?.length && eventCd) {
    pred5pp = forwardPred5PpFromRecalibCurve({ "Completion Date": eventCd }, chartPoints);
  }
  if (pred5pp == null && simRow) {
    pred5pp = readPred5Pp(simRow);
  }
  if (pred5pp == null) {
    pred5pp = pred5PpFromFeedRow(feedRow);
  }

  const expected =
    actual != null && pred5pp != null && Number.isFinite(pred5pp)
      ? Math.round(actual * (1 + pred5pp / 100) * 100) / 100
      : null;

  let gap5pp: number | null = null;
  const trajSimRow =
    simRow ??
    (eventCd ? ({ "Completion Date": eventCd } as Record<string, unknown>) : null);
  if (trajSimRow && chartPoints?.length) {
    const daysToCd =
      feedRow?.source === "slope"
        ? feedRow.slopeEvent.days_to_cd_at_detection ?? readDaysToCd(trajSimRow)
        : readDaysToCd(trajSimRow);
    const traj = buildSlopeTrajectory({
      chartPoints,
      simRow: trajSimRow,
      daysToCd,
    });
    gap5pp = slopeGapsFromTrajectory(traj.points).at5;
  }

  const { slope5d, slope20d } = feedRow ? slopesFromFeedRow(feedRow) : { slope5d: null, slope20d: null };
  const tone = slopeStockTone({
    kind: feedRow?.kind ?? null,
    slope5d,
    slope20d,
    pred5pp,
    gap5pp,
    actual,
    expected,
  });

  return {
    actual,
    expected,
    tone,
    pred5pp,
    gap5pp,
    actualSource,
    simRowStale: opts?.simRowStale ?? (!simRow && Boolean(feedRow)),
  };
}

/** |Modello T+5 − spot| per filtri tab / banner (USD). */
export function slopePriceGapFromSimRow(
  simRow: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null | undefined,
): number | null {
  const { actual, expected } = resolveSlopeStockPrices(simRow, chartPoints, null);
  return slopeModelActualGapUsd(actual, expected);
}

/** @deprecated Usa resolveSlopeStockPrices — mantiene compat per import legacy. */
export function resolveStockPrices(
  simRow: Record<string, unknown> | null,
  chartPoints: ChartPoint[] | null | undefined,
): { actual: number | null; expected: number | null } {
  const d = resolveSlopeStockPrices(simRow, chartPoints, null);
  return { actual: d.actual, expected: d.expected };
}

export function expectedStockTone(
  expected: number | null,
  actual: number | null,
): string {
  if (expected == null || actual == null) return "text-ink-muted";
  if (expected > actual * 1.002) return "text-[rgb(var(--signal-up))]";
  if (expected < actual * 0.998) return "text-[rgb(var(--signal-down))]";
  return "text-ink";
}

/** Sottotitolo badge Accelerazione quando spot < modello T+5 ma pendenza 5g si rafforza. */
export function slopeAccelPriceHint(
  lang: "it" | "en",
  kind: UnifiedSlopeFeedRow["kind"] | null,
  stock: Pick<SlopeStockDisplay, "actual" | "expected" | "gap5pp">,
): string | null {
  if (kind !== "slope_acc") return null;
  const { actual, expected, gap5pp } = stock;
  if (actual == null || expected == null || expected <= actual * 1.002) return null;
  if (gap5pp != null && gap5pp < -SLOPE_TRAJECTORY_GAP5_PP) {
    return lang === "it" ? "Momento↑ · sotto curva 5g" : "Momentum↑ · below 5d curve";
  }
  return lang === "it" ? "T+5 modello sopra spot" : "Model T+5 above spot";
}

export type SlopeCapitalImpact = {
  hasPosition: boolean;
  capitalEur: number | null;
  /** Capitale × scostamento reale vs modello T+5 (shares × (actual − expected)). */
  modelGapLossEur: number | null;
  positionPnlEur: number | null;
  positionPnlPct: number | null;
  priceGapUsd: number | null;
};

/** Perdita (o surplus) in € sul capitale investito dovuta allo scostamento spot vs modello T+5. */
export function resolveSlopeCapitalImpact(
  simRow: Record<string, unknown> | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  actual: number | null,
  expected: number | null,
): SlopeCapitalImpact {
  const priceGapUsd = slopeModelActualGapUsd(actual, expected);
  const empty: SlopeCapitalImpact = {
    hasPosition: false,
    capitalEur: null,
    modelGapLossEur: null,
    positionPnlEur: null,
    positionPnlPct: null,
    priceGapUsd,
  };
  if (!simRow || !inputs || !rowHasActivePortfolio(simRow, inputs)) return empty;

  const pos = computeSimulationPosition(simRow, inputs);
  if (!pos || pos.capital <= 0) return empty;

  let modelGapLossEur: number | null = null;
  if (actual != null && expected != null && Number.isFinite(actual) && Number.isFinite(expected)) {
    const shares = pos.shares > 0 ? pos.shares : pos.buyPrice > 0 ? pos.capital / pos.buyPrice : 0;
    if (shares > 0) {
      modelGapLossEur = Math.round(shares * (actual - expected) * 100) / 100;
    }
  }

  return {
    hasPosition: true,
    capitalEur: pos.capital,
    modelGapLossEur,
    positionPnlEur: pos.pnlUnavailable ? null : pos.pnlEur,
    positionPnlPct: pos.pnlUnavailable ? null : pos.pnlPct,
    priceGapUsd,
  };
}

export function fmtSlopeCapitalLossEur(
  eur: number | null | undefined,
  lang: "it" | "en",
): string {
  if (eur == null || !Number.isFinite(eur)) return "—";
  const abs = Math.abs(eur).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (eur < -0.005) return `−€${abs}`;
  if (eur > 0.005) return `+€${abs}`;
  return lang === "it" ? "€0,00" : "€0.00";
}

export function slopeCapitalLossTone(eur: number | null | undefined): string {
  if (eur == null || !Number.isFinite(eur)) return "text-ink-muted";
  if (eur < -0.01) return "text-[rgb(var(--signal-down))] font-semibold";
  if (eur > 0.01) return "text-[rgb(var(--signal-up))] font-semibold";
  return "text-ink-muted";
}

export function fmtStockUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function slopeStockActualTitle(
  stock: Pick<SlopeStockDisplay, "actualSource" | "simRowStale">,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  if (stock.actualSource === "sheet") {
    return it ? "Prezzo reale corrente (Simulation / Yahoo)" : "Current real price (Simulation / Yahoo)";
  }
  if (stock.actualSource === "detection") {
    return it
      ? "Prezzo al rilevamento — watch post-CD (titolo fuori foglio Simulation)"
      : "Price at detection — post-CD watch (ticker off Simulation sheet)";
  }
  if (stock.actualSource === "chart") {
    return it ? "Prezzo da snapshot curva (nessuna riga Simulation)" : "Price from chart snapshot (no Simulation row)";
  }
  if (stock.simRowStale) {
    return it
      ? "Nessun prezzo: watch post-CD senza price_at_detection nel log"
      : "No price: post-CD watch without price_at_detection in log";
  }
  return it ? "Prezzo reale corrente" : "Current real price";
}

export function slopeStockExpectedTitle(
  stock: Pick<SlopeStockDisplay, "pred5pp" | "actualSource" | "simRowStale">,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  const pred =
    stock.pred5pp != null
      ? `Pred+5 ${stock.pred5pp >= 0 ? "+" : ""}${stock.pred5pp.toFixed(2)} pp`
      : null;
  if (pred && stock.actualSource === "sheet") {
    return it
      ? `Prezzo atteso (modello): oggi × (1 + ${pred}). Colore = tono errore pendenza.`
      : `Expected price (model): today × (1 + ${pred}). Color = slope error tone.`;
  }
  if (pred && stock.actualSource === "detection") {
    return it
      ? `Prezzo atteso stimato al rilevamento × (1 + ${pred})`
      : `Expected price at detection × (1 + ${pred})`;
  }
  if (stock.simRowStale) {
    return it
      ? "Prezzo atteso non disponibile (CD passato o curva assente dallo snapshot)"
      : "Expected price unavailable (past CD or curve missing from snapshot)";
  }
  return it
    ? "Prezzo atteso ~T+5 (Pred+5 dalla curva ricalibrata)"
    : "Expected ~T+5 price (Pred+5 from recalibrated curve)";
}
