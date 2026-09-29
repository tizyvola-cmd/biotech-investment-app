import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ADVICE_LEARNING_HISTORY_CHANGED_EVENT,
  ADVICE_RECALCULATE_REQUEST_EVENT,
  clearAdviceLearningHistory,
  loadAdviceLearningHistory,
  type AdviceLearningSnapshot,
} from "../sheet/adviceLearningHistory";
import {
  assessAdviceTimelineQuality,
  ADVICE_TIMELINE_MIN_BUY_FOR_TREND,
  ADVICE_TIMELINE_MIN_SELL_FOR_TREND,
} from "../sheet/adviceLearningTimelineQuality";
import { useT } from "../shared/i18n";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";

type ChartPoint = AdviceLearningSnapshot & {
  idx: number;
  label: string;
  /** Diamond marker for manual checkpoints — null elsewhere (keeps Scatter on main series). */
  manualMarker: number | null;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function dayLabel(day: string): string {
  // YYYY-MM-DD → DD MMM
  if (!day || day.length < 10) return day;
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
}

function trendDeltaPp(snaps: AdviceLearningSnapshot[], field: keyof AdviceLearningSnapshot): number | null {
  const valid = snaps
    .map((s) => Number(s[field]))
    .filter((v) => Number.isFinite(v));
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  return Math.round((last - first) * 10) / 10;
}

function trendChipClass(positive: boolean): string {
  return positive
    ? "border-emerald-300/70 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "border-rose-300/70 bg-rose-50/70 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300";
}

function TrendDeltaChip({
  label,
  delta,
  show,
  title,
  className,
}: {
  label: string;
  delta: number | null;
  show: boolean;
  title: string;
  className?: string;
}) {
  if (delta == null || !show) return null;
  return (
    <span
      className={`rounded-md border px-2 py-1 tabular-nums ${trendChipClass(delta >= 0)} ${className ?? ""}`}
      title={title}
    >
      {label}{" "}
      <span className="font-semibold">
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)} pp
      </span>
    </span>
  );
}

function resolveTooltipRow(payload?: { payload?: ChartPoint; dataKey?: string | number }[]): ChartPoint | null {
  if (!payload?.length) return null;
  const fromLine = payload.find(
    (p) => p.dataKey === "buySuccessRatePct" && p.payload?.day,
  )?.payload;
  if (fromLine) return fromLine;
  const any = payload.find((p) => p.payload?.day)?.payload;
  return any ?? payload[0]?.payload ?? null;
}

function TooltipBox({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload?: ChartPoint; dataKey?: string | number }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = resolveTooltipRow(payload);
  if (!row) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5 dark:bg-slate-900 dark:border-slate-700">
      <p className="font-semibold">
        {row.label}
        {row.manual ? (
          <span className="ml-1 text-[8px] uppercase tracking-wide text-indigo-600">
            {it ? "checkpoint manuale" : "manual checkpoint"}
          </span>
        ) : null}
      </p>
      <p>
        <span className="text-ink-muted">{it ? "BUY (24h):" : "BUY (24h):"}</span>{" "}
        <span className="font-semibold text-teal-700 dark:text-teal-300">
          {fmtPct(row.buySuccessRatePct)}
        </span>
        <span className="text-ink-muted"> · n={row.buyScored ?? 0}</span>
        <span className="block text-[9px] text-ink-muted/90 mt-0.5">
          {it ? "✓ se prezzo ≥ +0,5% entro 24h" : "✓ if price ≥ +0.5% within 24h"}
        </span>
      </p>
      <p>
        <span className="text-ink-muted">{it ? "SELL (24h):" : "SELL (24h):"}</span>{" "}
        <span className="font-semibold text-rose-700 dark:text-rose-300">
          {fmtPct(row.sellSuccessRatePct ?? null)}
        </span>
        <span className="text-ink-muted"> · n={row.sellScored ?? 0}</span>
        <span className="block text-[9px] text-ink-muted/90 mt-0.5">
          {it
            ? "✓ se prezzo ≤ −0,5% entro 24h (anticipo ribasso)"
            : "✓ if price ≤ −0.5% within 24h (decline anticipated)"}
        </span>
      </p>
      {row.bucketCorrectionsActive > 0 || row.actionDemotionsActive > 0 ? (
        <p className="text-indigo-700 dark:text-indigo-300 pt-0.5 border-t border-slate-100/80">
          {it ? "Correzioni attive:" : "Active corrections:"}{" "}
          <span className="font-semibold">
            {row.bucketCorrectionsActive} {it ? "bucket" : "bucket(s)"} ·{" "}
            {row.actionDemotionsActive} {it ? "azioni" : "actions"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function AdviceLearningTimelinePanel({
  lang,
  className,
}: {
  lang: "it" | "en";
  className?: string;
}) {
  const t = useT();
  const it = lang === "it";
  const [history, setHistory] = useState(() => loadAdviceLearningHistory());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setHistory(loadAdviceLearningHistory());
    window.addEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
  }, []);

  const snaps = history.snapshots;
  const chartData = useMemo<ChartPoint[]>(
    () =>
      snaps.map((s, idx) => ({
        ...s,
        idx,
        label: dayLabel(s.day),
        manualMarker:
          s.manual && (s.buySuccessRatePct != null || s.sellSuccessRatePct != null)
            ? (s.buySuccessRatePct ?? s.sellSuccessRatePct ?? null)
            : null,
      })),
    [snaps],
  );

  const buyTrend = useMemo(() => trendDeltaPp(snaps, "buySuccessRatePct"), [snaps]);
  const sellTrend = useMemo(() => trendDeltaPp(snaps, "sellSuccessRatePct"), [snaps]);

  const latest = snaps[snaps.length - 1] ?? null;
  const first = snaps[0] ?? null;
  const quality = useMemo(() => assessAdviceTimelineQuality(snaps), [snaps]);

  const anyTrendHidden =
    (buyTrend != null && !quality.showBuyTrend) ||
    (sellTrend != null && !quality.showSellTrend);

  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 100];
    const values: number[] = [];
    for (const p of chartData) {
      if (p.buySuccessRatePct != null) values.push(p.buySuccessRatePct);
      if (p.sellSuccessRatePct != null) values.push(p.sellSuccessRatePct);
    }
    if (values.length === 0) return [0, 100];
    const minV = Math.max(0, Math.floor(Math.min(...values) - 5));
    const maxV = Math.min(100, Math.ceil(Math.max(...values) + 5));
    if (maxV - minV < 30) return [Math.max(0, minV - 10), Math.min(100, maxV + 10)];
    return [minV, maxV];
  }, [chartData]);

  const onResetClick = () => {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm(
      it
        ? "Cancellare lo storico di apprendimento? L'azione non è reversibile."
        : "Clear the learning history? This cannot be undone.",
    );
    if (!confirmed) return;
    clearAdviceLearningHistory();
    setHistory(loadAdviceLearningHistory());
  };

  const onRecalculateClick = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(ADVICE_RECALCULATE_REQUEST_EVENT));
  };

  const showChart = chartData.length >= 1;
  const singleCheckpoint = chartData.length === 1;
  const xDomain: [number, number] | ["dataMin", "dataMax"] = singleCheckpoint
    ? [-0.5, 0.5]
    : ["dataMin", "dataMax"];

  return (
    <div
      className={
        className ??
        "rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 dark:bg-slate-900/40 p-4 space-y-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">
            {t("adviceLearning.timeline.title")}
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug max-w-[680px]">
            {t("adviceLearning.timeline.lead")}
          </p>
          {latest?.ts ? (
            <DashboardPanelUpdatedLabel updatedAt={latest.ts} className="!text-[9px] mt-0.5" />
          ) : null}
        </div>
        {snaps.length > 0 ? (
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={onRecalculateClick}
              className="rounded-md border border-indigo-200/70 bg-indigo-50/70 px-2.5 py-1 text-[10px] font-medium text-indigo-800 hover:bg-indigo-100/70 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-200 transition"
              title={
                it
                  ? "Ricalcola correzioni bucket e aggiorna il checkpoint di oggi (lo storico resta)"
                  : "Recalculate bucket corrections and update today's checkpoint (history kept)"
              }
            >
              {t("adviceLearning.timeline.recalculate")}
            </button>
            <button
              type="button"
              onClick={onResetClick}
              className="rounded-md border border-rose-200/70 bg-rose-50/70 px-2.5 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-100/70 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300 transition"
              title={it ? "Cancella lo storico (irreversibile)" : "Clear history (irreversible)"}
            >
              {t("adviceLearning.timeline.reset")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRecalculateClick}
            className="rounded-md border border-indigo-200/70 bg-indigo-50/70 px-2.5 py-1 text-[10px] font-medium text-indigo-800 hover:bg-indigo-100/70 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-200 transition shrink-0"
          >
            {t("adviceLearning.timeline.recalculate")}
          </button>
        )}
      </div>

      {quality.showLowSampleBanner && latest ? (
        <div className="rounded-md border border-amber-300/55 bg-amber-50/65 dark:bg-amber-950/25 dark:border-amber-800/45 px-3 py-2 space-y-1">
          <p className="text-[11px] font-semibold text-amber-950 dark:text-amber-100">
            {t("adviceLearning.timeline.lowSampleBannerTitle")}
          </p>
          <p className="text-[10px] text-amber-900/90 dark:text-amber-200/90 leading-snug">
            {t("adviceLearning.timeline.cumulativeNote")}
          </p>
          <ul className="text-[10px] text-amber-900/90 dark:text-amber-200/90 leading-snug list-disc pl-4 space-y-0.5">
            {quality.staleCheckpoint && quality.daysSinceLatest != null ? (
              <li>
                {t("adviceLearning.timeline.staleLine", {
                  days: String(quality.daysSinceLatest),
                })}
              </li>
            ) : null}
            {quality.buyLowSample ? (
              <li>
                {t("adviceLearning.timeline.buyLowLine", {
                  n: String(latest.buyScored ?? 0),
                  min: String(ADVICE_TIMELINE_MIN_BUY_FOR_TREND),
                })}
              </li>
            ) : null}
            {quality.sellLowSample ? (
              <li>
                {t("adviceLearning.timeline.sellLowLine", {
                  n: String(latest.sellScored ?? 0),
                  min: String(ADVICE_TIMELINE_MIN_SELL_FOR_TREND),
                })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {snaps.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-md border border-indigo-200/70 bg-indigo-50/70 px-2 py-1 tabular-nums dark:border-indigo-900/40 dark:bg-indigo-950/40">
            <span className="text-ink-muted">{it ? "Checkpoint:" : "Checkpoints:"}</span>{" "}
            <span className="font-semibold">{snaps.length}</span>
          </span>
          {first && latest ? (
            <span className="rounded-md border border-slate-200/70 bg-slate-50/70 px-2 py-1 tabular-nums dark:border-slate-700/60 dark:bg-slate-800/40">
              <span className="text-ink-muted">{it ? "Periodo:" : "Period:"}</span>{" "}
              <span className="font-semibold">
                {dayLabel(first.day)} → {dayLabel(latest.day)}
              </span>
            </span>
          ) : null}
          {buyTrend != null ? (
            <TrendDeltaChip
              label="Δ BUY"
              delta={buyTrend}
              show={quality.showBuyTrend}
              className={
                buyTrend >= 0
                  ? "!border-teal-300/70 !bg-teal-50/70 !text-teal-800 dark:!border-teal-900/40 dark:!bg-teal-950/40 dark:!text-teal-300"
                  : undefined
              }
              title={
                it
                  ? `Δ successo BUY (n≥${ADVICE_TIMELINE_MIN_BUY_FOR_TREND} all'ultimo checkpoint)`
                  : `BUY success Δ (n≥${ADVICE_TIMELINE_MIN_BUY_FOR_TREND} at latest checkpoint)`
              }
            />
          ) : null}
          {sellTrend != null ? (
            <TrendDeltaChip
              label="Δ SELL"
              delta={sellTrend}
              show={quality.showSellTrend}
              className={
                sellTrend >= 0
                  ? "!border-rose-300/70 !bg-rose-50/70 !text-rose-800 dark:!border-rose-900/40 dark:!bg-rose-950/40 dark:!text-rose-300"
                  : undefined
              }
              title={
                it
                  ? `Δ successo SELL (n≥${ADVICE_TIMELINE_MIN_SELL_FOR_TREND} all'ultimo checkpoint)`
                  : `SELL success Δ (n≥${ADVICE_TIMELINE_MIN_SELL_FOR_TREND} at latest checkpoint)`
              }
            />
          ) : null}
          {latest?.buySuccessRatePct != null ? (
            <span className="rounded-md border border-teal-300/70 bg-teal-50/70 px-2 py-1 tabular-nums text-teal-900 dark:border-teal-900/40 dark:bg-teal-950/40 dark:text-teal-200">
              {it ? "BUY attuale:" : "Latest BUY:"}{" "}
              <span className="font-semibold">{latest.buySuccessRatePct.toFixed(1)}%</span>
              <span className="text-ink-muted"> · n={latest.buyScored}</span>
            </span>
          ) : null}
          {latest?.sellSuccessRatePct != null ? (
            <span className="rounded-md border border-rose-300/70 bg-rose-50/70 px-2 py-1 tabular-nums text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {it ? "SELL attuale:" : "Latest SELL:"}{" "}
              <span className="font-semibold">{latest.sellSuccessRatePct.toFixed(1)}%</span>
              <span className="text-ink-muted"> · n={latest.sellScored ?? 0}</span>
            </span>
          ) : null}
          {latest && (latest.bucketCorrectionsActive > 0 || latest.actionDemotionsActive > 0) ? (
            <span
              className="rounded-md border border-violet-300/70 bg-violet-50/70 px-2 py-1 tabular-nums text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-200"
              title={
                it
                  ? "Numero di correzioni e declassamenti attivi al checkpoint più recente"
                  : "Active corrections and demotions at the latest checkpoint"
              }
            >
              {it ? "Correzioni attive:" : "Active corrections:"}{" "}
              <span className="font-semibold">
                {latest.bucketCorrectionsActive} bucket · {latest.actionDemotionsActive}{" "}
                {it ? "azioni" : "actions"}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
      {anyTrendHidden ? (
        <p className="text-[9px] text-ink-muted leading-snug -mt-1">
          {t("adviceLearning.timeline.hiddenDeltasHint")}
        </p>
      ) : null}

      {showChart ? (
        <div className="space-y-1">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
              <XAxis
                dataKey="idx"
                type="number"
                domain={xDomain}
                tick={{ fontSize: 10 }}
                tickFormatter={(idx) => chartData[Number(idx)]?.label ?? ""}
                interval="preserveStartEnd"
                minTickGap={24}
                allowDecimals={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={yDomain}
                tickFormatter={(v) => `${Math.round(Number(v))}%`}
                width={42}
              />
              <Tooltip
                content={<TooltipBox it={it} />}
                shared
                isAnimationActive={false}
              />
              <ReferenceLine y={50} stroke="rgba(148, 163, 184, 0.5)" strokeDasharray="4 4" />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconType="line"
              />
              <Line
                type="monotone"
                dataKey="buySuccessRatePct"
                name={it ? "BUY (24h)" : "BUY (24h)"}
                stroke="#0d9488"
                strokeWidth={2.2}
                dot={{ r: 2.5, stroke: "#0d9488", fill: "#0d9488" }}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="sellSuccessRatePct"
                name={it ? "SELL (24h)" : "SELL (24h)"}
                stroke="#be123c"
                strokeWidth={2.2}
                dot={{ r: 2.5, stroke: "#be123c", fill: "#be123c" }}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
              <Scatter
                name={it ? "Apply learnings" : "Apply learnings"}
                dataKey="manualMarker"
                fill="#a855f7"
                shape="diamond"
                legendType="diamond"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[9px] text-ink-muted leading-snug">
            {t("adviceLearning.timeline.legendHint")}
          </p>
          {singleCheckpoint ? (
            <p className="text-[10px] text-ink-muted/90 text-center leading-snug">
              {t("adviceLearning.timeline.notEnough")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300/60 bg-slate-50/60 dark:border-slate-700/60 dark:bg-slate-800/40 p-4 text-[11px] text-ink-muted text-center">
          {t("adviceLearning.timeline.empty")}
        </div>
      )}
    </div>
  );
}
