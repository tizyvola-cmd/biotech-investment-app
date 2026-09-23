/**
 * Deep-dive card header KPI block:
 * LAST · DAY · MKT CAP · EIS M/C · BETA · LIQUIDITY · P(CONT) + D10%
 * + optional context note + CD STUDY strip — one compact card.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fmtPortfolioPnlPct,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import {
  estimateContG10FromDailyCloses,
  resolveContBand,
  resolveContG10,
  resolveContG10WithFallback,
  resolveDisplayPContinuation,
  withContG10Fallback,
  type ContBand,
} from "../sheet/continuationScore";
import {
  betaDisplay,
  betaTooltipText,
  liquidityScoreCellStyle,
  liquidityTooltipText,
  resolveSimRowBeta,
  resolveSimRowLiquiditaFy,
  resolveSimRowLiquidityScore,
} from "../sheet/simRowBetaLiquidity";
import { WindIcon } from "./ContG10Badge";
import type { ChartPoint } from "../types";
import { fetchVolumeHistory } from "../api/supernova";
import { useT } from "../shared/i18n";

const STRONG_WIND_PCONT = 50;

function contScoreStyle(band: ContBand): { color: string; background: string } {
  if (band === "high" || band === "declining") {
    return { color: "rgb(var(--negative))", background: "rgba(var(--negative) / 0.18)" };
  }
  if (band === "low") {
    return { color: "rgb(var(--positive))", background: "rgba(var(--positive) / 0.18)" };
  }
  if (band === "mid") {
    return {
      color: "rgb(var(--signal-neutral))",
      background: "rgba(var(--signal-neutral) / 0.18)",
    };
  }
  return { color: "rgb(var(--ink-muted))", background: "rgba(243, 245, 250, 0.08)" };
}

function signedLabelClass(label: string): string {
  const raw = label.trim();
  if (raw.startsWith("-") || raw.startsWith("−")) return "text-negative";
  if (raw.startsWith("+")) return "text-positive";
  return "text-ink";
}

function Cell({
  label,
  title,
  hover,
  children,
  className = "",
}: {
  label: string;
  title?: string;
  hover?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`group/cell relative min-w-0 px-1.5 py-0.5 ${className}`}
      title={hover ? undefined : title}
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink-muted leading-none truncate">
        {label}
      </p>
      <div className="mt-1 min-w-0 leading-none">{children}</div>
      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-40 mt-1.5 hidden w-[17.5rem] rounded-xl border border-white/[0.12] bg-[#121729] px-3 py-2.5 text-left shadow-2xl group-hover/cell:block"
        >
          {hover}
        </div>
      ) : null}
    </div>
  );
}

function PctValue({
  pct,
  eur,
}: {
  pct?: number | null;
  eur?: number | null;
}) {
  const accent = portfolioPnlAccentClass(eur, pct).replace("text-slate-600", "text-ink");
  return (
    <p className={`text-[13px] font-bold tabular-nums ${accent}`}>
      {pct != null && Number.isFinite(pct) ? fmtPortfolioPnlPct(pct) : "—"}
    </p>
  );
}

export function DeepDiveKpiRibbon({
  it,
  pnlPctLast,
  pnlEurLast,
  pnlPct24h,
  pnlEur24h,
  simRow,
  chartPts = null,
  marketCapLabel,
  eisMarketLabel,
  eisClinicalLabel,
  eisMarketColor: _eisMarketColor,
  eisClinicalColor: _eisClinicalColor,
  onOpenEis,
  note,
  clinicalSlot,
}: {
  it: boolean;
  pnlPctLast?: number | null;
  pnlEurLast?: number | null;
  pnlPct24h?: number | null;
  pnlEur24h?: number | null;
  simRow: Record<string, unknown> | null | undefined;
  chartPts?: ChartPoint[] | null;
  marketCapLabel: string;
  eisMarketLabel: string;
  eisClinicalLabel: string;
  eisMarketColor?: string;
  eisClinicalColor?: string;
  onOpenEis?: () => void;
  /** One-line recovering / residual context under the KPI row. */
  note?: string | null;
  clinicalSlot?: ReactNode;
}) {
  const t = useT();
  const ticker = String(simRow?.Ticker ?? simRow?.ticker ?? "").trim().toUpperCase();
  const sheetOrChartG10 = resolveContG10WithFallback(simRow ?? null, chartPts);
  const [dailyG10, setDailyG10] = useState<number | null>(null);

  useEffect(() => {
    if (!ticker) {
      setDailyG10(null);
      return;
    }
    let alive = true;
    void fetchVolumeHistory(ticker, 25)
      .then((doc) => {
        if (!alive) return;
        setDailyG10(estimateContG10FromDailyCloses(doc.bars ?? []));
      })
      .catch(() => {
        if (alive) setDailyG10(null);
      });
    return () => {
      alive = false;
    };
  }, [ticker]);

  const g10 = dailyG10 ?? sheetOrChartG10;
  const contRow = useMemo(() => {
    if (!simRow) return null;
    const withChart = withContG10Fallback(simRow, chartPts) ?? simRow;
    if (g10 == null || resolveContG10(withChart) != null) return withChart;
    return { ...withChart, cont_g10: g10 };
  }, [simRow, chartPts, g10]);

  const beta = simRow ? resolveSimRowBeta(simRow) : null;
  const betaUi = beta != null ? betaDisplay(beta) : null;
  const liqScore = simRow ? resolveSimRowLiquidityScore(simRow) : null;
  const fyDisplay = simRow ? resolveSimRowLiquiditaFy(simRow) : null;

  const pCont = contRow ? resolveDisplayPContinuation(contRow) : null;
  const contBand = contRow ? resolveContBand(contRow) : "not_run";
  const g10Text =
    g10 != null && Number.isFinite(g10)
      ? `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%`
      : "—";
  const g10Tone =
    g10 == null || !Number.isFinite(g10)
      ? "text-ink-muted"
      : g10 >= 0
        ? "text-positive"
        : "text-negative";

  return (
    <section
      className="rounded-lg border border-[rgb(var(--border))]/[0.16] bg-surface-elevated overflow-visible text-ink"
      aria-label={it ? "Indici deep dive" : "Deep dive metrics"}
    >
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-x-0.5 px-1.5 py-1.5">
        <Cell
          label={it ? "Ultima" : "Last"}
          title={t("sim.lossAnalysis.pnlDual.readingTip")}
        >
          <PctValue pct={pnlPctLast} eur={pnlEurLast} />
        </Cell>

        <Cell
          label={it ? "Giorno" : "Day"}
          title={t("sim.lossAnalysis.pnlDual.todayTip")}
        >
          <PctValue pct={pnlPct24h} eur={pnlEur24h} />
        </Cell>

        <Cell
          label={t("sim.lossAnalysis.metric.marketCap")}
          title={t("sim.lossAnalysis.metric.marketCapTip")}
        >
          <p className="text-[13px] font-bold tabular-nums text-ink">
            {marketCapLabel}
          </p>
        </Cell>

        <button
          type="button"
          onClick={onOpenEis}
          className="min-w-0 px-1.5 py-0.5 text-left hover:bg-[rgb(var(--ink))]/[0.06] transition-colors rounded"
          title={t("decisionLab.pattern.eis.impactOverview.eisScoreDualHint")}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink-muted leading-none">
            EIS M/C
          </p>
          <p className="mt-1 flex items-baseline gap-0.5 tabular-nums leading-none">
            <span className={`text-[13px] font-bold ${signedLabelClass(eisMarketLabel)}`}>
              {eisMarketLabel}
            </span>
            <span className="text-ink-muted text-[11px]" aria-hidden>
              /
            </span>
            <span className={`text-[13px] font-bold ${signedLabelClass(eisClinicalLabel)}`}>
              {eisClinicalLabel}
            </span>
          </p>
        </button>

        <Cell label="Beta" title={betaTooltipText(beta, it)}>
          {betaUi ? (
            <p className="text-[13px] font-bold tabular-nums text-ink">
              {betaUi.text}
            </p>
          ) : (
            <p className="text-[13px] font-bold text-ink-muted">—</p>
          )}
        </Cell>

        <Cell
          label={it ? "Liquidità" : "Liquidity"}
          title={liquidityTooltipText(liqScore, fyDisplay ?? "", it)}
        >
          {liqScore != null ? (
            <p
              className="text-[13px] font-bold tabular-nums inline-block px-0.5 rounded"
              style={liquidityScoreCellStyle(liqScore)}
            >
              {liqScore.toFixed(2)}
            </p>
          ) : (
            <p className="text-[13px] font-bold text-ink-muted">—</p>
          )}
        </Cell>

        <Cell
          label="P(cont)"
          hover={
            <div className="space-y-1">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">
                  P(cont)
                </span>
                <span className="text-[12px] font-bold tabular-nums text-[#F3F5FA]">
                  {pCont != null && Number.isFinite(pCont) ? `${Math.round(pCont)}%` : "—"}
                </span>
              </p>
              <p className="text-[11px] leading-snug text-[#F3F5FA]">
                {it
                  ? "Probabilità che il titolo continui a crescere."
                  : "Probability that the stock continues to rise."}
              </p>
            </div>
          }
        >
          <p
            className="text-[13px] font-bold tabular-nums inline-flex items-center gap-0.5 px-0.5 rounded leading-none"
            style={pCont != null ? contScoreStyle(contBand) : { color: "rgb(var(--ink-muted))" }}
          >
            {pCont != null && pCont >= STRONG_WIND_PCONT ? (
              <WindIcon className="w-2.5 h-2.5 shrink-0 text-[rgb(var(--purple-soft))]" />
            ) : null}
            {pCont != null && Number.isFinite(pCont) ? `${Math.round(pCont)}%` : "—"}
          </p>
        </Cell>

        <Cell
          label="D10%"
          hover={
            <div className="space-y-1">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">
                  D10%
                </span>
                <span className={`text-[12px] font-bold tabular-nums ${g10Tone}`}>
                  {g10Text}
                </span>
              </p>
              <p className="text-[11px] leading-snug text-[#F3F5FA]">
                {it
                  ? "Variazione percentuale del prezzo negli ultimi 10 giorni di mercato."
                  : "Percent price change over the last 10 market days."}
              </p>
            </div>
          }
        >
          <p className={`text-[13px] font-bold tabular-nums leading-none ${g10Tone}`}>
            {g10Text}
          </p>
        </Cell>
      </div>

      {note ? (
        <p className="px-2.5 pb-1.5 text-[11px] italic text-ink-muted leading-snug truncate" title={note}>
          {note}
        </p>
      ) : null}

      {clinicalSlot ? (
        <div className="mx-1.5 mb-1.5 rounded-md border border-[rgb(var(--border))]/[0.16] bg-[rgb(var(--bg-deep))] px-2.5 py-1.5 min-w-0">
          {clinicalSlot}
        </div>
      ) : null}
    </section>
  );
}
