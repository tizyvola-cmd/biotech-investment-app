/** Colonna compatta: torta avanzamento + target price $ (rialzo) o freccia ↓ (calo). */

import {
  computeTargetProgress,
  resolveModelTargetDisplay,
} from "../sheet/simRowTargetStop";
import { formatSignedPct } from "../sheet/expectedRoiDisplay";
import { fmtSignedUsdPnl } from "../sheet/portfolioGainLossStyle";
import { positionGainUsd } from "../sheet/simulationPosition";
import { useLang, useT } from "../shared/i18n";
import { isPlanTargetReached } from "./PortfolioPlanTargetChip";
import { TargetDistanceDonut } from "./TargetDistanceDonut";

function fmtCompactUsd(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function ModelTargetPriceCell({
  simRow,
  columns,
  currPriceUsd,
  planReturnPct,
  buyPriceUsd,
  inPortfolio,
  showProgress = true,
  daysToTarget,
  suggestedAction,
  pnlPct,
  pnlUsd,
  shares,
}: {
  simRow: Record<string, unknown> | undefined;
  columns?: string[];
  currPriceUsd: number | null;
  planReturnPct?: number | null;
  buyPriceUsd?: number | null;
  inPortfolio?: boolean;
  /** Mostra mini-torta distanza target (default on). */
  showProgress?: boolean;
  /** Giorni stimati per raggiungere il target (sotto al prezzo). */
  daysToTarget?: number | null;
  /** SELL con target piano raggiunto: mostra gain realizzato invece del prezzo obiettivo. */
  suggestedAction?: string | null;
  pnlPct?: number | null;
  /** Gain totale $ — se assente, calcolato da buy/curr/shares. */
  pnlUsd?: number | null;
  shares?: number | null;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  const sellTargetReached =
    suggestedAction === "sell" &&
    inPortfolio &&
    isPlanTargetReached(pnlPct, planReturnPct);

  if (sellTargetReached) {
    const resolvedGainUsd =
      pnlUsd != null && Number.isFinite(pnlUsd)
        ? pnlUsd
        : positionGainUsd({
            shares: shares ?? 0,
            buyPrice: buyPriceUsd ?? 0,
            currPrice: currPriceUsd,
          });
    const pctLabel = formatSignedPct(pnlPct ?? null);
    const usdLabel = fmtSignedUsdPnl(resolvedGainUsd);
    const title = t("sim.col.targetReachedGainTip", {
      pct: pctLabel,
      usd: usdLabel,
      target: planReturnPct != null ? formatSignedPct(planReturnPct) : "—",
    });

    return (
      <span
        className="inline-flex items-center gap-1.5 min-w-[4.5rem] justify-center w-full"
        title={title}
        aria-label={title}
      >
        {showProgress ? (
          <div className="inline-flex items-center gap-1 shrink-0" style={{ width: '38px', justifyContent: 'center' }}>
            <TargetDistanceDonut ratio={1} tone="up" size={20} title={title} />
            {/* Bandiera con dollaro - target raggiunto */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              className="shrink-0"
            >
              <g transform="translate(12, 12)">
                {/* Pole */}
                <line x1="0" y1="-8" x2="0" y2="8" stroke="rgb(var(--signal-up))" strokeWidth="1.5" />
                {/* Flag */}
                <path
                  d="M 0,-8 L 8,-6 L 8,-2 L 0,-4 Z"
                  fill="rgb(var(--signal-up))"
                  stroke="rgb(var(--signal-up))"
                  strokeWidth="0.5"
                />
                {/* Dollar sign */}
                <text
                  x="4"
                  y="-3"
                  fontSize="6"
                  fontWeight="bold"
                  fill="white"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  $
                </text>
              </g>
            </svg>
          </div>
        ) : null}
        <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
          <span className="inline-block text-[11px] font-semibold tabular-nums text-[rgb(var(--signal-up))] leading-tight max-w-[3.75rem] truncate">
            {usdLabel}
          </span>
          <span className="text-[11px] tabular-nums text-[rgb(var(--signal-up))]/90 leading-none font-medium">
            {pctLabel}
          </span>
        </span>
      </span>
    );
  }

  if (!simRow) {
    return <span className="text-ink-muted/35 text-[11px]">·</span>;
  }

  const display = resolveModelTargetDisplay(
    simRow,
    currPriceUsd,
    columns,
    planReturnPct,
  );

  if (!display) {
    return <span className="text-ink-muted/35 text-[11px]">·</span>;
  }

  const tooltipBase = it ? display.tooltipIt : display.tooltipEn;
  const progress = computeTargetProgress(display, currPriceUsd, {
    buyPriceUsd,
    inPortfolio,
  });
  const progressLabel =
    progress.ratio != null
      ? it
        ? `${Math.round(progress.ratio * 100)}% verso target`
        : `${Math.round(progress.ratio * 100)}% toward target`
      : display.mode === "fall"
        ? it
          ? "Modello in calo — nessun target rialzo"
          : "Model declining — no upside target"
        : it
          ? "Target non disponibile"
          : "Target unavailable";
  const title = `${tooltipBase} · ${progressLabel}${
    daysToTarget != null && daysToTarget > 0
      ? it
        ? ` · ~${daysToTarget}g al target`
        : ` · ~${daysToTarget}d to target`
      : ""
  }`;

  const priceNode =
    display.mode === "fall" ? (
      <span
        className="inline-flex items-center justify-center text-[rgb(var(--signal-down))] font-bold text-[11px] leading-none"
        aria-hidden
      >
        ↓
      </span>
    ) : display.mode === "rise" && display.targetPriceUsd != null ? (
      <span className="inline-block text-[11px] font-semibold tabular-nums text-[rgb(var(--signal-up))] leading-tight max-w-[3.25rem] truncate">
        {fmtCompactUsd(display.targetPriceUsd)}
      </span>
    ) : (
      <span className="text-ink-muted/45 text-[11px] font-medium">~</span>
    );

  const daysNode =
    daysToTarget != null && daysToTarget > 0 ? (
      <span className="text-[11px] tabular-nums text-ink-muted/75 leading-none">
        {daysToTarget}d
      </span>
    ) : null;

  return (
    <span
      className="inline-flex items-center gap-1.5 min-w-[4.5rem] justify-center w-full"
      title={title}
      aria-label={title}
    >
      {showProgress ? (
        <div className="inline-flex items-center shrink-0" style={{ width: '38px', justifyContent: 'center' }}>
          <TargetDistanceDonut
            ratio={progress.ratio}
            tone={progress.tone}
            size={20}
            title={progressLabel}
          />
        </div>
      ) : null}
      <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
        {priceNode}
        {daysNode}
      </span>
    </span>
  );
}
