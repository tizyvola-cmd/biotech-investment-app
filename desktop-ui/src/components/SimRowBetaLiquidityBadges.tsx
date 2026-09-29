import { useEffect, useMemo, useState } from "react";
import { fetchVolumeHistory } from "../api/supernova";
import {
  contBandLabel,
  continuationTooltipText,
  contSellUiRegimeLabel,
  estimateContG10FromDailyCloses,
  resolveContBand,
  resolveContG10,
  resolveContG10WithFallback,
  resolveContSellUiRegime,
  resolveDisplayPContinuation,
  withContG10Fallback,
  type ContBand,
} from "../sheet/continuationScore";
import { G10_HELP_EN, G10_HELP_IT } from "./ContG10Badge";
import {
  betaBucketLabel,
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

/** Strong-wind threshold — same coin-flip as P(continuation) chart. */
const STRONG_WIND_PCONT = 50;

/** Band is exhaustion-vs-base; UI shows P(continuation) — invert colors. */
function contScoreStyle(band: ContBand): { color: string; background: string } {
  // high exhaustion → weak continuation → red
  if (band === "high") return { color: "#9f1239", background: "rgba(159,18,57,0.12)" };
  // low exhaustion → stronger continuation → green
  if (band === "low") return { color: "#166534", background: "rgba(22,101,52,0.12)" };
  if (band === "mid") return { color: "#92400e", background: "rgba(146,64,14,0.12)" };
  if (band === "declining") return { color: "#9f1239", background: "rgba(159,18,57,0.12)" };
  if (band === "not_run") return { color: "#64748b", background: "rgba(100,116,139,0.12)" };
  return { color: "#64748b", background: "transparent" };
}

const LIQ_CHIP_CLS = {
  ok: "border-[rgb(var(--positive)/0.35)] bg-[rgb(var(--positive)/0.12)] text-[rgb(var(--positive))]",
  warn: "border-[rgb(var(--warn)/0.4)] bg-[rgb(var(--warn)/0.12)] text-[rgb(var(--warn))]",
  risk: "border-[rgb(var(--negative)/0.35)] bg-[rgb(var(--negative)/0.12)] text-[rgb(var(--negative))]",
} as const;

function parseLiqChips(fy: string): { label: string; value: string; tone: keyof typeof LIQ_CHIP_CLS }[] {
  const out: { label: string; value: string; tone: keyof typeof LIQ_CHIP_CLS }[] = [];
  const cr = /CR\s*([\d.]+)/i.exec(fy);
  const qr = /QR\s*([\d.]+)/i.exec(fy);
  const cash = /Cash[^|]*?([\d.]+)\s*M/i.exec(fy) ?? /Cash\s*([\d.]+)/i.exec(fy);
  if (cr) {
    const n = Number(cr[1]);
    out.push({
      label: "CR",
      value: Number.isFinite(n) ? n.toFixed(2) : cr[1]!,
      tone: !Number.isFinite(n) || n >= 1.5 ? "ok" : n >= 1 ? "warn" : "risk",
    });
  }
  if (qr) {
    const n = Number(qr[1]);
    out.push({
      label: "QR",
      value: Number.isFinite(n) ? n.toFixed(2) : qr[1]!,
      tone: !Number.isFinite(n) || n >= 1 ? "ok" : n >= 0.8 ? "warn" : "risk",
    });
  }
  if (cash) {
    const n = Number(cash[1]);
    out.push({
      label: "Cash",
      value: Number.isFinite(n) ? n.toFixed(2) : cash[1]!,
      tone: !Number.isFinite(n) || n >= 0.5 ? "ok" : n >= 0.25 ? "warn" : "risk",
    });
  }
  return out;
}

export function SimRowBetaLiquidityBadges({
  simRow,
  it,
  dense = false,
  /** Side-by-side with approaching-CD study strip — tighter trio. */
  layout = "default",
  /** Price series — fills 10d % / P(cont) when the sheet row has no cont_g10. */
  chartPts = null,
}: {
  simRow: Record<string, unknown> | null | undefined;
  it: boolean;
  dense?: boolean;
  layout?: "default" | "side";
  chartPts?: ChartPoint[] | null;
}) {
  const ticker = String(simRow?.Ticker ?? simRow?.ticker ?? "").trim().toUpperCase();
  const sheetOrChartG10 = resolveContG10WithFallback(simRow ?? null, chartPts);
  const [dailyG10, setDailyG10] = useState<number | null>(null);

  useEffect(() => {
    if (sheetOrChartG10 != null || !ticker) {
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
  }, [ticker, sheetOrChartG10]);

  const g10 = sheetOrChartG10 ?? dailyG10;
  const contRow = useMemo(() => {
    if (!simRow) return null;
    const withChart = withContG10Fallback(simRow, chartPts) ?? simRow;
    if (g10 == null || resolveContG10(withChart) != null) return withChart;
    return { ...withChart, cont_g10: g10 };
  }, [simRow, chartPts, g10]);

  if (!simRow || !contRow) return null;

  const beta = resolveSimRowBeta(simRow);
  const liqScore = resolveSimRowLiquidityScore(simRow);
  const fyDisplay = resolveSimRowLiquiditaFy(simRow);
  const liqChips = fyDisplay ? parseLiqChips(fyDisplay) : [];
  const pCont = resolveDisplayPContinuation(contRow);
  const contBand = resolveContBand(contRow);
  const contRegime = resolveContSellUiRegime(g10);
  const showPContPct =
    pCont != null && (contRegime === "in_regime" || contRegime === "missing");
  const g10Label = "D10%";
  const g10Help = it ? G10_HELP_IT : G10_HELP_EN;
  const g10Text =
    g10 != null && Number.isFinite(g10)
      ? `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%`
      : "—";
  const g10Tone =
    g10 == null || !Number.isFinite(g10)
      ? "text-ink-muted"
      : g10 >= 0
        ? "text-emerald-800"
        : "text-rose-700";

  const betaUi = beta != null ? betaDisplay(beta) : null;
  const side = layout === "side";
  const boxCls = side
    ? "rounded-md border border-[rgb(var(--border))]/45 bg-surface/50 px-1.5 py-1 min-w-0 h-full"
    : dense
      ? "rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 px-2 py-1.5 min-w-0 h-full"
      : "rounded-lg border border-[rgb(var(--panel-feed-border))]/55 bg-white/90 px-3 py-2 min-w-[5.5rem] flex-1 max-w-[10rem]";
  const valCls = side ? "text-sm" : dense ? "text-base" : "text-lg";
  const labelCls = side
    ? "text-[8px] font-semibold uppercase tracking-wide text-ink-muted/85"
    : "text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85";
  const gridCls = side
    ? "grid grid-cols-3 gap-1 items-stretch h-full min-w-0"
    : dense
      ? "grid grid-cols-1 sm:grid-cols-3 gap-1 items-stretch"
      : "flex flex-wrap items-stretch gap-2";

  return (
    <div className={gridCls}>
      <div className={boxCls} title={betaTooltipText(beta, it)}>
        <p className={labelCls}>Beta</p>
        {betaUi ? (
          <>
            <p className={`${valCls} font-bold tabular-nums leading-tight mt-0.5`} style={betaUi.style}>
              {betaUi.text}
              {betaUi.icon && !side ? <span className="ml-0.5 text-sm">{betaUi.icon}</span> : null}
            </p>
            {!side ? (
              <p
                className={`text-[9px] text-ink-muted/80 leading-snug mt-0.5${
                  dense ? " line-clamp-1" : " line-clamp-2"
                }`}
              >
                {betaBucketLabel(betaUi.bucket, it)}
              </p>
            ) : null}
          </>
        ) : (
          <p className={`${valCls} font-bold text-ink-muted/50 mt-0.5`}>—</p>
        )}
      </div>

      <div className={boxCls} title={liquidityTooltipText(liqScore, fyDisplay, it)}>
        <p className={labelCls}>{it ? "Liquidità" : "Liquidity"}</p>
        {liqScore != null ? (
          <p
            className={`${valCls} font-bold tabular-nums leading-tight mt-0.5 px-1 rounded`}
            style={liquidityScoreCellStyle(liqScore)}
          >
            {liqScore.toFixed(2)}
          </p>
        ) : (
          <p className={`${valCls} font-bold text-ink-muted/50 mt-0.5`}>—</p>
        )}
        {liqChips.length > 0 ? (
          <div className={`flex flex-wrap gap-0.5${side ? " mt-0.5" : dense ? " mt-0.5" : " mt-1"}`}>
            {liqChips.map((chip) => (
              <span
                key={chip.label}
                className={`inline-flex items-center gap-0.5 rounded border font-semibold tabular-nums ${LIQ_CHIP_CLS[chip.tone]} ${
                  side ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]"
                }`}
              >
                <span className="opacity-80">{chip.label}</span>
                <span>{chip.value}</span>
              </span>
            ))}
          </div>
        ) : fyDisplay && !side ? (
          <p className="text-[9px] text-ink-muted/75 leading-snug mt-1 line-clamp-2">{fyDisplay}</p>
        ) : null}
      </div>

      <div className={boxCls} title={continuationTooltipText(contRow, it)}>
        <p className={labelCls}>{it ? "P(cont.)" : "P(cont.)"}</p>
        {showPContPct && pCont != null ? (
          <p
            className={`${valCls} font-bold tabular-nums leading-tight mt-0.5 px-1 rounded inline-flex items-center gap-1`}
            style={contScoreStyle(contBand)}
          >
            {pCont >= STRONG_WIND_PCONT ? (
              <WindIcon
                className={`${side ? "w-3 h-3" : dense ? "w-3.5 h-3.5" : "w-4 h-4"} shrink-0 text-sky-600`}
              />
            ) : null}
            {Math.round(pCont)}%
          </p>
        ) : contRegime === "declining" || contRegime === "not_run" || contRegime === "in_regime" ? (
          <p
            className={`${valCls} font-bold leading-tight mt-0.5 px-1 rounded`}
            style={contScoreStyle(
              contRegime === "declining" ? "declining" : contRegime === "not_run" ? "not_run" : "low",
            )}
          >
            {contSellUiRegimeLabel(contRegime, it)}
          </p>
        ) : (
          <p className={`${valCls} font-bold text-ink-muted/50 mt-0.5`}>—</p>
        )}
        <p
          className={`${side ? "text-[10px]" : "text-[12px]"} font-semibold tabular-nums leading-snug mt-1`}
          title={g10Help}
        >
          <span className="text-ink-muted uppercase tracking-wide text-[0.85em]">{g10Label}</span>{" "}
          <span className={`${g10Tone} font-bold`}>{g10Text}</span>
        </p>
        {pCont != null && !side ? (
          <p
            className={`text-[9px] text-ink-muted/80 leading-snug mt-0.5${
              dense ? " line-clamp-1" : " line-clamp-2"
            }`}
          >
            {contBandLabel(contBand, it)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
