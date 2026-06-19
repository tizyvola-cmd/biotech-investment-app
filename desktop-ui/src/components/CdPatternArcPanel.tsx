import { Suspense, lazy } from "react";
import { useT } from "../shared/i18n";
import type { CdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";

const CdPatternRadarChart = lazy(() =>
  import("./CdPatternRadarChart").then((m) => ({ default: m.CdPatternRadarChart })),
);

function fmtAxisRaw(
  ax: CdPatternTickerRecommendation["axes"][number],
): string {
  if (ax.rawValue == null || !Number.isFinite(ax.rawValue)) return "—";
  const dec = ax.id === "mii" || ax.id === "slope" ? 2 : 0;
  return `${ax.rawValue.toFixed(dec)}${ax.unit}`;
}

export function CdPatternArcPanel({
  rec,
  variant = "default",
  className = "",
  hideMetrics = false,
  chartHeight,
}: {
  rec: CdPatternTickerRecommendation;
  variant?: "default" | "mini";
  className?: string;
  /** Nasconde la griglia assi sotto il radar (tile compatte). */
  hideMetrics?: boolean;
  chartHeight?: number;
}) {
  const t = useT();
  const mini = variant === "mini";
  const chartH = chartHeight ?? (mini ? 136 : 260);

  return (
    <div
      className={`rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 ${
        mini ? "p-1 space-y-0.5" : "p-3 space-y-2"
      } ${className}`.trim()}
    >
      {!hideMetrics ? (
      <p
        className={`font-semibold text-ink leading-none ${
          mini ? "text-[9px]" : "text-[11px]"
        }`}
      >
        {t("decisionLab.pattern.arcTitle")}
        {mini ? (
          <span className="text-[rgb(var(--chart-model))] tabular-nums ml-1">· {rec.matchPct}%</span>
        ) : null}
      </p>
      ) : null}
      <Suspense
        fallback={
          <div
            className={`flex items-center justify-center text-[10px] text-ink-muted ${
              mini ? "h-[136px]" : "h-[260px]"
            }`}
          >
            {t("decisionLab.pattern.loading")}
          </div>
        }
      >
        <CdPatternRadarChart rec={rec} height={chartH} mini={mini} compact={false} />
      </Suspense>
      {!hideMetrics ? (
      <div className={`grid grid-cols-2 ${mini ? "gap-0.5" : "gap-1.5"}`}>
        {rec.axes.map((ax) => (
          <div
            key={ax.id}
            className={`flex justify-between tabular-nums rounded bg-[rgb(var(--surface-3))]/30 ${
              mini ? "text-[8px] leading-tight px-1 py-0.5 gap-1" : "text-[10px] px-2 py-1"
            }`}
          >
            <span className="text-ink-muted shrink-0">{ax.label}</span>
            <span className="font-semibold text-ink text-right min-w-0 truncate">
              {fmtAxisRaw(ax)}
              <span className="text-ink-muted font-normal">
                {" "}
                / {ax.threshold}
                {ax.unit}
              </span>
            </span>
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}
