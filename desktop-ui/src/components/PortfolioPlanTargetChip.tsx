/** Target plan ROI con mini-torta avanzamento (verde/rosso). */

import { useLang, useT, type TranslationKey } from "../shared/i18n";
import {
  resolveTargetRoiGapReason,
  type TargetPeakGapReason,
} from "../sheet/lossAnalysisTargetPeak";
import { TargetDistanceDonut } from "./TargetDistanceDonut";

function targetPeakGapLabel(
  reason: TargetPeakGapReason,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  daysToCd: number | null,
): { short: string; tip: string } {
  switch (reason) {
    case "past_cd":
      return {
        short: t("sim.lossAnalysis.gap.pastCdShort"),
        tip: t("sim.lossAnalysis.gap.pastCdTip"),
      };
    case "beyond_monitor":
      return {
        short: t("sim.lossAnalysis.gap.beyondMonitorShort"),
        tip: t("sim.lossAnalysis.gap.beyondMonitorTip", {
          days: daysToCd ?? "?",
        }),
      };
    case "beyond_hot":
      return {
        short: t("sim.lossAnalysis.gap.beyondHotShort"),
        tip: t("sim.lossAnalysis.gap.beyondHotTip", {
          days: daysToCd ?? "?",
        }),
      };
    case "watch_provisional":
      return {
        short: t("sim.lossAnalysis.gap.watchProvShort"),
        tip: t("sim.lossAnalysis.gap.watchProvTip", {
          days: daysToCd ?? "?",
        }),
      };
    case "no_chart":
      return {
        short: t("sim.lossAnalysis.gap.noChartShort"),
        tip: t("sim.lossAnalysis.gap.noChartTip"),
      };
    case "no_rise":
      return {
        short: t("sim.lossAnalysis.gap.noRiseShort"),
        tip: t("sim.lossAnalysis.peak.missing"),
      };
    case "unknown_cd":
      return {
        short: "—",
        tip: t("sim.lossAnalysis.gap.unknownCdTip"),
      };
    default:
      return { short: "—", tip: "" };
  }
}

export function TargetPeakGapLabel({
  reason,
  daysToCd,
  className = "text-[9px] font-medium text-ink-muted/90 leading-tight",
}: {
  reason: TargetPeakGapReason;
  daysToCd: number | null;
  className?: string;
}) {
  const t = useT();
  if (reason === "available") return null;
  const { short, tip } = targetPeakGapLabel(reason, t, daysToCd);
  return (
    <span className={className} title={tip || undefined}>
      {short}
    </span>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function computePlanTargetProgress(
  pnlPct: number | null | undefined,
  planReturnPct: number | null | undefined,
): { ratio: number | null; tone: "up" | "down" } {
  if (planReturnPct == null || planReturnPct <= 0) {
    return { ratio: null, tone: "down" };
  }
  const pnl = pnlPct ?? 0;
  if (pnl >= planReturnPct) return { ratio: 1, tone: "up" };
  if (pnl <= 0) return { ratio: 0, tone: "down" };
  return { ratio: clamp01(pnl / planReturnPct), tone: "up" };
}

export function isPlanTargetReached(
  pnlPct: number | null | undefined,
  planReturnPct: number | null | undefined,
): boolean {
  if (planReturnPct == null || planReturnPct <= 0) return false;
  if (pnlPct == null || !Number.isFinite(pnlPct)) return false;
  return pnlPct >= planReturnPct;
}

export function PlanTargetSummaryCell({
  pnlPct,
  planReturnPct,
  daysToCd = null,
  chartPointsLoaded = true,
  targetProvisional = false,
}: {
  pnlPct: number | null | undefined;
  planReturnPct: number | null | undefined;
  daysToCd?: number | null;
  chartPointsLoaded?: boolean;
  targetProvisional?: boolean;
}) {
  const t = useT();

  const gapReason = resolveTargetRoiGapReason({
    daysToCd,
    planReturnPct: planReturnPct ?? null,
    chartPointsLoaded,
    targetProvisional,
  });

  if (gapReason !== "available" && gapReason !== "watch_provisional") {
    return (
      <TargetPeakGapLabel
        reason={gapReason}
        daysToCd={daysToCd}
        className="text-[9px] font-medium text-ink-muted/90 leading-tight max-w-[72px] mx-auto block text-center"
      />
    );
  }

  if (planReturnPct == null || planReturnPct <= 0) {
    return null;
  }

  const progress = computePlanTargetProgress(pnlPct, planReturnPct);
  const colorClass =
    progress.tone === "up"
      ? "text-[rgb(var(--signal-up))]"
      : "text-[rgb(var(--signal-down))]";
  const pctLabel = `+${planReturnPct.toFixed(1)}%`;
  const progressPct =
    progress.ratio != null ? Math.round(progress.ratio * 100) : null;
  const title =
    progressPct != null
      ? t("sim.lossAnalysis.target.progressTip", {
          progress: progressPct,
          target: pctLabel,
        })
      : t("sim.lossAnalysis.target.unavailableTip", { target: pctLabel });
  const provTip =
    gapReason === "watch_provisional"
      ? t("sim.lossAnalysis.gap.watchProvTip", { days: daysToCd ?? "?" })
      : null;

  return (
    <div className="flex flex-col items-center gap-0.5 mx-auto" title={provTip ?? title}>
      <TargetDistanceDonut
        ratio={progress.ratio}
        tone={progress.tone}
        size={24}
        title={provTip ?? title}
      />
      <span className={`text-[9px] font-semibold tabular-nums leading-none ${colorClass}`}>
        {pctLabel}
      </span>
      {gapReason === "watch_provisional" ? (
        <span className="text-[8px] font-medium text-amber-700 dark:text-amber-300 leading-none">
          {t("sim.lossAnalysis.gap.watchProvShort")}
        </span>
      ) : null}
    </div>
  );
}

export function PortfolioPlanTargetChip({
  pnlPct,
  planReturnPct,
  size = 16,
}: {
  pnlPct: number | null | undefined;
  planReturnPct: number | null | undefined;
  size?: number;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  if (planReturnPct == null || planReturnPct <= 0) return null;

  const progress = computePlanTargetProgress(pnlPct, planReturnPct);
  const colorClass =
    progress.tone === "up"
      ? "text-[rgb(var(--signal-up))]"
      : "text-[rgb(var(--signal-down))]";
  const pctLabel = `+${planReturnPct.toFixed(1)}%`;
  const progressPct =
    progress.ratio != null ? Math.round(progress.ratio * 100) : null;
  const title =
    progressPct != null
      ? t("sim.lossAnalysis.target.progressTip", {
          progress: progressPct,
          target: pctLabel,
        })
      : t("sim.lossAnalysis.target.unavailableTip", { target: pctLabel });

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums ${colorClass}`}
      title={title}
    >
      <TargetDistanceDonut
        ratio={progress.ratio}
        tone={progress.tone}
        size={size}
        title={title}
      />
      <span>
        Target {pctLabel}
        {progressPct != null && progress.ratio != null && progress.ratio < 1 ? (
          <span className="font-normal opacity-90">
            {" "}
            ({it ? `${100 - progressPct}% manca` : `${100 - progressPct}% left`})
          </span>
        ) : null}
      </span>
    </span>
  );
}
