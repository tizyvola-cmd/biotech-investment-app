import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { loadInvestmentSimOutcomes, type SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import type { SheetTable } from "../types";
import {
  buildActivePortfolioPositions,
  positionPnlForOpenRow,
} from "../sheet/simulationPosition";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  buildDecisionGainView,
  summarizeOpenMtm,
} from "../sheet/investmentDecisionGainView";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} €`;
}

export function InvestmentDecisionGainPanel({
  reloadToken = 0,
  simTable = null,
}: {
  reloadToken?: number;
  simTable?: SheetTable | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable ?? null, reloadToken);
  const portfolioHistory = useInvestSimPortfolioHistory(reloadToken);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SimOutcomeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      if (cancelled) return;
      setRows(doc?.rows ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const openMtm = useMemo(() => {
    const positions = buildActivePortfolioPositions(simTable?.rows, inputs, {
      history: portfolioHistory,
    });
    const enriched = positions.map((pos) => {
      const simRow = simRowByKey.get(pos.key);
      const aligned =
        simRow != null
          ? positionPnlForOpenRow(simRow, inputs, portfolioHistory)
          : null;
      return {
        pnlEur: aligned?.pnlEur ?? pos.pnlEur,
        pnlUnavailable: pos.pnlUnavailable,
      };
    });
    return summarizeOpenMtm(enriched);
  }, [simTable?.rows, inputs, portfolioHistory, simRowByKey]);

  const view = useMemo(
    () => buildDecisionGainView(rows, openMtm, lang),
    [rows, openMtm, lang],
  );

  const signalBars = useMemo(
    () => [
      {
        key: "buyOk",
        label: it ? "Buy OK" : "Buy OK",
        count: view.buySuccess,
        fill: "#059669",
      },
      {
        key: "buyFail",
        label: it ? "Buy miss" : "Buy miss",
        count: view.buyFailure,
        fill: "#dc2626",
      },
      {
        key: "sellOk",
        label: it ? "Sell OK" : "Sell OK",
        count: view.sellSuccess,
        fill: "#2563eb",
      },
      {
        key: "sellFail",
        label: it ? "Sell miss" : "Sell miss",
        count: view.sellFailure,
        fill: "#f97316",
      },
    ].filter((b) => b.count > 0),
    [view, it],
  );

  if (loading) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center border border-dashed border-[rgb(var(--border))]/50 rounded-lg">
        {it ? "Caricamento esiti decisioni…" : "Loading decision outcomes…"}
      </p>
    );
  }

  if (!view.hasChart) {
    return (
      <div className="rounded-lg border border-dashed border-amber-200/80 bg-amber-50/50 px-3 py-4 text-[11px] text-ink-muted">
        {t("modelLab.qc.decisionGain.empty")}
      </div>
    );
  }

  const netClosed = view.closedGainEur + view.closedLossEur;
  const netAll = netClosed + view.openGainEur + view.openLossEur;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
      <div>
        <p className="text-[9px] uppercase tracking-wide text-ink-muted">
          {t("modelLab.qc.decisionGain.title")}
        </p>
        <p className="text-sm font-semibold text-ink leading-snug mt-0.5">
          {t("modelLab.qc.decisionGain.lead")}
        </p>
        <p className="text-[10px] text-ink-muted leading-snug mt-1 max-w-prose">
          {t("modelLab.qc.decisionGain.body")}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/35 px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.decisionGain.kpi.realized")}
          </p>
          <p
            className={`text-base font-semibold tabular-nums ${
              netClosed >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {fmtUsd(netClosed)}
          </p>
          <p className="text-[9px] text-ink-muted tabular-nums">
            {view.closedGain}↑ · {view.closedLoss}↓
          </p>
        </div>
        <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/35 px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.decisionGain.kpi.open")}
          </p>
          <p
            className={`text-base font-semibold tabular-nums ${
              view.openGainEur + view.openLossEur >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {fmtUsd(view.openGainEur + view.openLossEur)}
          </p>
          <p className="text-[9px] text-ink-muted tabular-nums">
            {view.openGain}↑ · {view.openLoss}↓
          </p>
        </div>
        <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/35 px-2.5 py-2 col-span-2">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.decisionGain.kpi.total")}
          </p>
          <p
            className={`text-base font-semibold tabular-nums ${
              netAll >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {fmtUsd(netAll)}
          </p>
          <p className="text-[9px] text-ink-muted">
            {t("modelLab.qc.decisionGain.kpi.totalSub")}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.decisionGain.barTitle")}</p>
        <p className="text-[9px] text-ink-muted">{t("modelLab.qc.decisionGain.barCaption")}</p>
        <div className="h-[140px] w-full">
          <ViewErrorBoundary label="Gain vs loss">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.barRows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} height={32} />
                <YAxis tick={{ fontSize: 9 }} width={28} allowDecimals={false} />
                <Tooltip
                  formatter={(v: number, _n, p) => {
                    const row = p.payload as (typeof view.barRows)[0];
                    return [
                      `${v} ${it ? "posizioni" : "positions"} · ${fmtUsd(row.totalEur)}`,
                      row.label,
                    ];
                  }}
                  contentStyle={{ fontSize: 10 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {view.barRows.map((row) => (
                    <Cell key={row.key} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ViewErrorBoundary>
        </div>
      </div>

      {view.timeline.length >= 2 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.decisionGain.timelineTitle")}</p>
          <p className="text-[9px] text-ink-muted">{t("modelLab.qc.decisionGain.timelineCaption")}</p>
          <div className="h-[150px] w-full">
            <ViewErrorBoundary label="Cumulative P&L">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={view.timeline} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9 }}
                    interval="preserveStartEnd"
                    height={28}
                  />
                  <YAxis tick={{ fontSize: 9 }} width={44} unit="€" />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Tooltip
                    formatter={(v: number) => fmtUsd(v)}
                    labelFormatter={(_l, payload) => {
                      const p = payload?.[0]?.payload as (typeof view.timeline)[0] | undefined;
                      if (!p) return "";
                      return `${p.ticker} · ${fmtUsd(p.eventEur)}`;
                    }}
                    contentStyle={{ fontSize: 10 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  <Line
                    type="monotone"
                    dataKey="cumulativeEur"
                    name={t("modelLab.qc.decisionGain.cumulativeLine")}
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ViewErrorBoundary>
          </div>
        </div>
      ) : null}

      {signalBars.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.decisionGain.signalTitle")}</p>
          <div className="h-[100px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalBars} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9 }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={56} />
                <Tooltip contentStyle={{ fontSize: 10 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {signalBars.map((row) => (
                    <Cell key={row.key} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
