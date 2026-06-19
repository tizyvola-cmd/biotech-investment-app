import type { TranslationKey } from "../shared/i18n";

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

function fmtSlopePp(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** Optional 5d / 20d suffix for slope trajectory captions. */
export function slopeWindowCaptionSuffix(
  slope5d: number | null | undefined,
  slope20d: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (slope5d != null && Number.isFinite(slope5d)) {
    parts.push(`5d ${fmtSlopePp(slope5d)} pp/d`);
  }
  if (slope20d != null && Number.isFinite(slope20d)) {
    parts.push(`20d ${fmtSlopePp(slope20d)} pp/d`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function modalPredSparklineCaption(t: TFn): string {
  return t("modalCharts.caption.pred");
}

export function modalSlopeTrajectoryCaption(
  t: TFn,
  opts?: { slope5d?: number | null; slope20d?: number | null },
): string {
  const base = t("modalCharts.caption.slope");
  const suffix = slopeWindowCaptionSuffix(opts?.slope5d, opts?.slope20d);
  return suffix ? `${base} · ${suffix}` : base;
}

export function modalGainPlanCaption(
  t: TFn,
  opts?: { recoveryDays?: number | null },
): string {
  const days = opts?.recoveryDays;
  if (days != null && Number.isFinite(days) && days > 0) {
    return t("modalCharts.caption.gainPlanRecovery", { days: Math.round(days) });
  }
  return t("modalCharts.caption.gainPlan");
}

export function modalPatternCaption(t: TFn, matchPct: number | null | undefined): string {
  if (matchPct != null && Number.isFinite(matchPct)) {
    return t("modalCharts.caption.pattern", { pct: Math.round(matchPct) });
  }
  return t("modalCharts.caption.patternMissing");
}

export function modalGainPlanMarkerLabel(
  days: number | null | undefined,
  it: boolean,
): string | undefined {
  if (days == null || !Number.isFinite(days) || days <= 0) return undefined;
  return it ? `Recupero ~${Math.round(days)}g` : `Recovery ~${Math.round(days)}d`;
}

export function modalMiiCaption(t: TFn): string {
  return t("modalCharts.caption.mii");
}
