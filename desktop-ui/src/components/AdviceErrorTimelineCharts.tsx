import { useMemo, useState, type ReactNode } from "react";
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
} from "recharts";
import type { AdviceCalibrationPoint } from "../sheet/investDecisionSimAdviceCalibration";
import {
  filterAdviceCalibrationByUniverse,
  type AdviceErrorUniverseView,
} from "../sheet/investDecisionSimAdviceCalibration";
import { stabilizeAdviceErrorYDomain } from "../sheet/adviceCalibrationStability";
import type { AdviceActionKind } from "../sheet/investDecisionSimAdviceCalibration";
import {
  ADVICE_ACTIONS,
  buildAdviceBuySellHorizonDots,
  buildAdviceErrorActionDots,
  buildAdviceErrorTimeDots,
  filterAdvicePointsByActions,
  type AdviceErrorDotPoint,
  type AdviceErrorHorizon,
} from "../sheet/adviceErrorTimelineCharts";
import { AdviceCalibScatterDot, BuySellErrorScatterDot, CriticalMissSellLegendDot, SecondaryErrorLegendDot } from "./adviceChartMarkers";
import { adviceErrorTimelineBlockMinHeight } from "./decisionSimChartLayout";

const ACTION_META: Record<
  AdviceActionKind,
  { labelIt: string; labelEn: string; color: string }
> = {
  buy: { labelIt: "BUY", labelEn: "BUY", color: "#16a34a" },
  sell: { labelIt: "SELL", labelEn: "SELL", color: "#dc2626" },
  hold: { labelIt: "HOLD", labelEn: "HOLD", color: "#2563eb" },
  review: { labelIt: "INCERTO", labelEn: "UNCERTAIN", color: "#ea580c" },
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function ChartShell({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div className="w-full shrink-0 overflow-hidden" style={{ height, minHeight: height }}>
      {children}
    </div>
  );
}

function DotTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload: AdviceErrorDotPoint }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md dark:bg-slate-900 dark:border-slate-700 space-y-0.5">
      <p className="font-semibold">
        {row.ticker} · {row.xLabel}
      </p>
      <p className={row.signedErrorPct >= 0 ? "text-emerald-700" : "text-rose-700"}>
        {it ? "Movimento titolo" : "Stock move"}: {fmtPct(row.signedErrorPct)}
      </p>
      {row.visualClass === "criticalMissSell" ? (
        <p className="text-rose-700 font-medium">
          {it ? "Miss SELL · titolo sceso" : "Miss SELL · stock dropped"}
          {row.missSellLossTier
            ? ` · ${it ? "gravità" : "severity"} ${row.missSellLossTier}/4`
            : ""}
        </p>
      ) : (
        <p className="text-ink-muted">{errorKindCaption(row, it) ?? row.suggestedAction.toUpperCase()}</p>
      )}
      <p className={row.outcome === "good" ? "text-emerald-600" : "text-rose-600"}>
        {row.outcome === "good" ? "✓" : "✗"} {it ? "esito" : "outcome"}
      </p>
    </div>
  );
}

function SignedErrorDotChart({
  dots,
  xDomain,
  xTicks,
  xTickFormatter,
  yDomain,
  it,
  height,
  marker = "legacy",
  hideXAxis = false,
}: {
  dots: AdviceErrorDotPoint[];
  xDomain: [number, number];
  xTicks: number[];
  xTickFormatter: (v: number) => string;
  yDomain: [number, number];
  it: boolean;
  height: number;
  marker?: "legacy" | "buySell";
  hideXAxis?: boolean;
}) {
  return (
    <ChartShell height={height}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 4, right: 4, bottom: hideXAxis ? 0 : 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {!hideXAxis ? (
            <XAxis
              type="number"
              dataKey="x"
              domain={xDomain}
              ticks={xTicks}
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 7 }}
            />
          ) : (
            <XAxis type="number" dataKey="x" domain={xDomain} hide tick={false} axisLine={false} />
          )}
          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain}
            tick={{ fontSize: 7 }}
            width={34}
            tickFormatter={(v) => fmtPct(v)}
          />
          <Tooltip content={<DotTooltip it={it} />} cursor={false} />
          <ReferenceArea y1={0} y2={yDomain[1]} fill="#10b981" fillOpacity={0.06} ifOverflow="visible" />
          <ReferenceArea y1={yDomain[0]} y2={0} fill="#f43f5e" fillOpacity={0.06} ifOverflow="visible" />
          <ReferenceLine y={0} stroke="#eab308" strokeWidth={2} strokeDasharray="4 4" />
          <Scatter
            data={dots}
            dataKey="y"
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number; payload?: AdviceErrorDotPoint }) =>
              marker === "buySell" ? (
                <BuySellErrorScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
              ) : (
                <AdviceCalibScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
              )
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function symmetricYDomain(dots: AdviceErrorDotPoint[]): [number, number] {
  if (!dots.length) return [-12, 12];
  const maxAbs = Math.max(...dots.map((d) => Math.abs(d.y)), 3);
  const pad = Math.ceil(maxAbs * 1.2);
  return [-pad, pad];
}

export type AdviceErrorChartModel = {
  stableYDomain: [number, number];
  timeDots: AdviceErrorDotPoint[];
  actionDots: AdviceErrorDotPoint[];
  timeXDomain: [number, number];
  timeTicks: number[];
  timeTickFormatter: (v: number) => string;
  actionXDomain: [number, number];
  actionTicks: number[];
  actionTickFormatter: (v: number) => string;
  timeWeekKeys: string[];
  hasTime: boolean;
  hasAction: boolean;
};

export function useAdviceErrorChartModel(
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
  actions: ReadonlySet<AdviceActionKind>,
): AdviceErrorChartModel {
  const it = lang === "it";

  const filtered = useMemo(
    () => filterAdvicePointsByActions(points, actions),
    [points, actions],
  );

  const stableYDomain = useMemo(() => {
    const allTime = buildAdviceErrorTimeDots(points, lang);
    const allAction = buildAdviceErrorActionDots(points);
    return symmetricYDomain([...allTime, ...allAction]);
  }, [points, lang]);

  const timeDots = useMemo(
    () => buildAdviceErrorTimeDots(filtered, lang),
    [filtered, lang],
  );

  const actionBuckets = useMemo(
    () =>
      ADVICE_ACTIONS.filter((a) => actions.has(a)).map((action, xIndex) => ({
        action,
        xIndex,
        label: it ? ACTION_META[action].labelIt : ACTION_META[action].labelEn,
      })),
    [actions, it],
  );

  const actionDots = useMemo(() => {
    const indexByAction = new Map(actionBuckets.map((b) => [b.action, b.xIndex]));
    return buildAdviceErrorActionDots(filtered)
      .filter((d) => actions.has(d.suggestedAction))
      .map((d) => {
        const base = indexByAction.get(d.suggestedAction) ?? 0;
        const jitter = d.x - ADVICE_ACTIONS.indexOf(d.suggestedAction);
        return { ...d, x: base + jitter };
      });
  }, [filtered, actions, actionBuckets]);

  const timeWeekKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of timeDots) keys.add(d.xLabel);
    return [...keys];
  }, [timeDots]);

  const timeXDomain = useMemo((): [number, number] => {
    if (timeDots.length <= 1) return [-0.45, 0.45];
    const maxIdx = Math.max(...timeDots.map((d) => d.x));
    return [-0.45, Math.ceil(maxIdx) + 0.45];
  }, [timeDots]);

  const timeTicks = useMemo(() => {
    const byLabel = new Map<number, string>();
    for (const d of timeDots) {
      const idx = Math.round(d.x);
      if (!byLabel.has(idx)) byLabel.set(idx, d.xLabel);
    }
    return [...byLabel.keys()].sort((a, b) => a - b);
  }, [timeDots]);

  const timeTickFormatter = (v: number) => {
    const dot = timeDots.find((d) => Math.round(d.x) === Math.round(v));
    return dot?.xLabel ?? "";
  };

  const actionXDomain = useMemo((): [number, number] => {
    if (actionBuckets.length <= 1) return [-0.45, 0.45];
    return [-0.45, actionBuckets.length - 0.55];
  }, [actionBuckets.length]);

  const actionTicks = actionBuckets.map((b) => b.xIndex);
  const actionTickFormatter = (v: number) => actionBuckets[Math.round(v)]?.label ?? "";

  return {
    stableYDomain,
    timeDots,
    actionDots,
    timeXDomain,
    timeTicks,
    timeTickFormatter,
    actionXDomain,
    actionTicks,
    actionTickFormatter,
    timeWeekKeys,
    hasTime: timeDots.length > 0,
    hasAction: actionDots.length > 0,
  };
}

export function AdviceErrorActionFilterBar({
  lang,
  actions,
  onToggle,
  onSelectAll,
  compact = false,
}: {
  lang: "it" | "en";
  actions: ReadonlySet<AdviceActionKind>;
  onToggle: (action: AdviceActionKind) => void;
  onSelectAll: () => void;
  compact?: boolean;
}) {
  const it = lang === "it";
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "min-h-[22px]" : "min-h-[26px]"}`}>
      <span className="text-[9px] uppercase font-semibold text-ink-muted tracking-wide mr-0.5">
        {it ? "Filtra" : "Filter"}
      </span>
      {ADVICE_ACTIONS.map((action) => {
        const meta = ACTION_META[action];
        const on = actions.has(action);
        return (
          <button
            key={action}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(action)}
            className={`px-1.5 py-0.5 rounded-md text-[8px] font-semibold border transition ${
              on
                ? "text-white shadow-sm"
                : "bg-white/70 text-ink-muted border-[rgb(var(--border))]/50 opacity-60"
            }`}
            style={on ? { backgroundColor: meta.color, borderColor: meta.color } : undefined}
          >
            {it ? meta.labelIt : meta.labelEn}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onSelectAll}
        className="px-1.5 py-0.5 rounded-md text-[8px] font-medium border border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
      >
        {it ? "Tutti" : "All"}
      </button>
    </div>
  );
}

export function AdviceErrorSingleChart({
  variant,
  model,
  it,
  chartHeight,
}: {
  variant: "time" | "category";
  model: AdviceErrorChartModel;
  it: boolean;
  chartHeight: number;
}) {
  const emptyMsg =
    variant === "time"
      ? it
        ? "Nessun esito nel filtro."
        : "No outcomes in filter."
      : it
        ? "Nessuna azione con esiti."
        : "No action outcomes.";

  if (variant === "time") {
    if (!model.hasTime) {
      return (
        <div
          className="flex items-center justify-center text-[9px] text-ink-muted h-full"
          style={{ minHeight: chartHeight }}
        >
          {emptyMsg}
        </div>
      );
    }
    return (
      <SignedErrorDotChart
        dots={model.timeDots}
        xDomain={model.timeXDomain}
        xTicks={model.timeTicks}
        xTickFormatter={model.timeTickFormatter}
        yDomain={model.stableYDomain}
        it={it}
        height={chartHeight}
      />
    );
  }

  if (!model.hasAction) {
    return (
      <div
        className="flex items-center justify-center text-[9px] text-ink-muted h-full"
        style={{ minHeight: chartHeight }}
      >
        {emptyMsg}
      </div>
    );
  }
  return (
    <SignedErrorDotChart
      dots={model.actionDots}
      xDomain={model.actionXDomain}
      xTicks={model.actionTicks}
      xTickFormatter={model.actionTickFormatter}
      yDomain={model.stableYDomain}
      it={it}
      height={chartHeight}
    />
  );
}

const SECONDARY_LEGEND: {
  kind: import("../sheet/adviceErrorTimelineCharts").AdviceBuySellErrorKind;
  palette: import("../sheet/adviceErrorTimelineCharts").SecondaryErrorPalette;
  labelIt: string;
  labelEn: string;
  tipIt: string;
  tipEn: string;
}[] = [
  {
    kind: "wrongBuy",
    palette: "blueYellow",
    labelIt: "Wrong BUY (titolo scende)",
    labelEn: "Wrong BUY (stock drops)",
    tipIt: "Consiglio BUY errato: il titolo è sceso dopo il segnale.",
    tipEn: "Wrong BUY advice: the stock dropped after the signal.",
  },
  {
    kind: "wrongSell",
    palette: "yellowBlue",
    labelIt: "Wrong SELL (titolo sale)",
    labelEn: "Wrong SELL (stock rises)",
    tipIt: "Consiglio SELL errato: il titolo è salito dopo il segnale.",
    tipEn: "Wrong SELL advice: the stock rose after the signal.",
  },
  {
    kind: "missBuy",
    palette: "yellowBlue",
    labelIt: "Miss BUY (titolo sale)",
    labelEn: "Miss BUY (stock rises)",
    tipIt: "Consiglio BUY non eseguito: il titolo è salito — opportunità persa.",
    tipEn: "BUY advice not taken: the stock rose — missed opportunity.",
  },
];

const CRITICAL_TIER_LABELS: {
  tier: import("../sheet/adviceErrorTimelineCharts").MissSellLossTier;
  labelIt: string;
  labelEn: string;
  tipIt: string;
  tipEn: string;
}[] = [
  {
    tier: 1,
    labelIt: "Miss SELL · perdita fino al 25% capitale",
    labelEn: "Miss SELL · loss up to 25% of capital",
    tipIt: "Consiglio SELL non eseguito: hai tenuto la posizione e perso fino al 25% del capitale.",
    tipEn: "SELL advice not taken: you held and lost up to 25% of capital.",
  },
  {
    tier: 2,
    labelIt: "Miss SELL · perdita fino al 50% capitale",
    labelEn: "Miss SELL · loss up to 50% of capital",
    tipIt: "Consiglio SELL non eseguito: hai tenuto la posizione e perso fino al 50% del capitale.",
    tipEn: "SELL advice not taken: you held and lost up to 50% of capital.",
  },
  {
    tier: 3,
    labelIt: "Miss SELL · perdita fino al 75% capitale",
    labelEn: "Miss SELL · loss up to 75% of capital",
    tipIt: "Consiglio SELL non eseguito: hai tenuto la posizione e perso fino al 75% del capitale.",
    tipEn: "SELL advice not taken: you held and lost up to 75% of capital.",
  },
  {
    tier: 4,
    labelIt: "Miss SELL · perdita fino al 100% capitale",
    labelEn: "Miss SELL · loss up to 100% of capital",
    tipIt: "Consiglio SELL non eseguito: hai tenuto la posizione e perso fino al 100% del capitale.",
    tipEn: "SELL advice not taken: you held and lost up to 100% of capital.",
  },
];

function errorKindCaption(
  row: AdviceErrorDotPoint,
  it: boolean,
): string | null {
  if (row.visualClass === "criticalMissSell") {
    return it ? "Miss SELL (titolo scende)" : "Miss SELL (stock drops)";
  }
  if (!row.errorKind) return null;
  const leg = SECONDARY_LEGEND.find((r) => r.kind === row.errorKind);
  if (!leg) return null;
  return it ? leg.labelIt : leg.labelEn;
}

export function AdviceErrorHorizonBar({
  lang,
  horizon,
  onHorizonChange,
}: {
  lang: "it" | "en";
  horizon: AdviceErrorHorizon;
  onHorizonChange: (h: AdviceErrorHorizon) => void;
}) {
  const it = lang === "it";
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-[22px]">
      <span className="text-[9px] uppercase font-semibold text-ink-muted tracking-wide mr-0.5">
        {it ? "Finestra" : "Window"}
      </span>
      {(["24h", "7d", "all"] as const).map((h) => (
        <button
          key={h}
          type="button"
          aria-pressed={horizon === h}
          onClick={() => onHorizonChange(h)}
          className={`px-1.5 py-0.5 rounded-md text-[8px] font-semibold border transition ${
            horizon === h
              ? "bg-ink text-white border-ink"
              : "bg-white/70 text-ink-muted border-[rgb(var(--border))]/50"
          }`}
        >
          {h === "24h"
            ? it
              ? "24 ore"
              : "24 hours"
            : h === "7d"
              ? it
                ? "7 giorni"
                : "7 days"
              : it
                ? "Tutto lo storico"
                : "All history"}
        </button>
      ))}
    </div>
  );
}

export function AdviceErrorUniverseBar({
  lang,
  universe,
  onUniverseChange,
}: {
  lang: "it" | "en";
  universe: AdviceErrorUniverseView;
  onUniverseChange: (v: AdviceErrorUniverseView) => void;
}) {
  const it = lang === "it";
  const options: { id: AdviceErrorUniverseView; labelIt: string; labelEn: string }[] = [
    { id: "portfolio", labelIt: "Portafoglio", labelEn: "Portfolio" },
    { id: "simloop", labelIt: "Sim loop", labelEn: "Sim loop" },
    { id: "all", labelIt: "Tutti insieme", labelEn: "All together" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-[22px]">
      <span className="text-[9px] uppercase font-semibold text-ink-muted tracking-wide mr-0.5">
        {it ? "Dati" : "Data"}
      </span>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={universe === opt.id}
          onClick={() => onUniverseChange(opt.id)}
          className={`px-1.5 py-0.5 rounded-md text-[8px] font-semibold border transition ${
            universe === opt.id
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white/70 text-ink-muted border-[rgb(var(--border))]/50 hover:bg-indigo-50"
          }`}
        >
          {it ? opt.labelIt : opt.labelEn}
        </button>
      ))}
    </div>
  );
}

export function AdviceBuySellLegend({ lang }: { lang: "it" | "en" }) {
  const it = lang === "it";
  return (
    <div className="flex flex-col gap-1 min-h-[18px]">
      <p className="text-[8px] text-ink-muted/90 leading-snug">
        {it
          ? "Asse Y = movimento del titolo dopo il consiglio (%). Sopra 0 = salita · sotto 0 = discesa."
          : "Y-axis = stock move after advice (%). Above 0 = rise · below 0 = drop."}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="text-[8px] font-semibold text-rose-700 uppercase tracking-wide mr-0.5"
          title={
            it
              ? "SELL consigliato ma non eseguito mentre la posizione perdeva valore."
              : "SELL advised but not taken while the position lost value."
          }
        >
          {it ? "Miss SELL" : "Miss SELL"}
        </span>
        {CRITICAL_TIER_LABELS.map((row) => (
          <span
            key={row.tier}
            className="inline-flex items-center gap-1 text-[8px] text-ink-muted"
            title={it ? row.tipIt : row.tipEn}
          >
            <svg width={14} height={14} aria-hidden className="shrink-0">
              <CriticalMissSellLegendDot tier={row.tier} />
            </svg>
            {it ? row.labelIt : row.labelEn}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="text-[8px] font-semibold text-ink-muted uppercase tracking-wide mr-0.5"
          title={
            it
              ? "Consiglio BUY/SELL valutato errato o non eseguito con movimento sfavorevole."
              : "Wrong or unexecuted BUY/SELL advice with unfavorable stock move."
          }
        >
          {it ? "Altri errori" : "Other errors"}
        </span>
        {SECONDARY_LEGEND.map((row) => (
          <span
            key={`${row.kind}-${row.palette}`}
            className="inline-flex items-center gap-1 text-[8px] text-ink-muted"
            title={it ? row.tipIt : row.tipEn}
          >
            <svg width={14} height={14} aria-hidden className="shrink-0">
              <SecondaryErrorLegendDot kind={row.kind} palette={row.palette} />
            </svg>
            {it ? row.labelIt : row.labelEn}
          </span>
        ))}
      </div>
    </div>
  );
}

export type AdviceBuySellErrorModel = {
  dots: AdviceErrorDotPoint[];
  yDomain: [number, number];
  xDomain: [number, number];
  xTicks: number[];
  xTickFormatter: (v: number) => string;
  hasData: boolean;
};

export function useAdviceBuySellErrorModel(
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
  horizon: AdviceErrorHorizon,
): AdviceBuySellErrorModel {
  const dots = useMemo(
    () => buildAdviceBuySellHorizonDots(points, horizon, lang),
    [points, horizon, lang],
  );
  const yDomain = useMemo(() => stabilizeAdviceErrorYDomain(dots), [dots]);

  return {
    dots,
    yDomain,
    xDomain: [0, 1] as [number, number],
    xTicks: [] as number[],
    xTickFormatter: () => "",
    hasData: dots.length > 0,
  };
}

export function AdviceBuySellErrorChart({
  model,
  lang,
  chartHeight,
}: {
  model: AdviceBuySellErrorModel;
  lang: "it" | "en";
  chartHeight: number;
}) {
  const it = lang === "it";
  if (!model.hasData) {
    return (
      <div
        className="flex items-center justify-center text-[9px] text-ink-muted h-full"
        style={{ minHeight: chartHeight }}
      >
        {it ? "Nessun esito BUY/SELL nel filtro." : "No BUY/SELL outcomes in filter."}
      </div>
    );
  }
  return (
    <SignedErrorDotChart
      dots={model.dots}
      xDomain={model.xDomain}
      xTicks={model.xTicks}
      xTickFormatter={model.xTickFormatter}
      yDomain={model.yDomain}
      it={it}
      height={chartHeight}
      marker="buySell"
      hideXAxis
    />
  );
}

/** Dual error charts — Tester Prediction tab. */
export function AdviceErrorTimelineCharts({
  points,
  lang,
  chartHeight = 200,
}: {
  points: AdviceCalibrationPoint[];
  lang: "it" | "en";
  chartHeight?: number;
  compact?: boolean;
}) {
  const it = lang === "it";
  const [actions, setActions] = useState<Set<AdviceActionKind>>(() => new Set(ADVICE_ACTIONS));
  const [universe, setUniverse] = useState<AdviceErrorUniverseView>("all");
  const filteredPoints = useMemo(
    () => filterAdviceCalibrationByUniverse(points, universe),
    [points, universe],
  );
  const model = useAdviceErrorChartModel(filteredPoints, lang, actions);
  const blockMinHeight = adviceErrorTimelineBlockMinHeight(chartHeight);

  return (
    <div className="space-y-2 shrink-0" style={{ minHeight: blockMinHeight }}>
      <AdviceErrorUniverseBar lang={lang} universe={universe} onUniverseChange={setUniverse} />
      <AdviceErrorActionFilterBar
        lang={lang}
        actions={actions}
        onToggle={(action) => {
          setActions((prev) => {
            const next = new Set(prev);
            if (next.has(action)) next.delete(action);
            else next.add(action);
            return next;
          });
        }}
        onSelectAll={() => setActions(new Set(ADVICE_ACTIONS))}
      />
      <p className="text-[9px] text-ink-muted leading-snug min-h-[28px]">
        {it
          ? "Punti = esiti ✓/✗. Linea gialla = zero errori."
          : "Dots = ✓/✗ outcomes. Yellow line = zero error."}
      </p>
      <div className="grid grid-cols-2 gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-ink mb-1 min-h-[18px]">
            {it ? "Errore nel tempo" : "Error over time"}
          </p>
          <AdviceErrorSingleChart variant="time" model={model} it={it} chartHeight={chartHeight} />
          <p className="text-[8px] text-ink-muted/70 mt-1 tabular-nums min-h-[14px]">
            {model.hasTime ? (
              <>
                n={model.timeDots.length}
                {model.timeWeekKeys.length > 0
                  ? ` · ${model.timeWeekKeys.length} ${it ? "settimane" : "weeks"}`
                  : ""}
              </>
            ) : (
              "\u00a0"
            )}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-ink mb-1 min-h-[18px]">
            {it ? "Errore per categoria" : "Error by category"}
          </p>
          <AdviceErrorSingleChart variant="category" model={model} it={it} chartHeight={chartHeight} />
          <p className="text-[8px] text-ink-muted/70 mt-1 tabular-nums min-h-[14px]">
            {model.hasAction ? `n=${model.actionDots.length}` : "\u00a0"}
          </p>
        </div>
      </div>
    </div>
  );
}
