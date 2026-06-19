/**
 * ROI atteso verso CD — giorni, %, moltiplicatore, € (Decision Lab + Simulation).
 */
import type { ExpectedGainSource } from "./simulationPlanGain";
import {
  portfolioToneSignalClass,
  resolveModelMetricTone,
  type PortfolioPnlTone,
} from "./portfolioGainLossStyle";

export const DEFAULT_PLAN_CAPITAL_EUR = 5000;

export type ExpectedRoiParts = {
  days: number | null;
  returnPct: number | null;
  capitalEur: number;
  gainEur: number | null;
  multiplierLabel: string;
};

export function roiMultiplierFromPct(pct: number): number {
  return 1 + pct / 100;
}

export function formatRoiMultiplier(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${roiMultiplierFromPct(pct).toFixed(2)}×`;
}

export function expectedGainEurFromPct(pct: number | null, capitalEur: number): number | null {
  if (pct == null || !Number.isFinite(pct) || capitalEur <= 0) return null;
  return Math.round((capitalEur * pct) / 100 * 100) / 100;
}

export function formatSignedPct(pct: number | null, digits = 1): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatGainEurSigned(eur: number | null): string {
  if (eur == null || !Number.isFinite(eur)) return "—";
  const sign = eur > 0 ? "+" : "";
  return `${sign}${eur.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

export function formatInvestmentDays(lang: "it" | "en", days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days <= 0) return lang === "it" ? "CD passata / oggi" : "CD passed / today";
  if (lang === "it") {
    return days === 1 ? "1 giorno fino al CD" : `${days} giorni fino al CD`;
  }
  return days === 1 ? "1 day to CD" : `${days} days to CD`;
}

export function buildExpectedRoiParts(
  days: number | null,
  returnPct: number | null,
  capitalEur: number,
): ExpectedRoiParts {
  const cap = capitalEur > 0 ? capitalEur : DEFAULT_PLAN_CAPITAL_EUR;
  return {
    days,
    returnPct,
    capitalEur: cap,
    gainEur: expectedGainEurFromPct(returnPct, cap),
    multiplierLabel: formatRoiMultiplier(returnPct),
  };
}

export function expectedRoiSourceLabel(
  lang: "it" | "en",
  source: ExpectedGainSource | undefined,
): string {
  if (source === "slope_target") {
    return lang === "it"
      ? "Target dinamico da pendenza curva (legacy)"
      : "Dynamic slope target (legacy)";
  }
  if (source === "precat") {
    return lang === "it"
      ? "Pendenza effettiva × giorni al CD"
      : "Effective slope × days to CD";
  }
  if (source === "curve_model") {
    return lang === "it"
      ? "Δ curva modello (oggi → CD)"
      : "Model curve delta (today → CD)";
  }
  if (source === "pred_horizon") {
    return lang === "it"
      ? "Modello scalato all'orizzonte CD"
      : "Model scaled to CD horizon";
  }
  return lang === "it"
    ? "Stima pre-CD (non Pred +5 isolato)"
    : "Pre-CD estimate (not isolated Pred +5)";
}

export function targetRoiTooltip(
  lang: "it" | "en",
  parts: ExpectedRoiParts,
  targetHighPct?: number | null,
): string {
  const days =
    parts.days != null && Number.isFinite(parts.days)
      ? lang === "it"
        ? parts.days === 1
          ? "1 giorno al target"
          : `${parts.days} giorni al target`
        : parts.days === 1
          ? "1 day to target"
          : `${parts.days} days to target`
      : "—";
  const band =
    targetHighPct != null && Number.isFinite(targetHighPct)
      ? lang === "it"
        ? ` · banda +${parts.returnPct != null ? parts.returnPct.toFixed(1) : "—"}% → +${targetHighPct.toFixed(1)}%`
        : ` · band +${parts.returnPct != null ? parts.returnPct.toFixed(1) : "—"}% → +${targetHighPct.toFixed(1)}%`
      : "";
  const cap = parts.capitalEur.toLocaleString("it-IT");
  if (lang === "it") {
    return `ROI al target: fine del tratto in salita sulla curva (plateau o discesa), non al CD. Orizzonte: ${days}${band}. ${formatSignedPct(parts.returnPct)} (${parts.multiplierLabel}) = ${formatGainEurSigned(parts.gainEur)} su €${cap}.`;
  }
  return `ROI at target: end of predicted rise segment on the curve (plateau or downturn), not CD. Horizon: ${days}${band}. ${formatSignedPct(parts.returnPct)} (${parts.multiplierLabel}) = ${formatGainEurSigned(parts.gainEur)} on €${cap}.`;
}

type TargetRoiCellProps = {
  lang: "it" | "en";
  daysToTarget: number | null;
  returnPct: number | null;
  capitalEur?: number;
  targetHighPct?: number | null;
  variant?: "table" | "inline";
  slope5d?: number | null;
  slope20d?: number | null;
  /** ``forward``: colore dal segno ROI atteso; ``market``: pendenza mercato (legacy). */
  colorMode?: "forward" | "market";
  currentPriceUsd?: number | null;
};

/** ROI al target dinamico — orizzonte più corto del CD. */
export function TargetRoiCell({
  lang,
  daysToTarget,
  returnPct,
  capitalEur = DEFAULT_PLAN_CAPITAL_EUR,
  targetHighPct,
  variant = "table",
  slope5d,
  slope20d,
  colorMode = "forward",
  currentPriceUsd,
}: TargetRoiCellProps) {
  if (returnPct == null) {
    return variant === "table" ? (
      <span className="text-ink-muted text-[10px]">—</span>
    ) : null;
  }

  const parts = buildExpectedRoiParts(daysToTarget, returnPct, capitalEur);
  const tip = `${targetRoiTooltip(lang, parts, targetHighPct)}${
    lang === "it"
      ? " Non è il P&L attuale — solo gain atteso se il prezzo raggiunge il target dinamico."
      : " Not current P&L — expected gain if price reaches the dynamic target."
  }`;
  const tone: PortfolioPnlTone =
    colorMode === "market"
      ? resolveModelMetricTone(returnPct, slope5d, slope20d)
      : returnPct > 0
        ? "gain"
        : returnPct < 0
          ? "loss"
          : "flat";
  const pctCls = portfolioToneSignalClass(tone);

  if (variant === "inline") {
    return (
      <p className="text-[9px] decision-lab-muted leading-tight tabular-nums" title={tip}>
        {lang === "it" ? "Target" : "Target"}:{" "}
        <span className={`font-semibold ${pctCls}`}>{formatSignedPct(returnPct)}</span>
        {daysToTarget != null && daysToTarget > 0 ? (
          <>
            {" · "}
            <span>{daysToTarget}d</span>
          </>
        ) : null}
      </p>
    );
  }

  // Calculate target price in USD if currentPriceUsd is available
  const targetPriceUsd =
    currentPriceUsd != null && currentPriceUsd > 0 && returnPct != null
      ? currentPriceUsd * (1 + returnPct / 100)
      : null;

  return (
    <div className="text-[11px] leading-snug tabular-nums" title={tip}>
      <div className={`font-semibold ${pctCls}`}>{formatSignedPct(returnPct)}</div>
      <div className="text-[10px] text-ink-muted/90 mt-0.5">
        {daysToTarget != null && daysToTarget > 0 ? (
          <span>{daysToTarget}d</span>
        ) : (
          <span>—</span>
        )}
        {" · "}
        <span>{parts.multiplierLabel}</span>
        {parts.gainEur != null ? (
          <>
            {" · "}
            <span className={pctCls}>{formatGainEurSigned(parts.gainEur)}</span>
          </>
        ) : null}
      </div>
      {targetPriceUsd != null && (
        <div className="text-[10px] text-ink-muted/90 mt-0.5">
          Target: ${targetPriceUsd.toFixed(2)}
        </div>
      )}
    </div>
  );
}

export function expectedRoiTooltip(
  lang: "it" | "en",
  parts: ExpectedRoiParts,
  source?: ExpectedGainSource,
): string {
  const src = expectedRoiSourceLabel(lang, source);
  const days = formatInvestmentDays(lang, parts.days);
  const cap = parts.capitalEur.toLocaleString("it-IT");
  if (lang === "it") {
    return `${src}. Orizzonte: ${days}. ROI atteso ${formatSignedPct(parts.returnPct)} (${parts.multiplierLabel}) = ${formatGainEurSigned(parts.gainEur)} su capitale €${cap}.`;
  }
  return `${src}. Horizon: ${days}. Expected ROI ${formatSignedPct(parts.returnPct)} (${parts.multiplierLabel}) = ${formatGainEurSigned(parts.gainEur)} on €${cap} capital.`;
}

type ExpectedRoiCellProps = {
  lang: "it" | "en";
  days: number | null;
  returnPct: number | null;
  capitalEur?: number;
  source?: ExpectedGainSource;
  /** Card layout: larger primary % + sub-lines */
  variant?: "table" | "card" | "hero";
  /** Tighter hero layout for opportunity cards */
  dense?: boolean;
  slope5d?: number | null;
  slope20d?: number | null;
};

export function ExpectedRoiCell({
  lang,
  days,
  returnPct,
  capitalEur = DEFAULT_PLAN_CAPITAL_EUR,
  source,
  variant = "table",
  dense = false,
  slope5d,
  slope20d,
}: ExpectedRoiCellProps) {
  const parts = buildExpectedRoiParts(days, returnPct, capitalEur);
  const tip = expectedRoiTooltip(lang, parts, source);
  const pctCls = portfolioToneSignalClass(
    resolveModelMetricTone(returnPct, slope5d, slope20d),
  );

  if (returnPct == null && days == null) {
    return <span className="text-ink-muted">—</span>;
  }

  if (variant === "hero" || variant === "card") {
    const isHero = variant === "hero";
    const heroDense = isHero && dense;
    return (
      <div title={tip} className={isHero ? (heroDense ? "space-y-1" : "space-y-2") : undefined}>
        {heroDense ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              {returnPct != null ? (
                <p className={`text-lg sm:text-xl font-bold tabular-nums tracking-tight leading-none ${pctCls}`}>
                  {parts.multiplierLabel}{" "}
                  <span className="text-sm sm:text-base font-semibold opacity-90">
                    ({formatSignedPct(returnPct)})
                  </span>
                </p>
              ) : (
                <p className="decision-lab-muted text-sm">—</p>
              )}
              <p className="text-[11px] decision-lab-text leading-tight shrink-0">
                {lang === "it" ? "Orizz." : "Horiz."}{" "}
                <span className="font-semibold tabular-nums">{formatInvestmentDays(lang, days)}</span>
              </p>
            </div>
            {parts.gainEur != null ? (
              <p className={`text-xs sm:text-[13px] font-semibold tabular-nums leading-snug ${pctCls}`}>
                {formatGainEurSigned(parts.gainEur)}
                {" · "}
                <span className="font-medium opacity-90">
                  {lang === "it" ? "su" : "on"} €{parts.capitalEur.toLocaleString("it-IT")}
                </span>
              </p>
            ) : (
              <p className="text-xs sm:text-[13px] decision-lab-muted tabular-nums leading-snug">
                {lang === "it" ? "su" : "on"} €{parts.capitalEur.toLocaleString("it-IT")}
              </p>
            )}
          </>
        ) : (
          <>
            {returnPct != null ? (
              <p
                className={`font-bold tabular-nums tracking-tight ${pctCls} ${
                  isHero ? "text-3xl sm:text-4xl leading-none" : "text-base"
                }`}
              >
                {formatSignedPct(returnPct)}
              </p>
            ) : (
              <p className="decision-lab-muted text-sm">—</p>
            )}
            <p
              className={`decision-lab-text leading-snug ${
                isHero ? "text-sm font-medium" : "text-[10px] mt-1"
              }`}
            >
              {lang === "it" ? "Orizzonte" : "Horizon"}:{" "}
              <span className="font-semibold tabular-nums">{formatInvestmentDays(lang, days)}</span>
            </p>
          </>
        )}
        {!heroDense ? (
          <p
            className={`decision-lab-muted leading-snug tabular-nums ${
              isHero ? "text-xs sm:text-sm" : "text-[10px] mt-0.5"
            }`}
          >
            <span className={`font-semibold ${pctCls}`}>{formatSignedPct(returnPct)}</span>
            {" · "}
            <span className="font-semibold">{parts.multiplierLabel}</span>
            {parts.gainEur != null ? (
              <>
                {" · "}
                <span className={`font-semibold ${pctCls}`}>{formatGainEurSigned(parts.gainEur)}</span>
              </>
            ) : null}
            {" · "}
            <span className="opacity-85">
              {lang === "it" ? "su" : "on"} €{parts.capitalEur.toLocaleString("it-IT")}
            </span>
          </p>
        ) : null}
        {!isHero ? (
          <p className="text-[9px] decision-lab-muted mt-0.5 leading-tight italic">
            {expectedRoiSourceLabel(lang, source)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-[11px] leading-snug tabular-nums text-center" title={tip}>
      <div className={`font-semibold ${pctCls}`}>{formatSignedPct(returnPct)}</div>
      <div className="text-[10px] text-ink-muted/90 mt-0.5">
        <span>{parts.multiplierLabel}</span>
        {parts.gainEur != null ? (
          <>
            {" · "}
            <span className={pctCls}>{formatGainEurSigned(parts.gainEur)}</span>
          </>
        ) : null}
      </div>
      <div className="text-[10px] text-ink-muted/90 mt-0.5">
        {days != null && days > 0 ? <span>{days}d</span> : <span>—</span>}
      </div>
    </div>
  );
}
