/**
 * Supernova composite scoring engine — mirrors prediction/scoring_engine.py
 * UI colors, types, and client-side display helpers.
 */

export type ScoringRecommendation =
  | "STRONG BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG SELL";

export type ScoringOverrideFlag =
  | "PRE-CATALYST LOCK"
  | "POST-EVENT DISLOCATION"
  | "CASH CRISIS"
  | null;

export type ScoringComponentScores = {
  momentum: number | null;
  slope: number | null;
  beta: number | null;
  rsi: number | null;
  atr: number | null;
  volume_ratio: number | null;
  short_interest: number | null;
  bollinger: number | null;
  xbi_rs: number | null;
  cash_runway: number | null;
  catalyst_proximity: number | null;
  phase_probability: number | null;
};

export type ScoringColor = {
  hex: string;
  tailwind_bg: string;
  tailwind_text: string;
  badge_style: string;
};

export type StockScoreResult = {
  ticker: string;
  composite_score: number;
  recommendation: ScoringRecommendation;
  override_flag: ScoringOverrideFlag;
  component_scores: ScoringComponentScores;
  signal_summary: string;
  confidence_score: number;
  color: ScoringColor;
  override_color?: string | null;
};

export const SCORING_WEIGHTS_RAW: Record<keyof ScoringComponentScores, number> = {
  momentum: 0.2,
  slope: 0.15,
  beta: 0.1,
  rsi: 0.1,
  atr: 0.05,
  volume_ratio: 0.1,
  short_interest: 0.1,
  bollinger: 0.05,
  xbi_rs: 0.05,
  cash_runway: 0.05,
  catalyst_proximity: 0.1,
  phase_probability: 0.05,
};

const _wSum = Object.values(SCORING_WEIGHTS_RAW).reduce((a, b) => a + b, 0);

export const SCORING_WEIGHTS = Object.fromEntries(
  Object.entries(SCORING_WEIGHTS_RAW).map(([k, v]) => [k, v / _wSum]),
) as Record<keyof ScoringComponentScores, number>;

export const RECOMMENDATION_COLORS: Record<ScoringRecommendation, ScoringColor> = {
  "STRONG BUY": {
    hex: "#16a34a",
    tailwind_bg: "bg-green-100",
    tailwind_text: "text-green-600",
    badge_style: "background:#dcfce7;color:#16a34a;border:1px solid #16a34a40",
  },
  BUY: {
    hex: "#4ade80",
    tailwind_bg: "bg-green-50",
    tailwind_text: "text-green-400",
    badge_style: "background:#f0fdf4;color:#4ade80;border:1px solid #4ade8040",
  },
  HOLD: {
    hex: "#facc15",
    tailwind_bg: "bg-yellow-50",
    tailwind_text: "text-yellow-400",
    badge_style: "background:#fefce8;color:#ca8a04;border:1px solid #facc1540",
  },
  SELL: {
    hex: "#f97316",
    tailwind_bg: "bg-orange-50",
    tailwind_text: "text-orange-400",
    badge_style: "background:#fff7ed;color:#f97316;border:1px solid #f9731640",
  },
  "STRONG SELL": {
    hex: "#dc2626",
    tailwind_bg: "bg-red-100",
    tailwind_text: "text-red-600",
    badge_style: "background:#fee2e2;color:#dc2626;border:1px solid #dc262640",
  },
};

export const OVERRIDE_FLAG_COLORS: Record<
  Exclude<ScoringOverrideFlag, null>,
  { hex: string; tailwind_bg: string; tailwind_text: string }
> = {
  "PRE-CATALYST LOCK": {
    hex: "#9333ea",
    tailwind_bg: "bg-purple-50",
    tailwind_text: "text-purple-600",
  },
  "POST-EVENT DISLOCATION": {
    hex: "#3b82f6",
    tailwind_bg: "bg-blue-50",
    tailwind_text: "text-blue-500",
  },
  "CASH CRISIS": {
    hex: "#171717",
    tailwind_bg: "bg-neutral-100",
    tailwind_text: "text-neutral-900",
  },
};

const COMPONENT_MAX: Record<keyof ScoringComponentScores, number> = {
  momentum: 20,
  slope: 15,
  beta: 10,
  rsi: 10,
  atr: 5,
  volume_ratio: 10,
  short_interest: 10,
  bollinger: 5,
  xbi_rs: 5,
  cash_runway: 5,
  catalyst_proximity: 10,
  phase_probability: 5,
};

export function componentContributionClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-ink-muted";
  return value > 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";
}

export function compositeScoreMarkerPct(score: number): number {
  return Math.max(0, Math.min(100, ((score + 100) / 200) * 100));
}

/** Gradient bar background red → yellow → green. */
export function compositeScoreBarGradient(): string {
  return "linear-gradient(90deg, #dc2626 0%, #facc15 50%, #16a34a 100%)";
}

export function formatComponentLabel(key: keyof ScoringComponentScores): string {
  const labels: Record<keyof ScoringComponentScores, string> = {
    momentum: "Momentum",
    slope: "Slope / RoC",
    beta: "Beta",
    rsi: "RSI 14",
    atr: "ATR %",
    volume_ratio: "Volume ratio",
    short_interest: "Short interest",
    bollinger: "Bollinger squeeze",
    xbi_rs: "XBI rel. strength",
    cash_runway: "Cash runway",
    catalyst_proximity: "Catalyst proximity",
    phase_probability: "Phase P(success)",
  };
  return labels[key];
}

export function componentMax(key: keyof ScoringComponentScores): number {
  return COMPONENT_MAX[key];
}

export function normalizeComponentPct(value: number | null, key: keyof ScoringComponentScores): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const mx = COMPONENT_MAX[key];
  return Math.max(-100, Math.min(100, (value / mx) * 100));
}

export function attachDisplayColors(result: StockScoreResult): StockScoreResult {
  const rec = result.recommendation as ScoringRecommendation;
  return {
    ...result,
    color: result.color ?? RECOMMENDATION_COLORS[rec] ?? RECOMMENDATION_COLORS.HOLD,
    override_color:
      result.override_flag != null
        ? OVERRIDE_FLAG_COLORS[result.override_flag]?.hex ?? null
        : null,
  };
}

export const COMPONENT_ORDER: (keyof ScoringComponentScores)[] = [
  "momentum",
  "slope",
  "beta",
  "rsi",
  "atr",
  "volume_ratio",
  "short_interest",
  "bollinger",
  "xbi_rs",
  "cash_runway",
  "catalyst_proximity",
  "phase_probability",
];
