/**
 * Merges monitor snapshots, calibration history, cohort rebuilds and signal
 * outcomes into a day-by-day narrative for the Model Learnings tab.
 */
import type { MonitorEntry } from "../sheet/accuracyMetrics";
import { parseMonitorEntries } from "../sheet/accuracyMetrics";
import { buildWeeklyEvolution, type EvolutionTrend } from "../sheet/modelEvolution";
import type { ModelLearningsSources } from "../data/modelLearningsData";
import { cohortAccuracyKpis } from "../data/cohortAccuracyData";
import { buildSignAccuracyCurveView, peakSignHitFromPoints, type SignPeakHit } from "./signAccuracyCurve";
import type { StrongSignalsHighlight } from "./strongSignalsKpi";
import { resolveStrongSignalsHighlight } from "./strongSignalsKpi";
import { buildModelSizeErrorView, type ModelSizeErrorView } from "./modelSizeErrorView";
import { buildModelStretchView, type ModelStretchView } from "./modelStretchView";
import type { SignalScatterPoint, SignalWeeklyRow } from "../data/signalCalibrationData";

export type LearningEventKind =
  | "recalibration"
  | "monitor_snapshot"
  | "cohort_rebuild"
  | "directional_kpi"
  | "signal_week";

export type ModelLearningEvent = {
  dayKey: string;
  ts: number;
  kind: LearningEventKind;
  title: string;
  detail: string;
  metricBefore?: number | null;
  metricAfter?: number | null;
  metricDelta?: number | null;
  metricLabel?: string;
  appliedTo?: string;
};

export type DailySignalOutcome = {
  dayKey: string;
  ticker: string;
  pred5_pp: number | null;
  actual_5d_pct: number | null;
  hit: boolean | null;
  pending: boolean;
  affid: number | null;
};

export type DayLearningSummary = {
  dayKey: string;
  dayLabel: string;
  events: ModelLearningEvent[];
  outcomes: DailySignalOutcome[];
  hits: number;
  misses: number;
  pending: number;
};

export type PipelineStep = {
  id: string;
  title: string;
  source: string;
  consumes: string;
  produces: string;
};

export type LearningLoopChartRow = {
  dayKey: string;
  label: string;
  hits: number;
  misses: number;
  signalHitPct: number | null;
  accV4: number | null;
  calFactor: number | null;
  recalib: boolean;
};

export type ModelLearningsView = {
  events: ModelLearningEvent[];
  days: DayLearningSummary[];
  chartRows: LearningLoopChartRow[];
  monitorEntries: MonitorEntry[];
  monitorSource: string;
  trend: EvolutionTrend;
  kpis: {
    accV4: number | null;
    accRetro: number | null;
    accSim: number | null;
    preCdSignHitPct: number | null;
    nRetroEval: number | null;
    nSimEval: number | null;
    nSimPending: number;
    usefulHitPct: number | null;
    usefulHitPeak: StrongSignalsHighlight | null;
    signPeakHit: SignPeakHit | null;
    calFactorV4: number | null;
    calFactorDelta: number | null;
    deltaPpLastMonitor: number | null;
    pendingSignals: number;
    closedSignals: number;
    nRetro: number | null;
  };
  pipelineSteps: PipelineStep[];
  comparisonHitDelta: number | null;
  comparisonAt: string | null;
  modelStretch: ModelStretchView;
  modelSizeError: ModelSizeErrorView;
  narrative: LearningNarrativeSummary;
};

/** Plain-language recap for the Model Learnings tab (no day-by-day detail). */
export type LearningNarrativeSummary = {
  headline: string;
  whatHappened: string[];
  modelImpact: string[];
};

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function dayKeyFromIso(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function dayLabel(dayKey: string, lang: "en" | "it"): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(lang === "it" ? "it-IT" : "en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortDayLabel(dayKey: string, lang: "en" | "it"): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(lang === "it" ? "it-IT" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Serie giornaliera per il grafico learning loop (esiti + acc monitor + cal_factor). */
export function buildLearningLoopChartData(
  days: DayLearningSummary[],
  events: ModelLearningEvent[],
  monitorEntries: MonitorEntry[],
  lang: "en" | "it",
): LearningLoopChartRow[] {
  const dayMap = new Map<string, LearningLoopChartRow>();

  const ensure = (dayKey: string): LearningLoopChartRow => {
    let row = dayMap.get(dayKey);
    if (!row) {
      row = {
        dayKey,
        label: shortDayLabel(dayKey, lang),
        hits: 0,
        misses: 0,
        signalHitPct: null,
        accV4: null,
        calFactor: null,
        recalib: false,
      };
      dayMap.set(dayKey, row);
    }
    return row;
  };

  for (const d of days) {
    const row = ensure(d.dayKey);
    row.hits = d.hits;
    row.misses = d.misses;
    const closed = d.hits + d.misses;
    row.signalHitPct =
      closed > 0 ? Math.round((100 * d.hits) / closed * 10) / 10 : null;
  }

  for (const e of events) {
    if (!e.dayKey || e.dayKey === "unknown") continue;
    const row = ensure(e.dayKey);
    if (e.kind === "recalibration") {
      row.recalib = true;
      if (e.metricAfter != null && (e.metricLabel ?? "").includes("cal_factor")) {
        row.calFactor = e.metricAfter;
      }
    }
    if (e.kind === "monitor_snapshot" && e.metricAfter != null) {
      row.accV4 = e.metricAfter;
    }
  }

  for (const ent of monitorEntries) {
    const dk = dayKeyFromIso(ent.runIso);
    if (!dk) continue;
    const row = ensure(dk);
    if (ent.accV4Pct != null) row.accV4 = ent.accV4Pct;
  }

  return [...dayMap.values()]
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .slice(-45);
}

function calFactorV4(cf: Record<string, number | null> | undefined): number | null {
  if (!cf) return null;
  return parseNum(cf.v4_options ?? cf["v4_options"]);
}

function buildRecalibrationEvents(sources: ModelLearningsSources, lang: "en" | "it"): ModelLearningEvent[] {
  const out: ModelLearningEvent[] = [];
  const doc = sources.calibState;
  if (!doc) return out;

  const history = doc.history ?? [];
  const current = doc.current;
  const it = lang === "it";

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const next = i + 1 < history.length ? history[i + 1] : current;
    const ts = h.timestamp ?? "";
    const dayKey = dayKeyFromIso(ts);
    if (!dayKey) continue;
    const before = calFactorV4(h.cal_factor);
    const after = next ? calFactorV4(next.cal_factor ?? (next as typeof h).cal_factor) : null;
    const delta = before != null && after != null ? after - before : null;
    out.push({
      dayKey,
      ts: Date.parse(ts) || 0,
      kind: "recalibration",
      title: it ? "Ricalibrazione modello" : "Model recalibration",
      detail: it
        ? `Aggiornato cal_factor v4 da retro-pool (n=${h.n_retro_total ?? "—"}).`
        : `Updated v4 cal_factor from retro pool (n=${h.n_retro_total ?? "—"}).`,
      metricBefore: before,
      metricAfter: after,
      metricDelta: delta,
      metricLabel: "cal_factor v4",
      appliedTo: it
        ? "Affidabilità ricalibrata, curve empiriche, predizioni Simulation"
        : "Recalibrated reliability, empirical curves, Simulation predictions",
    });
  }

  if (current?.timestamp) {
    const dayKey = dayKeyFromIso(current.timestamp);
    const prev = history[history.length - 1];
    const before = prev ? calFactorV4(prev.cal_factor) : null;
    const after = calFactorV4(current.cal_factor);
    if (dayKey && (before == null || before !== after)) {
      out.push({
        dayKey,
        ts: Date.parse(current.timestamp) || 0,
        kind: "recalibration",
        title: it ? "Ricalibrazione corrente" : "Current recalibration",
        detail: it
          ? `Stato attivo · n retro=${current.n_retro_total ?? "—"}`
          : `Active state · retro n=${current.n_retro_total ?? "—"}`,
        metricBefore: before,
        metricAfter: after,
        metricDelta: before != null && after != null ? after - before : null,
        metricLabel: "cal_factor v4",
        appliedTo: it ? "Modello in produzione" : "Production model",
      });
    }
  }

  return out;
}

function buildMonitorEvents(
  sources: ModelLearningsSources,
  lang: "en" | "it",
): { events: ModelLearningEvent[]; entries: MonitorEntry[] } {
  const it = lang === "it";
  const raw = sources.monitor?.entries ?? [];
  const entries = parseMonitorEntries({ entries: raw });
  const events: ModelLearningEvent[] = [];

  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const rec = e as Record<string, unknown>;
    const runIso = String(rec.run_iso ?? "");
    const dayKey = dayKeyFromIso(runIso);
    if (!dayKey) continue;
    const acc = parseNum(rec.acc_v4_pct);
    const delta = parseNum(rec.delta_pp_vs_prev);
    const calFactor = parseNum(rec.cal_factor_v4);
    const trigger = rec.snapshot_trigger != null ? String(rec.snapshot_trigger) : "";
    events.push({
      dayKey,
      ts: Date.parse(runIso) || 0,
      kind: "monitor_snapshot",
      title: it ? "Snapshot accuratezza" : "Accuracy snapshot",
      detail: trigger
        ? `${it ? "Trigger" : "Trigger"}: ${trigger} · N=${parseNum(rec.n_evaluable_ok_v4) ?? "—"}`
        : `N=${parseNum(rec.n_evaluable_ok_v4) ?? "—"}`,
      metricBefore: delta != null && acc != null ? acc - delta : null,
      metricAfter: acc,
      metricDelta: delta,
      metricLabel: it ? "Acc. direzionale v4" : "v4 directional acc.",
      appliedTo: calFactor != null ? `cal_factor=${calFactor.toFixed(4)}` : undefined,
    });
  }

  return { events, entries };
}

function buildCohortEvents(sources: ModelLearningsSources, lang: "en" | "it"): ModelLearningEvent[] {
  const it = lang === "it";
  const out: ModelLearningEvent[] = [];
  const comparison = sources.cohort?.comparison;
  if (comparison?.current_at) {
    const dayKey = dayKeyFromIso(comparison.current_at);
    if (dayKey) {
      const hitDelta = comparison.summary_delta?.hit_rate_pct ?? null;
      out.push({
        dayKey,
        ts: Date.parse(comparison.current_at) || 0,
        kind: "cohort_rebuild",
        title: it ? "Rigenerazione cohort decisionale" : "Decision cohort rebuild",
        detail: comparison.env_changed
          ? it
            ? "Ambiente modello cambiato — confronto before/after disponibile"
            : "Model environment changed — before/after comparison available"
          : it
            ? "Cohort storico aggiornato dopo refresh"
            : "Historical cohort updated after refresh",
        metricDelta: hitDelta,
        metricLabel: "Δ Hit%",
        appliedTo: it ? "Validazione rolling pre-CD" : "Rolling pre-CD validation",
      });
    }
  }

  for (const snap of sources.cohortHistory?.snapshots ?? []) {
    const dayKey = dayKeyFromIso(snap.generated_at);
    if (!dayKey) continue;
    if (out.some((e) => e.dayKey === dayKey && e.kind === "cohort_rebuild")) continue;
    out.push({
      dayKey,
      ts: Date.parse(snap.generated_at ?? "") || 0,
      kind: "cohort_rebuild",
      title: it ? "Snapshot cohort" : "Cohort snapshot",
      detail: `Hit=${snap.summary?.hit_rate_pct ?? "—"}% · IC=${snap.summary?.ic_spearman ?? "—"}`,
      metricAfter: snap.summary?.hit_rate_pct ?? null,
      metricLabel: "Hit%",
    });
  }

  return out;
}

function buildDirectionalEvent(sources: ModelLearningsSources, lang: "en" | "it"): ModelLearningEvent[] {
  const doc = sources.directional;
  if (!doc?.generated_at) return [];
  const dayKey = dayKeyFromIso(doc.generated_at);
  if (!dayKey) return [];
  const it = lang === "it";
  return [
    {
      dayKey,
      ts: Date.parse(doc.generated_at) || 0,
      kind: "directional_kpi",
      title: it ? "KPI direzionali aggiornati" : "Directional KPIs updated",
      detail: it
        ? `Useful hit=${doc.useful_hit_pct ?? "—"}% (n=${doc.useful_n_directional ?? 0}) · chiusi=${doc.records_with_actual ?? "—"}`
        : `Useful hit=${doc.useful_hit_pct ?? "—"}% (n=${doc.useful_n_directional ?? 0}) · closed=${doc.records_with_actual ?? "—"}`,
      metricAfter: doc.useful_hit_pct ?? doc.hit_directional ?? null,
      metricLabel: it ? "Hit% utile" : "Useful Hit%",
      appliedTo: it ? "Filtri segnale e soglie affidabilità" : "Signal filters and reliability thresholds",
    },
  ];
}

function buildSignalWeekEvents(sources: ModelLearningsSources, lang: "en" | "it"): ModelLearningEvent[] {
  const it = lang === "it";
  const rows = sources.signalCalib?.weekly_actionable ?? [];
  return rows.map((w: SignalWeeklyRow) => {
    const dayKey = w.week_key?.includes("-W")
      ? w.week_key
      : dayKeyFromIso(w.week_key) ?? w.week_key;
    return {
      dayKey: dayKey ?? "unknown",
      ts: 0,
      kind: "signal_week" as const,
      title: it ? "Batch segnali settimanale" : "Weekly signal batch",
      detail: `n=${w.n ?? 0} · Hit=${w.hit_pct ?? "—"}%`,
      metricAfter: w.hit_pct ?? null,
      metricLabel: "Hit%",
      appliedTo: it ? "Audit segnali pre-CD" : "Pre-CD signal audit",
    };
  });
}

function buildDailyOutcomes(scatter: SignalScatterPoint[] | undefined): DailySignalOutcome[] {
  const out: DailySignalOutcome[] = [];
  for (const p of scatter ?? []) {
    const ticker = String(p.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const dayKey = dayKeyFromIso(p.log_date) ?? "unknown";
    const pending = p.actual_5d_pct == null && p.hit == null;
    out.push({
      dayKey,
      ticker,
      pred5_pp: p.pred5_pp ?? null,
      actual_5d_pct: p.actual_5d_pct ?? null,
      hit: p.hit ?? null,
      pending,
      affid: p.affid ?? null,
    });
  }
  return out.sort((a, b) => b.dayKey.localeCompare(a.dayKey) || a.ticker.localeCompare(b.ticker));
}

function groupByDay(
  events: ModelLearningEvent[],
  outcomes: DailySignalOutcome[],
  lang: "en" | "it",
): DayLearningSummary[] {
  const dayMap = new Map<string, DayLearningSummary>();

  const ensure = (dayKey: string): DayLearningSummary => {
    let d = dayMap.get(dayKey);
    if (!d) {
      d = {
        dayKey,
        dayLabel: dayLabel(dayKey, lang),
        events: [],
        outcomes: [],
        hits: 0,
        misses: 0,
        pending: 0,
      };
      dayMap.set(dayKey, d);
    }
    return d;
  };

  for (const e of events) {
    ensure(e.dayKey).events.push(e);
  }
  for (const o of outcomes) {
    const d = ensure(o.dayKey);
    d.outcomes.push(o);
    if (o.pending) d.pending += 1;
    else if (o.hit === true) d.hits += 1;
    else if (o.hit === false) d.misses += 1;
  }

  for (const d of dayMap.values()) {
    d.events.sort((a, b) => b.ts - a.ts);
  }

  return [...dayMap.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}

const PIPELINE_STEPS_EN: PipelineStep[] = [
  {
    id: "outcomes",
    title: "Closed outcomes (Past Pred + audit)",
    source: "past_catalyst_predictions.json · signal_audit_log.jsonl",
    consumes: "Real 5d returns after each pre-CD signal",
    produces: "Hit/miss per ticker · scatter pred5 vs actual",
  },
  {
    id: "directional",
    title: "Directional KPI build",
    source: "accuracy_directional_calibration.json",
    consumes: "All closed pairs with reliability filter",
    produces: "Useful Hit%, strong tier, per-horizon stats",
  },
  {
    id: "calib",
    title: "Model recalibration",
    source: "model_calibration_state.json",
    consumes: "Retro pool errors · magnitude buckets",
    produces: "cal_factor v4 · empirical curve adjustments",
  },
  {
    id: "monitor",
    title: "Accuracy monitor",
    source: "model_accuracy_monitor_history.json",
    consumes: "Each refresh / weekly snapshot",
    produces: "Acc v4 trend · Δpp vs previous · MAE T+7",
  },
  {
    id: "apply",
    title: "Applied to predictions",
    source: "Simulation sheet · Active Signals",
    consumes: "cal_factor + curve feedback + adaptive rules",
    produces: "Updated Affidabilità · pred5_live · signal tiers",
  },
];

const PIPELINE_STEPS_IT: PipelineStep[] = [
  {
    id: "outcomes",
    title: "Esiti chiusi (Past Pred + audit)",
    source: "past_catalyst_predictions.json · signal_audit_log.jsonl",
    consumes: "Rendimenti reali a 5g dopo ogni segnale pre-CD",
    produces: "Hit/miss per ticker · scatter pred5 vs actual",
  },
  {
    id: "directional",
    title: "Build KPI direzionali",
    source: "accuracy_directional_calibration.json",
    consumes: "Tutte le coppie chiuse con filtro affidabilità",
    produces: "Useful Hit%, tier strong, stats per orizzonte",
  },
  {
    id: "calib",
    title: "Ricalibrazione modello",
    source: "model_calibration_state.json",
    consumes: "Errori retro-pool · bucket magnitudine",
    produces: "cal_factor v4 · aggiustamenti curve empiriche",
  },
  {
    id: "monitor",
    title: "Monitor accuratezza",
    source: "model_accuracy_monitor_history.json",
    consumes: "Ogni refresh / snapshot settimanale",
    produces: "Trend acc v4 · Δpp vs precedente · MAE T+7",
  },
  {
    id: "apply",
    title: "Applicato alle predizioni",
    source: "Foglio Simulation · Segnali attivi",
    consumes: "cal_factor + feedback curve + regole adaptive",
    produces: "Affidabilità aggiornata · pred5_live · tier segnale",
  },
];

function fmtPctPlain(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtPpPlain(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

export function buildLearningNarrativeSummary(
  view: Pick<
    ModelLearningsView,
    "events" | "days" | "trend" | "kpis" | "comparisonHitDelta" | "comparisonAt"
  >,
  lang: "en" | "it",
): LearningNarrativeSummary {
  const it = lang === "it";
  const { kpis, trend } = view;
  const totalHits = view.days.reduce((s, d) => s + d.hits, 0);
  const totalMisses = view.days.reduce((s, d) => s + d.misses, 0);
  const closedRecent = totalHits + totalMisses;

  const lastRecalib = view.events.find((e) => e.kind === "recalibration");
  const lastMonitor = view.events.find((e) => e.kind === "monitor_snapshot");
  const lastCohort = view.events.find((e) => e.kind === "cohort_rebuild");

  const trendWord =
    trend.label === "improving"
      ? it
        ? "in miglioramento"
        : "getting better"
      : trend.label === "degrading"
        ? it
          ? "in calo"
          : "getting worse"
        : trend.label === "stable"
          ? it
            ? "stabile"
            : "steady"
          : it
            ? "in pausa"
            : "on hold";

  const accBit =
    kpis.preCdSignHitPct != null
      ? it
        ? `segno giornaliero pre-CD (2 mesi) azzeccato nel ${fmtPctPlain(kpis.preCdSignHitPct)} delle sedute`
        : `pre-CD daily sign (2 mo) correct ${fmtPctPlain(kpis.preCdSignHitPct)} of sessions`
      : kpis.accRetro != null
        ? it
          ? `segno curva storica ~${fmtPctPlain(kpis.accRetro)}`
          : `historical curve sign ~${fmtPctPlain(kpis.accRetro)}`
        : it
          ? "la precisione non è ancora misurabile"
          : "accuracy can't be measured yet";

  const headline = it
    ? `Il modello è ${trendWord}: ${accBit}.`
    : `The model is ${trendWord}: ${accBit}.`;

  const whatHappened: string[] = [];

  if (kpis.closedSignals > 0 || kpis.pendingSignals > 0) {
    const hitRecent =
      closedRecent > 0 ? Math.round((100 * totalHits) / closedRecent) : null;
    whatHappened.push(
      it
        ? `${kpis.closedSignals} previsioni già verificate · ${kpis.pendingSignals} ancora in attesa (circa 5 giorni di borsa per chiuderle)${
            hitRecent != null ? ` · negli ultimi giorni: ${hitRecent}% azzeccate (${totalHits} sì, ${totalMisses} no)` : ""
          }.`
        : `${kpis.closedSignals} predictions already checked · ${kpis.pendingSignals} still waiting (about 5 trading days to close)${
            hitRecent != null ? ` · recent days: ${hitRecent}% correct (${totalHits} yes, ${totalMisses} no)` : ""
          }.`,
    );
  } else {
    whatHappened.push(
      it
        ? "Non ci sono ancora previsioni verificate — il modello aspetta i prossimi refresh con risultati chiusi."
        : "No verified predictions yet — the model is waiting for the next refresh with closed results.",
    );
  }

  if (kpis.preCdSignHitPct != null) {
    whatHappened.push(
      it
        ? `Segno giornaliero pre-CD (2 mesi): ${fmtPctPlain(kpis.preCdSignHitPct)} — ogni giorno di borsa, Δ prezzo stimato vs Δ reale nella stessa direzione.`
        : `Pre-CD daily sign (2 mo): ${fmtPctPlain(kpis.preCdSignHitPct)} — each session, estimated vs actual day move same direction.`,
    );
  }

  if (kpis.nSimEval != null && kpis.nSimEval > 0 && kpis.accSim != null) {
    whatHappened.push(
      it
        ? `Simulation (nuove analisi): ${fmtPctPlain(kpis.accSim)} su ${kpis.nSimEval} verificate${
            kpis.nSimPending > 0 ? ` · ${kpis.nSimPending} ancora in attesa (≥32 gg dopo CD)` : ""
          }.`
        : `Simulation (new entries): ${fmtPctPlain(kpis.accSim)} on ${kpis.nSimEval} verified${
            kpis.nSimPending > 0 ? ` · ${kpis.nSimPending} still pending (≥32 calendar days after CD)` : ""
          }.`,
    );
  } else if (kpis.nSimPending > 0) {
    whatHappened.push(
      it
        ? `Simulation: ${kpis.nSimPending} analisi in attesa di esito (catalyst non ancora maturi).`
        : `Simulation: ${kpis.nSimPending} analyses waiting for outcome (catalyst not mature yet).`,
    );
  }

  if (kpis.usefulHitPct != null) {
    whatHappened.push(
      it
        ? `Sui segnali passati di buona qualità, la percentuale di successo storica è ${fmtPctPlain(kpis.usefulHitPct)}.`
        : `On past high-quality signals, the historical success rate is ${fmtPctPlain(kpis.usefulHitPct)}.`,
    );
  }

  if (lastRecalib) {
    const when = dayLabel(lastRecalib.dayKey, lang);
    whatHappened.push(
      it
        ? `Ultimo aggiornamento automatico (${when}): il modello ha ritoccato le curve in base agli errori passati.`
        : `Last automatic update (${when}): the model adjusted its curves based on past errors.`,
    );
  }

  if (lastCohort && view.comparisonAt) {
    const when = dayLabel(dayKeyFromIso(view.comparisonAt) ?? lastCohort.dayKey, lang);
    const deltaNote =
      view.comparisonHitDelta != null && Math.abs(view.comparisonHitDelta) > 0.05
        ? it
          ? ` Il tasso di successo è cambiato di ${fmtPpPlain(view.comparisonHitDelta)}.`
          : ` Success rate shifted by ${fmtPpPlain(view.comparisonHitDelta)}.`
        : it
          ? " Nessun cambiamento significativo nel tasso di successo."
          : " No significant change in success rate.";
    whatHappened.push(
      it
        ? `Criteri Buy/Sell rivisti (${when}).${deltaNote}`
        : `Buy/Sell criteria reviewed (${when}).${deltaNote}`,
    );
  } else if (lastMonitor) {
    const when = dayLabel(lastMonitor.dayKey, lang);
    const deltaNote =
      kpis.deltaPpLastMonitor != null && Math.abs(kpis.deltaPpLastMonitor) > 0.05
        ? it
          ? ` Precisione ${kpis.deltaPpLastMonitor > 0 ? "migliorata" : "peggiorata"} di ${fmtPpPlain(kpis.deltaPpLastMonitor)}.`
          : ` Accuracy ${kpis.deltaPpLastMonitor > 0 ? "up" : "down"} by ${fmtPpPlain(kpis.deltaPpLastMonitor)}.`
        : it
          ? " Precisione invariata rispetto al controllo precedente."
          : " Accuracy unchanged since the previous check.";
    whatHappened.push(
      it
        ? `Ultimo controllo settimanale (${when}).${deltaNote}`
        : `Latest weekly check (${when}).${deltaNote}`,
    );
  }

  const modelImpact: string[] = [];

  if (kpis.calFactorV4 != null) {
    modelImpact.push(
      it
        ? "Le curve e i ROI che vedi in Simulation usano già l'ultima correzione calcolata dal modello."
        : "The curves and ROI you see in Simulation already use the model's latest correction.",
    );
  }

  if (kpis.deltaPpLastMonitor != null) {
    const dir =
      kpis.deltaPpLastMonitor > 0.05
        ? it
          ? "è migliorata leggermente"
          : "has improved slightly"
        : kpis.deltaPpLastMonitor < -0.05
          ? it
            ? "è peggiorata leggermente"
          : "has worsened slightly"
          : it
            ? "è rimasta uguale"
            : "has stayed the same";
    modelImpact.push(
      it
        ? `La precisione del modello ${dir} rispetto all'ultimo controllo.`
        : `Model accuracy ${dir} compared to the last check.`,
    );
  } else if (kpis.accV4 != null) {
    modelImpact.push(
      it
        ? `La precisione resta intorno al ${fmtPctPlain(kpis.accV4)} — servono più controlli per capire se il trend cambia.`
        : `Accuracy stays around ${fmtPctPlain(kpis.accV4)} — more checks are needed to see if the trend is changing.`,
    );
  }

  if (view.comparisonHitDelta != null && Math.abs(view.comparisonHitDelta) > 0.05) {
    modelImpact.push(
      it
        ? "Le soglie dei segnali Buy/Sell si sono adattate al nuovo storico."
        : "Buy/Sell signal thresholds have adapted to the updated history.",
    );
  }

  if (kpis.pendingSignals > 0 && kpis.closedSignals === 0) {
    modelImpact.push(
      it
        ? `Quando si chiuderanno abbastanza previsioni (di solito dopo ~5 giorni), il modello farà un nuovo aggiornamento automatico.`
        : `Once enough predictions close (usually after ~5 days), the model will run another automatic update.`,
    );
  }

  return {
    headline,
    whatHappened: whatHappened.slice(0, 4),
    modelImpact: modelImpact.slice(0, 4),
  };
}

export function buildModelLearningsView(
  sources: ModelLearningsSources,
  options: { lang?: "en" | "it"; monitorSource?: string } = {},
): ModelLearningsView {
  const lang = options.lang ?? "en";
  const { events: monitorEvents, entries } = buildMonitorEvents(sources, lang);
  const events = [
    ...buildRecalibrationEvents(sources, lang),
    ...monitorEvents,
    ...buildCohortEvents(sources, lang),
    ...buildDirectionalEvent(sources, lang),
    ...buildSignalWeekEvents(sources, lang),
  ].sort((a, b) => b.ts - a.ts || b.dayKey.localeCompare(a.dayKey));

  const outcomes = buildDailyOutcomes(sources.signalCalib?.scatter_pred5_vs_actual);
  const days = groupByDay(events, outcomes, lang);
  const evolution = buildWeeklyEvolution(entries);

  const lastMonitor = [...entries].filter((e) => !e.invalid).sort(
    (a, b) => Date.parse(b.runIso) - Date.parse(a.runIso),
  )[0];
  const rawLast = [...(sources.monitor?.entries ?? [])]
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .sort((a, b) => Date.parse(String(b.run_iso ?? "")) - Date.parse(String(a.run_iso ?? "")))[0];

  const currentCf = calFactorV4(sources.calibState?.current?.cal_factor);
  const hist = sources.calibState?.history ?? [];
  const prevCf = hist.length ? calFactorV4(hist[hist.length - 1]?.cal_factor) : null;
  const calDelta = currentCf != null && prevCf != null ? currentCf - prevCf : null;

  const chartRows = buildLearningLoopChartData(days, events, entries, lang);

  const comparisonHitDelta = sources.cohort?.comparison?.summary_delta?.hit_rate_pct ?? null;
  const comparisonAt = sources.cohort?.comparison?.current_at ?? null;

  const pendingSignals = sources.signalCalib?.pending_outcomes ?? 0;
  const usefulHitPeak = resolveStrongSignalsHighlight(
    sources.directional,
    sources.signalCalib?.live_latest,
    pendingSignals,
  );

  const cohortK = cohortAccuracyKpis(sources.cohortAccuracy);
  const signCurve = buildSignAccuracyCurveView(
    sources.accuracySummary,
    sources.signCurveDaily,
  );
  const signPeakHit = peakSignHitFromPoints(signCurve.points);

  const modelStretch = buildModelStretchView(
    sources.calibState,
    sources.signCurveDaily,
    sources.accuracySummary,
    sources.signalCalib?.curve_impact_cumulative,
  );

  const modelSizeError = buildModelSizeErrorView(entries);

  const partial = {
    events,
    days,
    chartRows,
    monitorEntries: entries,
    monitorSource: options.monitorSource ?? "",
    trend: evolution.trend,
    kpis: {
      accV4: signCurve.preCdHitPct ?? cohortK.accRetro ?? lastMonitor?.accV4Pct ?? null,
      accRetro: signCurve.preCdHitPct ?? cohortK.accRetro ?? lastMonitor?.accV4Pct ?? null,
      preCdSignHitPct: signCurve.preCdHitPct,
      accSim: cohortK.accSim,
      nRetroEval: cohortK.nRetroEval ?? lastMonitor?.nEval ?? null,
      nSimEval: cohortK.nSimEval,
      nSimPending: cohortK.nSimPending,
      usefulHitPct: sources.directional?.useful_hit_pct ?? null,
      usefulHitPeak,
      signPeakHit,
      calFactorV4: currentCf,
      calFactorDelta: calDelta,
      deltaPpLastMonitor: rawLast ? parseNum(rawLast.delta_pp_vs_prev) : null,
      pendingSignals,
      closedSignals: sources.signalCalib?.closed_rows ?? 0,
      nRetro: sources.calibState?.current?.n_retro_total ?? null,
    },
    pipelineSteps: lang === "it" ? PIPELINE_STEPS_IT : PIPELINE_STEPS_EN,
    comparisonHitDelta,
    comparisonAt,
    modelStretch,
    modelSizeError,
  };

  return {
    ...partial,
    narrative: buildLearningNarrativeSummary(partial, lang),
  };
}
