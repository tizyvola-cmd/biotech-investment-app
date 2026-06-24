/**
 * Resolve / sanitize sim-loop P&L from compact ticks (evaluations stripped on save).
 */
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import { openPaperMtmFromPortfolio } from "./investDecisionSimExperiment";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";

const PNL_SANITY_MAX_EUR = 500_000;

export function roundSimPnlEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function sanePnlEur(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && Math.abs(n) <= PNL_SANITY_MAX_EUR;
}

function resolveClosedFromPiggy(cumRealized: number, piggy: ExperimentPiggyBank): number {
  if (!sanePnlEur(piggy.closedPnlEur)) return roundSimPnlEur(cumRealized);
  return roundSimPnlEur(Math.max(cumRealized, piggy.closedPnlEur));
}

function fromPiggyParts(
  piggy: ExperimentPiggyBank,
  cumRealized: number,
): number | null {
  const closed = resolveClosedFromPiggy(cumRealized, piggy);
  if (!sanePnlEur(piggy.openMtmPnlEur)) return closed;
  return roundSimPnlEur(closed + piggy.openMtmPnlEur);
}

/** End-of-tick total — prefer decomposed piggy on compact ticks, else MTM reconstruct. */
export function resolveTickEndTotalPnlEur(
  cumRealized: number,
  portfolioAfter: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  piggy?: ExperimentPiggyBank | null,
): number {
  const openMtm = openPaperMtmFromPortfolio(portfolioAfter, evaluations);
  const reconstructed = roundSimPnlEur(cumRealized + openMtm);

  if (!piggy || !Number.isFinite(piggy.totalPnlEur)) return reconstructed;

  const stored = piggy.totalPnlEur;
  if (Math.abs(stored) > PNL_SANITY_MAX_EUR) return reconstructed;

  const parts = fromPiggyParts(piggy, cumRealized);
  if (parts != null && evaluations.length === 0 && sanePnlEur(piggy.openMtmPnlEur) && Math.abs(piggy.openMtmPnlEur) > 0) {
    if (Math.abs(stored) <= PNL_SANITY_MAX_EUR) {
      const partsTol = Math.max(100, Math.abs(parts) * 0.2 + 50);
      if (Math.abs(stored - parts) <= partsTol) return roundSimPnlEur(stored);
    }
    if (Math.abs(parts - reconstructed) > 50 || Math.abs(piggy.openMtmPnlEur) > 0) {
      return parts;
    }
  }

  if (stored === 0 && reconstructed !== 0) return reconstructed;
  if (stored !== 0 && reconstructed === 0 && portfolioAfter.length === 0) return stored;

  if (evaluations.length === 0 && stored !== 0) {
    const closedOnly = roundSimPnlEur(piggy.closedPnlEur ?? cumRealized);
    if (portfolioAfter.length === 0) return closedOnly;
    return reconstructed;
  }

  if (Math.abs(stored - reconstructed) <= 50) return stored;
  return reconstructed;
}

/** Paper sim total P&L at a tick — realized closes + open MTM (ignores stale zero piggy snapshots). */
export function resolvePaperTotalPnlEur(
  cumRealized: number,
  portfolioAfter: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  piggy?: ExperimentPiggyBank | null,
): number {
  return resolveTickEndTotalPnlEur(cumRealized, portfolioAfter, evaluations, piggy);
}

/**
 * Detect tick history that omits open MTM (flat near €0, or closed-only climb)
 * or ends with stale partial open MTM while live re-mark is very different —
 * both cause a vertical chart cliff at "now".
 */
export function looksLikeOpenMtmCatchUpCliff(
  histTotal: number,
  liveTotal: number,
  histClosed?: number | null,
  liveClosed?: number | null,
): boolean {
  if (!Number.isFinite(histTotal) || !Number.isFinite(liveTotal)) return false;

  const gap = roundSimPnlEur(liveTotal - histTotal);
  const absTol = Math.max(2500, Math.abs(liveTotal) * 0.45 + 500);
  const jumpMin = Math.max(1500, Math.abs(liveTotal) * 0.35);

  if (Math.abs(gap) <= jumpMin || Math.abs(gap) <= absTol * 0.85) return false;

  if (Math.abs(histTotal) < Math.max(400, absTol * 0.25)) return true;

  const closed =
    histClosed != null && Number.isFinite(histClosed) ? histClosed : histTotal;
  const closedOnly =
    Math.abs(histTotal - closed) < Math.max(75, Math.abs(closed) * 0.06);
  if (closedOnly) {
    const impliedOpenMtm = roundSimPnlEur(liveTotal - closed);
    if (
      Math.abs(impliedOpenMtm) > Math.max(800, Math.abs(liveTotal) * 0.2) &&
      Math.abs(gap) > Math.max(2000, Math.abs(histTotal) * 0.35)
    ) {
      return true;
    }
  }

  // Last tick had partial open MTM; live "now" re-marked the book with closed flat.
  const hClosed =
    histClosed != null && Number.isFinite(histClosed) ? roundSimPnlEur(histClosed) : null;
  const lClosed =
    liveClosed != null && Number.isFinite(liveClosed)
      ? roundSimPnlEur(liveClosed)
      : hClosed;
  if (hClosed != null && lClosed != null) {
    const closedDrift = Math.abs(roundSimPnlEur(lClosed - hClosed));
    const closedFlatTol = Math.max(100, Math.abs(hClosed) * 0.05 + 50);
    if (closedDrift <= closedFlatTol) {
      const histOpen = roundSimPnlEur(histTotal - hClosed);
      const liveOpen = roundSimPnlEur(liveTotal - lClosed);
      const openSwing = Math.abs(roundSimPnlEur(liveOpen - histOpen));
      const openSwingMin = Math.max(1500, Math.abs(liveTotal) * 0.25 + 400);
      if (openSwing >= openSwingMin) return true;
    }
  }

  return false;
}

function rampHistTotalsToLive<T extends DecisionSimPnlSeriesPoint>(
  points: T[],
  histIndices: number[],
  liveTotal: number,
  liveClosed: number,
): T[] {
  const openMtmLive = roundSimPnlEur(liveTotal - liveClosed);
  const span = histIndices.length - 1;

  return points.map((p, i) => {
    if (p.isLive) {
      const closed = p.closedPnlEur ?? liveClosed;
      return {
        ...p,
        totalPnlEur: roundSimPnlEur(liveTotal),
        openMtmEur: roundSimPnlEur(liveTotal - closed),
      };
    }
    const histPos = histIndices.indexOf(i);
    if (histPos < 0) return p;
    const cumR =
      p.closedPnlEur != null && Number.isFinite(p.closedPnlEur)
        ? p.closedPnlEur
        : (p.cumulativeRealizedEur ?? 0);
    const frac = span > 0 ? histPos / span : 1;
    const openEst = roundSimPnlEur(openMtmLive * frac);
    return {
      ...p,
      totalPnlEur: roundSimPnlEur(cumR + openEst),
      openMtmEur: openEst,
    };
  });
}

/**
 * When live total is injected after stale flat history, spread open-MTM catch-up
 * across the window instead of attributing it all to the last calendar day.
 */
export function reconcileEndOfDayTotalsToLive(
  endOfDayTotal: Map<string, number>,
  cumRealizedByDay: Map<string, number>,
  liveTotalPnlEur: number,
): Map<string, number> {
  const days = [...endOfDayTotal.keys()].sort();
  if (days.length === 0) return endOfDayTotal;

  const out = new Map(endOfDayTotal);
  const lastDay = days[days.length - 1]!;
  out.set(lastDay, roundSimPnlEur(liveTotalPnlEur));

  if (days.length < 2) return out;

  const prevDay = days[days.length - 2]!;
  const prevEnd = out.get(prevDay) ?? 0;

  const lastCumRealized =
    cumRealizedByDay.get(lastDay) ?? cumRealizedByDay.get(prevDay) ?? 0;
  if (!looksLikeOpenMtmCatchUpCliff(prevEnd, liveTotalPnlEur, lastCumRealized)) {
    return out;
  }
  const openMtmLive = roundSimPnlEur(liveTotalPnlEur - lastCumRealized);
  const span = days.length - 1;

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const cumR = cumRealizedByDay.get(day) ?? 0;
    const frac = span > 0 ? i / span : 1;
    const openEst = roundSimPnlEur(openMtmLive * frac);
    out.set(day, roundSimPnlEur(cumR + openEst));
  }
  out.set(lastDay, roundSimPnlEur(liveTotalPnlEur));
  return out;
}

export function resolveTickClosedPnlEur(
  cumRealized: number,
  piggy?: ExperimentPiggyBank | null,
): number {
  if (!piggy) return roundSimPnlEur(cumRealized);
  return resolveClosedFromPiggy(cumRealized, piggy);
}

export function resolveMaturationOpenMtmEur(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  piggy?: ExperimentPiggyBank | null,
): number {
  const reconstructed = openPaperMtmFromPortfolio(portfolio, evaluations);
  if (!piggy || !Number.isFinite(piggy.openMtmPnlEur)) return reconstructed;
  const stored = piggy.openMtmPnlEur;
  if (Math.abs(stored) > PNL_SANITY_MAX_EUR) return reconstructed;
  if (evaluations.length === 0 && Math.abs(stored) > 0) return roundSimPnlEur(stored);
  if (stored === 0 && reconstructed !== 0) return reconstructed;
  if (evaluations.length === 0) return reconstructed;
  if (Math.abs(stored - reconstructed) <= 50) return roundSimPnlEur(stored);
  if (Math.abs(stored - reconstructed) > Math.max(500, Math.abs(reconstructed) * 0.5 + 250)) {
    return reconstructed;
  }
  return roundSimPnlEur(stored);
}

export type DecisionSimPnlSeriesPoint = {
  totalPnlEur: number;
  closedPnlEur?: number;
  openMtmEur?: number;
  cumulativeRealizedEur?: number;
  isLive?: boolean;
};

/** Spread stale→live catch-up across tick history (Decision Sim + maturation charts). */
export function sanitizeDecisionSimTimeSeries<T extends DecisionSimPnlSeriesPoint>(
  points: T[],
): T[] {
  if (points.length < 2) return points;

  const livePoint = points.find((p) => p.isLive);
  const liveTotal = livePoint?.totalPnlEur ?? points[points.length - 1]?.totalPnlEur;
  if (liveTotal == null || !Number.isFinite(liveTotal) || Math.abs(liveTotal) > PNL_SANITY_MAX_EUR) {
    return points;
  }

  const histIndices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!points[i]?.isLive) histIndices.push(i);
  }
  if (histIndices.length < 2) return points;

  const lastHistIdx = histIndices[histIndices.length - 1]!;
  const lastHist = points[lastHistIdx]!;
  const lastClosed =
    lastHist.closedPnlEur != null && Number.isFinite(lastHist.closedPnlEur)
      ? lastHist.closedPnlEur
      : (lastHist.cumulativeRealizedEur ?? lastHist.totalPnlEur);

  const liveClosed =
    livePoint?.closedPnlEur != null && Number.isFinite(livePoint.closedPnlEur)
      ? livePoint.closedPnlEur
      : (livePoint?.cumulativeRealizedEur ??
        (lastHist.closedPnlEur != null && Number.isFinite(lastHist.closedPnlEur)
          ? lastHist.closedPnlEur
          : lastHist.cumulativeRealizedEur) ??
        0);

  if (
    !looksLikeOpenMtmCatchUpCliff(
      lastHist.totalPnlEur,
      liveTotal,
      lastClosed,
      liveClosed,
    )
  ) {
    return points;
  }

  return rampHistTotalsToLive(points, histIndices, liveTotal, liveClosed);
}

export type SanitizedLivePiggy = {
  piggy: ExperimentPiggyBank;
  adjusted: boolean;
  reason?: "total_mismatch" | "insane_total";
};

/** Guardrail: total must equal closed + open MTM (fixes stale piggy snapshots). */
export function sanitizeLiveExperimentPiggy(
  piggy: ExperimentPiggyBank,
  cumulativePaperPnlEur: number,
): SanitizedLivePiggy {
  const closed = roundSimPnlEur(
    Number.isFinite(piggy.closedPnlEur) ? piggy.closedPnlEur : cumulativePaperPnlEur,
  );
  const open = roundSimPnlEur(Number.isFinite(piggy.openMtmPnlEur) ? piggy.openMtmPnlEur : 0);
  const reconstructed = roundSimPnlEur(closed + open);
  const stored = piggy.totalPnlEur;

  if (!Number.isFinite(stored) || Math.abs(stored) > PNL_SANITY_MAX_EUR) {
    return {
      piggy: { ...piggy, totalPnlEur: reconstructed, closedPnlEur: closed, openMtmPnlEur: open },
      adjusted: true,
      reason: "insane_total",
    };
  }

  const tol = Math.max(75, Math.abs(reconstructed) * 0.08 + 50);
  if (Math.abs(stored - reconstructed) <= tol) {
    return { piggy, adjusted: false };
  }

  return {
    piggy: { ...piggy, totalPnlEur: reconstructed, closedPnlEur: closed, openMtmPnlEur: open },
    adjusted: true,
    reason: "total_mismatch",
  };
}

export function buildEndOfDayMapsFromTicks(ticks: DecisionSimTick[]): {
  endOfDayTotal: Map<string, number>;
  cumRealizedByDay: Map<string, number>;
} {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const endOfDayTotal = new Map<string, number>();
  const cumRealizedByDay = new Map<string, number>();
  let cumRealized = 0;

  for (const tk of sorted) {
    for (const tr of tk.trades) {
      if (tr.side === "sell" && tr.pnlEurSimulated != null) {
        cumRealized += tr.pnlEurSimulated;
      }
    }
    cumRealized = roundSimPnlEur(cumRealized);
    const day = tk.at.includes("T") ? tk.at.slice(0, 10) : tk.at.replace(" ", "T").slice(0, 10);
    cumRealizedByDay.set(day, cumRealized);
    endOfDayTotal.set(
      day,
      resolveTickEndTotalPnlEur(
        cumRealized,
        tk.portfolioAfter,
        tk.evaluations,
        tk.summary.piggyBank,
      ),
    );
  }

  return { endOfDayTotal, cumRealizedByDay };
}
