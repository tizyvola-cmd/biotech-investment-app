import { useMemo, type ReactNode } from "react";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Trade, PortfolioPoint } from "../types/trades";
import { TradeTable } from "./TradeTable";
import { useLang, useT } from "../shared/i18n";
import { AdviceTriangleMarker, SellOutcomeTriangle, adviceOutcomeFill } from "./adviceChartMarkers";
import type { AdviceOutcomeClass } from "../sheet/investDecisionSimAdviceCalibration";
import { DECISION_SIM_PAIR_PRECHART_FALLBACK_PX } from "./decisionSimChartLayout";

type ChartRow = {
  date: string;
  value: number;
  compareValue?: number | null;
  simLoopSynthValue?: number | null;
  simLoopWeightedValue?: number | null;
  totalPnlEur?: number;
  buyY: number | null;
  sellY: number | null;
  reviewY: number | null;
  buyTicker?: string;
  sellTicker?: string;
  reviewTicker?: string;
  buyMeta?: string;
  sellMeta?: string;
  sellAdviceOutcome?: AdviceOutcomeClass | null;
  postMovePct24h?: number | null;
};

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Sort chart rows chronologically (labels from formatDecisionSimChartTime). */
function chartLabelSortKey(label: string): number {
  if (label === "start") return 0;
  if (label === "· now" || label === "now") return Number.MAX_SAFE_INTEGER - 1;
  const m = label.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return Number.MAX_SAFE_INTEGER - 2;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const hour = Number(m[3]);
  const minute = Number(m[4]);
  if (![month, day, hour, minute].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER - 2;
  return Date.UTC(2026, month - 1, day, hour, minute);
}

function ChartLegend({
  it,
  showCompare,
  showSimLoopWeighted,
  showSimLoopSynth,
  isPnlMode,
  isSynthPrimary,
}: {
  it: boolean;
  showCompare?: boolean;
  showSimLoopWeighted?: boolean;
  showSimLoopSynth?: boolean;
  isPnlMode?: boolean;
  isSynthPrimary?: boolean;
}) {
  const primaryLabel = isSynthPrimary
    ? it
      ? "Sim loop (synth) P&L €"
      : "Sim loop (synth) P&L €"
    : isPnlMode
      ? it
        ? "Sim loop P&L €"
        : "Sim loop P&L €"
      : it
        ? "Valore portafoglio €"
        : "Portfolio value €";
  const primarySwatch = isSynthPrimary ? (
    <span className="inline-block w-5 h-0.5 bg-pink-600 rounded" aria-hidden />
  ) : (
    <span className="inline-block w-5 h-0.5 bg-[#185FA5] rounded" aria-hidden />
  );
  const items: { swatch: ReactNode; label: string }[] = [
    {
      swatch: primarySwatch,
      label: primaryLabel,
    },
    ...(showCompare
      ? [
          {
            swatch: (
              <span
                className="inline-block w-5 h-0 border-t-2 border-violet-500 border-dashed"
                aria-hidden
              />
            ),
            label: it ? "Logica attuale" : "Current logic",
          },
        ]
      : []),
    ...(showSimLoopWeighted
      ? [
          {
            swatch: (
              <span
                className="inline-block w-5 h-0 border-t-2 border-emerald-600 border-dashed"
                aria-hidden
              />
            ),
            label: it ? "Sim loop (weight)" : "Sim loop (weight)",
          },
        ]
      : []),
    ...(showSimLoopSynth
      ? [
          {
            swatch: (
              <span
                className="inline-block w-5 h-0 border-t-2 border-pink-600 border-dashed"
                aria-hidden
              />
            ),
            label: it ? "Sim loop (synth)" : "Sim loop (synth)",
          },
        ]
      : []),
    {
      swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600" aria-hidden />,
      label: "BUY",
    },
    {
      swatch: (
        <AdviceTriangleMarker cx={5} cy={5} fill={adviceOutcomeFill("good")} direction="down" size={8} />
      ),
      label: it ? "SELL ✓ (titolo scende)" : "SELL ✓ (stock falls)",
    },
    {
      swatch: (
        <AdviceTriangleMarker cx={5} cy={5} fill={adviceOutcomeFill("bad")} direction="down" size={8} />
      ),
      label: it ? "SELL ✗ (titolo sale)" : "SELL ✗ (stock rises)",
    },
    {
      swatch: (
        <span
          className="inline-block w-2.5 h-2.5 bg-amber-600"
          style={{ clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" }}
          aria-hidden
        />
      ),
      label: "HOLD / REVIEW",
    },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[9px] text-ink-muted">
          {item.swatch}
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function PortfolioTooltip({
  active,
  payload,
  it,
  isPnlMode = true,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  it: boolean;
  isPnlMode?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5">
      <p className="font-semibold">{d.date}</p>
      <p className="text-[#185FA5]">
        {isPnlMode
          ? `${it ? "P&L sim loop" : "Sim loop P&L"}: ${fmtEur(d.value)}`
          : `${it ? "Valore book" : "Book value"}: ${fmtEur(d.value)}`}
      </p>
      {d.totalPnlEur != null ? (
        <p className={d.totalPnlEur >= 0 ? "text-emerald-700" : "text-rose-700"}>
          P&L: {d.totalPnlEur >= 0 ? "+" : ""}
          {fmtEur(d.totalPnlEur)}
        </p>
      ) : null}
      {d.simLoopWeightedValue != null && Number.isFinite(d.simLoopWeightedValue) ? (
        <p className="text-emerald-700 font-semibold">
          {it ? "Sim loop (weight)" : "Sim loop (weight)"}: {fmtEur(d.simLoopWeightedValue)}
        </p>
      ) : null}
      {d.simLoopSynthValue != null && Number.isFinite(d.simLoopSynthValue) ? (
        <p className="text-pink-700 font-semibold">
          {it ? "Sim loop (synth)" : "Sim loop (synth)"}: {fmtEur(d.simLoopSynthValue)}
        </p>
      ) : null}
      {d.buyTicker ? <p className="text-emerald-700">BUY {d.buyTicker} {d.buyMeta ?? ""}</p> : null}
      {d.sellTicker ? (
        <p className={d.sellAdviceOutcome === "good" ? "text-emerald-700" : d.sellAdviceOutcome === "bad" ? "text-rose-600" : "text-rose-600"}>
          SELL {d.sellTicker} {d.sellMeta ?? ""}
          {d.postMovePct24h != null ? (
            <span className="text-ink-muted">
              {" "}
              · 24h {d.postMovePct24h >= 0 ? "+" : ""}
              {d.postMovePct24h.toFixed(1)}%
              {d.sellAdviceOutcome === "good"
                ? it ? " · consiglio ✓" : " · advice ✓"
                : d.sellAdviceOutcome === "bad"
                  ? it ? " · consiglio ✗" : " · advice ✗"
                  : null}
            </span>
          ) : null}
        </p>
      ) : null}
      {d.reviewTicker ? <p className="text-amber-700">{d.reviewTicker}</p> : null}
    </div>
  );
}

export function TradePortfolioChart({
  trades,
  portfolioCurve,
  deployedCapitalEur,
  compact = false,
  chartHeight = 280,
  fill = false,
  pairLayout = false,
  pairPreChartHeight = null,
  headerSlot,
  comparePortfolioCurve,
  compareLabel: _compareLabel,
  simLoopWeightedPortfolioCurve,
  simLoopSynthPortfolioCurve,
  valueMode = "pnl",
  curveVariant = "equal",
  showOverlayCurves = false,
  initialCapital,
}: {
  trades: Trade[];
  portfolioCurve: PortfolioPoint[];
  /** Deployed capital — return % denominator in P&L mode. */
  deployedCapitalEur: number;
  /** @deprecated use deployedCapitalEur */
  initialCapital?: number;
  /** Dashboard embed — hide trade table, smaller KPIs/chart. */
  compact?: boolean;
  chartHeight?: number;
  /** Riempie l'altezza residua della card dashboard. */
  fill?: boolean;
  /** Affiancato a P(plan): KPI strip si allunga fino all'altezza del pannello sinistro. */
  pairLayout?: boolean;
  /** Altezza misurata del blocco pre-grafico sinistro (px). */
  pairPreChartHeight?: number | null;
  /** Titolo / header sopra le KPI (es. «Paper portfolio · BUY / SELL»). */
  headerSlot?: ReactNode;
  comparePortfolioCurve?: PortfolioPoint[];
  /** Dashed overlay — baseline sim loop when comparing RA what-if. */
  compareLabel?: string;
  /** Sim loop book value with Learning Lab approved weights. */
  simLoopWeightedPortfolioCurve?: PortfolioPoint[];
  /** Sim loop book value with Weight Sim Exp (synth) sizing. */
  simLoopSynthPortfolioCurve?: PortfolioPoint[];
  /** Y axis: cumulative P&L € (sim loop) or legacy book value. */
  valueMode?: "pnl" | "book";
  /** Primary curve styling — equal-weight paper sim vs synth sizing. */
  curveVariant?: "equal" | "synth";
  /** Show dashed weight/synth overlays (off when using curveVariant toggle). */
  showOverlayCurves?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const capitalBase = deployedCapitalEur > 0 ? deployedCapitalEur : (initialCapital ?? 0);
  const isPnlMode = valueMode === "pnl";
  const isSynthPrimary = curveVariant === "synth";
  const primaryStroke = isSynthPrimary ? "#db2777" : "#185FA5";

  const chartData = useMemo((): ChartRow[] => {
    const compareByDate = new Map(
      (comparePortfolioCurve ?? []).map((p) => [p.date, p.value]),
    );
    const synthByDate = new Map(
      (simLoopSynthPortfolioCurve ?? []).map((p) => [p.date, p.value]),
    );
    const weightedByDate = new Map(
      (simLoopWeightedPortfolioCurve ?? []).map((p) => [p.date, p.value]),
    );

    const curve =
      portfolioCurve.length === 1
        ? [
            {
              date: "start",
              value: isPnlMode ? 0 : capitalBase,
              totalPnlEur: 0,
            },
            portfolioCurve[0]!,
          ]
        : portfolioCurve;

    const byDate = new Map<string, ChartRow>();
    for (const point of curve) {
      byDate.set(point.date, {
        date: point.date,
        value: point.value,
        compareValue: compareByDate.get(point.date) ?? null,
        simLoopWeightedValue: weightedByDate.get(point.date) ?? null,
        simLoopSynthValue: synthByDate.get(point.date) ?? null,
        totalPnlEur: point.totalPnlEur,
        buyY: null,
        sellY: null,
        reviewY: null,
      });
    }
    if (byDate.size === 0) {
      byDate.set("—", {
        date: "—",
        value: isPnlMode ? 0 : capitalBase,
        buyY: null,
        sellY: null,
        reviewY: null,
      });
    }

    for (const tr of trades) {
      let row = byDate.get(tr.date);
      if (!row) {
        const lastVal = curve.length
          ? curve[curve.length - 1]?.value ?? (isPnlMode ? 0 : capitalBase)
          : isPnlMode
            ? 0
            : capitalBase;
        row = {
          date: tr.date,
          value: lastVal,
          buyY: null,
          sellY: null,
          reviewY: null,
        };
        byDate.set(tr.date, row);
      }
      const tradeValue = tr.value ?? 0;
      const meta =
        tr.qty != null && tr.price != null && Number.isFinite(tr.price)
          ? `· ${tr.qty} @ $${tr.price.toFixed(2)} · ${fmtEur(tradeValue)}`
          : `· ${fmtEur(tradeValue)}`;
      if (tr.action === "BUY" && row.buyY == null) {
        row.buyY = row.value;
        row.buyTicker = tr.ticker;
        row.buyMeta = meta;
      } else if (tr.action === "SELL" && row.sellY == null) {
        row.sellY = row.value;
        row.sellTicker = tr.ticker;
        row.sellAdviceOutcome = tr.adviceOutcome ?? "pending";
        row.postMovePct24h = tr.postMovePct24h ?? null;
        row.sellMeta =
          tr.pnl != null
            ? `${meta} · P&L ${tr.pnl >= 0 ? "+" : ""}${fmtEur(tr.pnl)}`
            : meta;
      } else if ((tr.action === "HOLD" || tr.action === "REVIEW") && row.reviewY == null) {
        row.reviewY = row.value;
        row.reviewTicker = `${tr.action} ${tr.ticker}`;
      }
    }

    const sorted = [...byDate.values()].sort(
      (a, b) => chartLabelSortKey(a.date) - chartLabelSortKey(b.date),
    );

    // Trade markers add dates between tick snapshots — carry last synth/weight book forward.
    let lastWeighted: number | null = null;
    let lastSynth: number | null = null;
    for (const row of sorted) {
      if (row.simLoopWeightedValue != null && Number.isFinite(row.simLoopWeightedValue)) {
        lastWeighted = row.simLoopWeightedValue;
      } else if (lastWeighted != null) {
        row.simLoopWeightedValue = lastWeighted;
      }
      if (row.simLoopSynthValue != null && Number.isFinite(row.simLoopSynthValue)) {
        lastSynth = row.simLoopSynthValue;
      } else if (lastSynth != null) {
        row.simLoopSynthValue = lastSynth;
      }
    }

    return sorted;
  }, [
    portfolioCurve,
    trades,
    capitalBase,
    isPnlMode,
    comparePortfolioCurve,
    simLoopWeightedPortfolioCurve,
    simLoopSynthPortfolioCurve,
  ]);

  const showCompare = (comparePortfolioCurve?.length ?? 0) > 0;
  const showSimLoopWeighted =
    showOverlayCurves && (simLoopWeightedPortfolioCurve?.length ?? 0) > 0;
  const showSimLoopSynth =
    showOverlayCurves && (simLoopSynthPortfolioCurve?.length ?? 0) > 0;

  const finalPoint = portfolioCurve[portfolioCurve.length - 1];
  const finalPnlRaw =
    finalPoint?.totalPnlEur ??
    finalPoint?.value ??
    (isPnlMode ? 0 : (finalPoint?.value ?? capitalBase) - capitalBase);
  const finalPnl = Number.isFinite(finalPnlRaw) ? finalPnlRaw : 0;
  const finalBook =
    isPnlMode && finalPoint?.value != null && Number.isFinite(finalPoint.value)
      ? capitalBase + finalPnl
      : finalPoint?.value ?? capitalBase;
  const pnlPct =
    capitalBase > 0 && Number.isFinite(finalPnl)
      ? ((finalPnl / capitalBase) * 100).toFixed(1)
      : "0.0";
  const closedTrades = trades.filter((tr) => tr.action === "SELL").length;
  const openBuys = trades.filter((tr) => tr.action === "BUY").length - closedTrades;

  const kpiCards = isPnlMode
    ? [
        {
          label: it ? "Cap. deploy" : "Deployed cap",
          value: fmtEur(capitalBase),
          color: "text-ink",
        },
        {
          label: it ? "P&L totale" : "Total P&L",
          value: (finalPnl >= 0 ? "+" : "") + fmtEur(finalPnl),
          color: finalPnl >= 0 ? "text-emerald-700" : "text-rose-700",
        },
        {
          label: it ? "Rendimento" : "Return",
          value: (finalPnl >= 0 ? "+" : "") + pnlPct + "%",
          color: finalPnl >= 0 ? "text-emerald-700" : "text-rose-700",
        },
        {
          label: it ? "Trade chiusi / aperti" : "Closed / open",
          value: `${closedTrades} / ${Math.max(0, openBuys)}`,
          color: "text-ink",
        },
      ]
    : [
        {
          label: it ? "Valore book" : "Book value",
          value: fmtEur(finalBook),
          color: "text-ink",
        },
        {
          label: it ? "P&L totale" : "Total P&L",
          value: (finalPnl >= 0 ? "+" : "") + fmtEur(finalPnl),
          color: finalPnl >= 0 ? "text-emerald-700" : "text-rose-700",
        },
        {
          label: it ? "Rendimento" : "Return",
          value: (finalPnl >= 0 ? "+" : "") + pnlPct + "%",
          color: finalPnl >= 0 ? "text-emerald-700" : "text-rose-700",
        },
        {
          label: it ? "Trade chiusi / aperti" : "Closed / open",
          value: `${closedTrades} / ${Math.max(0, openBuys)}`,
          color: "text-ink",
        },
      ];

  const kpiCompact = compact && !pairLayout;
  const kpiPair = compact && pairLayout;

  const resolvedChartHeight = chartHeight;
  const pairHeaderBlockHeight =
    pairPreChartHeight ?? DECISION_SIM_PAIR_PRECHART_FALLBACK_PX;

  const kpiGrid = (
    <div
      className={
        kpiPair
          ? "grid grid-cols-4 gap-1 shrink-0"
          : kpiCompact
            ? "grid grid-cols-4 gap-1 shrink-0"
            : compact
              ? "grid grid-cols-2 gap-1 shrink-0"
              : "grid grid-cols-2 sm:grid-cols-4 gap-2"
      }
    >
      {kpiCards.map((card) => (
        <div
          key={card.label}
          className={`tester-monitor-panel-soft rounded-md text-center shrink-0 ${
            kpiPair || kpiCompact
              ? "px-1 py-0.5"
              : compact
                ? "px-2 py-1.5"
                : "px-3 py-2"
          }`}
        >
          <p
            className={`font-bold tabular-nums leading-none ${card.color} ${
              kpiPair || kpiCompact ? "text-[11px]" : compact ? "text-sm" : "text-lg"
            }`}
          >
            {card.value}
          </p>
          <p
            className={`text-ink-muted leading-none truncate ${
              kpiPair || kpiCompact ? "text-[7px] mt-0.5" : "text-[9px] mt-0.5"
            }`}
            title={card.label}
          >
            {card.label}
          </p>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className={
        pairLayout
          ? "flex flex-col flex-1 min-h-0 gap-1.5 h-full"
          : compact
            ? fill
              ? "flex flex-col flex-1 min-h-0 gap-1.5 h-full"
              : "space-y-2"
            : "space-y-3"
      }
    >
      {kpiPair ? (
        <div
          className="shrink-0 flex flex-col gap-1 min-h-0"
          style={{ minHeight: pairHeaderBlockHeight }}
        >
          {headerSlot ? <div className="shrink-0">{headerSlot}</div> : null}
          {kpiGrid}
          <div className="flex-1 min-h-0" aria-hidden />
        </div>
      ) : (
        kpiGrid
      )}

      {!compact ? (
        <p className="tester-monitor-muted text-[9px] leading-snug px-0.5">
          {t("testerMonitor.decisionSim.tradePortfolio.sub")}
        </p>
      ) : null}

      {!compact ? (
        <div className={fill ? "shrink-0" : undefined}>
          <ChartLegend
            it={it}
            showCompare={showCompare}
            showSimLoopWeighted={showSimLoopWeighted}
            showSimLoopSynth={showSimLoopSynth}
            isPnlMode={isPnlMode}
            isSynthPrimary={isSynthPrimary}
          />
        </div>
      ) : null}

      <div
        className={pairLayout || fill ? "shrink-0 w-full min-w-0" : "w-full"}
        style={pairLayout || fill ? undefined : { height: resolvedChartHeight }}
      >
        <ResponsiveContainer
          width="100%"
          height={pairLayout || fill ? resolvedChartHeight : resolvedChartHeight}
        >
        <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 2, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            tick={{ fontSize: 9 }}
            tickFormatter={(v) => fmtEur(v)}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip content={<PortfolioTooltip it={it} isPnlMode={isPnlMode} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={primaryStroke}
            strokeWidth={2}
            dot={{ r: 3, fill: primaryStroke }}
            activeDot={{ r: 5 }}
            legendType="none"
          />
          {showCompare ? (
            <Line
              type="monotone"
              dataKey="compareValue"
              stroke="#7c3aed"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              legendType="none"
            />
          ) : null}
          {showSimLoopWeighted ? (
            <Line
              type="monotone"
              dataKey="simLoopWeightedValue"
              stroke="#059669"
              strokeWidth={1.8}
              strokeDasharray="6 4"
              dot={false}
              connectNulls
              legendType="none"
            />
          ) : null}
          {showSimLoopSynth ? (
            <Line
              type="monotone"
              dataKey="simLoopSynthValue"
              stroke="#db2777"
              strokeWidth={1.8}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              legendType="none"
            />
          ) : null}
          <Scatter dataKey="buyY" fill="#639922" legendType="none" />
          <Scatter
            dataKey="sellY"
            legendType="none"
            shape={(props: { cx?: number; cy?: number; payload?: ChartRow }) => (
              <SellOutcomeTriangle {...props} />
            )}
          />
          <Scatter dataKey="reviewY" fill="#BA7517" legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {kpiCompact || kpiPair ? (
        <div className="shrink-0">
          <ChartLegend
            it={it}
            showCompare={showCompare}
            showSimLoopWeighted={showSimLoopWeighted}
            showSimLoopSynth={showSimLoopSynth}
            isPnlMode={isPnlMode}
            isSynthPrimary={isSynthPrimary}
          />
        </div>
      ) : null}

      {!compact ? (
        <div>
          <p className="tester-monitor-text text-[11px] font-semibold mb-2">
            {t("testerMonitor.decisionSim.tradePortfolio.tableTitle")}
          </p>
          <TradeTable trades={trades.filter((tr) => tr.action === "BUY" || tr.action === "SELL")} />
        </div>
      ) : null}
    </div>
  );
}
