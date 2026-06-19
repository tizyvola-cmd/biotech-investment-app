import type { SynthGainImpact } from "../sheet/threePortfolioCompare";
import type { PortfolioSizingSuccessComparison } from "../sheet/portfolioWeightedSizing";
import type { DealUniverseRealizedSuccess } from "../sheet/portfolioSuccessBridge";
import { useEffect, useState } from "react";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";

export type PortfolioBalancingSuccessRow = {
  success: PortfolioSizingSuccessComparison;
  realized: DealUniverseRealizedSuccess;
  /** Extra 24h P&L vs equal € from approved weights (same date as chart). */
  gainWeight24h: SynthGainImpact;
  /** Extra 24h P&L vs equal € from synth mix (same date as chart). */
  gainSynth24h: SynthGainImpact;
};

function fmtEur(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtPctFrac(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtPp(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function fmtRelUplift(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function toneClass(v: number): string {
  if (v > 0) return "text-emerald-700 dark:text-emerald-300";
  if (v < 0) return "text-rose-700 dark:text-rose-300";
  return "text-ink-muted";
}

function fmtProbPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function SuccessRow({
  label,
  accent,
  row,
  it,
}: {
  label: string;
  accent: string;
  row: PortfolioBalancingSuccessRow;
  it: boolean;
}) {
  const { success, realized, gainWeight24h, gainSynth24h } = row;
  const baseProb = success.equal.probNetAtTargetPct;
  const deltaWeight =
    success.weighted != null
      ? success.weighted.probNetAtTargetPct - baseProb
      : null;
  const deltaSynth = success.synth.probNetAtTargetPct - baseProb;

  return (
    <tr className="border-b border-[rgb(var(--border))]/30 align-middle">
      <td className="py-2 pr-3">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          {label}
        </span>
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {realized.winRatePct != null ? (
          <span
            className="font-semibold text-violet-800 dark:text-violet-200"
            title={
              it
                ? `Win rate realizzato su ${realized.sampleSize} round-trip chiusi nel universe (${realized.winCount}W / ${realized.lossCount}L)`
                : `Realized win rate on ${realized.sampleSize} closed round-trips in universe (${realized.winCount}W / ${realized.lossCount}L)`
            }
          >
            {realized.winRatePct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-ink-muted/60" title={it ? "Nessun chiuso nel universe" : "No closed trades in universe"}>
            —
          </span>
        )}
        {realized.sampleSize > 0 ? (
          <span className="block text-[8px] text-ink-muted">n={realized.sampleSize}</span>
        ) : null}
      </td>
      <td className="py-2 px-2 text-right tabular-nums text-ink-muted">
        <span
          className="font-semibold text-ink"
          title={
            it
              ? "P(P&L netto portfolio ≥ €0) al capitale pieno · sizing equi · win rate osservato (no shrinkage)"
              : "P(portfolio net P&L ≥ €0) at full capital · equal sizing · raw observed win rate (no shrinkage)"
          }
        >
          {fmtProbPct(baseProb)}
        </span>
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {success.weighted ? (
          <span
            className="font-semibold text-emerald-800 dark:text-emerald-200"
            title={
              it
                ? "P(+) con pesi approvati Learning Lab (senza ottimizzazione synth)"
                : "P(+) with Learning Lab approved weights (no synth optimization)"
            }
          >
            {fmtProbPct(success.weighted.probNetAtTargetPct)}
          </span>
        ) : (
          <span className="text-ink-muted/60">—</span>
        )}
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {deltaWeight != null ? (
          <>
            <span className={`font-bold text-sm ${toneClass(deltaWeight)}`}>
              {deltaWeight >= 0 ? "+" : ""}
              {fmtProbPct(deltaWeight, 1)}
            </span>
            <span
              className={`block text-[9px] font-semibold ${toneClass(gainWeight24h.deltaPnlEur)}`}
              title={
                it
                  ? "Gain 24h cumulato extra vs equi dal bilanciamento weight (stessa data del grafico)"
                  : "Extra cumulative 24h gain vs equal from weight balancing (same chart date)"
              }
            >
              {fmtEur(gainWeight24h.deltaPnlEur)}
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        <span
          className="font-semibold text-teal-800 dark:text-teal-200"
          title={it ? "P(+) con mix Weight Sim Exp (synth)" : "P(+) with Weight Sim Exp mix (synth)"}
        >
          {fmtProbPct(success.synth.probNetAtTargetPct)}
        </span>
      </td>
      <td className="py-2 pl-2 text-right tabular-nums">
        <span className={`font-bold text-sm ${toneClass(deltaSynth)}`}>
          {deltaSynth >= 0 ? "+" : ""}
          {fmtProbPct(deltaSynth, 1)}
        </span>
        <span
          className={`block text-[9px] font-semibold ${toneClass(gainSynth24h.deltaPnlEur)}`}
          title={
            it
              ? "Gain 24h cumulato extra vs equi dal bilanciamento synth (stessa data del grafico)"
              : "Extra cumulative 24h gain vs equal from synth balancing (same chart date)"
          }
        >
          {fmtEur(gainSynth24h.deltaPnlEur)}
        </span>
      </td>
    </tr>
  );
}

function ImpactRow({
  label,
  accent,
  impact,
  it,
}: {
  label: string;
  accent: string;
  impact: SynthGainImpact;
  it: boolean;
}) {
  const hasBaseline = impact.baselineCostEur > 0;
  const hasSynth = impact.synthCostEur > 0;
  if (!hasBaseline && !hasSynth) return null;

  return (
    <tr className="border-b border-[rgb(var(--border))]/30 align-middle">
      <td className="py-2 pr-3">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          {label}
        </span>
      </td>
      <td className="py-2 px-2 text-right tabular-nums text-ink-muted">
        {hasBaseline ? (
          <>
            <span className={toneClass(impact.baselinePnlEur)}>{fmtEur(impact.baselinePnlEur)}</span>
            <span className="block text-[9px]">{fmtPctFrac(impact.baselineGainPct)}</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {hasSynth ? (
          <>
            <span className={`font-semibold ${toneClass(impact.synthPnlEur)}`}>
              {fmtEur(impact.synthPnlEur)}
            </span>
            <span className={`block text-[9px] font-semibold ${toneClass(impact.synthGainPct ?? 0)}`}>
              {fmtPctFrac(impact.synthGainPct)}
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {hasBaseline && hasSynth ? (
          <>
            <span className={`font-semibold ${toneClass(impact.deltaPnlEur)}`}>
              {fmtEur(impact.deltaPnlEur)}
            </span>
            <span className={`block text-[9px] ${toneClass(impact.deltaGainPp ?? 0)}`}>
              {fmtPp(impact.deltaGainPp)}
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pl-2 text-right tabular-nums">
        {impact.relativeGainUpliftPct != null ? (
          <span
            className={`font-bold text-sm ${toneClass(impact.relativeGainUpliftPct)}`}
            title={
              it
                ? "Quanto il gain € con synth supera quello equi (stesso denominatore)"
                : "How much synth P&L exceeds equal-€ P&L (same capital pot)"
            }
          >
            {fmtRelUplift(impact.relativeGainUpliftPct)}
          </span>
        ) : impact.baselinePnlEur === 0 && impact.synthPnlEur !== 0 ? (
          <span className="text-[9px] text-ink-muted">{it ? "n/d (equi €0)" : "n/a (equal €0)"}</span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export function SynthGainImpactPanel({
  mine24h,
  sim24h,
  mineTotal,
  simTotal,
  mineSuccess,
  simSuccess,
  synthAvailable,
  it,
}: {
  mine24h: SynthGainImpact;
  sim24h: SynthGainImpact;
  mineTotal: SynthGainImpact;
  simTotal: SynthGainImpact;
  mineSuccess: PortfolioBalancingSuccessRow | null;
  simSuccess: PortfolioBalancingSuccessRow | null;
  synthAvailable: boolean;
  it: boolean;
}) {
  const [open, setOpen] = useState(() => {
    const v = loadUiPrefsLocal().synthGainImpactOpen;
    return v == null ? false : Boolean(v);
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || disk == null || typeof disk.synthGainImpactOpen !== "boolean") {
        return;
      }
      setOpen(disk.synthGainImpactOpen);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    setOpen(next);
    saveUiPrefs({ synthGainImpactOpen: next });
  };

  const collapsedHint =
    synthAvailable && mine24h.relativeGainUpliftPct != null
      ? it
        ? `Mine ${fmtRelUplift(mine24h.relativeGainUpliftPct)} · Sim ${fmtRelUplift(sim24h.relativeGainUpliftPct)}`
        : `Mine ${fmtRelUplift(mine24h.relativeGainUpliftPct)} · Sim ${fmtRelUplift(sim24h.relativeGainUpliftPct)}`
      : null;

  const renderTable = (
    title: string,
    subtitle: string,
    mine: SynthGainImpact,
    sim: SynthGainImpact,
  ) => (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100">{title}</p>
      <p className="text-[9px] text-ink-muted mb-2 leading-snug">{subtitle}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-ink-muted border-b border-[rgb(var(--border))]/50">
              <th className="text-left font-semibold pb-1 pr-3">{it ? "Portafoglio" : "Portfolio"}</th>
              <th className="text-right font-semibold pb-1 px-2">{it ? "Equi (baseline)" : "Equal (baseline)"}</th>
              <th className="text-right font-semibold pb-1 px-2">{it ? "Con synth" : "With synth"}</th>
              <th className="text-right font-semibold pb-1 px-2">Δ</th>
              <th className="text-right font-semibold pb-1 pl-2">{it ? "Uplift gain" : "Gain uplift"}</th>
            </tr>
          </thead>
          <tbody>
            <ImpactRow label="Mine" accent="#0d9488" impact={mine} it={it} />
            <ImpactRow label="Sim loop" accent="#db2777" impact={sim} it={it} />
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <details
      open={open}
      onToggle={onToggle}
      className="rounded-xl border border-teal-500/35 bg-teal-500/5 dark:bg-teal-950/20 shrink-0 group"
    >
      <summary className="cursor-pointer select-none list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden hover:bg-teal-500/10 dark:hover:bg-teal-950/30 transition-colors">
        <div className="flex flex-wrap items-start gap-2">
          <div className="text-lg shrink-0" aria-hidden>
            📐
          </div>
          <div className="flex-1 min-w-[200px]">
            <h4 className="text-sm font-semibold text-ink">
              {it ? "Impatto synth sul gain (%)" : "Synth impact on gain (%)"}
            </h4>
            {!open && collapsedHint ? (
              <p className="text-[10px] text-ink-muted tabular-nums mt-0.5">{collapsedHint}</p>
            ) : (
              <p className="text-[10px] text-ink-muted leading-relaxed mt-0.5">
                {it
                  ? "Confronto synth vs stesso portafoglio a capitale equi — clic per espandere."
                  : "Synth vs equal € sizing — click to expand."}
              </p>
            )}
          </div>
          <span className="text-[10px] text-ink-muted shrink-0 self-center">
            {open ? (it ? "nascondi" : "hide") : it ? "mostra" : "show"}
          </span>
        </div>
      </summary>

      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-teal-500/25">
      <p className="text-[10px] text-ink-muted leading-relaxed">
        {it
          ? "La colonna «Con synth» è il rendimento % sul capitale investito; «Uplift gain» = quanto in più guadagni in € rispetto all'equi (relativo al P&L equi)."
          : "«With synth» = return % on invested capital; «Gain uplift» = extra € P&L vs equal (relative to equal P&L)."}
      </p>

      {!synthAvailable ? (
        <p className="text-[10px] text-amber-800 dark:text-amber-200">
          {it
            ? "Mix synth non disponibile (servono deal nel walk-order e pesi approvati Learning Lab)."
            : "Synth mix unavailable (need deals in walk-order and Learning Lab approved weights)."}
        </p>
      ) : (
        <div className="flex flex-col xl:flex-row gap-4 pt-1">
          {renderTable(
            it ? "Gain 24h cumulato" : "Cumulative 24h gain",
            it
              ? "Stessa metrica del grafico a destra — ottimizzazione synth sul target 24h Step 3."
              : "Same metric as the right chart — synth optimized to Step 3 24h target.",
            mine24h,
            sim24h,
          )}
          {renderTable(
            it ? "P&L totale (MTM)" : "Total P&L (MTM)",
            it
              ? "Rendimento % sul capitale usando il pick % mark-to-market di ogni deal."
              : "Return % on capital using each deal's mark-to-market pick %.",
            mineTotal,
            simTotal,
          )}
        </div>
      )}

      {synthAvailable && mineSuccess && simSuccess ? (
        <div className="pt-2 border-t border-teal-500/25 space-y-2">
          <div>
            <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100">
              {it ? "Probabilità totale di successo portafoglio" : "Total portfolio success probability"}
            </p>
            <p className="text-[9px] text-ink-muted leading-snug mt-0.5">
              {it
                ? "Realized WR = % vincite su round-trip chiusi nel universe. P(+) = probabilità joint modello (deal indipendenti, payoff SDS, win rate grezzo). Sotto Δ weight/synth: uplift P(+) e gain 24h cumulato € vs equi (data = ultimo punto grafico gain 24h)."
                : "Realized WR = win % on closed round-trips in the universe. P(+) = model joint probability (independent deals, SDS payoffs, raw win rate). Under Δ weight/synth: P(+) uplift and cumulative 24h gain € vs equal (date = last 24h chart point)."}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-ink-muted border-b border-[rgb(var(--border))]/50">
                  <th className="text-left font-semibold pb-1 pr-3">{it ? "Portafoglio" : "Portfolio"}</th>
                  <th className="text-right font-semibold pb-1 px-2">{it ? "Realized WR" : "Realized WR"}</th>
                  <th className="text-right font-semibold pb-1 px-2">{it ? "Equi P(+)" : "Equal P(+)"}</th>
                  <th className="text-right font-semibold pb-1 px-2">{it ? "Weight P(+)" : "Weight P(+)"}</th>
                  <th className="text-right font-semibold pb-1 px-2">{it ? "Δ weight" : "Δ weight"}</th>
                  <th className="text-right font-semibold pb-1 px-2">{it ? "Synth P(+)" : "Synth P(+)"}</th>
                  <th className="text-right font-semibold pb-1 pl-2">{it ? "Δ synth" : "Δ synth"}</th>
                </tr>
              </thead>
              <tbody>
                <SuccessRow
                  label="Mine"
                  accent="#0d9488"
                  row={mineSuccess}
                  it={it}
                />
                <SuccessRow
                  label="Sim loop"
                  accent="#db2777"
                  row={simSuccess}
                  it={it}
                />
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      </div>
    </details>
  );
}
