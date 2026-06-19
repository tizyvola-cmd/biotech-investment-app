import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLang, useT } from "../shared/i18n";
import { DECISION_SIM_PAIR_CHART_HEIGHT } from "./decisionSimChartLayout";

const BAR_COLORS = ["#6366f1", "#f97316", "#14b8a6", "#ec4899", "#eab308"];

export type MisalignChartRow = {
  id: string;
  label: string;
  count: number;
};

export function DecisionSimMisalignTypesChart({
  rows,
  misalignedTickers,
  evaluatedTickers,
  compact = false,
  className,
}: {
  rows: MisalignChartRow[];
  misalignedTickers: number;
  evaluatedTickers: number;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const chartHeight = compact ? DECISION_SIM_PAIR_CHART_HEIGHT : 180;

  if (evaluatedTickers <= 0) {
    return (
      <div
        className={`tester-monitor-panel rounded-xl flex items-center justify-center ${compact ? "p-2 min-h-[120px]" : "p-3 min-h-[160px]"} ${className ?? ""}`}
      >
        <p className="tester-monitor-muted text-[10px] text-center leading-relaxed px-2">
          {t("testerMonitor.decisionSim.chart.misalignTypesClear")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`tester-monitor-panel rounded-xl flex flex-col min-h-0 min-w-0 ${compact ? "p-2 space-y-1 h-full" : "p-3 space-y-1.5"} ${className ?? ""}`}
    >
      <div className="shrink-0 min-w-0">
        <p className={`tester-monitor-text font-semibold truncate ${compact ? "text-[10px]" : "text-[11px]"}`}>
          {t("testerMonitor.decisionSim.chart.misalignTypes")}
        </p>
        <p className={`tester-monitor-muted leading-snug ${compact ? "text-[8px] mt-0.5" : "text-[9px] mt-0.5"}`}>
          {t("testerMonitor.decisionSim.chart.misalignTypesSub", {
            n: misalignedTickers,
            total: evaluatedTickers,
          })}
        </p>
      </div>

      {rows.length > 0 ? (
        <div className={`w-full min-w-0 ${compact ? "flex-1" : ""}`} style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 8 }}
                allowDecimals={false}
                width={28}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip contentStyle={{ fontSize: 10 }} />
              <Bar dataKey="count" name={it ? "Ticker" : "Tickers"} radius={[3, 3, 0, 0]}>
                {rows.map((row, i) => (
                  <Cell key={row.id} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="tester-monitor-muted text-[10px] py-6 text-center flex-1">
          {t("testerMonitor.decisionSim.chart.misalignTypesClear")}
        </p>
      )}
    </div>
  );
}
