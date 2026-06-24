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
import { useT } from "../shared/i18n";
import {
  buildCdPatternPolygonChartRows,
  buildCdPatternPolygonLearningTrend,
  type CdPatternPolygonOverview,
} from "../sheet/cdPatternPolygonAccuracyView";

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

export function CdPatternPolygonAccuracySection({
  overview,
}: {
  overview: CdPatternPolygonOverview | null | undefined;
}) {
  const t = useT();
  const rows = buildCdPatternPolygonChartRows(overview);
  const trendRows = buildCdPatternPolygonLearningTrend(overview);
  const eff = overview?.effectiveness;
  const hasTrend = trendRows.length >= 2;

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3">
        <h3 className="text-sm font-semibold text-ink">{t("learningLab.polygonAccuracy.title")}</h3>
        <p className="text-[10px] text-ink-muted leading-relaxed mt-0.5">{t("learningLab.polygonAccuracy.subtitle")}</p>
        <p className="text-[11px] text-ink-muted py-2">{t("learningLab.polygonAccuracy.empty")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t("learningLab.polygonAccuracy.title")}</h3>
        <p className="text-[10px] text-ink-muted leading-relaxed mt-1">
          {t("learningLab.polygonAccuracy.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.polygonAccuracy.kpiMeanRho")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtRho(eff?.mean_corr_match_stock)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.polygonAccuracy.kpiSamples")}</p>
          <p className="font-semibold tabular-nums text-ink">{overview?.n_samples ?? 0}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.polygonAccuracy.kpiEvents")}</p>
          <p className="font-semibold tabular-nums text-ink">{overview?.n_events ?? 0}</p>
        </div>
      </div>

      <div style={{ height: 280 }} className="w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis
              dataKey="daysMid"
              type="number"
              reversed
              domain={[0, "dataMax"]}
              tick={{ fontSize: 9 }}
              label={{
                value: t("learningLab.polygonAccuracy.xAxis"),
                position: "insideBottom",
                offset: -2,
                style: { fontSize: 9, fill: "#64748b" },
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              domain={[-0.3, 1]}
              label={{
                value: "ρ",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 9, fill: "#64748b" },
              }}
            />
            <ReferenceLine x={0} stroke="#059669" strokeDasharray="4 3" label={{ value: "CD", fontSize: 8, fill: "#059669" }} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
            <Tooltip
              formatter={(v: number) => fmtRho(v)}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as { window?: string; daysLabel?: string; nSamples?: number };
                return `${row?.window ?? ""} · ${row?.daysLabel ?? ""} · n=${row?.nSamples ?? 0}`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="corr"
              name={t("learningLab.polygonAccuracy.lineCorr")}
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasTrend ? (
        <div className="space-y-1.5 pt-1">
          <div>
            <h4 className="text-[11px] font-semibold text-ink">{t("learningLab.polygonAccuracy.trendTitle")}</h4>
            <p className="text-[10px] text-ink-muted">{t("learningLab.polygonAccuracy.trendSubtitle")}</p>
          </div>
          <div style={{ height: 200 }} className="w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendRows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} domain={[-0.2, 1]} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
                <Tooltip formatter={(v: number) => fmtRho(v)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="meanCorr"
                  name={t("learningLab.polygonAccuracy.trendLine")}
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
