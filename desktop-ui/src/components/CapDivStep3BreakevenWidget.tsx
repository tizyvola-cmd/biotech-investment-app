/**
 * Capital & Diversification — Step 3, Interactive Breakeven Widget.
 *
 * Inside Step 3 (CapDivStep3BreakevenView). Lets the user modulate per-deal
 * sizes with sliders and watch the EV bar progress toward the breakeven
 * target in real time. READ-ONLY: nothing persists back to the portfolio.
 *
 * See `sheet/portfolioSizingWidget.ts` for the pure logic + tests.
 */
import { useEffect, useMemo, useState } from "react";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { CalibrationSnapshot } from "../calibration/calibrationTypes";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { bucketClinicalPhase, bucketIndication, bucketPplan, bucketSds } from "../sheet/lossAuditAnalysis";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "../sheet/simRowClinicalMeta";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  computePositionState,
  computeDealLossRisk,
  lossRiskSizeMultiplier,
  DEFAULT_FRICTION_THRESHOLDS,
  type FrictionEvent,
  type WidgetDeal,
} from "../sheet/portfolioSizingWidget";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { loadFrozenWeights } from "../calibration/proposalStore";
import {
  dimensionLabel,
  runUnivariateScreening,
} from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import { useLang } from "../shared/i18n";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}
function fmtPct01(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

function confTone(c: "low" | "medium" | "high"): string {
  if (c === "high") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (c === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
}

const DEAL_LIMIT = 12;

export function CapDivStep3BreakevenWidget({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
  totalCapitalEur,
  breakevenTargetEur,
  targetPositions,
  patternStoreVersion,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Live portfolio inputs (capital/buyPrice) — needed to detect open positions
   * and compute per-row probPct via buildSuggestionMonitorRows. */
  investInputs?: InvestSimInputs;
  /** Chart points per series key — needed by suggestion monitor for slope/prob. */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  /** Total capital pot the user is sizing inside (controlled by Step 3 parent). */
  totalCapitalEur: number;
  /** EV breakeven target (€) — typically Step 3's recAtTarget.expectedDailyPnlEur. */
  breakevenTargetEur: number;
  /** Suggested # of positions at target — used for the default slider value. */
  targetPositions: number;
  /** Bumped by parent when approved pattern changes (pulls fresh data). */
  patternStoreVersion: number;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  // Collapsible state for the "Open opportunities" sliders panel. Persisted
  // to localStorage so the user's preference (typically collapsed, since the
  // table can get long) survives page reloads. Defaults to CLOSED.
  const OPEN_OPPS_STORAGE_KEY = "capdiv.step3.openOpps.expanded";
  const [openOppsExpanded, setOpenOppsExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(OPEN_OPPS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // ── Build deal list from simTable open opportunities ─────────────────────
  // Use the SAME pipeline as the suggestion monitor / Decision Lab so that
  // probPct, planReturnPct, hasPosition and suggestedAction are computed from
  // (simTable + inputs + pointsBySeriesKey) instead of read directly from raw
  // sheet rows (which don't expose those columns).
  const monitorRows = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    const inputs = investInputs ?? {};
    const pts = pointsBySeriesKey ?? new Map<string, ChartPoint[]>();
    try {
      return buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey: pts,
        lang,
        paperPortfolio: [],
      });
    } catch {
      return [];
    }
  }, [simTable, investInputs, pointsBySeriesKey, lang]);

  // Per-ticker current mark-to-market return %, sourced from the same monitor
  // pipeline that feeds the Decision Lab and Three-portfolio compare. Used to
  // show the REALIZED P&L next to the modeled EV in each slider row so the
  // user can see when actual performance diverges from the calibration model
  // (e.g. EV negative while the deal is currently in profit).
  const realizedByTicker = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of monitorRows) {
      const t = String(r.ticker ?? "").toUpperCase();
      if (!t) continue;
      const v =
        r.pnlPct != null && Number.isFinite(r.pnlPct) ? r.pnlPct : null;
      // First write wins (monitorRows can have duplicates by key); preserve
      // the first non-null value for the ticker.
      if (!m.has(t) || (m.get(t) == null && v != null)) m.set(t, v);
    }
    return m;
  }, [monitorRows]);

  const deals = useMemo<WidgetDeal[]>(() => {
    if (!simTable?.rows?.length) return [];
    if (monitorRows.length === 0) return [];

    const sdsByTicker = new Map<string, SdsRow>();
    for (const s of sdsRows ?? []) {
      if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
    }
    const simRowByKey = buildSimRowByKeyMap(simTable.rows);

    type Candidate = { deal: WidgetDeal; rank: number };
    const cands: Candidate[] = [];
    for (const row of monitorRows) {
      // Universe: BUY recommendations + currently-held positions (HOLD/REVIEW).
      const isBuy = row.suggestedAction === "buy";
      const inPort = row.hasPosition === true;
      if (!isBuy && !inPort) continue;
      const ticker = String(row.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      const simRow = simRowByKey.get(row.key);
      const phaseRaw = simRow ? clinicalPhaseFromSimRow(simRow) : "";
      const indRaw = simRow ? clinicalIndicationFromSimRow(simRow, 200) : "";
      const sds = sdsByTicker.get(ticker)?.sds ?? null;
      const pplan = row.probPct;
      const planReturn =
        row.planReturnPct != null && Number.isFinite(row.planReturnPct)
          ? row.planReturnPct
          : row.planCdReturnPct;
      const cells = {
        clinicalPhase: bucketClinicalPhase(phaseRaw ?? ""),
        clinicalIndication: bucketIndication(indRaw ?? ""),
        sdsBucket: bucketSds(sds),
        pplanBucket: bucketPplan(pplan),
      };
      // Rank: portfolio positions first, then BUY by probability desc.
      const rank = (inPort ? 1_000_000 : 0) + (Number.isFinite(pplan) ? (pplan as number) : 0);
      cands.push({
        deal: {
          ticker,
          displayLabel: `${ticker} · ${cells.clinicalPhase} · ${cells.sdsBucket}`,
          cells,
          promisedReturnPct:
            planReturn != null && Number.isFinite(planReturn) ? planReturn : null,
        },
        rank,
      });
    }
    cands.sort((a, b) => b.rank - a.rank);
    return cands.slice(0, DEAL_LIMIT).map((c) => c.deal);
  }, [simTable, sdsRows, monitorRows]);

  // ── Inputs to compute fn (calibration + sds breakdown) ───────────────────
  const calibrationSnapshot = useMemo<CalibrationSnapshot | null>(() => {
    try {
      return computeCalibrationSnapshot(closedRows, { simTable, sdsRows });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedRows, simTable, sdsRows, patternStoreVersion]);

  const frozenWeights = useMemo(() => {
    return loadFrozenWeights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  const sdsBreakdown = useMemo(
    () => computeSdsGainBreakdown(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  // ── Phase A screening + approved Phase B pattern (loss-risk integration) ─
  const phaseA = useMemo<PhaseAResult | null>(() => {
    try {
      return runUnivariateScreening(closedRows, { simTable, sdsRows });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  const approvedPattern = useMemo<RiskPattern | null>(() => {
    try {
      const rec = loadApprovedPattern();
      return rec.current ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  // ── Detect disabled indications (no variance) ────────────────────────────
  const disabledIndications = useMemo(() => {
    const out = new Set<string>();
    if (!calibrationSnapshot) return out;
    const indDim = calibrationSnapshot.dimensions.clinicalIndication;
    if (!indDim?.hasVariance) {
      for (const c of indDim?.cells ?? []) out.add(c.cell);
    }
    return out;
  }, [calibrationSnapshot]);

  // ── Slider state ─────────────────────────────────────────────────────────
  // Baseline: equal allocation across the visible deals (capped at targetPositions).
  const baselinePerDeal = useMemo(() => {
    const denom = Math.max(targetPositions, deals.length, 1);
    return Math.max(0, totalCapitalEur / denom);
  }, [totalCapitalEur, targetPositions, deals.length]);

  // First-pass risk profile per ticker — only used to seed the slider default
  // (the full state is recomputed below via computePositionState).
  // Re-derived whenever deals / Phase A / approved pattern change.
  const riskByTicker = useMemo(() => {
    const out = new Map<string, number>();
    for (const d of deals) {
      const lr = phaseA || approvedPattern
        ? computeDealLossRisk(d, phaseA ?? null, approvedPattern ?? null)
        : null;
      out.set(d.ticker, lr ? lossRiskSizeMultiplier(lr) : 1.0);
    }
    return out;
  }, [deals, phaseA, approvedPattern]);

  const [sliders, setSliders] = useState<Record<string, number>>({});

  // Reset sliders to risk-adjusted defaults when deal list changes substantially.
  // Each deal starts at baseline × lossRiskSizeMultiplier so riskier cells get
  // a smaller initial cap. The user can still drag in either direction.
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const d of deals) {
      const mult = riskByTicker.get(d.ticker) ?? 1.0;
      next[d.ticker] = Math.max(0, baselinePerDeal * mult);
    }
    setSliders(next);
  }, [deals, baselinePerDeal, riskByTicker]);

  // ── Compute state on every render ────────────────────────────────────────
  const state = useMemo(
    () =>
      computePositionState({
        deals,
        sliders,
        totalCapitalEur,
        breakevenTargetEur,
        calibrationSnapshot,
        frozenWeights,
        sdsGainBreakdown: sdsBreakdown,
        disabledIndications,
        friction: DEFAULT_FRICTION_THRESHOLDS,
        phaseA,
        approvedPattern,
      }),
    [
      deals,
      sliders,
      totalCapitalEur,
      breakevenTargetEur,
      calibrationSnapshot,
      frozenWeights,
      sdsBreakdown,
      disabledIndications,
      phaseA,
      approvedPattern,
    ],
  );

  // Friction event log (rolling window — last 8 unique events)
  const [eventLog, setEventLog] = useState<FrictionEvent[]>([]);
  useEffect(() => {
    if (state.frictionEvents.length === 0) return;
    setEventLog((prev) => {
      const incoming = state.frictionEvents.map((e) => ({
        ...e,
        at: new Date().toISOString(),
      }));
      // Deduplicate consecutive identical messages
      const merged = [...incoming, ...prev].filter((e, idx, arr) =>
        idx === 0 || arr[idx - 1].message !== e.message,
      );
      return merged.slice(0, 8);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(state.frictionEvents)]);

  function setSlider(ticker: string, candidate: number) {
    // Look up the current runtime max for this ticker — clamp during drag.
    const d = state.perDeal.find((p) => p.ticker === ticker);
    const max = d ? d.runtimeMaxEur : totalCapitalEur;
    const clamped = Math.max(0, Math.min(candidate, max));
    setSliders((prev) => ({ ...prev, [ticker]: clamped }));
  }

  function resetAll() {
    const next: Record<string, number> = {};
    for (const d of deals) {
      const mult = riskByTicker.get(d.ticker) ?? 1.0;
      next[d.ticker] = Math.max(0, baselinePerDeal * mult);
    }
    setSliders(next);
    setEventLog([]);
  }

  function defaultForTicker(ticker: string): number {
    const mult = riskByTicker.get(ticker) ?? 1.0;
    return Math.max(0, baselinePerDeal * mult);
  }

  function zeroAll() {
    const next: Record<string, number> = {};
    for (const d of deals) next[d.ticker] = 0;
    setSliders(next);
    setEventLog([]);
  }

  if (deals.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/40 bg-white/60 dark:bg-surface/60 px-4 py-3">
        <p className="text-xs text-ink-muted">
          {it
            ? "Nessuna opportunità aperta nel sim table per costruire il widget. Lancia il refresh delle previsioni o attendi nuovi dati."
            : "No open opportunities in the sim table to build the widget. Run a forecast refresh or wait for new data."}
        </p>
      </div>
    );
  }

  const evProgressClamped = Math.min(1.5, state.evProgress);
  const barColor =
    state.evMeetsTarget && state.evTotalEur > 0
      ? "bg-emerald-500"
      : state.evTotalEur > 0
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <section className="rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 dark:from-indigo-950/15 dark:via-surface dark:to-violet-950/15 px-3 py-3 space-y-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
            {it ? "Widget interattivo" : "Interactive widget"}
          </p>
          <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            {it
              ? "Modula ogni opportunità e guarda il breakeven aggiornarsi live"
              : "Modulate each opportunity and watch breakeven update live"}
          </h3>
          <p className="text-[10px] leading-relaxed text-indigo-800/75 dark:text-indigo-200/75 mt-0.5 max-w-3xl">
            {it
              ? "Read-only: nessun salvataggio sul portfolio reale. Win rate dal Calibration Center, payoff dallo Step 1 (fallback esplicito se mancante), cap di diversificazione attivi durante il drag, frizione visiva su confidence LOW/MEDIUM."
              : "Read-only: no writes to the real portfolio. Win rate from the Calibration Center, payoff from Step 1 (explicit fallback when missing), diversification caps active during drag, visual friction on LOW/MEDIUM confidence."}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className="btn-ghost text-[10px]" onClick={resetAll}>
            {it ? "↺ Reset" : "↺ Reset"}
          </button>
          <button type="button" className="btn-ghost text-[10px]" onClick={zeroAll}>
            {it ? "0 Azzera" : "0 Zero"}
          </button>
        </div>
      </header>

      {/* Collapsible "How it works" — explains EV, cap, friction, risk to first-time users. */}
      <details className="rounded-md bg-white/60 dark:bg-surface/60 border border-indigo-200/40 dark:border-indigo-800/30 text-[10px]">
        <summary className="px-3 py-1.5 cursor-pointer font-semibold text-indigo-800 dark:text-indigo-200">
          {it ? "Come si legge il widget — EV, cap, frizione, rischio" : "How to read the widget — EV, cap, friction, risk"}
        </summary>
        <div className="px-3 py-2 space-y-2 leading-relaxed text-ink/85">
          <div>
            <p className="font-semibold text-ink">
              {it ? "EV (Expected Value)" : "EV (Expected Value)"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "Per ogni deal: EV = size × [winRate × payoffWin% + (1 − winRate) × payoffLoss%]. winRate viene dal Calibration Center (cella più specifica con n sufficiente). payoffWin/payoffLoss vengono dallo Step 1 per bucket SDS (se mancano, fallback esplicito). Il totale è la somma sugli slider. La barra è verde quando EV ≥ target di breakeven."
                : "Per deal: EV = size × [winRate × payoffWin% + (1 − winRate) × payoffLoss%]. winRate comes from the Calibration Center (most specific cell with enough n). payoffWin/payoffLoss come from Step 1 per SDS bucket (explicit fallback if missing). The total sums across sliders. The bar turns green when EV ≥ breakeven target."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">
              {it ? "Size suggerito (default slider)" : "Suggested size (slider default)"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "All'apertura: size = (capitale totale / opportunità attese) × moltiplicatore_di_rischio. Il moltiplicatore in [0.3, 1.5] viene dal Phase A (lift aggregato dei bucket di rischio del deal, media geometrica pesata per confidence) + extra ×0.5 se il pattern Phase B approvato fa match. Lift > 1 = bucket più rischioso del baseline → size ridotto. Lift < 1 = bucket più sicuro → size leggermente boostato."
                : "On open: size = (total capital / target positions) × risk_multiplier. The multiplier in [0.3, 1.5] comes from Phase A (geometric mean of the deal's risk-bucket lifts, weighted by confidence) + extra ×0.5 if the approved Phase B pattern matches. Lift > 1 = riskier-than-baseline bucket → smaller size. Lift < 1 = safer-than-baseline bucket → modest boost."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">
              {it ? "Cap di diversificazione (limite duro)" : "Diversification caps (hard limit)"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "Ogni slider è bloccato in tempo reale a runtimeMax = min(single-position cap, cap fase residuo, cap indicazione residuo). Trascinare oltre il cap fa scattare un evento nel log. Le indicazioni senza varianza (un solo bucket) hanno il cap disattivato (badge \"cap n/d\")."
                : "Each slider is clamped in real time to runtimeMax = min(single-position cap, remaining phase cap, remaining indication cap). Dragging past the cap fires an event in the log. Indications with no variance (single bucket) have the cap disabled (\"cap n/a\" badge)."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">
              {it ? "Frizione visiva (soglia soft)" : "Visual friction (soft threshold)"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "Lo slider diventa ambra (MEDIUM) o rosa (LOW) quando supera la soglia soft = single-cap × softFraction(confidence). Non blocca il movimento — segnala che stai concentrando capitale dove la win rate è poco affidabile. Su LOW confidence la frizione scatta prima (n insufficiente)."
                : "The slider turns amber (MEDIUM) or rose (LOW) past the soft threshold = single-cap × softFraction(confidence). It doesn't block movement — it signals you're concentrating capital where the win rate has weak support. LOW confidence triggers friction earlier (insufficient n)."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">
              {it ? "Riga rischio sotto ogni slider" : "Risk row below each slider"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "Badge \"loss risk ×L → suggested size ×M\": L è il lift aggregato Phase A del deal, M è il moltiplicatore di sizing risultante. I chip a fianco mostrano i top-3 bucket contribuenti (tooltip: P(loss) shrunk e n). Il badge rosso \"Pattern di rischio attivo\" appare quando il pattern Phase B approvato fa match — il size suggerito viene dimezzato ulteriormente."
                : "Badge \"loss risk ×L → suggested size ×M\": L is the deal's Phase A aggregate lift, M is the resulting size multiplier. Adjacent chips show the top-3 contributing buckets (tooltip: shrunk P(loss) and n). The red \"Risk pattern match\" badge appears when the approved Phase B pattern fires — suggested size is halved on top."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">
              {it ? "Reset" : "Reset"}
            </p>
            <p className="text-ink-muted">
              {it
                ? "↺ Reset riporta tutti gli slider al default risk-adjusted. Right-click su un singolo slider riporta solo quello al default. 0 Azzera mette tutti a zero (utile per ripartire da capo)."
                : "↺ Reset returns all sliders to the risk-adjusted default. Right-click on a single slider returns just that one. 0 Zero sets all to zero (useful to start fresh)."}
            </p>
          </div>
        </div>
      </details>

      {/* Breakeven progress bar */}
      <div className="rounded-md bg-white/70 dark:bg-surface/70 border border-indigo-200/40 dark:border-indigo-800/30 px-3 py-3">
        <div className="flex items-end justify-between mb-1">
          <div>
            <p className="text-[10px] text-ink-muted">
              {it ? "EV totale (atteso, €)" : "EV total (expected, €)"}
            </p>
            <p
              className={`text-xl font-bold tabular-nums ${
                state.evMeetsTarget && state.evTotalEur > 0
                  ? "text-emerald-700 dark:text-emerald-300"
                  : state.evTotalEur > 0
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-rose-700 dark:text-rose-300"
              }`}
            >
              {fmtEur(state.evTotalEur)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-ink-muted">
              {it ? "Target breakeven" : "Breakeven target"}
            </p>
            <p className="text-sm font-semibold text-ink tabular-nums">
              {fmtEur(breakevenTargetEur)}
            </p>
            <p className="text-[9px] text-ink-muted">
              {fmtEur(state.allocatedEur)} {it ? "allocati" : "allocated"}
            </p>
          </div>
        </div>
        <div className="w-full h-3 rounded-full bg-slate-200/60 dark:bg-slate-800/60 overflow-hidden">
          <div
            className={`h-full transition-all duration-200 ${barColor}`}
            style={{ width: `${Math.min(100, evProgressClamped * 100)}%` }}
          />
        </div>
        <p className="text-[9px] text-ink-muted mt-1">
          {state.evMeetsTarget
            ? it ? "✓ EV atteso supera il target di breakeven." : "✓ Expected EV exceeds the breakeven target."
            : it ? "↑ EV atteso sotto il target. Modula gli slider per avvicinarti." : "↑ Expected EV below target. Modulate sliders to approach it."}
        </p>
      </div>

      {/* Per-deal sliders — collapsible panel. Default closed to keep the
          Step 3 page compact; the user can expand it to fine-tune sizes.
          State is persisted to localStorage. */}
      <details
        open={openOppsExpanded}
        onToggle={(e) => {
          const next = (e.currentTarget as HTMLDetailsElement).open;
          setOpenOppsExpanded(next);
          try {
            window.localStorage.setItem(OPEN_OPPS_STORAGE_KEY, next ? "1" : "0");
          } catch {
            /* localStorage unavailable — non-fatal */
          }
        }}
        className="group/openopps rounded-md bg-white/70 dark:bg-surface/70 border border-indigo-200/40 dark:border-indigo-800/30"
      >
        <summary className="px-3 py-1.5 border-b border-transparent group-open/openopps:border-indigo-200/40 dark:group-open/openopps:border-indigo-800/30 flex items-center justify-between gap-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 transition-colors">
          <p className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
            <span
              className="inline-block text-ink-muted transition-transform duration-150 group-open/openopps:rotate-90"
              aria-hidden="true"
            >
              ▶
            </span>
            {it ? `Opportunità aperte (${deals.length})` : `Open opportunities (${deals.length})`}
            {!openOppsExpanded ? (
              <span className="ml-1 text-[11px] font-normal text-ink-muted/80 italic">
                {it ? "clicca per espandere" : "click to expand"}
              </span>
            ) : null}
          </p>
          <p className="text-[11px] text-ink-muted">
            {it ? "click destro slider = reset; cap = limite duro" : "right-click slider = reset; cap = hard ceiling"}
          </p>
        </summary>
        <ul className="divide-y divide-indigo-200/30 dark:divide-indigo-800/20">
          {state.perDeal.map((p) => {
            const m = p.metrics;
            const sliderMax = Math.max(p.runtimeMaxEur, p.sizeEur);
            return (
              <li key={p.ticker} className="px-3 py-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="text-[13px] font-mono font-semibold text-indigo-900 dark:text-indigo-100">
                    {p.ticker}
                  </p>
                  <span className={`text-[10px] px-1 rounded ${confTone(m.confidence)}`}>
                    {m.confidence.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {it ? "win rate" : "win rate"} {fmtPct01(m.winRate)}{" "}
                    <span className="text-ink-muted/70">
                      ({m.winRateSource.dimension} = {m.winRateSource.cell}, n={m.winRateSource.n})
                    </span>
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {it ? "payoff" : "payoff"} +{m.payoffWinPct.toFixed(1)}% / {m.payoffLossPct.toFixed(1)}%
                    <span
                      className={`ml-1 text-[10px] px-1 rounded ${
                        m.payoffSource === "step1"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      }`}
                    >
                      {m.payoffSource === "step1" ? "Step 1" : (it ? "stima prelim." : "prelim. estimate")}
                    </span>
                  </span>
                  <span className="text-[11px] text-ink-muted ml-auto">{p.metrics.sdsBucket}</span>
                </div>

                <div className="mt-0.5 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={sliderMax}
                    step={50}
                    value={p.sizeEur}
                    onChange={(e) => setSlider(p.ticker, Number(e.target.value))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSlider(p.ticker, defaultForTicker(p.ticker));
                    }}
                    className={`flex-1 cursor-pointer ${
                      p.pastSoftThreshold
                        ? m.confidence === "low"
                          ? "accent-rose-500"
                          : "accent-amber-500"
                        : "accent-indigo-500"
                    } ${p.clampedToRuntimeMax ? "opacity-90" : ""}`}
                    aria-label={`${p.ticker} size`}
                  />
                  <div className="w-28 text-right leading-tight">
                    <p
                      className={`text-[15px] font-semibold tabular-nums ${
                        p.pastSoftThreshold
                          ? m.confidence === "low"
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-amber-700 dark:text-amber-300"
                          : "text-ink"
                      }`}
                    >
                      {Math.round(p.sizeEur).toLocaleString("it-IT")} €
                    </p>
                    <p
                      className={`text-[11px] tabular-nums ${
                        p.evEur >= 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-rose-700 dark:text-rose-300"
                      }`}
                      title={
                        it
                          ? "EV modellato = size × (winRate × payoff vincita + (1−winRate) × payoff perdita). È la previsione probabilistica del modello di calibrazione, NON quanto stai guadagnando ora."
                          : "Modeled EV = size × (winRate × winPayoff + (1−winRate) × lossPayoff). It's the calibration model's probability-weighted forecast, NOT your current realized P&L."
                      }
                    >
                      EV {fmtEur(p.evEur)}
                    </p>
                    {(() => {
                      const realizedPct = realizedByTicker.get(p.ticker);
                      if (realizedPct == null) {
                        return (
                          <p
                            className="text-[11px] tabular-nums text-ink-muted/70 italic"
                            title={
                              it
                                ? "Deal non ancora aperto in portafoglio — nessun P&L mark-to-market disponibile."
                                : "Deal not yet held — no mark-to-market P&L available."
                            }
                          >
                            MTM —
                          </p>
                        );
                      }
                      const realizedEur = (p.sizeEur * realizedPct) / 100;
                      return (
                        <p
                          className={`text-[11px] tabular-nums ${
                            realizedEur >= 0
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-rose-700 dark:text-rose-300"
                          }`}
                          title={
                            it
                              ? `P&L realizzato (mark-to-market) a questo size = ${Math.round(p.sizeEur).toLocaleString("it-IT")} € × ${realizedPct.toFixed(2)}% = ${fmtEur(realizedEur)}. È quello che il deal sta facendo ORA, indipendentemente dall'EV modellato.`
                              : `Realized P&L (mark-to-market) at this size = ${Math.round(p.sizeEur).toLocaleString("it-IT")} € × ${realizedPct.toFixed(2)}% = ${fmtEur(realizedEur)}. This is what the deal is doing RIGHT NOW, independent of the modeled EV.`
                          }
                        >
                          MTM {fmtEur(realizedEur)}
                        </p>
                      );
                    })()}
                  </div>
                </div>
                {p.pastSoftThreshold ? (
                  <p className="text-[11px] mt-0.5 text-amber-700 dark:text-amber-300 italic">
                    {m.confidence === "low"
                      ? it
                        ? `Oltre soglia soft a ${Math.round(p.softThresholdEur).toLocaleString("it-IT")} € — n insufficiente per concentrare qui.`
                        : `Past soft threshold at ${Math.round(p.softThresholdEur).toLocaleString("it-IT")} € — n insufficient to concentrate here.`
                      : it
                        ? `Oltre soglia soft a ${Math.round(p.softThresholdEur).toLocaleString("it-IT")} € — confidence MEDIUM.`
                        : `Past soft threshold at ${Math.round(p.softThresholdEur).toLocaleString("it-IT")} € — MEDIUM confidence.`}
                  </p>
                ) : null}
                {p.clampedToRuntimeMax ? (
                  <p className="text-[11px] mt-0.5 text-rose-700 dark:text-rose-300">
                    {it
                      ? `Slider bloccato a ${Math.round(p.runtimeMaxEur).toLocaleString("it-IT")} € (cap di diversificazione attivo).`
                      : `Slider locked at ${Math.round(p.runtimeMaxEur).toLocaleString("it-IT")} € (active diversification cap).`}
                  </p>
                ) : null}
                {/* Phase A + Phase B loss-risk row. Hidden when no risk signal. */}
                {m.lossRisk && m.lossRisk.hasSignal ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    {/* Aggregate risk badge: green when safer-than-base, amber neutral, rose when riskier. */}
                    {(() => {
                      const lift = m.lossRisk.aggregateLift;
                      const tone =
                        lift > 1.2
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
                          : lift < 0.85
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200";
                      const mult = m.lossRiskSizeMultiplier;
                      return (
                        <span className={`px-1.5 py-0.5 rounded ${tone}`}>
                          {it ? "rischio perdita" : "loss risk"} ×{lift.toFixed(2)}
                          <span className="ml-1 text-[10px] opacity-80">
                            → {it ? "size suggerito" : "suggested size"} ×{mult.toFixed(2)}
                          </span>
                        </span>
                      );
                    })()}
                    {/* Contributing buckets — top 3 by |lift - 1| desc */}
                    {m.lossRisk.contributions.length > 0
                      ? [...m.lossRisk.contributions]
                          .sort(
                            (a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1),
                          )
                          .slice(0, 3)
                          .map((c) => (
                            <span
                              key={`${c.dimension}:${c.bucket}`}
                              className="px-1 py-0.5 rounded border border-slate-300/60 dark:border-slate-700/60 text-ink-muted"
                              title={`${dimensionLabel(c.dimension, lang)} = ${c.bucket}\nP(loss) shrunk = ${(c.shrunkLossRate * 100).toFixed(1)}% on n=${c.n} (${c.confidence})`}
                            >
                              {c.bucket}
                              <span className="ml-1 text-[10px] opacity-70">
                                ×{c.lift.toFixed(2)}
                              </span>
                            </span>
                          ))
                      : null}
                    {/* Phase B approved pattern match — red flag (only when lift>=1.3 and precision>=50%) */}
                    {m.lossRisk.matchedApprovedPattern ? (
                      <span
                        className="px-1.5 py-0.5 rounded font-semibold bg-rose-200 text-rose-900 dark:bg-rose-800/60 dark:text-rose-100 cursor-help"
                        title={(() => {
                          const s = approvedPattern?.inSampleStats;
                          if (!s) return it ? "Pattern di rischio attivo" : "Risk pattern match";
                          return it
                            ? `Pattern di rischio attivo\nlift=${s.lift.toFixed(2)}× · precisione=${(s.precision * 100).toFixed(0)}% · n=${s.n}\n${approvedPattern?.name ?? ""}`
                            : `Risk pattern match\nlift=${s.lift.toFixed(2)}× · precision=${(s.precision * 100).toFixed(0)}% · n=${s.n}\n${approvedPattern?.name ?? ""}`;
                        })()}
                      >
                        {it ? "Pattern di rischio attivo" : "Risk pattern match"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>

      {/* Event log */}
      {eventLog.length > 0 ? (
        <details className="rounded-md bg-white/50 dark:bg-surface/50 border border-indigo-200/30 dark:border-indigo-800/20 text-[10px]">
          <summary className="px-2.5 py-1 cursor-pointer text-ink-muted">
            {it ? "Log eventi cap / frizione" : "Cap / friction event log"} ({eventLog.length})
          </summary>
          <ul className="px-3 py-1.5 space-y-0.5">
            {eventLog.map((e, idx) => (
              <li key={idx} className="text-[10px] flex gap-2">
                <span className="text-ink-muted/70 tabular-nums w-16 shrink-0">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                <span className="text-[8px] uppercase font-semibold w-32 shrink-0 text-ink-muted">
                  {e.kind.replaceAll("_", " ")}
                </span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
