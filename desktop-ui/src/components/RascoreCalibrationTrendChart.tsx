import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RascoreCalibrationChartRow } from "../sheet/rascoreCalibrationHistory";
import type { LearningTrendVisual } from "../sheet/learningTrendVisual";
import {
  correlationSignificance,
  formatCorrelationWithStars,
  formatPValue,
} from "../sheet/statSignificance";
import { TrendStatusBadge } from "./LearningTrendUi";
import { useLang, useT } from "../shared/i18n";

function RhoTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RascoreCalibrationChartRow }>;
  it: boolean;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-[rgb(var(--panel-feed-border))]/60 bg-white px-2.5 py-2 text-[11px] shadow-md space-y-1 max-w-[220px]">
      <p className="font-semibold text-ink">{p.label}</p>
      <p className="text-violet-800">
        ρ (7g):{" "}
        <span className="font-medium">
          {p.rho != null ? formatCorrelationWithStars(p.rho, p.rhoN) : "—"}
        </span>
      </p>
      {p.rho != null && (
        <p className="text-ink-muted text-[10px]">
          {(() => {
            const { p: pval, stars } = correlationSignificance(p.rho, p.rhoN);
            return pval != null
              ? `p=${formatPValue(pval)} · ${stars}`
              : stars;
          })()}
        </p>
      )}
      {p.peakGrow7d != null && (
        <p className="text-emerald-700">
          {it ? "Picco % su 7g" : "Peak 7d up %"}: {p.peakGrow7d.toFixed(1)}%
        </p>
      )}
      {p.investMin != null && (
        <p className="text-ink-muted">
          Invest ≥ {p.investMin}
        </p>
      )}
      <p className="text-ink-muted text-[10px]">n signals: {p.nSignals}</p>
    </div>
  );
}

export function RascoreCalibrationTrendChart({
  rows,
  visual,
  compact = false,
}: {
  rows: RascoreCalibrationChartRow[];
  visual: LearningTrendVisual;
  compact?: boolean;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-5 text-center rounded-lg border border-dashed border-[rgb(var(--panel-feed-border))]/50">
        {t("modelLab.qc.rascoreImpact.evolution.empty")}
      </p>
    );
  }

  const hasRho = rows.some((r) => r.rho != null);

  return (
    <div className="space-y-2 rounded-xl border border-[rgb(var(--panel-feed-border))]/50 bg-white/90 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
            {t("modelLab.qc.rascoreImpact.evolution.title")}
          </p>
          <p className="text-[9px] text-ink-muted leading-snug mt-0.5">
            {t("modelLab.qc.rascoreImpact.evolution.caption")}
          </p>
        </div>
        <TrendStatusBadge visual={visual} it={it} />
      </div>
      <div className={`${compact ? "h-[150px]" : "h-[190px]"} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--panel-feed-border) / 0.35)" />
            <XAxis dataKey="label" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
            <YAxis
              domain={[-1, 1]}
              tick={{ fontSize: 9 }}
              ticks={[-1, -0.5, 0, 0.45, 1]}
              tickFormatter={(v: number) => (v >= 0 ? "+" : "") + v.toFixed(1)}
              width={36}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 4" />
            <ReferenceLine
              y={0.45}
              stroke="#059669"
              strokeDasharray="4 3"
              label={{
                value: it ? "ρ forte" : "strong ρ",
                fontSize: 8,
                fill: "#059669",
                position: "insideTopRight",
              }}
            />
            <Tooltip content={<RhoTooltip it={it} />} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            {hasRho && (
              <Line
                type="monotone"
                dataKey="rho"
                name={t("modelLab.qc.rascoreImpact.evolution.seriesRho")}
                stroke="#7c3aed"
                strokeWidth={2.25}
                dot={{ r: 4, fill: "#7c3aed", strokeWidth: 0 }}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted/80 leading-snug">
        {t("modelLab.sdsAccuracy.stat.legend")}
      </p>
      <p className="text-[9px] text-ink-muted/80 leading-snug">{it ? visual.explainIt : visual.explainEn}</p>
    </div>
  );
}
