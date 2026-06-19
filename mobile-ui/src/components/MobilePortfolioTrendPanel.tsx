import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  buildTrendChartRows,
  investTrendEurDomain,
  investTrendPnlDomain,
  trendLineColor,
} from "../mobilePortfolioTrend";
import type { InvestSimHistoryPoint } from "../types";
import { CHART_GRID, CHART_TICK } from "./mobileChartTheme";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export type TrendPositionOption = {
  key: string;
  ticker: string;
};

type Props = {
  history: InvestSimHistoryPoint[];
  positions: TrendPositionOption[];
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  loading?: boolean;
};

function breakevenLabelPlugin(label: string): Plugin<"line"> {
  return {
    id: "breakevenLabel",
    afterDraw(chart) {
      const yScale = chart.scales.y;
      if (!yScale) return;
      const zero = yScale.getPixelForValue(0);
      if (zero < chart.chartArea.top || zero > chart.chartArea.bottom) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = "#93c5fd";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(label, chart.chartArea.right - 2, zero - 5);
      ctx.restore();
    },
  };
}

function baseChartOptions(
  yDomain: [number, number],
  yTickFmt: (v: number) => string,
  breakevenLabel: string,
): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        titleColor: "#e2e8f0",
        bodyColor: "#f1f5f9",
        borderColor: "rgba(148, 163, 184, 0.35)",
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
      },
    },
    scales: {
      x: {
        grid: { color: CHART_GRID, drawTicks: false },
        ticks: {
          color: CHART_TICK,
          font: { size: 9 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 5,
        },
        border: { color: "rgba(147, 197, 253, 0.35)" },
      },
      y: {
        min: yDomain[0],
        max: yDomain[1],
        grid: { color: CHART_GRID, drawTicks: false },
        ticks: {
          color: CHART_TICK,
          font: { size: 9 },
          callback: (v) => yTickFmt(Number(v)),
        },
        border: { display: false },
      },
    },
    elements: {
      line: { tension: 0.28, borderWidth: 2.5 },
      point: { radius: 0, hoverRadius: 4, hitRadius: 12 },
    },
  };
}

export function MobilePortfolioTrendPanel({
  history,
  positions,
  selectedKey,
  onSelectKey,
  loading,
}: Props) {
  const { t, lang, locale } = useMobileLang();
  const breakeven = lang === "it" ? "Pareggio" : "Breakeven";

  const rows = useMemo(
    () => buildTrendChartRows(history, selectedKey, locale),
    [history, selectedKey, locale],
  );

  const selectedTicker =
    selectedKey != null ? positions.find((p) => p.key === selectedKey)?.ticker ?? null : null;

  const lastPct = rows.length ? rows[rows.length - 1].pnlPct : null;
  const lineColor = trendLineColor(lastPct);

  const pctDomain = useMemo(
    () => investTrendPnlDomain(rows.map((r) => r.pnlPct)),
    [rows],
  );
  const eurDomain = useMemo(
    () => investTrendEurDomain(rows.map((r) => r.pnlEur)),
    [rows],
  );

  const labels = rows.map((r) => r.ts);
  const pctValues = rows.map((r) => r.pnlPct);
  const eurValues = rows.map((r) => r.pnlEur);

  const pctSeriesLabel =
    selectedTicker != null
      ? selectedTicker
      : lang === "it"
        ? "P&L portafoglio %"
        : "Portfolio P&L %";

  const eurSeriesLabel =
    selectedTicker != null
      ? `${selectedTicker} €`
      : lang === "it"
        ? "P&L portafoglio €"
        : "Portfolio P&L €";

  const pctData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: pctSeriesLabel,
          data: pctValues,
          borderColor: lineColor,
          backgroundColor: lineColor,
          fill: {
            target: { value: 0 },
            above: "rgba(219, 234, 254, 0.55)",
            below: "rgba(254, 249, 195, 0.45)",
          },
        },
        {
          label: breakeven,
          data: labels.map(() => 0),
          borderColor: "rgba(37, 99, 235, 0.55)",
          borderDash: [5, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
      ],
    }),
    [labels, pctValues, pctSeriesLabel, lineColor, breakeven],
  );

  const eurData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: eurSeriesLabel,
          data: eurValues,
          borderColor: lineColor,
          backgroundColor: lineColor,
          fill: {
            target: { value: 0 },
            above: "rgba(219, 234, 254, 0.55)",
            below: "rgba(254, 249, 195, 0.45)",
          },
        },
        {
          label: breakeven,
          data: labels.map(() => 0),
          borderColor: "rgba(37, 99, 235, 0.55)",
          borderDash: [5, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
      ],
    }),
    [labels, eurValues, eurSeriesLabel, lineColor, breakeven],
  );

  const pctOptions = useMemo(
    () =>
      baseChartOptions(pctDomain, (v) => `${v.toFixed(2)}%`, breakeven),
    [pctDomain, breakeven],
  );

  const eurOptions = useMemo(
    () =>
      baseChartOptions(eurDomain, (v) => {
        const abs = Math.abs(v);
        if (abs >= 1000) return `€${(v / 1000).toFixed(1)}k`;
        return `€${Math.round(v)}`;
      }, breakeven),
    [eurDomain, breakeven],
  );

  const breakevenPlugin = useMemo(() => breakevenLabelPlugin(breakeven), [breakeven]);

  if (loading) {
    return <p className="hint trend-hint">{t("common.loading")}</p>;
  }

  if (rows.length < 2) {
    return (
      <p className="hint trend-hint">
        {t("portfolio.trend.needHistory")}
      </p>
    );
  }

  return (
    <div className="portfolio-trend-panel">
      {positions.length > 0 ? (
        <div className="field trend-scope-field">
          <label htmlFor="trend-scope">{t("portfolio.trend.scopeLabel")}</label>
          <select
            id="trend-scope"
            className="trend-scope-select"
            value={selectedKey ?? ""}
            onChange={(e) => onSelectKey(e.target.value || null)}
          >
            <option value="">{t("portfolio.trend.allPortfolio")}</option>
            {positions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.ticker}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="card trend-card trend-chart-card">
        <p className="trend-chart-kicker">{t("portfolio.trend.pnlTitle")}</p>
        <p className="trend-chart-caption">{t("portfolio.trend.pnlCaption")}</p>
        <p className="trend-current">{lastPct != null ? `${lastPct >= 0 ? "+" : ""}${lastPct.toFixed(2)}%` : "—"}</p>
        <div className="trend-chart-wrap">
          <Line
            data={pctData}
            options={pctOptions}
            plugins={[breakevenPlugin]}
          />
        </div>
        <div className="trend-legend">
          <span className="trend-legend-item">
            <span className="trend-legend-swatch" style={{ background: lineColor }} />
            {pctSeriesLabel}
          </span>
        </div>
      </div>

      <div className="card trend-card trend-chart-card">
        <p className="trend-chart-kicker">{t("portfolio.trend.eurTitle")}</p>
        <p className="trend-chart-caption">{t("portfolio.trend.eurCaption")}</p>
        <p className="trend-current">
          {rows.length
            ? `${eurValues[eurValues.length - 1] >= 0 ? "+" : ""}€ ${Math.abs(eurValues[eurValues.length - 1]).toFixed(0)}`
            : "—"}
        </p>
        <div className="trend-chart-wrap">
          <Line
            data={eurData}
            options={eurOptions}
            plugins={[breakevenPlugin]}
          />
        </div>
        <div className="trend-legend">
          <span className="trend-legend-item">
            <span className="trend-legend-swatch" style={{ background: lineColor }} />
            {eurSeriesLabel}
          </span>
        </div>
      </div>

      <p className="hint trend-hint">
        {t("portfolio.trend.readings", { n: history.length })}
      </p>
    </div>
  );
}
