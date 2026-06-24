import { useState, type ReactNode } from "react";
import type { AppScreen } from "../types";
import type {
  DecisionPrecisionSummary,
  WeightedGrowthSummary,
  OperativeSellCoverageBreakdown,
} from "../sheet/accuracySummary";
import {
  formatGrowthMultiplier,
  formatOperativeSellBreakdownLabel,
} from "../sheet/accuracySummary";
import type { IntrinsicRecommendationSummary } from "../sheet/intrinsicRecommendationEfficiency";
import type {
  ModelIntrinsicForecastSummary,
  ModelIntrinsicMetric,
} from "../sheet/signAccuracyCurve";
import {
  formatModelIntrinsicRangeLabel,
  formatSignPeakOffset,
  signHitToneClass,
} from "../sheet/signAccuracyCurve";
import type {
  ModelQualityWeeklyTrends,
} from "../sheet/modelQualityWeeklyTrends";
import { fmtPpDelta, trendLabelEn, trendLabelIt } from "../sheet/modelQualityWeeklyTrends";
import { sizeErrorTone, type ModelSizeErrorTrend } from "../sheet/modelSizeErrorView";
import type { ConfidenceLevel } from "../calibration/calibrationTypes";
import { confidenceFromN } from "../calibration/calibrationTypes";

export type OperativeGainSummary = {
  closedPnlEur: number;
  openMtmEur: number;
  totalPnlEur: number;
  winRatePct: number | null;
  closedSampleN: number;
  lowSample?: boolean;
  winRatePeakCdLabel?: string | null;
};

/** Live monitor advice not mirrored as paper SELL execution (sim loop iii). */
export type AdviceMonitorOperativeSummary = {
  decision: DecisionPrecisionSummary;
  pendingCount: number;
  /** SELL rows skipped because paper already sold the key. */
  paperSellExcludedCount: number;
};

export type OperativeColumnProps = {
  decision: DecisionPrecisionSummary | null;
  growth: WeightedGrowthSummary | null;
  operativeGain?: OperativeGainSummary | null;
  /** Sim loop only — monitor SELL/BUY without paper-executed sells. */
  adviceMonitor?: AdviceMonitorOperativeSummary | null;
  /** Why SELL n may be below total exits. */
  sellCoverage?: OperativeSellCoverageBreakdown | null;
  footnotes?: string[];
};

function ConfidenceBadge({ level, it }: { level: ConfidenceLevel; it: boolean }) {
  const label = level === "high" ? "H" : level === "medium" ? "M" : "L";
  return (
    <span
      className="inline-flex rounded px-1 py-0.5 text-[7px] font-bold tracking-wide bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      title={
        it
          ? `Campione n·${label} — non qualità metrica`
          : `Sample n·${label} — not metric quality`
      }
    >
      n·{label}
    </span>
  );
}

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString("it-IT")}`;
}

function fmtPctWithPeak(
  v: number | null | undefined,
  peakCdLabel: string | null | undefined,
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const base = `${v.toFixed(1)}%`;
  return peakCdLabel ? `${base} (${peakCdLabel})` : base;
}

function CompactMetric({
  title,
  value,
  valuePct,
  peakCdLabel,
  sub,
  n,
  confidence,
  it,
  tone = "neutral",
  tip,
}: {
  title: string;
  /** Pre-formatted value (overrides valuePct). */
  value?: string;
  valuePct?: number | null;
  peakCdLabel?: string | null;
  sub?: string;
  n: number;
  confidence: ConfidenceLevel;
  it: boolean;
  tone?: "neutral" | "positive" | "negative";
  /** Native hover tooltip. */
  tip?: string;
}) {
  const valueCls =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-300"
        : "text-ink";
  const display =
    value ?? (valuePct != null ? fmtPctWithPeak(valuePct, peakCdLabel) : "—");
  return (
    <div
      className={`rounded-md border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-surface/40 px-2 py-1.5 min-w-0${tip ? " cursor-help" : ""}`}
      title={tip}
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-[9px] font-semibold text-ink-muted uppercase truncate">{title}</span>
        <ConfidenceBadge level={confidence} it={it} />
      </div>
      <div className={`text-base font-bold tabular-nums leading-none ${valueCls}`}>{display}</div>
      <div className="text-[9px] text-ink-muted tabular-nums mt-0.5 truncate">
        n={n}
        {sub ? ` · ${sub}` : ""}
      </div>
    </div>
  );
}

function ModelIntrinsicBlock({
  summary,
  it,
}: {
  summary: ModelIntrinsicForecastSummary;
  it: boolean;
}) {
  const horizon = it ? summary.horizonLabelIt : summary.horizonLabelEn;
  const metricHint =
    summary.metric === "daily_dod"
      ? it
        ? "DoD segno/prezzo · curva Model quality"
        : "DoD sign/price · Model quality curve"
      : it
        ? "Nodi cumulativi · legacy"
        : "Cumulative nodes · legacy";

  const renderMetric = (
    title: string,
    metric: ModelIntrinsicMetric,
    sub: string,
    tone?: "neutral" | "positive" | "negative",
    extraSub?: string,
  ) => (
    <CompactMetric
      title={title}
      valuePct={metric.overallPct}
      peakCdLabel={formatModelIntrinsicRangeLabel(metric, it ? "it" : "en")}
      sub={extraSub ? `${sub} · ${extraSub}` : sub}
      n={metric.n}
      confidence={confidenceFromN(metric.n)}
      it={it}
      tone={tone}
    />
  );

  const signToneClass = signHitToneClass(summary.sign.overallPct, summary.metric);
  const signTone =
    signToneClass === "text-positive"
      ? "positive"
      : signToneClass === "text-negative"
        ? "negative"
        : "neutral";

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/25 px-2.5 py-2 space-y-1.5">
      <div>
        <p className="text-[10px] font-semibold text-ink">
          {it ? "Modello · previsione intrinseca" : "Model · intrinsic forecast"}
        </p>
        <p className="text-[8px] text-ink-muted leading-snug mt-0.5">
          {it
            ? "Quanto curva prediction e raccomandazioni anticipano oscillazione (segno) e prezzo reale — unico per tutto il sistema, non per esecuzione."
            : "How prediction curve and advice anticipate move direction (sign) and actual price — one system-wide value, not execution-specific."}
        </p>
        <p className="text-[8px] text-ink-muted/90 tabular-nums mt-0.5">
          {horizon} · {metricHint}
          {summary.signPeak
            ? it
              ? ` · Picco segno T${formatSignPeakOffset(summary.signPeak.offset)} = ${summary.signPeak.pct.toFixed(1)}% (Model quality)`
              : ` · Sign peak T${formatSignPeakOffset(summary.signPeak.offset)} = ${summary.signPeak.pct.toFixed(1)}% (Model quality)`
            : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {renderMetric(
          it ? "Segno · media pesata bin" : "Sign · weighted bin mean",
          summary.sign,
          it ? "match direzione prevista vs reale" : "forecast vs realized direction",
          signTone,
          it ? "parentesi = min/max bin T" : "parentheses = T-bin min/max",
        )}
        {renderMetric(
          it ? "Acc. prezzo · media pesata bin" : "Price acc. · weighted bin mean",
          summary.priceAccuracy,
          it ? "vicinanza al prezzo reale (0–100%)" : "closeness to actual price (0–100%)",
        )}
      </div>
    </div>
  );
}

function maeTrendToEvolution(t: ModelSizeErrorTrend): "improving" | "stable" | "degrading" | "unknown" {
  if (t === "worse") return "degrading";
  return t;
}

function ModelQualityWeeklyStrip({
  trends,
  it,
}: {
  trends: ModelQualityWeeklyTrends | null;
  it: boolean;
}) {
  if (!trends) return null;
  const hasAcc =
    trends.deltaPpLastMonitor != null ||
    trends.accSlopePpPerWeek != null ||
    trends.accV4Pct != null;
  const mae = trends.modelSizeError;
  const hasMae = mae.currentMaePp != null;
  const hasSds = trends.sdsRhoDelta != null;
  if (!hasAcc && !hasMae && !hasSds) return null;

  const accTrendWord = it ? trendLabelIt(trends.accTrendLabel) : trendLabelEn(trends.accTrendLabel);
  const maeTrendWord = it
    ? trendLabelIt(maeTrendToEvolution(mae.trend))
    : trendLabelEn(maeTrendToEvolution(mae.trend));

  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-sky-50/40 dark:bg-sky-950/20 px-2 py-1.5 space-y-1">
      <p className="text-[8px] font-semibold uppercase text-[rgb(var(--accent))]">
        {it ? "Δ settimanale · Model quality" : "Weekly Δ · Model quality"}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-ink-muted tabular-nums leading-snug">
        {hasAcc ? (
          <span>
            {it ? "Acc v4" : "Acc v4"}
            {trends.accV4Pct != null ? `: ${trends.accV4Pct.toFixed(1)}%` : ""}
            {trends.deltaPpLastMonitor != null
              ? ` · ${it ? "ultimo check" : "last check"} ${fmtPpDelta(trends.deltaPpLastMonitor)}`
              : ""}
            {trends.accSlopePpPerWeek != null
              ? ` · slope ${fmtPpDelta(trends.accSlopePpPerWeek)}/${it ? "sett." : "wk"}`
              : ""}
            {` · ${accTrendWord}`}
          </span>
        ) : null}
        {hasMae ? (
          <span className={sizeErrorTone(mae.currentMaePp)}>
            MAE T+7: {mae.currentMaePp!.toFixed(1)} pp
            {mae.deltaVsPrevWeek != null
              ? ` (${fmtPpDelta(mae.deltaVsPrevWeek)} ${it ? "vs sett. prec." : "vs prior wk"})`
              : ""}
            {` · ${maeTrendWord}`}
          </span>
        ) : null}
        {hasSds ? (
          <span>
            SDS ρ Δ: {trends.sdsRhoDelta! >= 0 ? "+" : ""}
            {trends.sdsRhoDelta!.toFixed(3)}
            {it ? " (prime vs ultime sett.) · " : " (first vs last wks) · "}
            {it ? trendLabelIt(trends.sdsRhoTrendLabel) : trendLabelEn(trends.sdsRhoTrendLabel)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DecisionPair({
  decision,
  it,
}: {
  decision: DecisionPrecisionSummary;
  it: boolean;
}) {
  const buySub = it ? "prezzo ↑ dopo BUY" : "price ↑ after BUY";
  const sellSub = it ? "prezzo ↓ dopo SELL" : "price ↓ after SELL";
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <CompactMetric
        title="BUY"
        valuePct={decision.buy.valuePct}
        peakCdLabel={decision.buy.peakCdLabel}
        sub={
          decision.buy.good != null && decision.buy.bad != null
            ? `${decision.buy.good}✓/${decision.buy.bad}✗ · ${buySub}`
            : buySub
        }
        n={decision.buy.n}
        confidence={decision.buy.confidence}
        it={it}
      />
      <CompactMetric
        title="SELL"
        valuePct={decision.sell.valuePct}
        peakCdLabel={decision.sell.peakCdLabel}
        sub={
          decision.sell.good != null && decision.sell.bad != null
            ? `${decision.sell.good}✓/${decision.sell.bad}✗ · ${sellSub}`
            : sellSub
        }
        n={decision.sell.n}
        confidence={decision.sell.confidence}
        it={it}
      />
    </div>
  );
}

function GrowthBlock({
  growth,
  operativeGain,
  it,
  showBoth = false,
}: {
  growth: WeightedGrowthSummary | null;
  operativeGain?: OperativeGainSummary | null;
  it: boolean;
  /** Sim loop: stack closed win above synth/equal. */
  showBoth?: boolean;
}) {
  if (showBoth && operativeGain && growth) {
    return (
      <div className="space-y-2">
        <ClosedWinBlock operativeGain={operativeGain} it={it} />
        <SynthEqualBlock growth={growth} it={it} />
      </div>
    );
  }
  if (growth) {
    return <SynthEqualBlock growth={growth} it={it} />;
  }
  if (operativeGain) {
    return <ClosedWinBlock operativeGain={operativeGain} it={it} />;
  }
  return <p className="text-[9px] text-ink-muted px-1">—</p>;
}

function ClosedWinBlock({
  operativeGain,
  it,
}: {
  operativeGain: OperativeGainSummary;
  it: boolean;
}) {
  return (
    <div className="space-y-1">
      <CompactMetric
        title={it ? "Win chiusi" : "Closed win"}
        valuePct={operativeGain.winRatePct}
        peakCdLabel={operativeGain.winRatePeakCdLabel}
        sub={`n=${operativeGain.closedSampleN} · ${fmtEur(operativeGain.totalPnlEur)} tot`}
        n={operativeGain.closedSampleN}
        confidence={confidenceFromN(operativeGain.closedSampleN)}
        it={it}
      />
      <div className="grid grid-cols-2 gap-1 text-[8px] tabular-nums text-ink-muted">
        <span>Cl {fmtEur(operativeGain.closedPnlEur)}</span>
        <span>Op {fmtEur(operativeGain.openMtmEur)}</span>
      </div>
    </div>
  );
}

function SynthEqualBlock({
  growth,
  it,
}: {
  growth: WeightedGrowthSummary;
  it: boolean;
}) {
  const tone =
    growth.multiplier != null && growth.multiplier < 1
      ? "negative"
      : growth.multiplier != null && growth.multiplier > 1
        ? "positive"
        : "neutral";
  return (
    <div className="space-y-1">
      <CompactMetric
        title={it ? "Synth/equal" : "Synth/equal"}
        value={formatGrowthMultiplier(growth.multiplier)}
        sub={`n=${growth.dealSampleN} · ${fmtEur(growth.equalGainEur)}→${fmtEur(growth.weightedGainEur)}`}
        n={growth.dealSampleN > 0 ? growth.dealSampleN : 1}
        confidence={confidenceFromN(growth.dealSampleN)}
        it={it}
        tone={tone}
      />
      <div className="grid grid-cols-2 gap-1 text-[8px] tabular-nums text-ink-muted">
        <span>
          Eq {fmtEur(growth.equalClosedEur)}+{fmtEur(growth.equalOpenEur)}
        </span>
        <span>
          Sy {fmtEur(growth.synthClosedEur)}+{fmtEur(growth.synthOpenEur)}
        </span>
      </div>
    </div>
  );
}

function OperativeDetailsCollapsible({
  data,
  it,
  variant,
}: {
  data: OperativeColumnProps;
  it: boolean;
  variant: "portfolio" | "simLoop";
}) {
  const [open, setOpen] = useState(false);
  const footnotes = data.footnotes ?? [];
  const monitor = variant === "simLoop" ? data.adviceMonitor : null;
  const showMonitor =
    monitor != null &&
    (monitor.decision.buy.n > 0 ||
      monitor.decision.sell.n > 0 ||
      monitor.pendingCount > 0 ||
      monitor.paperSellExcludedCount > 0);
  const hasDetails = showMonitor || footnotes.length > 0;
  if (!hasDetails) return null;

  const hintParts: string[] = [];
  if (monitor?.pendingCount) {
    hintParts.push(
      it ? `${monitor.pendingCount} att.` : `${monitor.pendingCount} pend.`,
    );
  }
  if (footnotes.length) {
    hintParts.push(it ? `${footnotes.length} note` : `${footnotes.length} notes`);
  }

  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/55 overflow-hidden mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-[rgb(var(--surface))]/50"
      >
        <span className="text-[9px] font-semibold text-ink-muted">
          {it ? "Dettagli · SELL / note" : "Details · SELL / notes"}
          {!open && hintParts.length ? (
            <span className="ml-1 font-normal tabular-nums">({hintParts.join(" · ")})</span>
          ) : null}
        </span>
        <span className="text-[10px] text-ink-muted shrink-0">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="px-2 pb-2 pt-0 border-t border-[rgb(var(--border))]/30 space-y-2">
          {showMonitor && monitor ? (
            <div>
              <p className="text-[8px] font-semibold text-ink-muted mb-0.5 pt-1.5">
                {it ? "Consigli monitor (no paper)" : "Monitor advice (no paper)"}
              </p>
              <p className="text-[7px] text-ink-muted/90 mb-1 leading-snug">
                {it
                  ? "SELL/BUY live — esclude chiavi già vendute in paper."
                  : "Live SELL/BUY — excludes keys already paper-sold."}
              </p>
              <DecisionPair decision={monitor.decision} it={it} />
              {monitor.pendingCount > 0 ? (
                <p className="text-[7px] text-ink-muted mt-0.5 tabular-nums">
                  {it
                    ? `${monitor.pendingCount} in attesa (flat/senza Var.)`
                    : `${monitor.pendingCount} pending (flat/no move)`}
                </p>
              ) : null}
              {monitor.paperSellExcludedCount > 0 ? (
                <p className="text-[7px] text-sky-800/80 dark:text-sky-200/80 mt-0.5 tabular-nums">
                  {it
                    ? `${monitor.paperSellExcludedCount} SELL paper → in i · Direzione`
                    : `${monitor.paperSellExcludedCount} paper SELLs → in i · Trade direction`}
                </p>
              ) : null}
            </div>
          ) : null}
          {footnotes.map((note) => (
            <p
              key={note}
              className="text-[8px] text-sky-800/90 dark:text-sky-200/90 leading-snug"
            >
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OperativeColumn({
  label,
  data,
  it,
  variant,
}: {
  label: string;
  data: OperativeColumnProps | null;
  it: boolean;
  /** portfolio = real Simulation book; simLoop = auto paper */
  variant: "portfolio" | "simLoop";
}) {
  const hasDirection =
    data?.decision && (data.decision.buy.n > 0 || data.decision.sell.n > 0);
  const hasGain = Boolean(data?.growth || data?.operativeGain);
  const sellBreakdownLabel = formatOperativeSellBreakdownLabel(
    data?.sellCoverage,
    it,
    variant,
  );
  const showSellBreakdown = Boolean(
    sellBreakdownLabel && (data?.sellCoverage?.executedCount ?? 0) > 0,
  );

  return (
    <div className="min-w-0 flex flex-col gap-2 border-l border-[rgb(var(--border))]/30 first:border-l-0 pl-2 first:pl-0">
      <p className="text-[9px] font-bold uppercase tracking-wide text-ink truncate">{label}</p>
      <div className="space-y-2">
        <div>
          <p className="text-[8px] font-semibold text-ink-muted mb-0.5">
            {it ? "i · Direzione trade" : "i · Trade direction"}
          </p>
          <p className="text-[7px] text-ink-muted/90 mb-1 leading-snug">
            {it
              ? "% BUY seguito da rialzo · % SELL seguito da ribasso (esecuzione reale o paper)."
              : "Share of BUYs followed by price rise · SELLs followed by price drop (real or paper)."}
          </p>
          {hasDirection && data?.decision ? (
            <DecisionPair decision={data.decision} it={it} />
          ) : !showSellBreakdown ? (
            <p className="text-[9px] text-ink-muted">—</p>
          ) : null}
          {showSellBreakdown ? (
            <p
              className={`text-[7px] text-sky-800/90 dark:text-sky-200/90 tabular-nums leading-snug px-0.5 ${
                hasDirection && data?.decision ? "mt-1" : ""
              }`}
              title={
                variant === "simLoop"
                  ? it
                    ? "SELL operativo: serve P(plan) all'ingresso e Var. 24h dopo la vendita. I round-trip chiusi contano come BUY."
                    : "Operative SELL: needs entry P(plan) and 24h move after sell. Closed round-trips count as BUY."
                  : it
                    ? "SELL operativo: prezzo ↓ entro 24h dopo l'uscita = ✓. P(plan) mostrato per trasparenza."
                    : "Operative SELL: price ↓ within 24h after exit = ✓. P(plan) shown for transparency."
              }
            >
              SELL: {sellBreakdownLabel}
              {variant === "simLoop" ? (
                <span className="block text-[7px] text-ink-muted/75 font-normal mt-0.5">
                  {it ? "Round-trip chiusi → metrica BUY." : "Closed round-trips → BUY metric."}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-[8px] font-semibold text-ink-muted mb-1">
            {variant === "simLoop"
              ? data?.operativeGain && data?.growth
                ? it
                  ? "ii · Gain chiusi · Synth"
                  : "ii · Closed gain · Synth"
                : data?.growth
                  ? it
                    ? "ii · Synth/equal"
                    : "ii · Synth/equal"
                  : it
                    ? "ii · Gain chiusi"
                    : "ii · Closed gain"
              : it
                ? "ii · Gain chiusi"
                : "ii · Closed gain"}
          </p>
          {variant === "simLoop" ? (
            <p className="text-[7px] text-ink-muted/90 mb-1 leading-snug">
              {data?.operativeGain && data?.growth
                ? it
                  ? "Win rate su round-trip paper chiusi · moltiplicatore synth vs equal sotto."
                  : "Win rate on closed paper round-trips · synth vs equal multiplier below."
                : data?.growth
                  ? it
                    ? "Moltiplicatore guadagno synth vs equal sul book paper auto."
                    : "Synth vs equal gain multiplier on auto paper book."
                  : it
                    ? "Win rate e P&L su round-trip paper chiusi nel sim loop."
                    : "Win rate and P&L on closed paper round-trips in sim loop."}
            </p>
          ) : (
            <p className="text-[7px] text-ink-muted/90 mb-1 leading-snug">
              {it
                ? "Win rate e P&L su round-trip chiusi nel portafoglio Simulation."
                : "Win rate and P&L on closed round-trips in Simulation portfolio."}
            </p>
          )}
          {hasGain ? (
            <GrowthBlock
              growth={data?.growth ?? null}
              operativeGain={data?.operativeGain ?? null}
              it={it}
              showBoth={variant === "simLoop" && Boolean(data?.operativeGain && data?.growth)}
            />
          ) : (
            <p className="text-[9px] text-ink-muted">—</p>
          )}
        </div>
        {data ? <OperativeDetailsCollapsible data={data} it={it} variant={variant} /> : null}
      </div>
    </div>
  );
}

function OperativeDirectionColumn({
  label,
  decision,
  sellCoverage,
  it,
  variant,
}: {
  label: string;
  decision: DecisionPrecisionSummary | null | undefined;
  sellCoverage?: OperativeSellCoverageBreakdown | null;
  it: boolean;
  variant: "portfolio" | "simLoop";
}) {
  const sellBreakdownLabel = formatOperativeSellBreakdownLabel(sellCoverage, it, variant);
  const showSellBreakdown = Boolean(
    sellBreakdownLabel && (sellCoverage?.executedCount ?? 0) > 0,
  );
  const hasDirection = decision && (decision.buy.n > 0 || decision.sell.n > 0);

  return (
    <div className="min-w-0 flex flex-col gap-1">
      <p className="text-[9px] font-bold uppercase tracking-wide text-ink truncate">{label}</p>
      {hasDirection && decision ? (
        <DecisionPair decision={decision} it={it} />
      ) : !showSellBreakdown ? (
        <p className="text-[9px] text-ink-muted px-0.5">—</p>
      ) : null}
      {showSellBreakdown ? (
        <p className="text-[7px] text-sky-800/90 dark:text-sky-200/90 tabular-nums leading-snug px-0.5">
          SELL: {sellBreakdownLabel}
        </p>
      ) : null}
    </div>
  );
}

function OperativeBuySellSummary({
  portfolioOperative,
  simLoopOperative,
  portfolioLabel,
  simLabel,
  it,
}: {
  portfolioOperative: OperativeColumnProps | null;
  simLoopOperative: OperativeColumnProps | null;
  portfolioLabel: string;
  simLabel: string;
  it: boolean;
}) {
  const hasPortfolio =
    (portfolioOperative?.decision?.buy.n ?? 0) > 0 ||
    (portfolioOperative?.decision?.sell.n ?? 0) > 0 ||
    (portfolioOperative?.sellCoverage?.executedCount ?? 0) > 0;
  const hasSimLoop =
    (simLoopOperative?.decision?.buy.n ?? 0) > 0 ||
    (simLoopOperative?.decision?.sell.n ?? 0) > 0 ||
    (simLoopOperative?.sellCoverage?.executedCount ?? 0) > 0;
  if (!hasPortfolio && !hasSimLoop) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/30 p-2 min-w-0">
      <p className="text-[10px] font-semibold text-ink leading-snug mb-0.5">
        {it ? "Operativa · BUY / SELL" : "Operative · BUY / SELL"}
      </p>
      <p className="text-[7px] text-ink-muted/90 mb-1.5 leading-snug">
        {it
          ? "% BUY seguito da rialzo · % SELL seguito da ribasso — stesso calcolo del dettaglio sotto (Simulation vs sim loop paper)."
          : "Share of BUYs followed by price rise · SELLs followed by price drop — same as the detail below (Simulation vs sim loop paper)."}
      </p>
      <div className="grid grid-cols-2 gap-0 min-w-0">
        <OperativeDirectionColumn
          label={portfolioLabel}
          decision={portfolioOperative?.decision}
          sellCoverage={portfolioOperative?.sellCoverage}
          it={it}
          variant="portfolio"
        />
        <OperativeDirectionColumn
          label={simLabel}
          decision={simLoopOperative?.decision}
          sellCoverage={simLoopOperative?.sellCoverage}
          it={it}
          variant="simLoop"
        />
      </div>
    </div>
  );
}

function CompareRow({
  title,
  left,
  right,
  onDetail,
  detailLabel,
}: {
  title: string;
  left: ReactNode;
  right: ReactNode;
  onDetail?: () => void;
  detailLabel: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/30 p-2 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] font-semibold text-ink leading-snug">{title}</p>
        {onDetail ? (
          <button
            type="button"
            onClick={onDetail}
            className="shrink-0 text-[9px] font-semibold text-[rgb(var(--accent))] hover:underline"
          >
            {detailLabel}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-0 min-w-0">
        {left}
        {right}
      </div>
    </div>
  );
}

function IntrinsicRecommendationBlock({
  intrinsic,
  it,
}: {
  intrinsic: IntrinsicRecommendationSummary | null;
  it: boolean;
}) {
  if (!intrinsic) return null;
  const hasData =
    intrinsic.monitor.scoredCount > 0 || intrinsic.closedReplay.scoredCount > 0;
  if (!hasData) return null;

  const sectionTip = it
    ? "Efficienza teorica delle raccomandazioni (HOLD/review inclusi). ≠ BUY/SELL operativi (portfolio/sim loop). Sinistra = consigli live oggi; destra = replay storico su deal Simulation chiusi."
    : "Theoretical advice efficiency (incl. HOLD/review). ≠ operative BUY/SELL (portfolio/sim loop). Left = live advice today; right = historical replay on closed Simulation deals.";

  const allAdviceTip = it
    ? "Monitor live · Tutti i consigli: ogni raccomandazione attuale (BUY, SELL, HOLD, review) vs Var.24h e P(plan). Popolazione aperta — cosa dice il modello adesso, non l'esito di un trade eseguito."
    : "Live monitor · All advice: each current recommendation (BUY, SELL, HOLD, review) vs 24h move and P(plan). Open-book population — what the model says now, not an executed trade outcome.";

  const allReplayTip = it
    ? "Replay chiusi · Tutti i replay: round-trip Simulation già chiusi — enter/hold vs skip/exit giudicati sul P&L realizzato. Popolazione storica; può differire dal monitor live (81% vs 53% = consigli attuali vs esiti passati)."
    : "Closed replay · All replay: closed Simulation round-trips — enter/hold vs skip/exit scored on realized P&L. Historical population; may differ from live monitor (81% vs 53% = current advice vs past outcomes).";

  return (
    <div
      className="rounded-lg border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/25 px-2.5 py-2 space-y-1.5 cursor-help"
      title={sectionTip}
    >
      <div>
        <p className="text-[10px] font-semibold text-ink leading-snug">
          {it ? "Efficienza intrinseca raccomandazioni" : "Intrinsic recommendation efficiency"}
          {intrinsic.combinedPrecisionPct != null ? (
            <span className="ml-2 text-sm font-bold tabular-nums text-[rgb(var(--accent))]">
              {intrinsic.combinedPrecisionPct.toFixed(1)}%
              <span className="text-[8px] font-normal text-ink-muted ml-1">
                · n={intrinsic.combinedAllActions?.n ?? 0}{" "}
                {it ? "tutti" : "all"}
              </span>
            </span>
          ) : null}
        </p>
        <p className="text-[8px] text-ink-muted leading-snug mt-0.5">
          {it
            ? "Quanto le raccomandazioni (incl. HOLD) anticipano l'esito — monitor live vs replay chiusi. Passa il cursore sulle card per la differenza."
            : "How well advice (incl. HOLD) anticipates outcome — live monitor vs closed replay. Hover cards for the difference."}
        </p>
        {intrinsic.combinedRangeLabel ? (
          <p className="text-[8px] text-ink-muted/90 tabular-nums mt-0.5">
            {intrinsic.combinedRangeLabel}
            {it
              ? " — fasce T-CD (n≥2), non min/max della media in header."
              : " — T-CD slices (n≥2), not min/max of header mean."}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="min-w-0 space-y-1">
          <p
            className="text-[8px] font-bold uppercase text-ink-muted cursor-help"
            title={allAdviceTip}
          >
            {it ? "Monitor live" : "Live monitor"}
          </p>
          {intrinsic.monitor.scoredCount > 0 || intrinsic.monitor.pendingCount > 0 ? (
            <CompactMetric
              title={it ? "Tutti i consigli" : "All advice"}
              valuePct={intrinsic.monitor.allActions.valuePct}
              sub={
                intrinsic.monitor.pendingCount > 0
                  ? `${intrinsic.monitor.allActions.good ?? 0}✓/${intrinsic.monitor.allActions.bad ?? 0}✗ · ${intrinsic.monitor.pendingCount} ${it ? "att." : "pend."} · incl. HOLD`
                  : `${intrinsic.monitor.allActions.good ?? 0}✓/${intrinsic.monitor.allActions.bad ?? 0}✗ · incl. HOLD/review`
              }
              n={intrinsic.monitor.allActions.n}
              confidence={intrinsic.monitor.allActions.confidence}
              it={it}
              tip={allAdviceTip}
            />
          ) : (
            <p className="text-[9px] text-ink-muted leading-snug px-0.5">
              {it
                ? "Nessun titolo valutabile: serve Var.24h (o MTM su paper) e P(plan)."
                : "No scorable tickers: need 24h move (or paper MTM) and P(plan)."}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p
            className="text-[8px] font-bold uppercase text-ink-muted cursor-help"
            title={allReplayTip}
          >
            {it ? "Replay chiusi" : "Closed replay"}
          </p>
          {intrinsic.closedReplay.scoredCount > 0 ? (
            <CompactMetric
              title={it ? "Tutti i replay" : "All replay"}
              valuePct={intrinsic.closedReplay.allActions.valuePct}
              sub={`${intrinsic.closedReplay.allActions.good ?? 0}✓/${intrinsic.closedReplay.allActions.bad ?? 0}✗ · enter/hold + skip/exit`}
              n={intrinsic.closedReplay.allActions.n}
              confidence={intrinsic.closedReplay.allActions.confidence}
              it={it}
              tip={allReplayTip}
            />
          ) : (
            <p className="text-[9px] text-ink-muted px-0.5">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function accuracyCollapsedHint(
  modelIntrinsic: ModelIntrinsicForecastSummary | null,
  portfolioOperative: OperativeColumnProps | null,
  simLoopOperative: OperativeColumnProps | null,
  it: boolean,
): string {
  const parts: string[] = [];
  if (modelIntrinsic?.sign.overallPct != null && Number.isFinite(modelIntrinsic.sign.overallPct)) {
    parts.push(`Sign ${modelIntrinsic.sign.overallPct.toFixed(1)}%`);
  }
  const portBuy = portfolioOperative?.decision?.buy;
  if (portBuy && portBuy.n > 0 && portBuy.valuePct != null) {
    parts.push(`${it ? "Port." : "Port."} BUY ${portBuy.valuePct.toFixed(1)}%`);
  }
  const portSell = portfolioOperative?.decision?.sell;
  if (portSell && portSell.n > 0 && portSell.valuePct != null) {
    parts.push(`${it ? "Port." : "Port."} SELL ${portSell.valuePct.toFixed(1)}%`);
  }
  const simBuy = simLoopOperative?.decision?.buy;
  if (simBuy && simBuy.n > 0 && simBuy.valuePct != null) {
    parts.push(`${it ? "Sim" : "Sim"} BUY ${simBuy.valuePct.toFixed(1)}%`);
  }
  const simSell = simLoopOperative?.decision?.sell;
  if (simSell && simSell.n > 0 && simSell.valuePct != null) {
    parts.push(`${it ? "Sim" : "Sim"} SELL ${simSell.valuePct.toFixed(1)}%`);
  }
  return parts.join(" · ");
}

export function AccuracySummaryPanel({
  portfolioOperative,
  simLoopOperative,
  modelIntrinsic = null,
  intrinsic = null,
  weeklyTrends = null,
  it,
  onNavigate,
}: {
  portfolioOperative: OperativeColumnProps | null;
  simLoopOperative: OperativeColumnProps | null;
  modelIntrinsic?: ModelIntrinsicForecastSummary | null;
  intrinsic?: IntrinsicRecommendationSummary | null;
  weeklyTrends?: ModelQualityWeeklyTrends | null;
  it: boolean;
  onNavigate?: (screen: AppScreen) => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = it ? "Dettaglio →" : "Details →";
  const hasPortfolio =
    portfolioOperative != null &&
    (portfolioOperative.decision?.buy.n ?? 0) +
      (portfolioOperative.decision?.sell.n ?? 0) +
      (portfolioOperative.operativeGain?.closedSampleN ?? 0) >
      0;
  const hasSimLoop =
    simLoopOperative != null &&
    (simLoopOperative.decision?.buy.n ?? 0) +
      (simLoopOperative.decision?.sell.n ?? 0) +
      (simLoopOperative.operativeGain?.closedSampleN ?? 0) +
      (simLoopOperative.growth != null ? 1 : 0) >
      0;
  const hasAny =
    hasPortfolio ||
    hasSimLoop ||
    modelIntrinsic != null ||
    (intrinsic?.monitor.scoredCount ?? 0) > 0;

  const portfolioLabel = it ? "Portafoglio Simulation" : "Simulation portfolio";
  const simLabel = it ? "Sim loop paper" : "Sim loop paper";
  const collapsedHint = accuracyCollapsedHint(
    modelIntrinsic,
    portfolioOperative,
    simLoopOperative,
    it,
  );

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/25 overflow-hidden min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-[rgb(var(--surface))]/50"
      >
        <span className="min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-xs font-semibold text-ink shrink-0">
            {it ? "Accuratezza" : "Accuracy"}
          </span>
          {!open && collapsedHint ? (
            <span className="text-[9px] font-normal text-ink-muted tabular-nums truncate">
              {collapsedHint}
            </span>
          ) : null}
          {!open && !collapsedHint && !hasAny ? (
            <span className="text-[9px] font-normal text-ink-muted">
              {it ? "Nessun dato" : "No data"}
            </span>
          ) : null}
        </span>
        <span className="text-[10px] text-ink-muted shrink-0">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 min-w-0 px-2.5 pb-2.5 pt-1 border-t border-[rgb(var(--border))]/30">
          {!hasAny ? (
            <p className="text-[10px] text-ink-muted text-center py-2">
              {it
                ? "Avvia sim loop o aggiungi posizioni Simulation."
                : "Start sim loop or add Simulation positions."}
            </p>
          ) : (
            <>
              <p className="text-[8px] text-ink-muted leading-snug">
                {it
                  ? "BUY/SELL operativi (portfolio vs sim loop) · gain chiusi/synth nel dettaglio sotto · segno/prezzo nel blocco Modello · efficienza intrinseca (HOLD/replay) sempre visibile."
                  : "Operative BUY/SELL (portfolio vs sim loop) · closed gain/synth detail below · sign/price in Model block · intrinsic efficiency (HOLD/replay) always visible."}
              </p>

              {modelIntrinsic ? <ModelIntrinsicBlock summary={modelIntrinsic} it={it} /> : null}
              <ModelQualityWeeklyStrip trends={weeklyTrends} it={it} />

              <OperativeBuySellSummary
                portfolioOperative={portfolioOperative}
                simLoopOperative={simLoopOperative}
                portfolioLabel={portfolioLabel}
                simLabel={simLabel}
                it={it}
              />

              <IntrinsicRecommendationBlock intrinsic={intrinsic} it={it} />

              <CompareRow
                title={
                  it
                    ? "Operativa · Simulation vs sim loop"
                    : "Operative · Simulation vs sim loop"
                }
                left={
                  <OperativeColumn
                    label={portfolioLabel}
                    data={portfolioOperative}
                    it={it}
                    variant="portfolio"
                  />
                }
                right={
                  <OperativeColumn
                    label={simLabel}
                    data={simLoopOperative}
                    it={it}
                    variant="simLoop"
                  />
                }
                onDetail={onNavigate ? () => onNavigate("testerMonitor") : undefined}
                detailLabel={detail}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
