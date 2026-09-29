/**
 * Compact 10-session run % badge for tables (cont_g10).
 * Sell-only: declining / not-run / in-regime (wind). Label lives in the column header.
 */
import type { ReactNode } from "react";
import {
  P_CONT_SELL_MIN_G10,
  contSellUiRegimeLabel,
  resolveContSellUiRegime,
  type ContSellUiRegime,
} from "../sheet/continuationScore";

export function WindIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  );
}

/** Short column header — replaces cryptic “G10”. */
export function contRunHeaderLabel(it: boolean): string {
  return it ? "10g %" : "10d %";
}

/** Longer name for modals / tooltips. */
export function contRunLongLabel(it: boolean): string {
  return it ? "Corsa a 10 giorni" : "10-day run";
}

/** g10 = % change over the last ~10 trading sessions (close[-10] → close[-1]). */
export const G10_HELP_IT =
  "D10% = quanto è cresciuto il titolo in percentuale negli ultimi 10 giorni.";
export const G10_HELP_EN =
  "D10% = how much the price has grown, in percent, over the last 10 days.";

export function ContG10Badge({
  g10,
  it,
  dense = false,
}: {
  g10: number | null | undefined;
  it: boolean;
  dense?: boolean;
}) {
  const help = it ? G10_HELP_IT : G10_HELP_EN;
  if (g10 == null || !Number.isFinite(g10)) {
    return (
      <span className="text-ink-muted tabular-nums" title={help}>
        —
      </span>
    );
  }
  const gLabel = `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%`;
  const declining = g10 < 0;
  const inRegime = g10 >= P_CONT_SELL_MIN_G10;
  const iconCls = dense ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0";

  if (declining) {
    if (dense) {
      return (
        <span
          className="inline-flex items-center gap-0.5 text-[9px] font-semibold tabular-nums text-rose-700"
          title={help}
        >
          {gLabel}
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col items-end gap-0 leading-tight" title={help}>
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase text-rose-700">
          {it ? "in calo" : "declining"}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tabular-nums text-rose-700/90">
          {gLabel}
        </span>
      </span>
    );
  }

  if (inRegime) {
    return (
      <span className="inline-flex items-center gap-1 text-sky-800" title={help}>
        <WindIcon className={`${iconCls} text-sky-600`} />
        <span className={`${dense ? "text-[9px]" : "text-[10px]"} font-semibold tabular-nums`}>
          {gLabel}
        </span>
      </span>
    );
  }

  // 0 ≤ g10 < 5%: has not run yet (too little rally for sell-exhaustion)
  return (
    <span className="inline-flex items-center gap-1 text-ink-muted" title={help}>
      <WindIcon className={`${iconCls} opacity-50`} />
      <span className="inline-flex flex-col items-start leading-tight">
        <span className={`${dense ? "text-[9px]" : "text-[10px]"} font-semibold tabular-nums`}>
          {gLabel}
        </span>
        {!dense ? (
          <span className="text-[8px] font-medium uppercase">
            {it ? "non ancora in corsa" : "not run yet"}
          </span>
        ) : null}
      </span>
    </span>
  );
}

const PCONT_HELP_IT =
  "P(cont) = probabilità empirica che la corsa tenga («vento»), non il prezzo. In regime con 10g % ≥ +5%. Fuori soglia: stato (in calo / corsa nascente), non una P bassa.";
const PCONT_HELP_EN =
  "P(cont) = empirical odds the run holds (“wind”), not price. In sell regime when 10d % ≥ +5%. Below threshold: status (declining / early run), not a low P.";

function formatContG10Line(g10: number): string {
  return `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%`;
}

/**
 * P(cont) cell: wind + % when in sell regime; regime status otherwise.
 * Always shows 10d % underneath when available (same number as the 10d column).
 */
export function ContPContBadge({
  pCont,
  g10,
  it,
  dense = false,
  uniform = false,
  regime: regimeIn,
}: {
  pCont: number | null | undefined;
  g10?: number | null;
  it: boolean;
  dense?: boolean;
  /** Match KPI snapshot table typography (10px medium). */
  uniform?: boolean;
  regime?: ContSellUiRegime;
}) {
  const help = it ? PCONT_HELP_IT : PCONT_HELP_EN;
  const regime = regimeIn ?? resolveContSellUiRegime(g10);
  const iconCls = dense ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0";
  const pctCls = uniform ? "text-[10px] font-medium" : dense ? "text-[9px]" : "text-[10px]";
  const labelWeight = uniform ? "font-medium" : "font-semibold";
  const pctWeight = uniform ? "font-medium" : "font-bold";
  const g10Line =
    g10 != null && Number.isFinite(g10) ? (
      <span
        className={`tabular-nums ${
          uniform ? "text-[9px] font-medium" : dense ? "text-[8px] font-semibold" : "text-[9px] font-semibold"
        } ${g10 >= 0 ? "text-sky-800" : "text-rose-700"}`}
        title={it ? G10_HELP_IT : G10_HELP_EN}
      >
        {it ? "10g " : "10d "}
        {formatContG10Line(g10)}
      </span>
    ) : null;

  let primary: ReactNode;
  if (regime === "in_regime" && pCont != null && Number.isFinite(pCont)) {
    const weak = pCont < 50;
    primary = (
      <span
        className={`inline-flex items-center justify-end gap-0.5 tabular-nums ${pctWeight} ${
          weak ? "text-rose-700" : "text-emerald-700"
        }`}
      >
        <WindIcon className={`${iconCls} ${weak ? "text-rose-600" : "text-sky-600"}`} />
        <span className={pctCls}>{Math.round(pCont)}%</span>
      </span>
    );
  } else if (regime === "declining") {
    primary = (
      <span
        className={`inline-flex items-center justify-end gap-0.5 uppercase text-rose-700 ${labelWeight} ${pctCls}`}
      >
        {contSellUiRegimeLabel("declining", it)}
      </span>
    );
  } else if (regime === "not_run") {
    primary = (
      <span
        className={`inline-flex items-center justify-end gap-0.5 text-amber-800 ${labelWeight} ${pctCls}`}
      >
        <WindIcon className={`${iconCls} opacity-45 text-amber-700`} />
        <span className="uppercase">{contSellUiRegimeLabel("not_run", it)}</span>
      </span>
    );
  } else {
    primary = (
      <span className={`text-ink-muted font-medium tabular-nums ${pctCls}`}>
        {contSellUiRegimeLabel(regime, it)}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0 leading-tight" title={help}>
      {primary}
      {g10Line}
    </span>
  );
}
