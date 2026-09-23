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
import type { EisCohortWeeklyHistoryDoc } from "../api/supernova";
import { useT } from "../shared/i18n";

type ChartRow = {
  weekKey: string;
  weekLabel: string;
  withEisPrice: number | null;
  withoutEisPrice: number | null;
  withEisSign: number | null;
  withoutEisSign: number | null;
  deltaPricePp: number | null;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function buildEisCohortWeeklyChartRows(
  doc: EisCohortWeeklyHistoryDoc | null | undefined,
): ChartRow[] {
  return (doc?.weeks ?? [])
    .slice()
    .sort((a, b) => a.week_key.localeCompare(b.week_key))
    .map((w) => ({
      weekKey: w.week_key,
      weekLabel: w.week_key.slice(5),
      withEisPrice: w.with_eis_price_accuracy_pct ?? null,
      withoutEisPrice: w.without_eis_price_accuracy_pct ?? null,
      withEisSign: w.with_eis_sign_hit_pct ?? null,
      withoutEisSign: w.without_eis_sign_hit_pct ?? null,
      deltaPricePp: w.delta_price_accuracy_pp ?? null,
    }));
}

export function EisCohortWeeklyTrendChart({
  history,
  loading,
}: {
  history: EisCohortWeeklyHistoryDoc | null | undefined;
  loading?: boolean;
}) {
  const t = useT();
  const rows = buildEisCohortWeeklyChartRows(history);

  if (loading) {
    return (
      <p className="text-[11px] text-ink-muted py-3">{t("modelLab.qc.eisImpact.loading")}</p>
    );
  }

  if (rows.length < 1) {
    return (
      <p className="text-[11px] text-ink-muted py-3 rounded border border-dashed border-[rgb(var(--border))]/50 px-3">
        {t("modelLab.qc.eisImpact.trendEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t("modelLab.qc.eisImpact.chartTitle")}</h3>
        <p className="text-[10px] text-ink-muted leading-snug">{t("modelLab.qc.eisImpact.chartCaption")}</p>
        <p className="text-[9px] text-ink-muted/80 mt-0.5">{t("modelLab.qc.eisImpact.chartReadHint")}</p>
      </div>
      <div style={{ height: 240 }} className="w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis dataKey="weekLabel" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 3" />
            <Tooltip
              formatter={(v: number, name: string) => [fmtPct(v), name]}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ChartRow | undefined;
                return row?.weekKey ?? "";
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="withEisPrice"
              name={`${t("modelLab.qc.eisImpact.legendWithEis")} · ${t("modelLab.qc.eisImpact.metricPrice")}`}
              stroke="#059669"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="withoutEisPrice"
              name={`${t("modelLab.qc.eisImpact.legendWithoutEis")} · ${t("modelLab.qc.eisImpact.metricPrice")}`}
              stroke="#94a3b8"
              strokeWidth={1.5}
              dot={{ r: 2 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="withEisSign"
              name={`${t("modelLab.qc.eisImpact.legendWithEis")} · ${t("modelLab.qc.eisImpact.metricSign")}`}
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 2 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="withoutEisSign"
              name={`${t("modelLab.qc.eisImpact.legendWithoutEis")} · ${t("modelLab.qc.eisImpact.metricSign")}`}
              stroke="#f472b6"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 2 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted italic">{t("modelLab.qc.eisImpact.scheduleNote")}</p>
    </div>
  );
}
