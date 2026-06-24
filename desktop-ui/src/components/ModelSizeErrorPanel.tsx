import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModelSizeErrorView } from "../sheet/modelSizeErrorView";
import {
  sizeErrorTone,
  sizeErrorTrendTone,
  type ModelSizeErrorTrend,
} from "../sheet/modelSizeErrorView";
import { fmtPpDelta } from "../sheet/modelQualityWeeklyTrends";
import { useLang, useT, type TranslationKey } from "../shared/i18n";

function trendKey(t: ModelSizeErrorTrend): TranslationKey {
  switch (t) {
    case "improving":
      return "modelLab.qc.modelSizeError.trend.improving";
    case "worse":
      return "modelLab.qc.modelSizeError.trend.worse";
    case "stable":
      return "modelLab.qc.modelSizeError.trend.stable";
    default:
      return "modelLab.qc.modelSizeError.trend.unknown";
  }
}

export type ModelSizeErrorPanelProps = {
  view: ModelSizeErrorView;
  defaultOpen?: boolean;
};

export function ModelSizeErrorPanel({ view, defaultOpen = true }: ModelSizeErrorPanelProps) {
  const t = useT();
  useLang();
  const [open, setOpen] = useState(defaultOpen);

  const chartData = useMemo(
    () =>
      view.weekPoints.map((p) => ({
        label: p.label,
        maePp: p.maePp,
      })),
    [view.weekPoints],
  );

  const headerValue =
    view.currentMaePp != null ? `${view.currentMaePp.toFixed(1)} pp` : "—";
  const deltaNote =
    view.deltaVsPrevWeek != null
      ? t("modelLab.qc.modelSizeError.vsPrevWeek", {
          delta: fmtPpDelta(view.deltaVsPrevWeek),
        })
      : null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/90 dark:bg-surface/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface/30 transition"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">{t("modelLab.qc.modelSizeError.title")}</p>
          <p className="text-[10px] text-ink-muted mt-0.5">{t("modelLab.qc.modelSizeError.lead")}</p>
          <p className={`text-sm font-bold tabular-nums mt-1 ${sizeErrorTone(view.currentMaePp)}`}>
            {headerValue}
            {deltaNote ? (
              <span className="text-[10px] font-medium text-ink-muted ml-2">{deltaNote}</span>
            ) : null}
            <span className={`text-[10px] font-medium ml-2 ${sizeErrorTrendTone(view.trend)}`}>
              {t(trendKey(view.trend))}
            </span>
          </p>
        </div>
        <span className="text-[10px] text-ink-muted shrink-0 pt-0.5">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-[rgb(var(--border))]/30 space-y-2">
          <p className="text-[10px] text-ink-muted leading-snug">
            {t("modelLab.qc.modelSizeError.body", { horizon: view.horizonLabel })}
          </p>

          {view.hasChart ? (
            <div className="h-[140px] min-w-0">
              <p className="text-[9px] font-semibold uppercase text-ink-muted mb-1">
                {t("modelLab.qc.modelSizeError.chartTitle")}
              </p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis dataKey="label" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 8 }} width={32} unit=" pp" />
                  <ReferenceLine y={10} stroke="rgb(var(--warn))" strokeDasharray="4 4" opacity={0.6} />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v: number) => [`${v.toFixed(1)} pp`, t("modelLab.qc.modelSizeError.lineMae")]}
                  />
                  <Line
                    type="monotone"
                    dataKey="maePp"
                    stroke="rgb(var(--accent))"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-[9px] text-ink-muted mt-1">{t("modelLab.qc.modelSizeError.chartFooter")}</p>
            </div>
          ) : (
            <p className="text-[10px] text-ink-muted">{t("modelLab.qc.modelSizeError.needMoreWeeks")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
