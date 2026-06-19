/**
 * Capital & Diversification — orchestrator of the 3-step narrative.
 *
 * Step 1: Gain potential (SDS × time) — CapDivStep1GainView
 * Step 2: Loss risk pattern (Phase A screening + Phase B builder + queue)
 *         — CapDivStep2RiskView
 * Step 3: Break-even sizing — CapDivStep3BreakevenView
 *
 * This file used to host a single vertical pile of analytical panels with no
 * narrative thread. The old "Open Complete Guide" markdown modal banner is
 * removed since its content is now embedded in the three steps.
 */
import { useEffect, useRef, useState } from "react";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { CapDivStep1GainView } from "./CapDivStep1GainView";
import { CapDivStep2RiskView } from "./CapDivStep2RiskView";
import { CapDivStep3BreakevenView } from "./CapDivStep3BreakevenView";
import { CapDivStep3BreakevenWidget } from "./CapDivStep3BreakevenWidget";
import { ThreePortfolioCompareView } from "./ThreePortfolioCompareView";
import type { ManualAllocationSynthesizerBundle } from "../sheet/manualAllocationPatternSynthesizer";
import { useLang } from "../shared/i18n";

export function PortfolioDiversificationLabPanel({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Live portfolio inputs (open positions capital/buyPrice). Optional for
   * backwards-compat with callers that haven't been updated yet. */
  investInputs?: InvestSimInputs;
  /** Chart points per series key — required by buildSuggestionMonitorRows to
   * compute per-row probPct/planReturnPct. Optional (empty map ⇒ degraded but
   * still functional). */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  // Bumped whenever the approved pattern changes — so Step 3 re-reads it.
  const [patternVersion, setPatternVersion] = useState(0);
  const onPatternChanged = () => setPatternVersion((v) => v + 1);

  const [manualAllocationBundle, setManualAllocationBundle] =
    useState<ManualAllocationSynthesizerBundle>({ portfolio: null, simLoop: null });

  const [frozenWeightsTick, setFrozenWeightsTick] = useState(0);
  useEffect(() => {
    const onFrozen = () => setFrozenWeightsTick((v) => v + 1);
    window.addEventListener("supernova:frozen-weights-updated", onFrozen);
    return () => window.removeEventListener("supernova:frozen-weights-updated", onFrozen);
  }, []);

  // Top-of-page widget: own capital pot, independent of Step 3 controls.
  // Persistence is delegated to `uiPrefs.ts` which writes both to
  // localStorage (fast path) and to `data/desktop_ui_prefs.json` on disk
  // via the Electron preload bridge. This keeps the value stable across
  // tab switches, app close/reopen, page reloads and even localStorage
  // wipes (browser cache clear, private mode, different origin).
  //
  // We deliberately do NOT persist the default until the user (or the
  // disk hydrate) provides a real value, so a fresh-tab default of 5000
  // never overwrites a previously saved value still on disk.
  const TOP_CAPITAL_DEFAULT = 5000;
  const isCapitalUserSetRef = useRef(false);
  const [topCapital, setTopCapital] = useState<number>(() => {
    const v = loadUiPrefsLocal().topCapital;
    if (v != null && Number.isFinite(v) && v >= 0) {
      isCapitalUserSetRef.current = true;
      return v;
    }
    return TOP_CAPITAL_DEFAULT;
  });
  useEffect(() => {
    if (isCapitalUserSetRef.current) return;
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (
        disk.topCapital != null &&
        Number.isFinite(disk.topCapital) &&
        disk.topCapital >= 0
      ) {
        isCapitalUserSetRef.current = true;
        setTopCapital(disk.topCapital);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!isCapitalUserSetRef.current) return;
    saveUiPrefs({ topCapital });
  }, [topCapital]);
  const TOP_TARGET_POSITIONS = 6;
  const topBreakevenTarget = Math.max(50, Math.round(topCapital * 0.02));

  return (
    <div className="space-y-4">
      {/* TOP — Interactive breakeven widget (hero) */}
      <div className="rounded-2xl border border-indigo-200/50 dark:border-indigo-800/40 bg-white/60 dark:bg-surface/60 p-3 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
              {it ? "Sopra ogni cosa — modula il sizing live" : "Above everything — modulate sizing live"}
            </p>
            <p className="text-[11px] text-ink-muted max-w-2xl mt-0.5">
              {it
                ? "Slider per opportunità con EV aggiornato in tempo reale. Per il calcolo dell'EV usiamo win rate dal Calibration Center e payoff dallo Step 1 (fallback se mancante). Read-only: non scrive sul portfolio reale."
                : "Per-opportunity sliders with live EV. Win rate from the Calibration Center, payoff from Step 1 (fallback if missing). Read-only: nothing is written to the real portfolio."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-ink">{it ? "Capitale pot" : "Capital pot"}</span>
            <span className="text-ink-muted">€</span>
            <input
              type="number"
              min={500}
              step={500}
              value={topCapital}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) {
                  isCapitalUserSetRef.current = true;
                  setTopCapital(v);
                }
              }}
              className="w-24 rounded-md border border-[rgb(var(--border))]/60 px-2 py-1 text-right tabular-nums bg-white/80 dark:bg-surface/80"
            />
          </label>
        </div>
        <CapDivStep3BreakevenWidget
          closedRows={closedRows}
          simTable={simTable}
          sdsRows={sdsRows}
          investInputs={investInputs}
          pointsBySeriesKey={pointsBySeriesKey}
          totalCapitalEur={topCapital}
          breakevenTargetEur={topBreakevenTarget}
          targetPositions={TOP_TARGET_POSITIONS}
          patternStoreVersion={patternVersion}
        />
      </div>

      {/* TOP — Three-portfolio comparison (mine / sim equal / sim weighted) */}
      <ThreePortfolioCompareView
        closedRows={closedRows}
        simTable={simTable}
        sdsRows={sdsRows}
        investInputs={investInputs}
        pointsBySeriesKey={pointsBySeriesKey}
        totalCapitalEur={topCapital}
        patternStoreVersion={patternVersion}
        frozenWeightsTick={frozenWeightsTick}
      />

      {/* Top-level narrative banner */}
      <div className="rounded-2xl border border-[rgb(var(--border))]/40 bg-gradient-to-r from-emerald-50/30 via-rose-50/30 to-teal-50/30 dark:from-emerald-950/15 dark:via-rose-950/15 dark:to-teal-950/15 px-4 py-3">
        <p className="text-[11px] font-semibold text-ink uppercase tracking-wider">
          {it ? "Capital & diversification — narrazione in 3 step" : "Capital & diversification — 3-step narrative"}
        </p>
        <p className="text-[11px] text-ink-muted leading-relaxed max-w-4xl mt-1">
          {it ? (
            <>
              <span className="text-emerald-700 dark:text-emerald-300 font-semibold">1) Cosa promette</span> il sistema per fascia SDS (ROI atteso e ROI realizzato) →{" "}
              <span className="text-rose-700 dark:text-rose-300 font-semibold">2) Come si perde valore</span> (Phase A: feature più associate alla perdita, Phase B: pattern AND con proposed→approved + holdout rolling) →{" "}
              <span className="text-teal-700 dark:text-teal-300 font-semibold">3) Quanto capitale serve</span> per chiudere sempre in positivo, con opzione di applicare il filtro pattern dello Step 2.
            </>
          ) : (
            <>
              <span className="text-emerald-700 dark:text-emerald-300 font-semibold">1) What the system promises</span> per SDS bucket (expected ROI vs delivered) →{" "}
              <span className="text-rose-700 dark:text-rose-300 font-semibold">2) How value is lost</span> (Phase A: features most associated with loss, Phase B: AND pattern with proposed→approved + rolling holdout) →{" "}
              <span className="text-teal-700 dark:text-teal-300 font-semibold">3) How much capital</span> is needed to always close positive, with optional Step 2 pattern filter.
            </>
          )}
        </p>
      </div>

      {/* STEP 1 — Gain potential (collapsible) */}
      <details className="rounded-2xl border border-emerald-200/40 dark:border-emerald-800/30 bg-white/40 dark:bg-surface/40">
        <summary className="px-4 py-2.5 cursor-pointer text-[12px] font-semibold text-ink hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
            1
          </span>
          <span>
            {it
              ? "▸ Step 1 — Gain potential (SDS × tempo)"
              : "▸ Step 1 — Gain potential (SDS × time)"}
          </span>
        </summary>
        <div className="px-3 pb-3 pt-1">
          <CapDivStep1GainView
            closedRows={closedRows}
            simTable={simTable}
            sdsRows={sdsRows}
          />
        </div>
      </details>

      {/* STEP 2 — Loss risk pattern (main, collapsible) */}
      <details className="rounded-2xl border border-rose-200/40 dark:border-rose-800/30 bg-white/40 dark:bg-surface/40">
        <summary className="px-4 py-2.5 cursor-pointer text-[12px] font-semibold text-ink hover:bg-rose-50/30 dark:hover:bg-rose-950/20 transition flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
            2
          </span>
          <span>
            {it
              ? "▸ Step 2 — Loss risk pattern (Phase A screening + Phase B builder)"
              : "▸ Step 2 — Loss risk pattern (Phase A screening + Phase B builder)"}
          </span>
        </summary>
        <div className="px-3 pb-3 pt-1">
          <CapDivStep2RiskView
            closedRows={closedRows}
            simTable={simTable}
            sdsRows={sdsRows}
            onPatternChanged={onPatternChanged}
            manualAllocationBundle={manualAllocationBundle}
          />
        </div>
      </details>

      {/* STEP 3 — Break-even sizing */}
      <CapDivStep3BreakevenView
        closedRows={closedRows}
        simTable={simTable}
        sdsRows={sdsRows}
        investInputs={investInputs}
        pointsBySeriesKey={pointsBySeriesKey}
        topCapital={topCapital}
        patternStoreVersion={patternVersion}
        onManualAllocationChange={setManualAllocationBundle}
        onPatternChanged={onPatternChanged}
        frozenWeightsTick={frozenWeightsTick}
      />
    </div>
  );
}
