import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import {
  GAP_INVESTIGATION_THRESHOLD_PCT,
  type DetectedGapEvent,
} from "./gapInvestigationTypes";

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Side-effect-free gap detection: compare stamped marks tick N−1 vs N.
 * Skips positions without a valid previous mark (new entries, first mark).
 */
export function detectGapEvents(
  portfolioBefore: PaperPosition[],
  portfolioAfter: PaperPosition[],
  tickTimestamp: string,
  evaluations: TickerSimEvaluation[] = [],
): DetectedGapEvent[] {
  const beforeByKey = new Map(portfolioBefore.map((p) => [p.key, p]));
  const evalByKey = new Map(evaluations.map((e) => [e.key, e]));
  const out: DetectedGapEvent[] = [];

  for (const after of portfolioAfter) {
    const before = beforeByKey.get(after.key);
    if (!before) continue;

    const previousMarkPct = sanitizePaperMovePct(before.lastMarkPct);
    const currentMarkPct = sanitizePaperMovePct(after.lastMarkPct);
    if (previousMarkPct == null || currentMarkPct == null) continue;

    const gapPct = roundPct(currentMarkPct - previousMarkPct);
    if (Math.abs(gapPct) <= GAP_INVESTIGATION_THRESHOLD_PCT) continue;

    const capital = after.capital ?? before.capital ?? 0;
    if (!(capital > 0)) continue;

    const ev = evalByKey.get(after.key);
    out.push({
      rowKey: after.key,
      ticker: after.ticker,
      tickTimestamp,
      previousMarkPct,
      currentMarkPct,
      gapPct,
      positionCapitalEur: Math.round(capital * 100) / 100,
      daysSinceCD: ev?.daysToCd ?? null,
    });
  }

  return out;
}
