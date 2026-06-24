/**
 * Score composito solidità ingresso 0–100 («Ha senso investire ORA?»).
 * Ogni componente ha peso fisso; la somma alimenta la torta UI.
 *
 * RA calib v1 (2026-06): pesi da pattern inverso T−60 coorte Simulation
 * (↑6 ↓13): riduce roi_target/timing/precat; aumenta align/sds/mii/calib/reliability.
 */
import type { Top2PickSignal } from "./top2PortfolioPick";
import { isHotZone, isWatchZone } from "./cdHorizons";
import { resolvePrimaryReturnPct } from "./canonicalRoi";
import { alignSolidityPoints } from "./entrySolidityAlign";
import {
  entryTimingSolidityPoints,
  ENTRY_TIMING_PEAK_MIN_DAYS,
  ENTRY_TIMING_PEAK_MAX_DAYS,
} from "./entrySolidityTiming";
import { pickReliabilityMetrics } from "./entrySolidityReliability";
import {
  getCachedSdsForTopOpps,
  sdsWatchEntryMinForDays,
  SDS_HOT_ENTRY_MIN,
  type SdsGateInfo,
} from "./sdsTopOppGate";
import type { MigSoliditySnapshot } from "./entrySolidityMig";
import { migSolidityKey } from "./entrySolidityMig";

function formatMiiComponentDetail(
  mig: Pick<MigSoliditySnapshot, "slopeAngleDeg" | "deltaPricePct" | "volRatio" | "verdict">,
  points: number,
  max: number,
  lang: "it" | "en",
): string {
  const deg = mig.slopeAngleDeg;
  const dSign = mig.deltaPricePct >= 0 ? "+" : "";
  const priceLabel = lang === "it" ? "prezzo" : "price";
  const pricePart = `${priceLabel} ${dSign}${mig.deltaPricePct.toFixed(1)}%`;
  const volPart = `vol ${mig.volRatio.toFixed(2)}×`;
  const head =
    lang === "it"
      ? `MII mercato ${deg >= 0 ? "+" : ""}${deg.toFixed(1)}° · ${pricePart} · ${volPart}`
      : `Market MII ${deg >= 0 ? "+" : ""}${deg.toFixed(1)}° · ${pricePart} · ${volPart}`;
  return `${head} · gate ${mig.verdict} → ${points}/${max} pt`;
}
import { isSolidityHardFailureCode } from "./solidityFailureBuckets";
import type { StrictPickFailure, StrictTopOppOpts } from "./topOppsStrictPick";

export type SolidityCompositeComponentId =
  | "reliability"
  | "timing"
  | "align"
  | "roi_target"
  | "sds"
  | "precat"
  | "mii"
  | "calib"
  | "momentum_accel";

/**
 * RA Score v2 (2026-06-16): Data-driven weight reallocation based on price correlation analysis.
 * 
 * Key changes from v1:
 * - Market MII: 10→20 pt (+10) — Best predictor (ρ=+0.44***)
 * - Pre-CD Signal: 6→15 pt (+9) — Second best (ρ=+0.32***)
 * - Target ROI: 5→10 pt (+5) — Undervalued (ρ=+0.13)
 * - Momentum Accel: 0→12 pt (NEW) — Captures short-term trend
 * - Model Reliability: 28→15 pt (-13) — Low correlation (ρ=+0.06)
 * - Direction Align: 17→10 pt (-7) — Weak predictor (ρ=+0.10)
 * - Entry Timing: 14→0 pt (-14) — Zero correlation (ρ=0.00), eliminated
 * - Calib pre&MII: 8→6 pt (-2) — Insufficient data
 * 
 * Total: 100 pt (unchanged)
 * Efficiency: 47% weight on high-correlation components (ρ>0.30) vs 16% in v1
 */
export const SOLIDITY_COMPONENT_MAX: Record<SolidityCompositeComponentId, number> = {
  reliability: 15,       // -13 from v1 (28), low ρ=+0.06
  timing: 0,             // -14 from v1 (14), ELIMINATED (ρ=0.00)
  align: 10,             // -7 from v1 (17), weak ρ=+0.10
  roi_target: 10,        // +5 from v1 (5), undervalued ρ=+0.13
  sds: 12,               // unchanged, gate function
  precat: 15,            // +9 from v1 (6), strong ρ=+0.32***
  mii: 20,               // +10 from v1 (10), best ρ=+0.44***
  calib: 6,              // -2 from v1 (8), limited data
  momentum_accel: 12,    // NEW component, captures Δ(Var.Giorn. 3d vs 7d)
};

export const SOLIDITY_COMPONENT_COLORS: Record<SolidityCompositeComponentId, string> = {
  reliability: "#6366f1",
  timing: "#10b981",
  align: "#0ea5e9",
  roi_target: "#8b5cf6",
  sds: "#f59e0b",
  precat: "#f43f5e",
  mii: "#059669",
  calib: "#7c3aed",
  momentum_accel: "#14b8a6", // Teal - represents momentum/velocity
};

export type SolidityCompositeTone = "good" | "warn" | "bad" | "neutral";

export type SolidityCompositeComponent = {
  id: SolidityCompositeComponentId;
  points: number;
  maxPoints: number;
  detail: string;
  tone: SolidityCompositeTone;
  /** Solo UI: riempimento barra quando i dati ci sono ma i punti sono 0 (es. MII bearish). */
  visualFillPct?: number;
};

export type EntrySolidityCompositeTier = "top" | "strong" | "watch" | "weak";

export type EntrySolidityComposite = {
  total: number;
  tier: EntrySolidityCompositeTier;
  components: SolidityCompositeComponent[];
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function lerpToMax(raw: number, min: number, max: number, cap: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (max <= min) return raw >= max ? cap : 0;
  return round1(clamp01((raw - min) / (max - min)) * cap);
}

export function entrySolidityTierFromTotal(total: number): EntrySolidityCompositeTier {
  if (total >= 85) return "top";
  if (total >= 65) return "strong";
  if (total >= 40) return "watch";
  return "weak";
}

function compositeTier(total: number): EntrySolidityCompositeTier {
  return entrySolidityTierFromTotal(total);
}

function sdsInfoForPick(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): SdsGateInfo | null {
  const map = opts?.sdsByTicker ?? getCachedSdsForTopOpps();
  if (!map?.size) return null;
  return map.get(s.ticker.trim().toUpperCase()) ?? null;
}

function scoreReliabilityComponent(
  s: Top2PickSignal,
  lang: "it" | "en",
  opts?: StrictTopOppOpts,
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.reliability;
  const m = pickReliabilityMetrics(s, opts);
  const score = m?.score;
  const points =
    score != null && Number.isFinite(score) ? round1((score / 100) * max) : 0;
  const tone: SolidityCompositeTone =
    score == null ? "neutral" : score >= 65 ? "good" : score >= 40 ? "warn" : "bad";
  const detail =
    score != null
      ? lang === "it"
        ? `Score Reliability ${Math.round(score)}/100 → ${points}/${max} pt`
        : `Score Reliability ${Math.round(score)}/100 → ${points}/${max} pt`
      : lang === "it"
        ? "Score non disponibile"
        : "Score unavailable";
  return { id: "reliability", points, maxPoints: max, detail, tone };
}

function scoreTimingComponent(
  s: Top2PickSignal,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.timing;
  const raw = entryTimingSolidityPoints(s.days);
  const points =
    raw != null ? lerpToMax(raw, -2, 10, max) : round1(max * 0.28);
  const tone: SolidityCompositeTone =
    raw == null ? "neutral" : raw >= 8 ? "good" : raw >= 0 ? "warn" : "bad";
  const detail =
    raw != null
      ? lang === "it"
        ? `Timing ingresso ${raw >= 0 ? "+" : ""}${raw.toFixed(1)} (picco T−${ENTRY_TIMING_PEAK_MAX_DAYS}…T−${ENTRY_TIMING_PEAK_MIN_DAYS}) → ${points}/${max} pt`
        : `Entry timing ${raw >= 0 ? "+" : ""}${raw.toFixed(1)} (peak T−${ENTRY_TIMING_PEAK_MAX_DAYS}…T−${ENTRY_TIMING_PEAK_MIN_DAYS}) → ${points}/${max} pt`
      : lang === "it"
        ? "Giorni al CD non noti"
        : "Days to CD unknown";
  return { id: "timing", points, maxPoints: max, detail, tone };
}

function scoreAlignComponent(
  s: Top2PickSignal,
  lang: "it" | "en",
  opts?: StrictTopOppOpts,
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.align;
  const raw = alignSolidityPoints(s, opts);
  const points = raw != null ? lerpToMax(raw, -8, 10, max) : round1(max * 0.4);
  const tone: SolidityCompositeTone =
    raw == null ? "neutral" : raw >= 5 ? "good" : raw >= 0 ? "warn" : "bad";
  const detail =
    raw != null
      ? lang === "it"
        ? `Align (Score Reliability) ${raw >= 0 ? "+" : ""}${raw.toFixed(1)} → ${points}/${max} pt`
        : `Align (Score Reliability) ${raw >= 0 ? "+" : ""}${raw.toFixed(1)} → ${points}/${max} pt`
      : lang === "it"
        ? "Align non calcolabile"
        : "Align unavailable";
  return { id: "align", points, maxPoints: max, detail, tone };
}

function scoreRoiTargetComponent(
  s: Top2PickSignal,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.roi_target;
  const target = resolvePrimaryReturnPct(s);
  let points = 0;
  if (target != null && Number.isFinite(target) && target > 0) {
    // RA calib v1: reward moderate curve target; high target often pre-extended (T−60 losers).
    if (target <= 8) {
      points = lerpToMax(target, 2, 8, max);
    } else if (target <= 15) {
      points = round1(max * 0.45);
    } else {
      points = round1(max * 0.15);
    }
  }
  const tone: SolidityCompositeTone = points >= max * 0.6 ? "good" : points > 0 ? "warn" : "bad";
  const detail =
    target != null && target > 0
      ? lang === "it"
        ? `ROI target +${target.toFixed(1)}% (picco curva, calib moderato) → ${points}/${max} pt`
        : `Target ROI +${target.toFixed(1)}% (curve peak, moderated calib) → ${points}/${max} pt`
      : lang === "it"
        ? "Nessun ROI target positivo → 0 pt"
        : "No positive target ROI → 0 pt";
  return { id: "roi_target", points, maxPoints: max, detail, tone };
}

function scoreSdsComponent(
  s: Top2PickSignal,
  opts: StrictTopOppOpts | undefined,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.sds;
  const info = sdsInfoForPick(s, opts);
  if (!info) {
    return {
      id: "sds",
      points: round1(max * 0.5),
      maxPoints: max,
      detail:
        lang === "it"
          ? "SDS non in cache — neutro 50%"
          : "SDS not cached — neutral 50%",
      tone: "neutral",
    };
  }
  if (info.veto) {
    return {
      id: "sds",
      points: 0,
      maxPoints: max,
      detail:
        lang === "it"
          ? `Veto SDS (${info.veto}) → 0 pt`
          : `SDS veto (${info.veto}) → 0 pt`,
      tone: "bad",
    };
  }
  const min = isHotZone(s.days)
    ? SDS_HOT_ENTRY_MIN
    : isWatchZone(s.days)
      ? sdsWatchEntryMinForDays(s.days)
      : 0;
  const ratio = min > 0 ? info.sds / min : info.sds / 100;
  const points = round1(clamp01(ratio) * max);
  const tone: SolidityCompositeTone =
    info.sds >= min ? "good" : info.sds >= min * 0.7 ? "warn" : "bad";
  const detail =
    lang === "it"
      ? `SDS ${Math.round(info.sds)} (min zona ${min}) → ${points}/${max} pt`
      : `SDS ${Math.round(info.sds)} (zone min ${min}) → ${points}/${max} pt`;
  return { id: "sds", points, maxPoints: max, detail, tone };
}

function scorePrecatComponent(
  s: Top2PickSignal,
  failures: StrictPickFailure[],
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.precat;
  const pk = s.precatKind;
  const macro = s.marketGate?.regime_gate_fired === true;

  let points = round1(max * 0.5);
  let tone: SolidityCompositeTone = "neutral";
  let detail = "";

  if (macro) {
    points = 0;
    tone = "bad";
    detail =
      lang === "it"
        ? `Gate macro attivo (${s.marketGate?.gate_reason ?? "risk-off"}) → 0 pt`
        : `Macro gate active (${s.marketGate?.gate_reason ?? "risk-off"}) → 0 pt`;
  } else if (pk === "enter" || pk === "accumulate") {
    points = max;
    tone = "good";
    detail =
      lang === "it"
        ? `Segnale pre-CD ${pk} → ${points}/${max} pt`
        : `Pre-CD signal ${pk} → ${points}/${max} pt`;
  } else if (pk === "sell" || pk === "late") {
    points = 0;
    tone = "bad";
    detail =
      lang === "it"
        ? `Segnale pre-CD ${pk} → 0 pt`
        : `Pre-CD signal ${pk} → 0 pt`;
  } else if (pk === "hold") {
    points = round1(max * 0.35);
    tone = "warn";
    detail =
      lang === "it"
        ? `Pre-CD hold → ${points}/${max} pt`
        : `Pre-CD hold → ${points}/${max} pt`;
  } else if (pk === "avoid") {
    points = round1(max * 0.55);
    tone = "warn";
    detail =
      lang === "it"
        ? `Pre-CD avoid (direzione da Align, non slope binario) → ${points}/${max} pt`
        : `Pre-CD avoid (direction from Align, not binary slope) → ${points}/${max} pt`;
  } else if (pk === "too_early") {
    points = round1(max * 0.25);
    tone = "warn";
    detail =
      lang === "it"
        ? `Pre-CD too early → ${points}/${max} pt`
        : `Pre-CD too early → ${points}/${max} pt`;
  } else {
    detail =
      lang === "it"
        ? `Segnale pre-CD ${pk ?? "—"} → ${points}/${max} pt`
        : `Pre-CD signal ${pk ?? "—"} → ${points}/${max} pt`;
  }

  const hardPrecat = failures.some(
    (f) =>
      f.code === "macro_gate_hold" ||
      f.code === "macro_gate_avoid" ||
      f.code === "precat_sell" ||
      f.code === "align_contrarian",
  );
  if (hardPrecat && points > max * 0.2) {
    points = round1(max * 0.15);
    tone = "bad";
  }

  return { id: "precat", points, maxPoints: max, detail, tone };
}

function resolveMigSnapshot(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): MigSoliditySnapshot | null {
  const key = migSolidityKey(s.ticker, s.cd ?? "");
  return opts?.migByKey?.get(key) ?? null;
}

function scoreMiiComponent(
  s: Top2PickSignal,
  opts: StrictTopOppOpts | undefined,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.mii;
  const mig = resolveMigSnapshot(s, opts);
  if (!mig) {
    return {
      id: "mii",
      points: round1(max * 0.35),
      maxPoints: max,
      detail:
        lang === "it"
          ? "MII non disponibile — neutro 35%"
          : "MII unavailable — neutral 35%",
      tone: "neutral",
    };
  }
  const deg = mig.slopeAngleDeg;
  let points = 0;
  if (deg > 0) {
    points = lerpToMax(deg, 0, 28, max);
    if (mig.verdict === "PASS") points = round1(Math.min(max, points * 1.08));
    else if (mig.verdict === "WATCH" && deg > 0) points = round1(Math.min(max, points * 0.92));
  } else if (deg > -4) {
    points = round1(max * 0.12);
  }
  const tone: SolidityCompositeTone =
    deg >= 20 && mig.verdict !== "BLOCK"
      ? "good"
      : deg > 0
        ? "warn"
        : "bad";
  const detail = formatMiiComponentDetail(mig, points, max, lang);
  const scorePct = max > 0 ? (points / max) * 100 : 0;
  const visualFillPct =
    scorePct >= 8
      ? undefined
      : Math.min(100, Math.max(14, (Math.abs(deg) / 28) * 100));
  return { id: "mii", points, maxPoints: max, detail, tone, visualFillPct };
}

function scoreCalibComponent(
  s: Top2PickSignal,
  opts: StrictTopOppOpts | undefined,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.calib;
  const mig = resolveMigSnapshot(s, opts);
  if (!mig || mig.calibPreScore == null) {
    return {
      id: "calib",
      points: round1(max * 0.35),
      maxPoints: max,
      detail:
        lang === "it"
          ? "Calib pre≈MII non disponibile — neutro 35%"
          : "Calib pre≈MII unavailable — neutral 35%",
      tone: "neutral",
    };
  }
  const score = mig.calibPreScore;
  let points = round1((score / 100) * max);
  if (mig.gapPrePct != null && mig.gapPrePct >= 85) {
    points = round1(Math.max(0, points * 0.55));
  }
  const tone: SolidityCompositeTone =
    score >= 72 ? "good" : score >= 45 ? "warn" : "bad";
  const gapNote =
    mig.gapPrePct != null
      ? lang === "it"
        ? ` · gap pre→MII ${mig.gapPrePct.toFixed(0)}%`
        : ` · gap pre→MII ${mig.gapPrePct.toFixed(0)}%`
      : "";
  const detail =
    lang === "it"
      ? `Calib pre≈MII ${Math.round(score)}/100${gapNote} → ${points}/${max} pt`
      : `Calib pre≈MII ${Math.round(score)}/100${gapNote} → ${points}/${max} pt`;
  return { id: "calib", points, maxPoints: max, detail, tone };
}

/**
 * Momentum Acceleration: measures short-term price momentum (Var. Giorn. 24h).
 * 
 * Rationale: Strong recent momentum (>2% daily) indicates buying pressure and
 * can compensate for weaker historical pattern match. Captures "happening now" signal.
 * 
 * Future enhancement: Compare 3-day vs 7-day momentum for true acceleration metric.
 */
function scoreMomentumAccelComponent(
  s: Top2PickSignal,
  opts: StrictTopOppOpts | undefined,
  lang: "it" | "en",
): SolidityCompositeComponent {
  const max = SOLIDITY_COMPONENT_MAX.momentum_accel;
  const dailyPct = s.pnlPct24h;
  
  // If no data, return neutral baseline
  if (dailyPct == null || !Number.isFinite(dailyPct)) {
    return {
      id: "momentum_accel",
      points: round1(max * 0.35),
      maxPoints: max,
      detail:
        lang === "it"
          ? "Var. Giorn. non disponibile — neutro 35%"
          : "Daily variation unavailable — neutral 35%",
      tone: "neutral",
    };
  }

  // Score based on momentum strength
  let points = 0;
  let momentumLabel = "";
  let tone: SolidityCompositeTone = "bad";

  if (dailyPct >= 2.0) {
    points = max;
    momentumLabel = lang === "it" ? "forte" : "strong";
    tone = "good";
  } else if (dailyPct >= 1.0) {
    points = round1(max * 0.8);
    momentumLabel = lang === "it" ? "buono" : "good";
    tone = "good";
  } else if (dailyPct >= 0.5) {
    points = round1(max * 0.6);
    momentumLabel = lang === "it" ? "positivo" : "positive";
    tone = "warn";
  } else if (dailyPct >= 0) {
    points = round1(max * 0.4);
    momentumLabel = lang === "it" ? "debole" : "weak";
    tone = "warn";
  } else if (dailyPct >= -0.5) {
    points = round1(max * 0.2);
    momentumLabel = lang === "it" ? "negativo" : "negative";
    tone = "bad";
  } else {
    points = 0;
    momentumLabel = lang === "it" ? "ribasso" : "declining";
    tone = "bad";
  }

  // Optional: Boost if MII also confirms momentum
  const mig = resolveMigSnapshot(s, opts);
  if (mig && dailyPct > 1.0 && mig.slopeAngleDeg > 15 && mig.volRatio > 1.5) {
    points = round1(Math.min(max, points * 1.15));
    momentumLabel += lang === "it" ? " + MII ↑" : " + MII ↑";
  }

  const sign = dailyPct >= 0 ? "+" : "";
  const detail =
    lang === "it"
      ? `Momentum ${sign}${dailyPct.toFixed(1)}% (${momentumLabel}) → ${points}/${max} pt`
      : `Momentum ${sign}${dailyPct.toFixed(1)}% (${momentumLabel}) → ${points}/${max} pt`;

  return { id: "momentum_accel", points, maxPoints: max, detail, tone };
}

export function computeEntrySolidityComposite(
  s: Top2PickSignal,
  failures: StrictPickFailure[],
  opts?: StrictTopOppOpts,
  lang: "it" | "en" = "it",
): EntrySolidityComposite {
  const components: SolidityCompositeComponent[] = [
    scoreReliabilityComponent(s, lang, opts),
    scoreTimingComponent(s, lang),
    scoreAlignComponent(s, lang, opts),
    scoreRoiTargetComponent(s, lang),
    scoreSdsComponent(s, opts, lang),
    scorePrecatComponent(s, failures, lang),
    scoreMiiComponent(s, opts, lang),
    scoreCalibComponent(s, opts, lang),
    scoreMomentumAccelComponent(s, opts, lang),
  ];

  let total = round1(components.reduce((acc, c) => acc + c.points, 0));

  const hasHardBlock = failures.some((f) => isSolidityHardFailureCode(f.code));
  if (hasHardBlock && total > 55) {
    total = round1(Math.min(total, 55));
  }

  return {
    total: Math.round(Math.min(100, Math.max(0, total))),
    tier: compositeTier(total),
    components,
  };
}

export function solidityCompositeTierColor(tier: EntrySolidityCompositeTier): string {
  switch (tier) {
    case "top":
      return "#10b981";
    case "strong":
      return "#6366f1";
    case "watch":
      return "#f59e0b";
    case "weak":
      return "#ef4444";
  }
}
