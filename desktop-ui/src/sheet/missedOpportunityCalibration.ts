/**
 * Piano di calibrazione P(plan) / Enter da audit opportunità perse.
 */
import type { MissedOppBlockerStat, MissedOppRow, MissedOpportunitySummary } from "./missedOpportunityAudit";
import { FWD_ENTRY_MIN, P_ENTRY_MIN } from "./recoveryProbability";

export type MissedOppBlockerKind =
  | "low_forward"
  | "negative_arc"
  | "low_match"
  | "slope_exit"
  | "slope_watch"
  | "precat_avoid"
  | "precat_early"
  | "precat_late"
  | "low_pplan"
  | "verdict_wait"
  | "verdict_skip"
  | "other";

export type MissedOppCalibrationAction = {
  id: string;
  priority: "high" | "medium" | "low";
  titleIt: string;
  titleEn: string;
  detailIt: string;
  detailEn: string;
  /** Parametro suggerito (solo display / learning loop). */
  param?: string;
  suggestedValue?: string;
  currentValue?: string;
};

export type MissedOppAxisGap = {
  id: string;
  label: string;
  current: number;
  target: number;
  rawValue: number | null;
  threshold: number;
  unit: string;
  gapPct: number;
  belowThreshold: boolean;
};

export type MissedOppCalibrationPlan = {
  actions: MissedOppCalibrationAction[];
  blockerCounts: Partial<Record<MissedOppBlockerKind, number>>;
  avgMissedDailyPct: number | null;
  avgMissedMatch: number | null;
};

export function classifyBlockerLabel(label: string): MissedOppBlockerKind {
  const l = label.toLowerCase();
  if (l.includes("forward") || l.includes("target forward")) return "low_forward";
  if (l.includes("roi arco") || l.includes("arc roi")) return "negative_arc";
  if (l.includes("match") || l.includes("poligono") || l.includes("polygon")) return "low_match";
  if (l.includes("exit/avoid") || l.includes("uscita")) return "slope_exit";
  if (l.includes("watch")) return "slope_watch";
  if (l.includes("evita") || l.includes("avoid entry")) return "precat_avoid";
  if (l.includes("lontano") || l.includes("too far")) return "precat_early";
  if (l.includes("tardivo") || l.includes("late entry")) return "precat_late";
  if (l.includes("p(plan)") || l.includes("p(piano)")) return "low_pplan";
  if (l.includes("attendere") || l.includes("wait")) return "verdict_wait";
  if (l.includes("skip")) return "verdict_skip";
  return "other";
}

export function aggregateBlockerKinds(
  rows: MissedOppRow[],
): Partial<Record<MissedOppBlockerKind, number>> {
  const counts: Partial<Record<MissedOppBlockerKind, number>> = {};
  for (const row of rows) {
    const seen = new Set<MissedOppBlockerKind>();
    for (const label of row.blockers) {
      const kind = classifyBlockerLabel(label);
      if (seen.has(kind)) continue;
      seen.add(kind);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

export function buildMissedOppCalibrationPlan(
  summary: MissedOpportunitySummary,
  _lang: "it" | "en",
): MissedOppCalibrationPlan {
  const missed = summary.missedRows;
  const counts = aggregateBlockerKinds(missed);
  const n = missed.length;
  const actions: MissedOppCalibrationAction[] = [];

  const avgMissedDailyPct =
    n > 0 ? Math.round((missed.reduce((s, r) => s + r.dailyPct24h, 0) / n) * 10) / 10 : null;
  const withMatch = missed.filter((r) => r.matchPct != null);
  const avgMissedMatch =
    withMatch.length > 0
      ? Math.round(withMatch.reduce((s, r) => s + (r.matchPct ?? 0), 0) / withMatch.length)
      : null;

  const share = (kind: MissedOppBlockerKind) => (n > 0 ? (counts[kind] ?? 0) / n : 0);

  if (share("low_forward") >= 0.4 && avgMissedDailyPct != null && avgMissedDailyPct >= 1.5) {
    actions.push({
      id: "relax_fwd_with_momentum",
      priority: "high",
      titleIt: "Target forward troppo restrittivo vs mercato",
      titleEn: "Forward target too strict vs market",
      detailIt: `${Math.round(share("low_forward") * 100)}% delle perse ha target < ${FWD_ENTRY_MIN}% ma Var. Giorn. media +${avgMissedDailyPct}%. Il modello penalizza il picco curva mentre il titolo sale oggi — attivo boost momentum 24h in P(plan).`,
      detailEn: `${Math.round(share("low_forward") * 100)}% of misses have target < ${FWD_ENTRY_MIN}% but mean Var. Giorn. +${avgMissedDailyPct}%. Model penalizes curve peak while price rises today — 24h momentum boost enabled in P(plan).`,
      param: "FWD_ENTRY_MIN (with momentum)",
      currentValue: `${FWD_ENTRY_MIN}%`,
      suggestedValue: `1% when Var. Giorn. ≥ +2%`,
    });
  }

  if (share("negative_arc") >= 0.35 && avgMissedDailyPct != null && avgMissedDailyPct >= 1) {
    actions.push({
      id: "arc_vs_daily_divergence",
      priority: "high",
      titleIt: "ROI arco vs rialzo 24h in divergenza",
      titleEn: "Arc ROI vs 24h gain diverging",
      detailIt: `${counts.negative_arc ?? 0} ticker con arco modello ↓ ma prezzo ↑ oggi. Non usare solo l'arco storico — pesare Var. Giorn. quando contradice il segmento.`,
      detailEn: `${counts.negative_arc ?? 0} tickers with model arc ↓ but price ↑ today. Do not rely on arc alone — weight Var. Giorn. when it contradicts the segment.`,
      param: "factorArcMomentum + dailyPct24h",
      suggestedValue: "boost when daily ↑ & arc ↓",
    });
  }

  if (share("low_match") >= 0.35) {
    actions.push({
      id: "review_polygon_thresholds",
      priority: "medium",
      titleIt: "Match poligono sotto soglia su molte perse",
      titleEn: "Polygon match below threshold on many misses",
      detailIt: `Match medio ${avgMissedMatch ?? "—"}% sulle perse. Valuta soglie RA/SDS/MII della finestra CD attiva (Decision Lab → Patterns).`,
      detailEn: `Mean match ${avgMissedMatch ?? "—"}% on misses. Review RA/SDS/MII thresholds for the active CD window (Decision Lab → Patterns).`,
      param: "CD_PATTERN_WINDOWS",
      suggestedValue: "−3…−5 pt on weakest axis",
    });
  }

  if (share("low_pplan") >= 0.4) {
    actions.push({
      id: "review_p_entry",
      priority: "medium",
      titleIt: "P(plan) sotto soglia Enter",
      titleEn: "P(plan) below Enter threshold",
      detailIt: `${Math.round(share("low_pplan") * 100)}% perse con P(plan) < ${P_ENTRY_MIN}%. Rivedi peso forward/arco o soglia Enter se il recall resta basso.`,
      detailEn: `${Math.round(share("low_pplan") * 100)}% misses with P(plan) < ${P_ENTRY_MIN}%. Review forward/arc weights or Enter threshold if recall stays low.`,
      param: "P_ENTRY_MIN",
      currentValue: `${P_ENTRY_MIN}%`,
      suggestedValue: "55–58% (only if precision OK)",
    });
  }

  if (share("slope_watch") >= 0.3) {
    actions.push({
      id: "slope_watch_missed",
      priority: "low",
      titleIt: "Molte perse in regime WATCH",
      titleEn: "Many misses in WATCH slope regime",
      detailIt: "Pendenza piatta/WATCH blocca Enter anche con rialzo 24h — valuta eccezione quando match ≥ 70% e Var. Giorn. ≥ +1.5%.",
      detailEn: "Flat/WATCH slope blocks Enter despite 24h gain — consider exception when match ≥ 70% and Var. Giorn. ≥ +1.5%.",
    });
  }

  if (!actions.length && n > 0) {
    actions.push({
      id: "drilldown",
      priority: "low",
      titleIt: "Analizza i singoli ticker persi",
      titleEn: "Drill down into individual misses",
      detailIt: "Apri il dettaglio per confrontare poligono vs target e blocker specifici.",
      detailEn: "Open detail rows to compare polygon vs target and specific blockers.",
    });
  }

  actions.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority];
  });

  return { actions, blockerCounts: counts, avgMissedDailyPct, avgMissedMatch };
}

export function buildAxisGapsFromPattern(
  axes: { id: string; label: string; current: number; target: number; rawValue: number | null; threshold: number; unit: string }[],
): MissedOppAxisGap[] {
  return axes
    .map((a) => ({
      id: a.id,
      label: a.label,
      current: a.current,
      target: a.target,
      rawValue: a.rawValue,
      threshold: a.threshold,
      unit: a.unit,
      gapPct: a.target - a.current,
      belowThreshold: a.current < a.target * 0.85,
    }))
    .sort((a, b) => b.gapPct - a.gapPct);
}

export function blockerStatsWithKinds(stats: MissedOppBlockerStat[]): MissedOppBlockerStat[] {
  return stats;
}
