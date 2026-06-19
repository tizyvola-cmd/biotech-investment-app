import { useEffect, useMemo, useState, useCallback, type ReactNode, type RefObject } from "react";
import {
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  aggregateAdviceCalibrationBuckets,
  buildAdviceForecastErrorScatter,
  buildAdviceCalibrationFromLiveRows,
  buildAdviceCalibrationFromPaperSells,
  mergeAdviceCalibrationPoints,
  summarizeAdviceCalibration,
  badAdviceDiagnosisLabel,
  diagnoseBadAdviceRootCause,
  type AdviceCalibrationPoint,
  type AdviceForecastErrorDot,
  type BadAdviceDiagnosis,
} from "../sheet/investDecisionSimAdviceCalibration";

import {
  ADVICE_FEEDBACK_CHANGED_EVENT,
  buildAdviceFeedback,
  clearAdviceFeedback,
  loadAdviceFeedback,
  saveAdviceFeedback,
  type AdviceFeedback,
} from "../sheet/adviceFeedback";
import {
  buildAdviceLearningSnapshot,
  loadAdviceLearningHistory,
  recordAdviceLearningSnapshot,
  shouldAutoSnapshot,
} from "../sheet/adviceLearningHistory";
import { raEffectivePaperAction, type EntryRaVerdictEntry } from "../sheet/decisionSimRaReplay";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import type { SheetTable } from "../types";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { dailyChangePctFromRow } from "../sheet/simulationPosition";
import { recommendationRationale, type SuggestionMonitorRow } from "../sheet/suggestionMonitor";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { useT } from "../shared/i18n";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";
import { DECISION_SIM_PAIR_CHART_HEIGHT } from "./decisionSimChartLayout";
import type { UnifiedAdviceSuccess } from "../sheet/unifiedAdviceSuccess";
import { unifiedAdviceSuccessTooltip } from "../sheet/unifiedAdviceSuccess";
import type { AdviceComplementKpis } from "../sheet/adviceComplementKpis";
import { formatCapturePct } from "../sheet/adviceComplementKpis";
import { AdviceCalibScatterDot } from "./adviceChartMarkers";
import { useAdviceFeedbackAutoApply } from "../hooks/useAdviceFeedbackAutoApply";

/** Y-axis horizon for the forecast-error scatter.
 *  "24h"        → Y = (24h move) − (expected move) at advice time. Default,
 *                 matches how the advice outcome was originally scored.
 *  "cumulative" → Y = (since-entry P&L %) − (expected move). Only available
 *                 for positions the paper portfolio actually held, since
 *                 recommendations never executed have no cumulative move yet. */
type ForecastErrorHorizon = "24h" | "cumulative";

function fmtSignedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function DotTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload: AdviceForecastErrorDot }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5">
      <p className="font-semibold">{row.ticker}</p>
      <p>
        {(row.suggestedAction ?? "—").toUpperCase()} · P(plan): {row.probPct.toFixed(1)}% ·{" "}
        {row.bucketLabel}
      </p>
      <p className="text-ink-muted">
        {it ? "Stima" : "Forecast"}: {fmtSignedPct(row.expectedReturnPct)} ·{" "}
        {it ? "Reale" : "Actual"}: {fmtSignedPct(row.actualReturnPct)}
      </p>
      <p
        className={
          row.forecastErrorPct >= 0 ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"
        }
      >
        {it ? "Errore" : "Error"}: {fmtSignedPct(row.forecastErrorPct)}
      </p>
      {row.outcome === "good" || row.outcome === "bad" ? (
        <p className={row.outcome === "good" ? "text-emerald-700" : "text-rose-700"}>
          {it ? "Esito consiglio" : "Advice outcome"}: {row.outcome === "good" ? "✓" : "✗"}
          {row.suggestedAction === "sell" ? (it ? " · SELL" : " · SELL") : null}
        </p>
      ) : null}
    </div>
  );
}

function ChartLegend({ it, compact }: { it: boolean; compact?: boolean }) {
  const items: { swatch: ReactNode; label: string }[] = [
    {
      swatch: (
        <span
          className="inline-block w-5 h-0 border-t-2 border-amber-400"
          style={{ borderColor: "#eab308" }}
          aria-hidden
        />
      ),
      label: it ? "Stima perfetta (errore 0%)" : "Perfect prediction (0% error)",
    },
    {
      swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden />,
      label: it ? "BUY giusto ✓" : "BUY good ✓",
    },
    {
      swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500" aria-hidden />,
      label: it ? "BUY sbagliato ✗" : "BUY bad ✗",
    },
    {
      swatch: (
        <svg width="10" height="10" aria-hidden>
          <polygon points="5,8 1,2 9,2" fill="#22c55e" />
        </svg>
      ),
      label: it ? "SELL ✓ (scende)" : "SELL ✓ (falls)",
    },
    {
      swatch: (
        <svg width="10" height="10" aria-hidden>
          <polygon points="5,8 1,2 9,2" fill="#ef4444" />
        </svg>
      ),
      label: it ? "SELL ✗ (sale)" : "SELL ✗ (rises)",
    },
    {
      swatch: <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400" aria-hidden />,
      label: it ? "Pending" : "Pending",
    },
  ];
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 ${compact ? "pt-0.5" : "pt-1 pb-0.5"}`}
      role="list"
    >
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1 text-[8px] text-ink-muted">
          {item.swatch}
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function AdviceCalibDetailTable({
  rows,
  monitorByKey,
  it,
}: {
  rows: AdviceCalibrationPoint[];
  monitorByKey: Map<string, SuggestionMonitorRow>;
  it: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-ink-muted uppercase tracking-wide text-[9px]">
            <th className="text-left py-1 pr-2">Ticker</th>
            <th className="text-center py-1 px-2">{it ? "Azione" : "Action"}</th>
            <th className="text-center py-1 px-2">P(plan)</th>
            <th className="text-center py-1 px-2">{it ? "Stima" : "Forecast"}</th>
            <th className="text-center py-1 px-2">{it ? "Reale 24h" : "Actual 24h"}</th>
            <th className="text-center py-1 px-2">{it ? "Errore" : "Error"}</th>
            <th className="text-left py-1 pl-2 min-w-[200px]">{it ? "Dove sbaglia" : "Root cause"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const monitorKey = row.id.split("|")[1] ?? "";
            const monitor = monitorByKey.get(monitorKey);
            const diagnosis = diagnoseBadAdviceRootCause(
              row,
              monitor
                ? {
                    planReturnPct: monitor.planReturnPct,
                    curveGapPct: monitor.readings?.curveGapPct ?? null,
                    misalignmentLabels: monitor.misalignmentLabels,
                    buyReason: monitor.buyReason,
                    holdThesis: monitor.holdThesis,
                    rationale: recommendationRationale(monitor),
                  }
                : null,
            );
            return (
            <tr key={row.id} className="border-t border-slate-100/80">
              <td className="py-1 pr-2 font-semibold">{row.ticker}</td>
              <td className="py-1 px-2 text-center uppercase text-[9px] font-semibold">
                {row.suggestedAction}
              </td>
              <td
                className={`py-1 px-2 text-center tabular-nums ${
                  row.outcome === "bad" ? "text-rose-700 font-semibold" : "text-amber-700"
                }`}
              >
                {row.probPct.toFixed(0)}%
              </td>
              <td className="py-1 px-2 text-center tabular-nums">
                {row.expectedReturnPct != null ? fmtSignedPct(row.expectedReturnPct) : "—"}
              </td>
              <td className="py-1 px-2 text-center tabular-nums">
                {row.priceChangePct != null ? fmtSignedPct(row.priceChangePct) : "—"}
              </td>
              <td
                className={`py-1 px-2 text-center tabular-nums font-semibold ${
                  row.forecastErrorPct != null && row.forecastErrorPct >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {row.forecastErrorPct != null ? fmtSignedPct(row.forecastErrorPct) : "—"}
              </td>
              <td className="py-1 pl-2 text-[9px] text-ink-muted leading-snug max-w-[280px]">
                {badAdviceDiagnosisLabel(diagnosis, it ? "it" : "en")}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DecisionSimAdviceCalibrationPanel({
  monitorRows,
  paperPortfolio = [],
  decisionSimTicks = [],
  liveEvaluations = [],
  simTable,
  lang,
  updatedAt,
  unifiedAdviceSuccess,
  adviceComplement,
  compact = false,
  className,
  raWhatIfActive = false,
  raVerdictByKey,
  preChartMeasureRef,
}: {
  monitorRows: SuggestionMonitorRow[];
  paperPortfolio?: PaperPosition[];
  /** Tick paper sim — arricchisce il grafico con SELL eseguiti. */
  decisionSimTicks?: DecisionSimTick[];
  liveEvaluations?: TickerSimEvaluation[];
  simTable?: SheetTable | null;
  lang: "it" | "en";
  updatedAt?: string | null;
  /** Stessa metrica unificata del KPI «Direzione consigli (24h)». */
  unifiedAdviceSuccess?: UnifiedAdviceSuccess | null;
  /** Capture, P&L chiuso e rendimento book — complementari alla direzione 24h. */
  adviceComplement?: AdviceComplementKpis | null;
  /** Layout compatto — affiancato al grafico paper portfolio. */
  compact?: boolean;
  className?: string;
  raWhatIfActive?: boolean;
  raVerdictByKey?: Map<string, EntryRaVerdictEntry>;
  /** Measures everything above the scatter chart (for pair-layout sync). */
  preChartMeasureRef?: RefObject<HTMLDivElement>;
}) {
  const t = useT();
  const it = lang === "it";
  const chartHeight = compact ? DECISION_SIM_PAIR_CHART_HEIGHT : 248;

  // Controlled open state for the "Bad advice ✗" details section. Default
  // to `false` (collapsed) per the user's preference — the bad-advice list is
  // a deep-dive, not the headline. The first time they open it the choice is
  // persisted via `uiPrefs` (localStorage + disk) so it survives tab switches
  // and app restarts. Controlled (not uncontrolled `<details open>`) because
  // React only writes the attribute on first mount — any subsequent panel
  // remount (tab switch, monitor refresh) would otherwise leave the DOM
  // toggle in whatever state the browser carried.
  const [badAdviceOpen, setBadAdviceOpen] = useState<boolean>(() => {
    const v = loadUiPrefsLocal().badAdviceListOpen;
    return v == null ? false : Boolean(v);
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (typeof disk.badAdviceListOpen === "boolean") {
        setBadAdviceOpen(disk.badAdviceListOpen);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const onBadAdviceToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      setBadAdviceOpen(next);
      saveUiPrefs({ badAdviceListOpen: next });
    },
    [],
  );

  const [insightsOpen, setInsightsOpen] = useState<boolean>(() => {
    const v = loadUiPrefsLocal().adviceCalibInsightsOpen;
    return v == null ? false : Boolean(v);
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (typeof disk.adviceCalibInsightsOpen === "boolean") {
        setInsightsOpen(disk.adviceCalibInsightsOpen);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const onInsightsToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      setInsightsOpen(next);
      saveUiPrefs({ adviceCalibInsightsOpen: next });
    },
    [],
  );

  const entryProbByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const pos of paperPortfolio) {
      if (pos.entryProbPct != null && Number.isFinite(pos.entryProbPct)) {
        map.set(pos.key, pos.entryProbPct);
      }
    }
    return map;
  }, [paperPortfolio]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const resolvePostMove24h = useCallback(
    (key: string): number | null => {
      const ev = liveEvaluations.find((e) => e.key === key);
      if (ev?.pnlPct24h != null && Number.isFinite(ev.pnlPct24h)) return ev.pnlPct24h;
      const row = simRowByKey.get(key);
      if (row) {
        const daily = dailyChangePctFromRow(row);
        if (daily != null && Number.isFinite(daily)) return daily;
      }
      return null;
    },
    [liveEvaluations, simRowByKey],
  );

  const points = useMemo(
    () => {
      const liveRows = monitorRows.map((row) => {
        const base = {
          key: row.key,
          ticker: row.ticker,
          suggestedAction: row.suggestedAction,
          inPaperPortfolio: row.inPaperPortfolio,
          hasPosition: row.hasPosition,
          exitDecision: row.exitDecision,
          probPct: row.probPct,
          probPctAtAdvice: row.inPaperPortfolio
            ? (entryProbByKey.get(row.key) ?? row.probPct)
            : row.probPct,
          planReturnPct: row.planReturnPct,
          miiAngleDeg: row.miiAngleDeg,
          pnlPct: row.pnlPct,
          pnlPct24h: row.pnlPct24h,
        };
        if (!raWhatIfActive || !raVerdictByKey?.size) return base;
        return {
          ...base,
          suggestedAction: raEffectivePaperAction(row, raVerdictByKey),
        };
      });
      return mergeAdviceCalibrationPoints(
        buildAdviceCalibrationFromLiveRows(liveRows, lang),
        buildAdviceCalibrationFromPaperSells(decisionSimTicks, resolvePostMove24h, lang),
      );
    },
    [monitorRows, lang, entryProbByKey, decisionSimTicks, resolvePostMove24h, raWhatIfActive, raVerdictByKey],
  );

  const summary = useMemo(() => summarizeAdviceCalibration(points), [points]);

  const [errorHorizon, setErrorHorizon] = useState<ForecastErrorHorizon>("24h");

  // In cumulative mode we swap the 24h move (priceChangePct) for the position's
  // since-entry pnlPct and recompute forecastErrorPct against the same expected
  // return. Points without a usable cumulative move (recommendations never held)
  // are dropped — there's nothing cumulative to score yet.
  const pointsForHorizon = useMemo(() => {
    if (errorHorizon === "24h") return points;
    const out: AdviceCalibrationPoint[] = [];
    for (const p of points) {
      if (p.pnlPct == null || !Number.isFinite(p.pnlPct)) continue;
      const expected = p.expectedReturnPct;
      if (expected == null || !Number.isFinite(expected)) continue;
      out.push({
        ...p,
        priceChangePct: p.pnlPct,
        forecastErrorPct: Math.round((p.pnlPct - expected) * 10) / 10,
      });
    }
    return out;
  }, [points, errorHorizon]);

  const scatterData = useMemo(
    () => buildAdviceForecastErrorScatter(pointsForHorizon),
    [pointsForHorizon],
  );

  const yDomain = useMemo((): [number, number] => {
    if (!scatterData.length) return [-12, 12];
    const maxAbs = Math.max(...scatterData.map((d) => Math.abs(d.y)), 3);
    const pad = Math.ceil(maxAbs * 1.2);
    return [-pad, pad];
  }, [scatterData]);

  const cumulativeAvailableCount = useMemo(
    () =>
      points.filter(
        (p) =>
          p.pnlPct != null &&
          Number.isFinite(p.pnlPct) &&
          p.expectedReturnPct != null &&
          Number.isFinite(p.expectedReturnPct),
      ).length,
    [points],
  );

  const hasData = scatterData.length > 0;
  const badAdviceRows = useMemo(
    () =>
      points
        .filter((p) => p.outcome === "bad")
        .sort((a, b) => b.probPct - a.probPct),
    [points],
  );
  const lowProbRows = useMemo(
    () =>
      points
        .filter((p) => p.probPct <= 59 && p.forecastErrorPct != null)
        .sort((a, b) => a.probPct - b.probPct),
    [points],
  );
  const monitorByKey = useMemo(
    () => new Map(monitorRows.map((row) => [row.key, row])),
    [monitorRows],
  );

  const bucketRows = useMemo(() => aggregateAdviceCalibrationBuckets(points, lang), [points, lang]);

  /**
   * Per-action breakdown of the scatter dots so the user can immediately see
   * "how many of my paper sells went wrong because the stock kept rising"
   * — the question the existing P(plan) chips can't answer (those mix BUY
   * and SELL into a single success rate). Bad sells (`outcome === "bad"` on
   * a `"sell"` row) carry a positive `priceChangePct` (price rose ≥ +0.5 %
   * in 24h after the sell), so we surface both the count and the average
   * rise to put a magnitude on the mistake.
   */
  const sellStats = useMemo(() => {
    const sells = points.filter((p) => p.suggestedAction === "sell");
    const good = sells.filter((p) => p.outcome === "good").length;
    const bad = sells.filter((p) => p.outcome === "bad").length;
    const pending = sells.filter((p) => p.outcome === "pending").length;
    const scored = good + bad;
    const accuracyPct = scored > 0 ? Math.round((good / scored) * 1000) / 10 : null;
    const badRises = sells.filter(
      (p) => p.outcome === "bad" && p.priceChangePct != null && Number.isFinite(p.priceChangePct),
    );
    const avgRisePct =
      badRises.length > 0
        ? Math.round(
            (badRises.reduce((s, p) => s + (p.priceChangePct ?? 0), 0) / badRises.length) * 10,
          ) / 10
        : null;
    const worstRisePct =
      badRises.length > 0
        ? Math.max(...badRises.map((p) => p.priceChangePct ?? 0))
        : null;
    const worstTicker = badRises.length > 0
      ? badRises.reduce((best, p) =>
          (p.priceChangePct ?? 0) > (best.priceChangePct ?? 0) ? p : best,
        ).ticker
      : null;
    return {
      total: sells.length,
      good,
      bad,
      pending,
      scored,
      accuracyPct,
      avgRisePct,
      worstRisePct,
      worstTicker,
    };
  }, [points]);

  const buyStats = useMemo(() => {
    const buys = points.filter((p) => p.suggestedAction === "buy");
    const good = buys.filter((p) => p.outcome === "good").length;
    const bad = buys.filter((p) => p.outcome === "bad").length;
    const scored = good + bad;
    return {
      good,
      bad,
      scored,
      accuracyPct: scored > 0 ? Math.round((good / scored) * 1000) / 10 : null,
    };
  }, [points]);

  const diagnosesByPointId = useMemo(() => {
    const map = new Map<string, BadAdviceDiagnosis>();
    for (const p of points) {
      if (p.outcome !== "bad") continue;
      const monitorKey = p.id.split("|")[1] ?? "";
      const monitor = monitorByKey.get(monitorKey);
      const diag = diagnoseBadAdviceRootCause(
        p,
        monitor
          ? {
              planReturnPct: monitor.planReturnPct,
              curveGapPct: monitor.readings?.curveGapPct ?? null,
              misalignmentLabels: monitor.misalignmentLabels,
              buyReason: monitor.buyReason,
              holdThesis: monitor.holdThesis,
              rationale: recommendationRationale(monitor),
            }
          : null,
      );
      map.set(p.id, diag);
    }
    return map;
  }, [points, monitorByKey]);

  const pendingFeedback = useMemo(
    () => buildAdviceFeedback(points, bucketRows, diagnosesByPointId),
    [points, bucketRows, diagnosesByPointId],
  );

  useAdviceFeedbackAutoApply({
    pendingFeedback,
    summary,
    unifiedAdviceSuccess,
    adviceComplement,
  });

  const [storedFeedback, setStoredFeedback] = useState<AdviceFeedback | null>(() =>
    typeof window !== "undefined" ? loadAdviceFeedback() : null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setStoredFeedback(loadAdviceFeedback());
    window.addEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
  }, []);

  /** Auto-snapshot once per calendar day when we have enough data. */
  useEffect(() => {
    if (summary.scoredCount < 3) return;
    const history = loadAdviceLearningHistory();
    const now = Date.now();
    if (!shouldAutoSnapshot(history, summary.scoredCount, now)) return;
    const snap = buildAdviceLearningSnapshot({
      summary,
      feedback: storedFeedback,
      unifiedAdviceSuccessPct: unifiedAdviceSuccess?.headlinePct ?? null,
      capturePct: adviceComplement?.capture.capturePct ?? null,
      paperBookReturnPct: adviceComplement?.paperReturn.returnPct ?? null,
      closedPnlWinRatePct: adviceComplement?.closedPnl.winRatePct ?? null,
      manual: false,
      now: new Date(now),
    });
    recordAdviceLearningSnapshot(snap);
  }, [summary, storedFeedback, unifiedAdviceSuccess?.headlinePct, adviceComplement]);

  const hasPendingFeedback =
    pendingFeedback.bucketCorrections.size > 0 || pendingFeedback.actionDemotions.size > 0;
  const hasStoredFeedback =
    storedFeedback != null &&
    (storedFeedback.bucketCorrections.size > 0 || storedFeedback.actionDemotions.size > 0);

  const onApplyLearnings = useCallback(() => {
    saveAdviceFeedback(pendingFeedback);
    const snap = buildAdviceLearningSnapshot({
      summary,
      feedback: pendingFeedback,
      unifiedAdviceSuccessPct: unifiedAdviceSuccess?.headlinePct ?? null,
      capturePct: adviceComplement?.capture.capturePct ?? null,
      paperBookReturnPct: adviceComplement?.paperReturn.returnPct ?? null,
      closedPnlWinRatePct: adviceComplement?.closedPnl.winRatePct ?? null,
      manual: true,
    });
    recordAdviceLearningSnapshot(snap);
  }, [pendingFeedback, summary, unifiedAdviceSuccess?.headlinePct, adviceComplement]);

  const onClearLearnings = useCallback(() => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        it
          ? "Rimuovere tutte le correzioni attive? Le raccomandazioni torneranno a usare P(plan) raw."
          : "Remove all active corrections? Recommendations will revert to raw P(plan).",
      );
      if (!ok) return;
    }
    clearAdviceFeedback();
  }, [it]);

  const lastAppliedLabel = useMemo(() => {
    if (!hasStoredFeedback || !storedFeedback?.generatedAt) return null;
    const d = new Date(storedFeedback.generatedAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(it ? "it-IT" : "en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [hasStoredFeedback, storedFeedback, it]);

  return (
    <div
      className={`rounded-xl shrink-0 flex flex-col h-full min-h-0 ${compact ? "p-2 gap-1.5" : "p-3 gap-2 space-y-2"} ${className ?? "tester-monitor-panel"}`}
    >
      <div
        ref={preChartMeasureRef}
        className={`shrink-0 flex flex-col ${compact ? "gap-1.5" : "gap-2"}`}
      >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`tester-monitor-text font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`}>
            {raWhatIfActive
              ? t("testerMonitor.decisionSim.adviceCalib.titleRa")
              : t("testerMonitor.decisionSim.adviceCalib.title")}
          </p>
          {unifiedAdviceSuccess?.headlinePct != null ? (
            <span
              className="rounded-md border border-indigo-300/70 bg-indigo-50/90 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-200"
              title={unifiedAdviceSuccessTooltip(unifiedAdviceSuccess, lang)}
            >
              {t("testerMonitor.decisionSim.kpi.adviceSuccess")}: {unifiedAdviceSuccess.headlinePct}%
            </span>
          ) : null}
          {adviceComplement?.capture.capturePct != null ? (
            <span
              className="rounded-md border border-sky-300/70 bg-sky-50/90 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200"
              title={t("testerMonitor.decisionSim.kpi.captureVsRecsTip")}
            >
              {t("testerMonitor.decisionSim.kpi.captureVsRecs")}:{" "}
              {formatCapturePct(adviceComplement.capture.capturePct)}
            </span>
          ) : null}
          {adviceComplement && adviceComplement.closedPnl.dealCount > 0 ? (
            <span
              className="rounded-md border border-violet-300/70 bg-violet-50/90 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-violet-900 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-200"
              title={t("testerMonitor.decisionSim.kpi.closedPnlSuccessTip")}
            >
              {t("testerMonitor.decisionSim.kpi.closedPnlSuccess")}:{" "}
              {adviceComplement.closedPnl.winRatePct != null
                ? `${adviceComplement.closedPnl.winRatePct}%`
                : "—"}
            </span>
          ) : null}
          {adviceComplement?.paperReturn.returnPct != null ? (
            <span
              className="rounded-md border border-teal-300/70 bg-teal-50/90 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-teal-900 dark:border-teal-500/40 dark:bg-teal-950/40 dark:text-teal-200"
              title={t("testerMonitor.decisionSim.kpi.paperBookReturnTip")}
            >
              {t("testerMonitor.decisionSim.kpi.paperBookReturn")}:{" "}
              {adviceComplement.paperReturn.returnPct >= 0 ? "+" : ""}
              {adviceComplement.paperReturn.returnPct}%
            </span>
          ) : null}
        </div>
        {!compact ? (
          <p className="tester-monitor-muted text-[9px] mt-0.5 leading-snug max-w-[640px]">
            {t("testerMonitor.decisionSim.adviceCalib.sub")}
            {adviceComplement ? (
              <>
                {" "}
                {t("testerMonitor.decisionSim.adviceCalib.complementNote")}
              </>
            ) : null}
          </p>
        ) : null}
        {updatedAt ? (
          <DashboardPanelUpdatedLabel updatedAt={updatedAt} className="!text-[9px]" />
        ) : null}

        {/* Learning loop control bar — actions always visible; status + chips +
            sell warning collapse to save vertical space. */}
        {summary.scoredCount > 0 ? (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onApplyLearnings}
                disabled={!hasPendingFeedback}
                title={t("adviceLearning.feedback.applyBtnTip")}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition border ${
                  hasPendingFeedback
                    ? "border-indigo-300/70 bg-indigo-50/90 text-indigo-900 hover:bg-indigo-100/90 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-200"
                    : "border-slate-200/70 bg-slate-50/70 text-ink-muted cursor-not-allowed"
                }`}
              >
                {t("adviceLearning.feedback.applyBtn")}
                {hasPendingFeedback ? (
                  <span className="ml-1 text-[9px] font-normal opacity-80">
                    ({pendingFeedback.bucketCorrections.size}b · {pendingFeedback.actionDemotions.size}a)
                  </span>
                ) : null}
              </button>
              {hasStoredFeedback ? (
                <button
                  type="button"
                  onClick={onClearLearnings}
                  title={t("adviceLearning.feedback.clearBtnTip")}
                  className="rounded-md border border-rose-200/70 bg-rose-50/70 px-2.5 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-100/70 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300 transition"
                >
                  {t("adviceLearning.feedback.clearBtn")}
                </button>
              ) : null}
            </div>

            <details
              className="tester-monitor-panel-soft rounded-lg px-2 py-1.5"
              open={insightsOpen}
              onToggle={onInsightsToggle}
            >
              <summary className="text-[10px] font-semibold cursor-pointer text-ink select-none list-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="text-[9px] opacity-60">
                    {insightsOpen ? "▾" : "▸"}
                  </span>
                  {t("adviceLearning.feedback.insightsSummary")}
                  {hasStoredFeedback && storedFeedback ? (
                    <span className="font-normal text-indigo-700 dark:text-indigo-300">
                      · {storedFeedback.bucketCorrections.size}b ·{" "}
                      {storedFeedback.actionDemotions.size}a
                    </span>
                  ) : null}
                  {sellStats.bad >= 3 && sellStats.bad > sellStats.good ? (
                    <span className="font-normal text-rose-700 dark:text-rose-300">
                      · SELL {sellStats.good}✓/{sellStats.bad}✗
                    </span>
                  ) : null}
                </span>
              </summary>

              <div className="mt-1.5 space-y-1.5">
                <span
                  className={`block text-[10px] leading-snug ${
                    hasStoredFeedback ? "text-indigo-700 dark:text-indigo-300" : "text-ink-muted"
                  }`}
                >
                  {hasStoredFeedback && storedFeedback
                    ? t("adviceLearning.feedback.statusActive", {
                        buckets: storedFeedback.bucketCorrections.size,
                        demotions: storedFeedback.actionDemotions.size,
                        when: lastAppliedLabel ?? "—",
                      })
                    : hasPendingFeedback
                      ? t("adviceLearning.feedback.statusIdle")
                      : t("adviceLearning.feedback.statusInsufficient")}
                </span>

                <div className={`flex flex-wrap gap-1.5 ${compact ? "text-[9px]" : "text-[10px]"}`}>
                  <span className="rounded-md border border-amber-200/80 bg-amber-50/80 px-1.5 py-0.5 tabular-nums">
                    {t("testerMonitor.decisionSim.adviceCalib.lowProbBand", {
                      n: summary.lowProb.count,
                      good: summary.lowProb.good,
                      bad: summary.lowProb.bad,
                      rate: summary.lowProb.successRatePct != null ? `${summary.lowProb.successRatePct}%` : "—",
                    })}
                  </span>
                  <span className="rounded-md border border-emerald-200/80 bg-emerald-50/80 px-1.5 py-0.5 tabular-nums">
                    {t("testerMonitor.decisionSim.adviceCalib.highProbBand", {
                      n: summary.highProb.count,
                      good: summary.highProb.good,
                      bad: summary.highProb.bad,
                      rate: summary.highProb.successRatePct != null ? `${summary.highProb.successRatePct}%` : "—",
                    })}
                  </span>
                  {buyStats.scored > 0 ? (
                    <span
                      className={`rounded-md border px-1.5 py-0.5 tabular-nums ${
                        buyStats.accuracyPct != null && buyStats.accuracyPct < 50
                          ? "border-rose-300/80 bg-rose-50/80 text-rose-900 font-semibold"
                          : "border-emerald-200/80 bg-emerald-50/80"
                      }`}
                      title={
                        it
                          ? "BUY paper valutati a 24h. ✓ = titolo salito ≥ +0.5 %, ✗ = sceso ≤ −0.5 %."
                          : "BUY paper trades scored over 24h. ✓ = stock rose ≥ +0.5 %, ✗ = fell ≤ −0.5 %."
                      }
                    >
                      {it ? "BUY" : "BUY"}: {buyStats.scored} · {buyStats.good}✓ / {buyStats.bad}✗
                      {buyStats.accuracyPct != null ? ` · ${buyStats.accuracyPct.toFixed(1)}%` : ""}
                    </span>
                  ) : null}
                  {sellStats.scored > 0 ? (
                    <span
                      className={`rounded-md border px-1.5 py-0.5 tabular-nums ${
                        sellStats.bad > sellStats.good
                          ? "border-rose-400/80 bg-rose-100/80 text-rose-900 font-semibold"
                          : sellStats.bad > 0
                            ? "border-rose-200/80 bg-rose-50/70 text-rose-800"
                            : "border-emerald-200/80 bg-emerald-50/80"
                      }`}
                      title={
                        it
                          ? "SELL paper valutati a 24h dopo la vendita. ✓ = titolo sceso ≥ −0.5 %, ✗ = salito ≥ +0.5 % (vendita prematura). Numero medio = di quanto è salito il titolo dopo che abbiamo venduto sui casi ✗."
                          : "SELL paper trades scored over 24h after sell. ✓ = stock fell ≥ −0.5 %, ✗ = rose ≥ +0.5 % (premature exit). Avg = how much the stock rose after we sold, across ✗ cases."
                      }
                    >
                      {it ? "SELL" : "SELL"}: {sellStats.scored} · {sellStats.good}✓ / {sellStats.bad}✗
                      {sellStats.accuracyPct != null ? ` · ${sellStats.accuracyPct.toFixed(1)}%` : ""}
                      {sellStats.bad > 0 && sellStats.avgRisePct != null
                        ? it
                          ? ` · ↑+${sellStats.avgRisePct}% media dopo`
                          : ` · ↑+${sellStats.avgRisePct}% avg after`
                        : ""}
                    </span>
                  ) : null}
                  {summary.pendingCount > 0 ? (
                    <span className="rounded-md border border-slate-200/80 bg-slate-50/80 px-1.5 py-0.5 text-ink-muted">
                      {t("testerMonitor.decisionSim.adviceCalib.pending", { n: summary.pendingCount })}
                    </span>
                  ) : null}
                </div>

                {sellStats.bad >= 3 && sellStats.bad > sellStats.good ? (
                  <div className="rounded-md border border-rose-300/80 bg-rose-50/70 dark:bg-rose-950/30 px-2.5 py-1.5 text-[10px] leading-snug text-rose-900 dark:text-rose-100">
                    <p className="font-semibold">
                      {it
                        ? `⚠ ${sellStats.bad}/${sellStats.scored} vendite paper sono andate sbagliate: il titolo è salito di +${sellStats.avgRisePct ?? 0}% in media nelle 24h dopo la vendita${sellStats.worstTicker && sellStats.worstRisePct != null ? ` (peggior caso: ${sellStats.worstTicker} +${sellStats.worstRisePct.toFixed(1)}%)` : ""}.`
                        : `⚠ ${sellStats.bad}/${sellStats.scored} paper sells went wrong: the stock rose +${sellStats.avgRisePct ?? 0}% on average in the 24h after the sell${sellStats.worstTicker && sellStats.worstRisePct != null ? ` (worst: ${sellStats.worstTicker} +${sellStats.worstRisePct.toFixed(1)}%)` : ""}.`}
                    </p>
                    <p className="mt-0.5 text-rose-800/90 dark:text-rose-200/90">
                      {it
                        ? "Il sim loop vende quando exitDecision = exit e la curva non sta salendo. Soglie chiave da rivedere: curveRisingHold, RECOVERY_HOLD_PROB_MIN (=55), e momentum 24h prima del sell. Apri la lista 'Bad advice ✗ — what went wrong' qui sotto per il root-cause per-ticker."
                        : "The sim loop sells when exitDecision = exit and the curve isn't rising. Tunable knobs: curveRisingHold, RECOVERY_HOLD_PROB_MIN (=55), and 24h momentum before the sell. Open the 'Bad advice ✗ — what went wrong' list below for the per-ticker root cause."}
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}
      </div>

      {hasData ? (
        <div className="flex flex-wrap items-center justify-between gap-2 -mb-0.5">
          <p className="text-[9px] leading-snug text-ink-muted max-w-[640px]">
            {it
              ? "Asse Y = errore previsione % (mossa reale − mossa attesa). Sopra zero = ha sorpreso in meglio · sotto zero = ha deluso · linea gialla = stima perfetta."
              : "Y axis = forecast error % (actual move − expected move). Above zero = beat the forecast · below zero = missed · yellow line = perfect prediction."}
          </p>
          <div
            role="group"
            aria-label={it ? "Finestra errore" : "Error horizon"}
            className="inline-flex shrink-0 rounded-md border border-slate-300/70 bg-white/80 p-0.5 text-[9px] font-semibold dark:border-slate-600/60 dark:bg-slate-900/50"
          >
            <button
              type="button"
              onClick={() => setErrorHorizon("24h")}
              aria-pressed={errorHorizon === "24h"}
              title={
                it
                  ? "Mossa reale del titolo nelle 24h dopo il consiglio (default)."
                  : "Stock move in the 24h after the advice (default)."
              }
              className={`px-2 py-0.5 rounded transition ${
                errorHorizon === "24h"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              24h
            </button>
            <button
              type="button"
              onClick={() => setErrorHorizon("cumulative")}
              aria-pressed={errorHorizon === "cumulative"}
              disabled={cumulativeAvailableCount === 0}
              title={
                it
                  ? "P&L cumulato dall'apertura per le posizioni effettivamente tenute in portafoglio."
                  : "Cumulative P&L since entry for positions actually held in the portfolio."
              }
              className={`px-2 py-0.5 rounded transition ${
                errorHorizon === "cumulative"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : cumulativeAvailableCount === 0
                    ? "text-ink-muted/50 cursor-not-allowed"
                    : "text-ink-muted hover:text-ink"
              }`}
            >
              {it ? "Cumulativo" : "Cumulative"}
              {cumulativeAvailableCount > 0 ? (
                <span className="ml-1 opacity-70 font-normal">({cumulativeAvailableCount})</span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}
      </div>

      {hasData ? (
        <div className="space-y-1 shrink-0">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart margin={{ top: 4, right: 8, bottom: compact ? 16 : 20, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                tick={{ fontSize: 8 }}
                tickFormatter={(v) => `${v}%`}
                label={
                  compact
                    ? undefined
                    : {
                        value: t("testerMonitor.decisionSim.adviceCalib.xAxis"),
                        position: "insideBottom",
                        offset: -4,
                        style: { fontSize: 9, fill: "#64748b", fontWeight: 500 },
                      }
                }
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                tick={{ fontSize: 8 }}
                tickFormatter={(v) => fmtSignedPct(v)}
                width={44}
                label={
                  compact
                    ? undefined
                    : {
                        value: it
                          ? "Errore % (reale − attesa)"
                          : "Error % (actual − expected)",
                        angle: -90,
                        position: "insideLeft",
                        offset: 4,
                        style: { fontSize: 9, fill: "#64748b", fontWeight: 500 },
                      }
                }
              />
              <ZAxis type="number" range={[64, 64]} />
              <Tooltip content={<DotTooltip it={it} />} cursor={{ strokeDasharray: "3 3" }} />
              {/* Faintly tint the "+" and "−" error zones so the split between
                  "beat forecast" (top) and "missed forecast" (bottom) is obvious. */}
              <ReferenceArea
                y1={0}
                y2={yDomain[1]}
                fill="#10b981"
                fillOpacity={0.05}
                ifOverflow="visible"
              />
              <ReferenceArea
                y1={yDomain[0]}
                y2={0}
                fill="#f43f5e"
                fillOpacity={0.05}
                ifOverflow="visible"
              />
              <ReferenceLine
                y={0}
                stroke="#eab308"
                strokeWidth={2}
                label={{
                  value: it ? "Stima perfetta" : "Perfect prediction",
                  position: "insideTopRight",
                  fill: "#a16207",
                  fontSize: 9,
                  fontWeight: 600,
                }}
              />
              <Scatter
                data={scatterData}
                fill="#22c55e"
                fillOpacity={0.9}
                legendType="none"
                shape={(props: { cx?: number; cy?: number; payload?: AdviceForecastErrorDot }) => (
                  <AdviceCalibScatterDot {...props} />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartLegend it={it} compact={compact} />
        </div>
      ) : (
        <p className="tester-monitor-muted text-[10px] py-4 text-center leading-relaxed">
          {t("testerMonitor.decisionSim.adviceCalib.empty")}
        </p>
      )}

      {/* Trailing collapsibles wrapped in a `mt-auto` footer so they sit
          flush at the bottom of the panel. This is what lets the left
          ("Bad advice ✗ — what went wrong") and the right panel's
          ("Sim loop open positions still maturing") summaries line up at
          the same Y line, even when the pre-chart content above differs
          in height between the two cards. */}
      <div className={`mt-auto shrink-0 ${compact ? "space-y-1.5" : "space-y-2"}`}>
        {badAdviceRows.length > 0 ? (
          <details
            className="tester-monitor-panel-soft rounded-lg px-2 py-1.5"
            open={badAdviceOpen}
            onToggle={onBadAdviceToggle}
          >
            <summary className="text-[10px] font-semibold cursor-pointer text-rose-700">
              {t("testerMonitor.decisionSim.adviceCalib.badAdviceList", { n: badAdviceRows.length })}
            </summary>
            <AdviceCalibDetailTable rows={badAdviceRows} monitorByKey={monitorByKey} it={it} />
          </details>
        ) : null}

        {!compact && lowProbRows.length > 0 ? (
          <details className="tester-monitor-panel-soft rounded-lg px-2.5 py-2">
            <summary className="text-[10px] font-semibold cursor-pointer">
              {t("testerMonitor.decisionSim.adviceCalib.lowProbList", { n: lowProbRows.length })}
            </summary>
            <AdviceCalibDetailTable rows={lowProbRows} monitorByKey={monitorByKey} it={it} />
          </details>
        ) : null}
      </div>
    </div>
  );
}
