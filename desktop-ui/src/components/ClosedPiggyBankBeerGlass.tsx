import { useId } from "react";
import { useT } from "../shared/i18n";
import type { ClosedPiggyBankDisplay } from "../sheet/closedPiggyBank";
import { closedPiggyResetConfirmVars } from "../sheet/closedPiggyBank";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";

function fmtUsd(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtEur(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}€ ${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pinta — birra gialla + schiuma in proporzione al gain; perdita = bicchiere vuoto con birra versata. */
export function BeerGlassIcon({
  fillPct,
  isLoss,
  size = 56,
}: {
  fillPct: number;
  isLoss: boolean;
  size?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(100, fillPct));
  const h = Math.round(size * (76 / 56));
  const w = size;

  // Inner cavity: y 20 (below rim) → 58 (bottom)
  const innerTop = 20;
  const innerBottom = 58;
  const innerH = innerBottom - innerTop;
  const liquidTop = innerBottom - (pct / 100) * innerH;
  const foamH = pct > 0 ? Math.min(11, 2.5 + (pct / 100) * 9) : 0;
  const foamTop = liquidTop - foamH;
  const hasBeer = !isLoss && pct > 0;

  const glassBody =
    "M 17 14 L 19 16 L 21 57 Q 28 62 35 57 L 37 16 L 39 14 Q 28 10 17 14 Z";
  const glassInner =
    "M 20 19 L 21.5 56 Q 28 59.5 34.5 56 L 36 19 Q 28 17 20 19 Z";

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 56 76"
      className="closed-piggy-beer-glass shrink-0"
      aria-hidden
    >
      <defs>
        <clipPath id={`beer-inner-${uid}`}>
          <path d={glassInner} />
        </clipPath>
        <linearGradient id={`beer-liquid-${uid}`} x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="75%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={`beer-foam-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
        <linearGradient id={`glass-shine-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`spill-puddle-${uid}`} cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="70%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" stopOpacity="0.85" />
        </radialGradient>
      </defs>

      {/* perdita — birra versata fuori (sotto il bicchiere) */}
      {isLoss ? (
        <g className="beer-spill">
          <ellipse cx="34" cy="71" rx="16" ry="4.2" fill={`url(#spill-puddle-${uid})`} opacity="0.92" />
          <ellipse cx="30" cy="69.5" rx="9" ry="2" fill="#fde047" opacity="0.55" />
          <path
            d="M 37 18 Q 40 28 39 38 Q 38 48 41 58 Q 42 63 38 67"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M 38 17 Q 41 24 40 32"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
          <ellipse cx="42" cy="66" rx="2.8" ry="1.6" fill="#fbbf24" opacity="0.7" />
          <ellipse cx="36" cy="68" rx="1.8" ry="1" fill="#fde047" opacity="0.6" />
        </g>
      ) : null}

      {/* corpo vetro (pinta) */}
      <path
        d={glassBody}
        fill="rgb(var(--surface))"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
        className="text-ink-muted/55"
      />
      <path d={glassBody} fill={`url(#glass-shine-${uid})`} stroke="none" pointerEvents="none" />

      {/* birra + schiuma */}
      {hasBeer ? (
        <g clipPath={`url(#beer-inner-${uid})`}>
          <rect
            x="18"
            y={liquidTop}
            width="20"
            height={innerBottom - liquidTop + 2}
            fill={`url(#beer-liquid-${uid})`}
          />
          {/* schiuma — altezza proporzionale al riempimento */}
          <path
            d={`M 20 ${foamTop + foamH * 0.55}
               Q 23 ${foamTop - 1.2} 26 ${foamTop + foamH * 0.35}
               Q 29 ${foamTop - 0.8} 32 ${foamTop + foamH * 0.5}
               Q 34 ${foamTop - 1.5} 36 ${foamTop + foamH * 0.6}
               L 36 ${liquidTop + 1.5}
               Q 28 ${liquidTop + 2.8} 20 ${liquidTop + 1.5}
               Z`}
            fill={`url(#beer-foam-${uid})`}
          />
          <ellipse cx="24" cy={foamTop + foamH * 0.35} rx="3.2" ry="1.5" fill="#fff" opacity="0.9" />
          <ellipse cx="31" cy={foamTop + foamH * 0.25} rx="2.4" ry="1.1" fill="#fff" opacity="0.75" />
          <ellipse cx="27" cy={foamTop + foamH * 0.55} rx="1.8" ry="0.9" fill="#fff" opacity="0.65" />
          {/* bollicine */}
          {pct > 25 ? (
            <>
              <circle cx="25" cy={liquidTop + 8} r="0.9" fill="#fff" opacity="0.35" />
              <circle cx="30" cy={liquidTop + 14} r="0.7" fill="#fff" opacity="0.28" />
            </>
          ) : null}
        </g>
      ) : null}

      {/* bordo / orlo pinta */}
      <ellipse
        cx="28"
        cy="14"
        rx="11"
        ry="2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        className="text-ink-muted/50"
      />
      <ellipse cx="28" cy="14.5" rx="8.5" ry="1.6" fill="rgb(var(--surface-2))" opacity="0.35" />

      {/* contorno interno (profondità vetro) */}
      <path
        d={glassInner}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-ink-muted/25"
        pointerEvents="none"
      />
    </svg>
  );
}

function closedPiggyResetMessage(
  display: ClosedPiggyBankDisplay,
  t: (key: import("../shared/i18n").TranslationKey, vars?: Record<string, string>) => string,
): string {
  const vars = closedPiggyResetConfirmVars(display);
  if (vars.hasBaseline) {
    return t("closedPiggy.resetConfirm", { display: vars.display, raw: vars.raw });
  }
  return t("closedPiggy.resetConfirmFirst", { amount: vars.raw });
}

export function ClosedPiggyBankBeerGlass({
  display,
  onReset,
  compact = false,
  showExplain = true,
}: {
  display: ClosedPiggyBankDisplay;
  onReset: () => void;
  compact?: boolean;
  showExplain?: boolean;
}) {
  const t = useT();
  const isLoss = display.pnlEur < -0.01;
  const isGain = display.pnlEur > 0.01;
  const noClosed = display.positionCount === 0;
  const pnlColor = noClosed
    ? "text-ink-muted"
    : portfolioPnlAccentClass(display.pnlEur).trim() || "text-ink";

  const handleReset = () => {
    if (typeof window !== "undefined" && window.confirm(closedPiggyResetMessage(display, t))) {
      onReset();
    }
  };

  return (
    <div
      className={`closed-piggy-bank-panel rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/60 ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <BeerGlassIcon fillPct={display.fillPct} isLoss={isLoss && !noClosed} size={compact ? 48 : 56} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[9px] uppercase tracking-widest font-semibold text-ink-muted leading-none">
              {t("closedPiggy.title")}
            </p>
            {!noClosed ? (
              <span className="text-[9px] tabular-nums text-ink-muted/80">
                {t("closedPiggy.count", { n: display.positionCount })}
              </span>
            ) : null}
          </div>
          <p
            className={`${compact ? "text-xl" : "text-2xl"} font-bold tabular-nums leading-none tracking-tight ${pnlColor}`}
            title={t("closedPiggy.pnlTip")}
          >
            {noClosed ? "—" : fmtEur(display.pnlEur)}
          </p>
          {!noClosed ? (
            <p className="text-[10px] tabular-nums text-ink-muted/90 leading-snug">
              {display.pnlPct >= 0 ? "+" : ""}
              {display.pnlPct.toFixed(2)}% · {t("closedPiggy.onCapital")}{" "}
              {fmtEur(display.capitalEur).replace(/^[+−]/, "")}
            </p>
          ) : (
            <p className="text-[10px] text-ink-muted/85 leading-snug">{t("closedPiggy.empty")}</p>
          )}
          {!noClosed && closedPiggyResetConfirmVars(display).hasBaseline ? (
            <p className="text-[9px] tabular-nums text-ink-muted/75 leading-snug">
              {t("closedPiggy.sinceResetNote", {
                raw: display.rawPnlEur.toFixed(2),
              })}
            </p>
          ) : null}
          {!noClosed && isGain ? (
            <p className="text-[9px] text-amber-700/90 dark:text-amber-300/90">{t("closedPiggy.gainFill")}</p>
          ) : null}
          {!noClosed && isLoss ? (
            <p className="text-[9px] text-[rgb(var(--signal-down))]/90">{t("closedPiggy.lossEmpty")}</p>
          ) : null}
          {showExplain ? (
            <p className="text-[9px] text-ink-muted/75 leading-snug max-w-[22rem]">{t("closedPiggy.explain")}</p>
          ) : null}
        </div>
        {!noClosed ? (
          <button
            type="button"
            onClick={handleReset}
            className="shrink-0 rounded-md border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/60 px-2 py-1 text-[10px] font-medium text-ink-muted hover:border-[rgb(var(--accent))]/35 hover:text-ink transition-colors"
            title={t("closedPiggy.resetTip")}
          >
            {t("closedPiggy.reset")}
          </button>
        ) : null}
      </div>
      {!noClosed && display.tickers.length > 0 ? (
        <p className="mt-2 text-[9px] text-ink-muted/70 truncate" title={display.tickers.join(", ")}>
          {display.tickers.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** Compatto per la dashboard — solo bicchiere + importo. */
export function ClosedPiggyBankCompact({
  display,
  onReset,
  onOpenDetail,
}: {
  display: ClosedPiggyBankDisplay;
  onReset: () => void;
  onOpenDetail?: () => void;
}) {
  const t = useT();
  if (display.positionCount === 0) return null;
  const isLoss = display.pnlEur < -0.01;
  const pnlColor = portfolioPnlAccentClass(display.pnlEur).trim() || "text-ink";

  return (
    <div className="closed-piggy-bank-compact shrink-0 flex flex-col items-center gap-0.5 min-w-[4.25rem]">
      <button
        type="button"
        onClick={onOpenDetail}
        className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-0.5 hover:bg-[rgb(var(--surface-2))]/50 transition-colors"
        title={t("closedPiggy.openLedger")}
      >
        <BeerGlassIcon fillPct={display.fillPct} isLoss={isLoss} size={44} />
        <span className={`text-[10px] font-bold tabular-nums leading-none ${pnlColor}`}>
          {fmtUsd(display.pnlEur)}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted/75 leading-none">
          {t("closedPiggy.short")}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(closedPiggyResetMessage(display, t))) onReset();
        }}
        className="text-[10px] text-ink-muted/60 hover:text-ink underline-offset-2 hover:underline"
      >
        {t("closedPiggy.reset")}
      </button>
    </div>
  );
}
