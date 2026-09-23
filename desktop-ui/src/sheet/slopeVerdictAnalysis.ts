/**
 * Analisi combinata Slope Verdict + MII per modal dettaglio (In Loss / segnali).
 */
import type { ChartPoint } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  computeSlopeStability,
  slopeStabilityLabel,
  stabilityVerdict,
  verdictLabel,
  type StabilityVerdict,
  type SlopeStabilityMetrics,
} from "./slopeStability";
import {
  DEFAULT_MIG_CONFIG,
  evaluateMarketInterest,
  type MIGResult,
  type MIGVerdict,
} from "./marketInterestGate";
import {
  resolveDailyRecalibModelSlopes5d,
  sdsRowsToMap,
  buildMarketInterestSnapshotsFromSimulation,
} from "./marketInterestFromSimulation";
import type { SheetTable } from "../types";
import { loadMigMinSlopeAngleDeg } from "./marketInterestPrefs";

export type SlopeVerdictAnalysis = {
  stability: SlopeStabilityMetrics;
  stabilityVerdict: StabilityVerdict;
  effSlope20d: number | null;
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  mig: MIGResult | null;
  narrativeIt: string;
  narrativeEn: string;
  tensionNoteIt: string | null;
  tensionNoteEn: string | null;
};

function effectiveSlope20(slope5d: number | null, slope20d: number | null): number | null {
  if (slope20d != null && Number.isFinite(slope20d)) return slope20d;
  return slope5d;
}

function buildMigForSimRow(
  simRow: Record<string, unknown>,
  simTable: SheetTable | null,
  chartPts: ChartPoint[] | null | undefined,
  sdsByTicker: Map<string, SdsRow>,
): MIGResult | null {
  if (!simTable?.rows?.length) return null;
  const cols = simTable.columns?.length
    ? simTable.columns
    : Object.keys(simTable.rows[0] ?? {});
  const colTicker = cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
  const colCd =
    cols.find((c) => c.toLowerCase().includes("completion")) ?? "Completion Date";
  const ticker = String(simRow[colTicker] ?? "")
    .trim()
    .toUpperCase();
  const cd = String(simRow[colCd] ?? "").trim();
  if (!ticker) return null;

  const sdsMap = sdsByTicker.size ? sdsByTicker : sdsRowsToMap([]);
  const snapshots = buildMarketInterestSnapshotsFromSimulation(simTable, sdsMap, {
    chartPointsBySeriesKey: undefined,
    chartsBundle: null,
    minDaysToCd: -999,
    maxDaysToCd: 9999,
  });
  let snap = snapshots.find((s) => s.ticker === ticker && (s.cd ?? "") === cd);
  if (!snap) {
    snap = snapshots.find((s) => s.ticker === ticker);
  }
  if (!snap) return null;

  if (chartPts?.length) {
    const model = resolveDailyRecalibModelSlopes5d(simRow, chartPts);
    snap = {
      ...snap,
      preDailyModelSlope5dPpPerDay: model.preDailySlope5d,
      postDailyModelSlope5dPpPerDay: model.postDailySlope5d,
    };
  }

  const minAngle = loadMigMinSlopeAngleDeg();
  return evaluateMarketInterest(snap, { ...DEFAULT_MIG_CONFIG, minSlopeAngleDeg: minAngle });
}

function migVerdictLabel(v: MIGVerdict, lang: "it" | "en"): string {
  if (lang === "it") {
    switch (v) {
      case "PASS":
        return "Gate PASS — interesse strutturale (|MII| ≥ soglia)";
      case "WATCH":
        return "Gate WATCH — interesse moderato";
      case "BLOCK":
        return "Gate BLOCK — movimento debole";
    }
  }
  switch (v) {
    case "PASS":
      return "Gate PASS — structural interest (|MII| ≥ threshold)";
    case "WATCH":
      return "Gate WATCH — moderate interest";
    case "BLOCK":
      return "Gate BLOCK — weak move";
  }
}

function calibTierLabel(tier: string, lang: "it" | "en"): string {
  const mapIt: Record<string, string> = {
    aligned: "Allineato — mercato e modello concordi",
    drift: "Drift — scostamento moderato",
    diverge: "Divergenza — gap angolare ampio",
    contrarian: "Contrarian — segni opposti (attenzione)",
    unknown: "Calib non disponibile",
  };
  const mapEn: Record<string, string> = {
    aligned: "Aligned — market and model agree",
    drift: "Drift — moderate gap",
    diverge: "Diverge — wide angular gap",
    contrarian: "Contrarian — opposite signs (caution)",
    unknown: "Calib unavailable",
  };
  return (lang === "it" ? mapIt : mapEn)[tier] ?? tier;
}

function buildNarrative(
  stability: SlopeStabilityMetrics,
  verdict: StabilityVerdict,
  slope5d: number | null,
  slope20d: number | null,
  mig: MIGResult | null,
  lang: "it" | "en",
): { main: string; tension: string | null } {
  const cls = slopeStabilityLabel(stability.stabilityClass);
  const rot =
    stability.rotationFlag === 1
      ? lang === "it"
        ? "La pendenza 5g ha invertito segno rispetto alla 20g (rotazione)."
        : "The 5d slope reversed vs the 20d slope (rotation)."
      : "";
  const cons =
    stability.consistency != null
      ? lang === "it"
        ? `Coerenza TF: ${Math.round(stability.consistency * 100)}%.`
        : `TF consistency: ${Math.round(stability.consistency * 100)}%.`
      : "";
  const persist =
    stability.persistenceWindowDays > 0
      ? lang === "it"
        ? `Finestra persistenza attesa ≈ ${stability.persistenceWindowDays} gg.`
        : `Expected persistence window ≈ ${stability.persistenceWindowDays}d.`
      : "";

  const slopePart = [cls, rot, cons, persist].filter(Boolean).join(" ");
  const verdictPart = verdictLabel(verdict);

  let migPart = "";
  if (mig) {
    const cal = mig.calibPreDaily;
    migPart =
      lang === "it"
        ? ` MII ${mig.slopeAngleDeg >= 0 ? "+" : ""}${mig.slopeAngleDeg.toFixed(1)}° (${migVerdictLabel(mig.verdict, "it")}). Calib pre ${cal.calibrationScore?.toFixed(0) ?? "—"}/100 — ${calibTierLabel(cal.calibrationTier, "it")}.`
        : ` MII ${mig.slopeAngleDeg >= 0 ? "+" : ""}${mig.slopeAngleDeg.toFixed(1)}° (${migVerdictLabel(mig.verdict, "en")}). Calib pre ${cal.calibrationScore?.toFixed(0) ?? "—"}/100 — ${calibTierLabel(cal.calibrationTier, "en")}.`;
  }

  const main =
    lang === "it"
      ? `Verdetto pendenza: ${verdictPart}. ${slopePart} Pendenze: 5g ${fmtPp(slope5d)} · 20g ${fmtPp(slope20d)}.${migPart}`
      : `Slope verdict: ${verdictPart}. ${slopePart} Slopes: 5d ${fmtPp(slope5d)} · 20d ${fmtPp(slope20d)}.${migPart}`;

  let tension: string | null = null;
  if (mig && verdict === "exit" && (slope20d ?? 0) > 0.1 && (slope5d ?? 0) < 0) {
    const miiUp = mig.slopeAngleDeg > 5;
    if (miiUp || mig.calibPreDaily.calibrationTier === "aligned") {
      tension =
        lang === "it"
          ? "Tensione: verdetto EXIT per rotazione 5g/20g, ma il trend medio (20g) o l'MII possono ancora supportare un HOLD sulla curva — verifica picco modello e Calib."
          : "Tension: EXIT verdict from 5d/20d rotation, but the medium trend (20d) or MII may still support curve HOLD — check model peak and Calib.";
    }
  }
  if (mig?.calibPreDaily.calibrationTier === "contrarian") {
    tension =
      lang === "it"
        ? "Calib contrarian: il mercato (MII) e il modello forward vanno in direzioni opposte — storicamente errore Pred+5 più alto; cautela."
        : "Contrarian Calib: market (MII) and forward model disagree — historically higher Pred+5 error; use caution.";
  }

  return { main, tension };
}

function fmtPp(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} pp/g`;
}

export function buildSlopeVerdictAnalysis(opts: {
  slope5d: number | null;
  slope20d: number | null;
  slope45d?: number | null;
  simRow: Record<string, unknown> | null;
  simTable: SheetTable | null;
  chartPts?: ChartPoint[] | null;
  sdsRows?: SdsRow[] | null;
}): SlopeVerdictAnalysis {
  const { slope5d, slope20d, slope45d = null, simRow, simTable, chartPts, sdsRows } = opts;
  const stability = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope20d = effectiveSlope20(slope5d, slope20d);
  const stabilityVerdictVal = stabilityVerdict(stability, effSlope20d);

  const sdsMap = sdsRowsToMap(sdsRows ?? null);
  const mig =
    simRow && simTable
      ? buildMigForSimRow(simRow, simTable, chartPts, sdsMap)
      : null;

  const { main: narrativeIt, tension: tensionNoteIt } = buildNarrative(
    stability,
    stabilityVerdictVal,
    slope5d,
    slope20d,
    mig,
    "it",
  );
  const { main: narrativeEn, tension: tensionNoteEn } = buildNarrative(
    stability,
    stabilityVerdictVal,
    slope5d,
    slope20d,
    mig,
    "en",
  );

  return {
    stability,
    stabilityVerdict: stabilityVerdictVal,
    effSlope20d,
    slope5d,
    slope20d,
    slope45d,
    mig,
    narrativeIt,
    narrativeEn,
    tensionNoteIt,
    tensionNoteEn,
  };
}
