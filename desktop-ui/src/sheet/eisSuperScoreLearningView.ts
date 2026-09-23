/** Minimum n for showing ρ on the Super Score timeline (suppresses n=2–3 spikes). */
export const EIS_SUPER_MIN_N = 15;

export type EisSuperScoreTimelineRow = {
  window: string;
  days_min: number;
  days_max: number | null;
  days_mid: number;
  n_events: number;
  n_price_1d?: number;
  n_price_7d?: number;
  corr_raw_1d?: number | null;
  corr_super_1d?: number | null;
  corr_raw_7d?: number | null;
  corr_super_7d?: number | null;
  lift_1d?: number | null;
  lift_7d?: number | null;
  mae_raw_7d?: number | null;
  mae_super_7d?: number | null;
  mae_lift_7d?: number | null;
  long_short_raw_7d?: number | null;
  long_short_super_7d?: number | null;
  long_short_lift_7d?: number | null;
  mono_spearman_raw_super_7d?: number | null;
  corr_super_7d_ci_low?: number | null;
  corr_super_7d_ci_high?: number | null;
  cal_factor?: number | null;
};

export type EisSuperScoreOverview = {
  generated_at?: string;
  global_score_blend?: number;
  learned_blend?: number;
  windows?: Record<string, { cal_factor?: number; n_samples?: number }>;
  correlation_timeline?: EisSuperScoreTimelineRow[];
  effectiveness?: {
    mean_corr_raw_7d?: number | null;
    mean_corr_super_7d?: number | null;
    mean_lift_7d?: number | null;
    mean_mae_raw_7d?: number | null;
    mean_mae_super_7d?: number | null;
    mean_mae_lift_7d?: number | null;
    mean_long_short_lift_7d?: number | null;
    mean_mono_spearman_raw_super_7d?: number | null;
    bins_with_data_7d?: number;
  };
  learning_history?: Array<{
    week?: string;
    date?: string;
    mean_corr_raw_7d?: number | null;
    mean_corr_super_7d?: number | null;
    mean_lift_7d?: number | null;
  }>;
  n_events_scored?: number;
};

export type EisSuperScoreChartRow = {
  window: string;
  daysMid: number;
  daysLabel: string;
  corrRaw1d: number | null;
  corrSuper1d: number | null;
  corrRaw7d: number | null;
  corrSuper7d: number | null;
  /** Gated ρ — null when n below EIS_SUPER_MIN_N. */
  corrRaw1dGated: number | null;
  corrSuper1dGated: number | null;
  corrRaw7dGated: number | null;
  corrSuper7dGated: number | null;
  super7dCiLow: number | null;
  super7dCiHigh: number | null;
  super1dCiLow: number | null;
  super1dCiHigh: number | null;
  lift1d: number | null;
  lift7d: number | null;
  maeLift7d: number | null;
  longShortLift7d: number | null;
  monoSpearman: number | null;
  nEvents: number;
  nPrice1d: number;
  nPrice7d: number;
  /** T+7 bucket below n_min gate. */
  nGated: boolean;
  nGated1d: boolean;
  calFactor: number | null;
};

/** Fisher z 95% CI for Pearson ρ (n ≥ 4). */
export function fisherPearsonCi(
  r: number | null | undefined,
  n: number,
  z = 1.96,
): { lo: number | null; hi: number | null } {
  if (r == null || !Number.isFinite(r) || n < 4) return { lo: null, hi: null };
  const clamped = Math.max(-0.999, Math.min(0.999, r));
  const zr = Math.atanh(clamped);
  const se = 1 / Math.sqrt(n - 3);
  const lo = Math.tanh(zr - z * se);
  const hi = Math.tanh(zr + z * se);
  return { lo: Math.round(lo * 10000) / 10000, hi: Math.round(hi * 10000) / 10000 };
}

export type EisSuperHorizon = "1d" | "7d";

function gateRho(rho: number | null | undefined, n: number, minN = EIS_SUPER_MIN_N): number | null {
  if (rho == null || !Number.isFinite(rho) || n < minN) return null;
  return rho;
}

export function buildEisSuperScoreChartRows(
  overview: EisSuperScoreOverview | null | undefined,
  opts?: { minN?: number },
): EisSuperScoreChartRow[] {
  const minN = opts?.minN ?? EIS_SUPER_MIN_N;
  const timeline = overview?.correlation_timeline ?? [];
  return timeline
    .map((r) => {
      const n1 = r.n_price_1d ?? 0;
      const n7 = r.n_price_7d ?? 0;
      const ci7 =
        r.corr_super_7d_ci_low != null && r.corr_super_7d_ci_high != null
          ? { lo: r.corr_super_7d_ci_low, hi: r.corr_super_7d_ci_high }
          : fisherPearsonCi(r.corr_super_7d, n7);
      const ci1 = fisherPearsonCi(r.corr_super_1d, n1);
      const lift1d =
        r.lift_1d ??
        (r.corr_super_1d != null && r.corr_raw_1d != null
          ? Math.round((r.corr_super_1d - r.corr_raw_1d) * 10000) / 10000
          : null);
      const lift7d =
        r.lift_7d ??
        (r.corr_super_7d != null && r.corr_raw_7d != null
          ? Math.round((r.corr_super_7d - r.corr_raw_7d) * 10000) / 10000
          : null);
      return {
        window: r.window,
        daysMid: r.days_mid,
        daysLabel: r.days_max != null ? `${r.days_min}–${r.days_max}d` : `${r.days_min}d+`,
        corrRaw1d: r.corr_raw_1d ?? null,
        corrSuper1d: r.corr_super_1d ?? null,
        corrRaw7d: r.corr_raw_7d ?? null,
        corrSuper7d: r.corr_super_7d ?? null,
        corrRaw1dGated: gateRho(r.corr_raw_1d, n1, minN),
        corrSuper1dGated: gateRho(r.corr_super_1d, n1, minN),
        corrRaw7dGated: gateRho(r.corr_raw_7d, n7, minN),
        corrSuper7dGated: gateRho(r.corr_super_7d, n7, minN),
        super7dCiLow: n7 >= minN ? ci7.lo : null,
        super7dCiHigh: n7 >= minN ? ci7.hi : null,
        super1dCiLow: n1 >= minN ? ci1.lo : null,
        super1dCiHigh: n1 >= minN ? ci1.hi : null,
        lift1d,
        lift7d,
        maeLift7d: r.mae_lift_7d ?? null,
        longShortLift7d: r.long_short_lift_7d ?? null,
        monoSpearman: r.mono_spearman_raw_super_7d ?? null,
        nEvents: r.n_events ?? 0,
        nPrice1d: n1,
        nPrice7d: n7,
        nGated: n7 < minN,
        nGated1d: n1 < minN,
        calFactor: r.cal_factor ?? null,
      };
    })
    .sort((a, b) => b.daysMid - a.daysMid);
}

export function buildEisSuperScoreLearningTrend(
  overview: EisSuperScoreOverview | null | undefined,
): Array<{ week: string; raw7d: number | null; super7d: number | null; lift: number | null }> {
  return (overview?.learning_history ?? []).map((h) => ({
    week: String(h.week ?? h.date ?? "").slice(5, 10) || String(h.date ?? ""),
    raw7d: h.mean_corr_raw_7d ?? null,
    super7d: h.mean_corr_super_7d ?? null,
    lift: h.mean_lift_7d ?? null,
  }));
}

/** True when mean mono-Spearman(raw,super) ≈ 1 → Pearson ρ lift cannot show calibration value. */
export function isMonotoneCalibrationBlend(
  overview: EisSuperScoreOverview | null | undefined,
): boolean {
  const mono = overview?.effectiveness?.mean_mono_spearman_raw_super_7d;
  return mono != null && mono >= 0.995;
}

/**
 * Fallback diagnostic for when mono-Spearman is not yet computable.
 *
 * Pattern: Pearson Δρ is essentially zero but MAE lift is positive (super error < raw error).
 * That combination is consistent with a purely monotone recalibration — the ranking is unchanged
 * but the scale is better aligned to the observed price move. We cannot *prove* monotonicity
 * without Spearman, so the accompanying UI copy must stay hedged ("consistent with…").
 */
export function isLikelyMonotoneCalibrationByLift(
  overview: EisSuperScoreOverview | null | undefined,
  opts: { rhoEps?: number; maePpMin?: number } = {},
): boolean {
  const eff = overview?.effectiveness;
  if (!eff) return false;
  if (eff.mean_mono_spearman_raw_super_7d != null) return false;
  const rhoLift = eff.mean_lift_7d;
  const maeLift = eff.mean_mae_lift_7d;
  if (rhoLift == null || maeLift == null) return false;
  const rhoEps = opts.rhoEps ?? 0.005;
  const maePpMin = opts.maePpMin ?? 0.1;
  return Math.abs(rhoLift) < rhoEps && maeLift > maePpMin;
}
