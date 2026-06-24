/**
 * Adaptive plain-language summary for the Curve Engine tab.
 * Recomputes from latest monitor + accuracy summary on every data reload.
 */
import type { TemporalModelRow } from "./accuracyMetrics";
import type { DirectionalCalibDoc } from "../data/accuracyModelData";
import {
  buildWeeklyEvolution,
  type EvolutionSummary,
  type EvolutionTrend,
} from "./modelEvolution";
import type { MonitorEntry } from "./accuracyMetrics";

export type CurveEngineNarrative = {
  headline: string;
  whatHappened: string[];
  modelImpact: string[];
  trend: EvolutionTrend;
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function latestModelRow(
  rows: TemporalModelRow[],
  model: "v4" | "v5",
): TemporalModelRow | null {
  return rows.find((r) => r.model === model) ?? null;
}

function horizonMetric(
  row: TemporalModelRow | null,
  offset: number,
  kind: "hit" | "mae",
): number | null {
  if (!row) return null;
  const h = row.horizons.find((x) => x.offset === offset);
  if (!h) return null;
  return kind === "hit" ? h.hitPct : h.mae;
}

function trendWord(trend: EvolutionTrend, it: boolean): string {
  if (trend.label === "improving") return it ? "in miglioramento" : "improving";
  if (trend.label === "degrading") return it ? "in calo" : "declining";
  if (trend.label === "stable") return it ? "stabile" : "stable";
  return it ? "ancora da valutare" : "not yet assessable";
}

function accHealthLabel(acc: number | null, it: boolean): string {
  if (acc == null) return it ? "non misurata" : "not measured";
  if (acc >= 60) return it ? "solida (≥60%)" : "solid (≥60%)";
  if (acc >= 55) return it ? "accettabile (55–60%)" : "acceptable (55–60%)";
  if (acc >= 50) return it ? "al limite (~50%)" : "borderline (~50%)";
  return it ? "sotto il random (~50%)" : "below random (~50%)";
}

export function buildCurveEngineNarrative(input: {
  monitorEntries: MonitorEntry[];
  summaryRows: TemporalModelRow[];
  calibDoc: DirectionalCalibDoc | null;
  lang: "en" | "it";
}): CurveEngineNarrative {
  const it = input.lang === "it";
  const evolution = buildWeeklyEvolution(input.monitorEntries);
  const { trend, currentWeek, prevWeek, totalWeeks, totalRuns } = evolution;

  const v4Row = latestModelRow(input.summaryRows, "v4");
  const v5Row = latestModelRow(input.summaryRows, "v5");
  const calib = input.calibDoc;

  const acc =
    currentWeek?.accV4Pct ??
    [...input.monitorEntries].reverse().find((e) => !e.invalid)?.accV4Pct ??
    null;

  const headline = it
    ? `Curve engine ${trendWord(trend, true)}: accuratezza direzionale v4 ${accHealthLabel(acc, true)}${
        acc != null ? ` (${fmtPct(acc)})` : ""
      }.`
    : `Curve engine ${trendWord(trend, false)}: v4 directional accuracy ${accHealthLabel(acc, false)}${
        acc != null ? ` (${fmtPct(acc)})` : ""
      }.`;

  const whatHappened: string[] = [];

  if (totalWeeks > 0) {
    whatHappened.push(
      it
        ? `Monitor settimanale: ${totalRuns} snapshot su ${totalWeeks} settimane ISO${
            trend.accSlope != null
              ? ` · pendenza acc. ${fmtPp(trend.accSlope, 2)}/sett.`
              : ""
          }.`
        : `Weekly monitor: ${totalRuns} snapshots across ${totalWeeks} ISO weeks${
            trend.accSlope != null
              ? ` · acc. slope ${fmtPp(trend.accSlope, 2)}/wk`
              : ""
          }.`,
    );
  } else if (input.monitorEntries.length === 0) {
    whatHappened.push(
      it
        ? "Nessuno snapshot monitor — esegui un test o attendi il refresh settimanale."
        : "No monitor snapshots yet — run a test or wait for the weekly refresh.",
    );
  }

  if (currentWeek) {
    const wow =
      currentWeek.deltaAcc != null
        ? fmtPp(currentWeek.deltaAcc)
        : prevWeek?.accV4Pct != null && currentWeek.accV4Pct != null
          ? fmtPp(currentWeek.accV4Pct - prevWeek.accV4Pct)
          : null;
    whatHappened.push(
      it
        ? `Settimana corrente (${currentWeek.weekLabel}): acc. v4 ${fmtPct(currentWeek.accV4Pct)}${
            wow ? ` (${wow} vs sett. prec.)` : ""
          } · Hit% T+5 ${fmtPct(currentWeek.m2HitD5)} · MAE T+7 ${fmtPp(currentWeek.m2Mae7)}.`
        : `Current week (${currentWeek.weekLabel}): v4 acc. ${fmtPct(currentWeek.accV4Pct)}${
            wow ? ` (${wow} vs prior week)` : ""
          } · Hit% T+5 ${fmtPct(currentWeek.m2HitD5)} · MAE T+7 ${fmtPp(currentWeek.m2Mae7)}.`,
    );
    if (currentWeek.hasModelChange) {
      whatHappened.push(
        it
          ? "In questa settimana è avvenuta una ricalibrazione o modifica modello (trigger monitor)."
          : "A model recalibration or change occurred this week (monitor trigger).",
      );
    }
  }

  if (v4Row) {
    const hit5 = horizonMetric(v4Row, 5, "hit");
    const mae7 = horizonMetric(v4Row, 7, "mae");
    whatHappened.push(
      it
        ? `Diagnostica curve (ultimo refresh Accuracy): v4 Hit glob. ${fmtPct(v4Row.hitGlobal)} · MAE glob. ${fmtPp(
            v4Row.maeGlobal,
          )}${
            hit5 != null || mae7 != null
              ? ` · T+5 Hit ${fmtPct(hit5)} · T+7 MAE ${fmtPp(mae7)}`
              : ""
          } (N=${v4Row.nRows ?? "—"}).`
        : `Curve diagnostics (latest Accuracy refresh): v4 global Hit ${fmtPct(v4Row.hitGlobal)} · global MAE ${fmtPp(
            v4Row.maeGlobal,
          )}${
            hit5 != null || mae7 != null
              ? ` · T+5 Hit ${fmtPct(hit5)} · T+7 MAE ${fmtPp(mae7)}`
              : ""
          } (N=${v4Row.nRows ?? "—"}).`,
    );
  }

  if (v4Row && v5Row && v4Row.hitGlobal != null && v5Row.hitGlobal != null) {
    const gap = v5Row.hitGlobal - v4Row.hitGlobal;
    const leader = gap > 0.5 ? "v5" : gap < -0.5 ? "v4" : "v4/v5";
    whatHappened.push(
      it
        ? `Confronto modelli: ${leader === "v5" ? "v5" : leader === "v4" ? "v4" : "v4 e v5"} in testa sul Hit glob. (Δ v5−v4 ${fmtPp(gap)}).`
        : `Model comparison: ${leader} leads on global Hit (v5−v4 ${fmtPp(gap)}).`,
    );
  }

  if (calib?.useful_hit_pct != null) {
    whatHappened.push(
      it
        ? `KPI direzionale utile (filtro affidabilità): ${fmtPct(calib.useful_hit_pct)} su ${calib.useful_n_directional ?? calib.records_with_actual ?? "—"} coppie.`
        : `Useful directional KPI (reliability filter): ${fmtPct(calib.useful_hit_pct)} on ${calib.useful_n_directional ?? calib.records_with_actual ?? "—"} pairs.`,
    );
  }

  const modelImpact: string[] = [];

  if (acc != null) {
    if (acc >= 60) {
      modelImpact.push(
        it
          ? "Le curve v4 in Simulation hanno un buon allineamento direzionale — le predizioni pre-CD possono essere usate con peso pieno sul timing."
          : "v4 curves in Simulation show good directional alignment — pre-CD predictions can carry full timing weight.",
      );
    } else if (acc >= 50) {
      modelImpact.push(
        it
          ? "Accuratezza al limite del random: il motore curve resta attivo ma Affidabilità e tier segnale applicano sconti conservativi."
          : "Accuracy near random baseline: the curve engine stays active but reliability and signal tiers apply conservative discounts.",
      );
    } else {
      modelImpact.push(
        it
          ? "Accuratezza sotto il 50%: le curve restano visibili ma i segnali BUY/SELL privilegiano storico e regole adaptive rispetto al modello puro."
          : "Accuracy below 50%: curves remain visible but BUY/SELL signals favour history and adaptive rules over the pure model.",
      );
    }
  }

  if (currentWeek?.deltaMae7 != null) {
    const improved = currentWeek.deltaMae7 < -0.3;
    const worsened = currentWeek.deltaMae7 > 0.3;
    if (improved) {
      modelImpact.push(
        it
          ? `MAE T+7 migliorata di ${fmtPp(-currentWeek.deltaMae7)} rispetto alla settimana scorsa — le curve si adattano meglio all'ampiezza reale post-CD.`
          : `MAE T+7 improved by ${fmtPp(-currentWeek.deltaMae7)} vs last week — curves fit post-CD magnitude better.`,
      );
    } else if (worsened) {
      modelImpact.push(
        it
          ? `MAE T+7 peggiorata di ${fmtPp(currentWeek.deltaMae7)} — la ricalibrazione (cal_factor) tenderà a correggere l'ampiezza nelle prossime run.`
          : `MAE T+7 worsened by ${fmtPp(currentWeek.deltaMae7)} — recalibration (cal_factor) will tend to correct magnitude on upcoming runs.`,
      );
    }
  }

  if (v4Row?.hitGlobal != null) {
    const hit = v4Row.hitGlobal;
    modelImpact.push(
      it
        ? `Sul campione storico catalyst, il modello indovina la direzione nel ${fmtPct(hit)} dei casi — questo alimenta cal_factor e le soglie Hit% in Decision Lab.`
        : `On the historical catalyst sample, the model calls direction correctly ${fmtPct(hit)} of the time — this feeds cal_factor and Hit% thresholds in Decision Lab.`,
    );
  }

  if (trend.description) {
    modelImpact.push(trend.description);
  }

  if (totalWeeks < 3) {
    modelImpact.push(
      it
        ? "Servono almeno 3 settimane di monitor per confermare un trend — il summary si aggiornerà automaticamente ad ogni refresh."
        : "At least 3 monitor weeks are needed to confirm a trend — this summary updates automatically on each refresh.",
    );
  }

  return {
    headline,
    whatHappened: whatHappened.slice(0, 5),
    modelImpact: modelImpact.slice(0, 5),
    trend,
  };
}

export type CurveEngineChartRow = {
  weekLabel: string;
  accV4Pct: number | null;
  m2Mae7: number | null;
};

export function buildCurveEngineChartRows(
  evolution: EvolutionSummary,
): CurveEngineChartRow[] {
  return evolution.weeks.map((w) => ({
    weekLabel: w.weekLabel,
    accV4Pct: w.accV4Pct,
    m2Mae7: w.m2Mae7,
  }));
}
