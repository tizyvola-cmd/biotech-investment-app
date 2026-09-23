import { pearsonR, spearmanR } from "./statSignificance";

export type ScorePnlRow = {
  pnl: number;
  pplanIsDefault?: boolean;
};

/** Exclude portfolio rows with synthetic P(plan)=50 placeholder. */
export function excludePplanPlaceholders<T extends ScorePnlRow>(rows: T[]): T[] {
  return rows.filter((r) => !r.pplanIsDefault);
}

export function corrOnValidRows<T extends ScorePnlRow>(
  rows: T[],
  x: (r: T) => number | null,
  minN = 3,
): { r: number | null; n: number } {
  const valid = rows.filter((r) => {
    const v = x(r);
    return v != null && Number.isFinite(v);
  });
  if (valid.length < minN) return { r: null, n: valid.length };
  return {
    r: pearsonR(
      valid.map((r) => x(r)!),
      valid.map((r) => r.pnl),
    ),
    n: valid.length,
  };
}

export type DirectionalCorr = {
  up: number | null;
  down: number | null;
  nUp: number;
  nDown: number;
  n: number;
};

export function directionalCorrOnRows<T extends ScorePnlRow>(
  rows: T[],
  x: (r: T) => number | null,
  minN = 3,
): DirectionalCorr {
  const wins = rows.filter((r) => r.pnl > 0);
  const losses = rows.filter((r) => r.pnl < 0);
  const up = corrOnValidRows(wins, x, minN);
  const down = corrOnValidRows(losses, x, minN);
  const all = corrOnValidRows(rows, x, minN);
  return {
    up: up.r,
    down: down.r,
    nUp: wins.filter((r) => x(r) != null).length,
    nDown: losses.filter((r) => x(r) != null).length,
    n: all.n,
  };
}

export type ScoreTertileSpread = {
  n: number;
  lowMeanPnl: number;
  midMeanPnl: number;
  highMeanPnl: number;
  spreadHighLow: number;
  spearman: number | null;
};

function mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Mean P&L by score tertile — robust to outliers vs Pearson alone. */
export function scoreTertileSpread<T extends ScorePnlRow>(
  rows: T[],
  score: (r: T) => number | null,
  minPerTertile = 2,
): ScoreTertileSpread | null {
  const valid = rows
    .filter((r) => {
      const s = score(r);
      return s != null && Number.isFinite(s);
    })
    .sort((a, b) => score(a)! - score(b)!);
  if (valid.length < minPerTertile * 3) return null;
  const size = Math.floor(valid.length / 3);
  const low = valid.slice(0, size);
  const mid = valid.slice(size, size * 2);
  const high = valid.slice(size * 2);
  if (low.length < minPerTertile || mid.length < minPerTertile || high.length < minPerTertile) {
    return null;
  }
  const lowMeanPnl = mean(low.map((r) => r.pnl));
  const midMeanPnl = mean(mid.map((r) => r.pnl));
  const highMeanPnl = mean(high.map((r) => r.pnl));
  return {
    n: valid.length,
    lowMeanPnl: Math.round(lowMeanPnl * 10) / 10,
    midMeanPnl: Math.round(midMeanPnl * 10) / 10,
    highMeanPnl: Math.round(highMeanPnl * 10) / 10,
    spreadHighLow: Math.round((highMeanPnl - lowMeanPnl) * 10) / 10,
    spearman: spearmanR(
      valid.map((r) => score(r)!),
      valid.map((r) => r.pnl),
    ),
  };
}

/** n below this → show "unmeasured" instead of actionable r (Rescue etc.). */
export const CORR_UNMEASURED_N = 8;

export type ScoreOutcomeCorrSummary = {
  id: string;
  label: string;
  n: number;
  rAll: number | null;
  rUp: number | null;
  rDown: number | null;
  nUp: number;
  nDown: number;
  invertedScale: boolean;
};

/** One model score vs a chosen outcome (P&L% or T+3 move%). */
export function summarizeScoreOutcomeCorr<T>(
  id: string,
  label: string,
  rows: T[],
  score: (r: T) => number | null,
  outcome: (r: T) => number | null | undefined,
  opts?: { invertedScale?: boolean; minN?: number },
): ScoreOutcomeCorrSummary {
  const minN = opts?.minN ?? 3;
  const invertedScale = opts?.invertedScale ?? false;
  const valid = rows.filter((r) => {
    const x = score(r);
    const y = outcome(r);
    return x != null && Number.isFinite(x) && y != null && Number.isFinite(y);
  });
  const ups = valid.filter((r) => (outcome(r) as number) > 0);
  const downs = valid.filter((r) => (outcome(r) as number) < 0);
  const rAll =
    valid.length >= minN
      ? pearsonR(
          valid.map((r) => score(r)!),
          valid.map((r) => outcome(r) as number),
        )
      : null;
  const rUp =
    ups.length >= minN
      ? pearsonR(
          ups.map((r) => score(r)!),
          ups.map((r) => outcome(r) as number),
        )
      : null;
  const rDown =
    downs.length >= minN
      ? pearsonR(
          downs.map((r) => score(r)!),
          downs.map((r) => outcome(r) as number),
        )
      : null;
  return {
    id,
    label,
    n: valid.length,
    rAll,
    rUp,
    rDown,
    nUp: ups.length,
    nDown: downs.length,
    invertedScale,
  };
}
