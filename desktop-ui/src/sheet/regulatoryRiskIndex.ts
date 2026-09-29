import type { CatalystEntry, MonitoredAsset, RiskFlag } from "./catalystAnalysisStore";
import type { RegulatoryRiskSignal } from "../api/supernova";
import { isMedtechTicker } from "./medtechSymbols";

const CMC_KEYWORDS = [
  "cmc",
  "manufacturing",
  "complete response",
  "crl",
  "facility",
  "gmp",
  "inspection",
  "deficiency",
  "warning letter",
];

export type PdufaSignal =
  | { present: false }
  | {
      present: true;
      kind: "pdufa_nda" | "pdufa_bla";
      estimatedWindow: string;
      granularity: CatalystEntry["windowGranularity"];
      catalystId: string;
      status: CatalystEntry["status"];
    };

export type CmcHit = {
  source: "catalyst_desc" | "catalyst_note" | "risk_flag" | "auto_snapshot";
  text: string;
};

export type CmcSignal = {
  present: boolean;
  hits: CmcHit[];
};

export type CrlEntry = {
  description: string;
  source: string;
  flaggedAt: string;
  resolved: boolean;
};

export type CrlSignal = {
  hasActive: boolean;
  entries: CrlEntry[];
};

export type ApprovedSignal = {
  present: boolean;
  hits: string[];
};

export type PositiveSignal = {
  present: boolean;
  hits: string[];
};

export type DeviceClearanceSignal =
  | { present: false }
  | {
      present: true;
      kind: "510k" | "pma" | "de_novo" | "device_other";
      hits: string[];
    };

export type RegulatoryRiskIndex = {
  pdufaSignal: PdufaSignal;
  /** MedTech: 510(k) / PMA / De Novo clearance track (parallel to PDUFA for drugs). */
  deviceClearanceSignal?: DeviceClearanceSignal;
  cmcSignal: CmcSignal;
  crlSignal: CrlSignal;
  approvedSignal: ApprovedSignal;
  positiveSignal: PositiveSignal;
  hasAnySignal: boolean;
};

function containsCmcKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return CMC_KEYWORDS.some((k) => lower.includes(k));
}

function isRegulatoryFlag(flag: RiskFlag): boolean {
  return (
    flag.category === "regulatory" ||
    containsCmcKeyword(flag.description)
  );
}

export function buildRegulatoryRiskIndex(asset: MonitoredAsset): RegulatoryRiskIndex {
  // ── PDUFA signal ────────────────────────────────────────────────────────
  const pdufaCat = asset.catalysts.find(
    (c) => c.catalystKind === "pdufa_nda" || c.catalystKind === "pdufa_bla",
  );
  const pdufaSignal: PdufaSignal = pdufaCat
    ? {
        present: true,
        kind: pdufaCat.catalystKind as "pdufa_nda" | "pdufa_bla",
        estimatedWindow: pdufaCat.estimatedWindow,
        granularity: pdufaCat.windowGranularity,
        catalystId: pdufaCat.id,
        status: pdufaCat.status,
      }
    : { present: false };

  // ── CMC keyword scan ────────────────────────────────────────────────────
  const cmcHits: CmcHit[] = [];
  for (const c of asset.catalysts) {
    if (containsCmcKeyword(c.description)) {
      cmcHits.push({ source: "catalyst_desc", text: c.description.slice(0, 120) });
    }
    if (c.statusNote && containsCmcKeyword(c.statusNote)) {
      cmcHits.push({ source: "catalyst_note", text: c.statusNote.slice(0, 120) });
    }
  }
  for (const f of asset.riskFlags) {
    if (!f.resolved && containsCmcKeyword(f.description)) {
      cmcHits.push({ source: "risk_flag", text: f.description.slice(0, 120) });
    }
  }
  const cmcSignal: CmcSignal = { present: cmcHits.length > 0, hits: cmcHits };

  // ── CRL / regulatory risk flags ─────────────────────────────────────────
  const crlFlags = asset.riskFlags.filter(isRegulatoryFlag);
  const crlSignal: CrlSignal = {
    hasActive: crlFlags.some((f) => !f.resolved),
    entries: crlFlags.map((f) => ({
      description: f.description,
      source: f.source,
      flaggedAt: f.flaggedAt,
      resolved: f.resolved,
    })),
  };

  // ── Positive signals — detected only via auto snapshot (regulatory_risk_refresh.py).
  // Manual MonitoredAsset data does not currently carry "approved"/"success" status.
  const approvedSignal: ApprovedSignal = { present: false, hits: [] };
  const positiveSignal: PositiveSignal = { present: false, hits: [] };

  const hasAnySignal =
    pdufaSignal.present || cmcSignal.present || crlSignal.hasActive ||
    approvedSignal.present || positiveSignal.present;

  return {
    pdufaSignal,
    deviceClearanceSignal: { present: false },
    cmcSignal,
    crlSignal,
    approvedSignal,
    positiveSignal,
    hasAnySignal,
  };
}

export type RegulatoryScoreOptions = {
  /** Clinical phase from Simulation sheet (e.g. "Phase 3"). */
  clinicalPhase?: string | null;
  /** Ticker present in auto snapshot with no filing signals (`no_signals` flag). */
  cleanScan?: boolean;
  /** When true, device clearance signal uses medtech weighting. */
  isMedtech?: boolean;
};

function clampRegulatoryScore(score: number): number {
  return Math.max(-100, Math.min(100, score));
}

export function hasActiveRegulatoryRisk(index: RegulatoryRiskIndex): boolean {
  return (
    index.crlSignal.hasActive ||
    index.pdufaSignal.present ||
    index.deviceClearanceSignal?.present === true ||
    index.cmcSignal.present
  );
}

/** Favorable bonus from clinical phase when no active regulatory risk. */
export function clinicalPhaseRegulatoryBonus(phase: string | null | undefined): number {
  if (!phase) return 0;
  const p = phase.toLowerCase();
  if (/approv|market|commercial|launched|registrat/.test(p)) return -35;
  if (/phase\s*iii|phase\s*3|fase\s*iii|fase\s*3|pivotal/.test(p)) return -18;
  if (/phase\s*ii|phase\s*2|fase\s*ii|fase\s*2/.test(p)) return -8;
  if (/phase\s*i\b|phase\s*1|fase\s*i\b|fase\s*1/.test(p)) return -4;
  if (/preclinical|pre-clinical|preclinic/.test(p)) return -2;
  return 0;
}

function approvedHitsBonus(hits: string[]): number {
  const unique = [...new Set(hits.map((h) => h.toLowerCase().trim()).filter(Boolean))];
  if (!unique.length) return 0;
  return -Math.min(50, unique.length * 15);
}

function positiveHitsBonus(hits: string[]): number {
  let bonus = 0;
  const seen = new Set<string>();
  for (const raw of hits) {
    const lower = raw.toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    if (/fda approv|approval granted|marketing approval|nda approved|bla approved/.test(lower)) {
      bonus -= 12;
    } else if (/primary endpoint|phase 3 success|phase iii success|pivotal trial/.test(lower)) {
      bonus -= 10;
    } else if (/breakthrough|fast track|priority review|orphan drug|accelerated approval/.test(lower)) {
      bonus -= 8;
    } else {
      bonus -= 5;
    }
  }
  return Math.max(-30, bonus);
}

function resolvedCrlBonus(index: RegulatoryRiskIndex): number {
  const n = index.crlSignal.entries.filter((e) => e.resolved).length;
  if (!n) return 0;
  return -Math.min(15, 5 + (n - 1) * 5);
}

/**
 * Bidirectional score: -100 (favorable regulatory outlook) to +100 (maximum risk).
 *
 * Risk (positive side): CRL +50, PDUFA +35, CMC +15.
 * Favorability (negative side, proportional when no active risk):
 *   FDA approval hits, positive catalyst keywords, resolved CRL history,
 *   clinical phase proxy, clean-scan baseline (-5).
 */
export function computeRegulatoryRiskScore(
  index: RegulatoryRiskIndex,
  options?: RegulatoryScoreOptions,
): number {
  let score = 0;
  if (index.crlSignal.hasActive) score += 50;
  if (index.pdufaSignal.present) score += 35;
  if (index.deviceClearanceSignal?.present) score += options?.isMedtech ? 25 : 30;
  if (index.cmcSignal.present) score += 15;

  if (hasActiveRegulatoryRisk(index)) {
    return clampRegulatoryScore(score);
  }

  if (index.approvedSignal.present) {
    score += index.approvedSignal.hits.length
      ? approvedHitsBonus(index.approvedSignal.hits)
      : -50;
  }
  if (index.positiveSignal.present) {
    score += index.positiveSignal.hits.length
      ? positiveHitsBonus(index.positiveSignal.hits)
      : -30;
  }

  score += resolvedCrlBonus(index);

  const phaseBonus = clinicalPhaseRegulatoryBonus(options?.clinicalPhase);
  score += phaseBonus;

  const hasFavorableEvidence =
    index.approvedSignal.present ||
    index.positiveSignal.present ||
    resolvedCrlBonus(index) < 0 ||
    phaseBonus < 0;

  if (!hasFavorableEvidence && options?.cleanScan) {
    score -= 5;
  }

  return clampRegulatoryScore(score);
}

export type RegulatoryScoreBreakdownItemId =
  | "crl_active"
  | "pdufa"
  | "device_clearance"
  | "cmc"
  | "approved"
  | "positive"
  | "resolved_crl"
  | "clinical_phase"
  | "clean_scan";

export type RegulatoryScoreBreakdownItem = {
  id: RegulatoryScoreBreakdownItemId;
  contribution: number;
  details: string[];
};

export type RegulatoryScoreBreakdown = {
  /** Internal risk score (−100 favorable · +100 risk). */
  riskScore: number;
  /** Investment impact display (−riskScore). */
  impactScore: number;
  path: "active_risk" | "favorable";
  items: RegulatoryScoreBreakdownItem[];
  rawSum: number;
  clamped: boolean;
};

/** Line-by-line breakdown mirroring `computeRegulatoryRiskScore`. */
export function buildRegulatoryScoreBreakdown(
  index: RegulatoryRiskIndex,
  options?: RegulatoryScoreOptions,
): RegulatoryScoreBreakdown {
  const items: RegulatoryScoreBreakdownItem[] = [];
  let rawSum = 0;

  if (index.crlSignal.hasActive) {
    const contribution = 50;
    rawSum += contribution;
    items.push({
      id: "crl_active",
      contribution,
      details: index.crlSignal.entries
        .filter((e) => !e.resolved)
        .map((e) => e.description.slice(0, 140)),
    });
  }
  if (index.pdufaSignal.present) {
    const contribution = 35;
    rawSum += contribution;
    const pdufa = index.pdufaSignal;
    items.push({
      id: "pdufa",
      contribution,
      details: [
        `${pdufa.kind === "pdufa_nda" ? "NDA" : "BLA"} · ${pdufa.estimatedWindow} · ${pdufa.status}`,
      ],
    });
  }
  if (index.deviceClearanceSignal?.present) {
    const contribution = options?.isMedtech ? 25 : 30;
    rawSum += contribution;
    const dev = index.deviceClearanceSignal;
    items.push({
      id: "device_clearance",
      contribution,
      details: dev.hits.length ? dev.hits.slice(0, 4) : [dev.kind],
    });
  }
  if (index.cmcSignal.present) {
    const contribution = 15;
    rawSum += contribution;
    items.push({
      id: "cmc",
      contribution,
      details: index.cmcSignal.hits.map((h) => `${h.source}: ${h.text}`).slice(0, 4),
    });
  }

  if (hasActiveRegulatoryRisk(index)) {
    const riskScore = clampRegulatoryScore(rawSum);
    return {
      riskScore,
      impactScore: regulatoryImpactScore(riskScore),
      path: "active_risk",
      items,
      rawSum,
      clamped: riskScore !== rawSum,
    };
  }

  if (index.approvedSignal.present) {
    const contribution = index.approvedSignal.hits.length
      ? approvedHitsBonus(index.approvedSignal.hits)
      : -50;
    rawSum += contribution;
    items.push({
      id: "approved",
      contribution,
      details: index.approvedSignal.hits.length
        ? index.approvedSignal.hits.slice(0, 4)
        : ["FDA approval detected (auto scan)"],
    });
  }
  if (index.positiveSignal.present) {
    const contribution = index.positiveSignal.hits.length
      ? positiveHitsBonus(index.positiveSignal.hits)
      : -30;
    rawSum += contribution;
    items.push({
      id: "positive",
      contribution,
      details: index.positiveSignal.hits.length
        ? index.positiveSignal.hits.slice(0, 4)
        : ["Positive catalyst keywords (auto scan)"],
    });
  }

  const resolvedBonus = resolvedCrlBonus(index);
  if (resolvedBonus !== 0) {
    rawSum += resolvedBonus;
    items.push({
      id: "resolved_crl",
      contribution: resolvedBonus,
      details: index.crlSignal.entries
        .filter((e) => e.resolved)
        .map((e) => e.description.slice(0, 120)),
    });
  }

  const phaseBonus = clinicalPhaseRegulatoryBonus(options?.clinicalPhase);
  if (phaseBonus !== 0) {
    rawSum += phaseBonus;
    items.push({
      id: "clinical_phase",
      contribution: phaseBonus,
      details: [options?.clinicalPhase?.trim() || "—"],
    });
  }

  const hasFavorableEvidence =
    index.approvedSignal.present ||
    index.positiveSignal.present ||
    resolvedBonus < 0 ||
    phaseBonus < 0;

  if (!hasFavorableEvidence && options?.cleanScan) {
    const contribution = -5;
    rawSum += contribution;
    items.push({
      id: "clean_scan",
      contribution,
      details: [
        "No active CRL, PDUFA, CMC, or device clearance in auto scan",
        "Baseline favorable credit when risk signals are absent",
      ],
    });
  }

  const riskScore = clampRegulatoryScore(rawSum);
  return {
    riskScore,
    impactScore: regulatoryImpactScore(riskScore),
    path: "favorable",
    items,
    rawSum,
    clamped: riskScore !== rawSum,
  };
}

/** Build a RegulatoryRiskIndex from an auto snapshot entry (no manual Catalyst Hub data). */
export function regulatoryIndexFromAutoSignal(auto: RegulatoryRiskSignal): RegulatoryRiskIndex {
  const pdufaSignal: PdufaSignal = auto.pdufa.detected
    ? {
        present: true,
        kind: "pdufa_nda",
        estimatedWindow: "auto-detected",
        granularity: "broad",
        catalystId: "auto",
        status: "upcoming",
      }
    : { present: false };

  const cmcSignal: CmcSignal = {
    present: auto.cmc.detected,
    hits: auto.cmc.hits.map((h) => ({ source: "auto_snapshot" as const, text: h })),
  };

  const crlSignal: CrlSignal = {
    hasActive: auto.crl.detected,
    entries: auto.crl.sources.map((s) => ({
      description: s.headline,
      source: s.source,
      flaggedAt: s.filing_date ?? new Date().toISOString(),
      resolved: false,
    })),
  };

  const approvedSignal: ApprovedSignal = {
    present: auto.approved.detected,
    hits: [...auto.approved.hits],
  };

  const positiveSignal: PositiveSignal = {
    present: auto.positive.detected,
    hits: [...auto.positive.hits],
  };

  return {
    pdufaSignal,
    deviceClearanceSignal: { present: false },
    cmcSignal,
    crlSignal,
    approvedSignal,
    positiveSignal,
    hasAnySignal:
      pdufaSignal.present ||
      cmcSignal.present ||
      crlSignal.hasActive ||
      approvedSignal.present ||
      positiveSignal.present,
  };
}

/** Merge k8-scanned signals into an existing index (additive; preserves approved/positive). */
export function mergeK8IntoIndex(
  base: RegulatoryRiskIndex,
  k8: RegulatoryRiskIndex,
): RegulatoryRiskIndex {
  const pdufaSignal = base.pdufaSignal.present ? base.pdufaSignal : k8.pdufaSignal;
  const deviceClearanceSignal =
    base.deviceClearanceSignal?.present === true
      ? base.deviceClearanceSignal
      : k8.deviceClearanceSignal?.present === true
        ? k8.deviceClearanceSignal
        : { present: false as const };
  const cmcHits = [...base.cmcSignal.hits];
  for (const h of k8.cmcSignal.hits) {
    if (!cmcHits.some((m) => m.text === h.text)) cmcHits.push(h);
  }
  const cmcSignal = { present: base.cmcSignal.present || k8.cmcSignal.present, hits: cmcHits };
  const crlEntries = [...base.crlSignal.entries];
  for (const e of k8.crlSignal.entries) {
    if (!crlEntries.some((m) => m.description === e.description)) crlEntries.push(e);
  }
  const crlSignal = {
    hasActive: base.crlSignal.hasActive || k8.crlSignal.hasActive,
    entries: crlEntries,
  };
  const approvedHits = [...base.approvedSignal.hits];
  for (const h of k8.approvedSignal.hits) {
    if (!approvedHits.includes(h)) approvedHits.push(h);
  }
  const positiveHits = [...base.positiveSignal.hits];
  for (const h of k8.positiveSignal.hits) {
    if (!positiveHits.includes(h)) positiveHits.push(h);
  }
  const approvedSignal: ApprovedSignal = {
    present: base.approvedSignal.present || k8.approvedSignal.present,
    hits: approvedHits,
  };
  const positiveSignal: PositiveSignal = {
    present: base.positiveSignal.present || k8.positiveSignal.present,
    hits: positiveHits,
  };
  return {
    pdufaSignal,
    deviceClearanceSignal,
    cmcSignal,
    crlSignal,
    approvedSignal,
    positiveSignal,
    hasAnySignal:
      pdufaSignal.present ||
      deviceClearanceSignal.present === true ||
      cmcSignal.present ||
      crlSignal.hasActive ||
      approvedSignal.present ||
      positiveSignal.present,
  };
}

function buildMergedRegulatoryIndex(args: {
  manualIdx: RegulatoryRiskIndex | null;
  autoSig: RegulatoryRiskSignal | null | undefined;
  k8Index?: RegulatoryRiskIndex | null;
}): RegulatoryRiskIndex | null {
  const k8 = args.k8Index?.hasAnySignal ? args.k8Index : null;
  if (!args.manualIdx && !args.autoSig && !k8) return null;

  let index: RegulatoryRiskIndex;
  if (args.manualIdx) {
    index = mergeWithAutoSnapshot(args.manualIdx, args.autoSig);
  } else if (args.autoSig) {
    index = regulatoryIndexFromAutoSignal(args.autoSig);
  } else {
    index = k8!;
  }
  if (k8 && (args.manualIdx || args.autoSig)) {
    index = mergeK8IntoIndex(index, k8);
  }
  return index;
}

export type RegulatoryRiskBundle = {
  score: number | null;
  index: RegulatoryRiskIndex | null;
  diag: RegulatoryRiskDiagnostic | null;
  /** Options used for the score — pass through to UI breakdown so favorable drivers are visible. */
  clinicalPhase: string | null;
  cleanScan: boolean;
  isMedtech: boolean;
};

/** Full resolve: manual + auto snapshot + optional k8/sim row + clinical phase. */
export function resolveRegulatoryRiskBundle(args: {
  manualIdx: RegulatoryRiskIndex | null;
  autoSig: RegulatoryRiskSignal | null | undefined;
  clinicalPhase?: string | null;
  k8Index?: RegulatoryRiskIndex | null;
  ticker?: string | null;
}): RegulatoryRiskBundle {
  const index = buildMergedRegulatoryIndex(args);
  const clinicalPhase = args.clinicalPhase?.trim() || null;
  const isMedtech = isMedtechTicker(args.ticker);
  if (!index) {
    return {
      score: null,
      index: null,
      diag: null,
      clinicalPhase,
      cleanScan: false,
      isMedtech,
    };
  }

  const cleanScan = Boolean(args.autoSig?.no_signals) && !index.hasAnySignal;
  const score = computeRegulatoryRiskScore(index, {
    clinicalPhase,
    cleanScan,
    isMedtech,
  });
  return {
    score,
    index,
    diag: computeRegulatoryRiskDiagnostic(index),
    clinicalPhase,
    cleanScan,
    isMedtech,
  };
}

/** Resolve score from manual Catalyst Hub data, auto snapshot, and optional clinical phase. */
export function resolveRegulatoryScore(args: {
  manualIdx: RegulatoryRiskIndex | null;
  autoSig: RegulatoryRiskSignal | null | undefined;
  clinicalPhase?: string | null;
  k8Index?: RegulatoryRiskIndex | null;
}): number | null {
  return resolveRegulatoryRiskBundle(args).score;
}

/** Investment impact view — flips internal risk score (+ = headwind, − = favorable). */
export function regulatoryImpactScore(riskScore: number): number {
  return -riskScore;
}

/** Compact cells: + favorable · − headwind (aligned with EIS impact coloring). */
export function formatRegulatoryImpactDisplay(riskScore: number): string {
  const impact = Math.round(regulatoryImpactScore(riskScore));
  return impact > 0 ? `+${impact}` : String(impact);
}

/** Green = positive impact, red = negative impact (uses `--signal-up` / `--signal-down`). */
export function regulatoryImpactColorClass(riskScore: number): string {
  const impact = regulatoryImpactScore(riskScore);
  if (impact > 0) return "text-[rgb(var(--signal-up))] font-semibold";
  if (impact < 0) return "text-[rgb(var(--signal-down))] font-semibold";
  return "text-ink-muted";
}

/** UI helpers — colors follow investment impact, not raw risk sign. */
export function regulatoryScoreColorClass(score: number): string {
  return regulatoryImpactColorClass(score);
}

export function regulatoryScoreBarColor(score: number): string {
  const impact = regulatoryImpactScore(score);
  if (impact > 0) return "rgb(var(--signal-up))";
  if (impact < 0) return "rgb(var(--signal-down))";
  return "#94a3b8";
}

/** Map −100…+100 to bar width 0…100 (50 = neutral). */
export function regulatoryScoreBarWidthPct(score: number): number {
  return Math.max(0, Math.min(100, Math.round((score + 100) / 2)));
}

export function regulatoryScoreSummaryLabel(score: number, lang: "it" | "en"): string {
  if (score < -20) {
    return lang === "it" ? "Profilo regolatorio favorevole" : "Favorable regulatory profile";
  }
  if (score < 0) {
    return lang === "it" ? "Leggermente favorevole" : "Slightly favorable";
  }
  if (score === 0) {
    return lang === "it" ? "Neutro — nessun segnale attivo" : "Neutral — no active signals";
  }
  if (score >= 50) {
    return lang === "it" ? "Rischio regolatorio elevato — CRL/PDUFA" : "High regulatory risk — CRL/PDUFA";
  }
  return lang === "it" ? "Rischio regolatorio moderato — monitorare" : "Moderate regulatory risk — monitor";
}

export function formatRegulatoryScoreDisplay(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Regulatory Risk — Two-Axis Restructure (diagnostic, does NOT replace score above)
//
// Axis 1 — Imminence/certainty (0-100): how close in time is a binary regulatory event?
// Axis 2 — Severity/recoverability (0-100): if the event is negative, how likely is recovery?
// ═══════════════════════════════════════════════════════════════════════════════

// ── Axis 1: Imminence / Certainty ────────────────────────────────────────────

/**
 * Parse a catalyst `estimatedWindow` string into an approximate midpoint Date.
 * Handles: "2026-09-15" (precise), "Q3 2026" (quarter), "mid 2026" / "H2 2026" (broad).
 * Returns null if unparseable.
 */
export function parseEstimatedWindowDate(window: string): Date | null {
  const w = window.trim();

  // Precise date: "2026-09-15" or similar ISO-like format
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // Quarter: "Q1 2026", "Q2 2026", etc.
  const qMatch = /^Q([1-4])\s+(\d{4})$/i.exec(w);
  if (qMatch) {
    const q = parseInt(qMatch[1]!, 10);
    const y = parseInt(qMatch[2]!, 10);
    // Midpoint of quarter: Q1→Feb 15, Q2→May 15, Q3→Aug 15, Q4→Nov 15
    const midMonth = (q - 1) * 3 + 1; // 1,4,7,10
    return new Date(y, midMonth, 15);
  }

  // Half-year: "H1 2026", "H2 2026"
  const hMatch = /^H([12])\s+(\d{4})$/i.exec(w);
  if (hMatch) {
    const h = parseInt(hMatch[1]!, 10);
    const y = parseInt(hMatch[2]!, 10);
    return new Date(y, h === 1 ? 2 : 8, 15); // H1→Mar 15, H2→Sep 15
  }

  // Broad: "early 2026", "mid 2026", "late 2026", "2026"
  const broadMatch = /^(early|mid|late)?\s*(\d{4})$/i.exec(w);
  if (broadMatch) {
    const label = (broadMatch[1] ?? "mid").toLowerCase();
    const y = parseInt(broadMatch[2]!, 10);
    const m = label === "early" ? 2 : label === "late" ? 9 : 5; // Mar, Jun, Oct midpoints
    return new Date(y, m, 15);
  }

  return null;
}

export type RegulatoryImminenceResult = {
  score: number;
  reason: "crl_active" | "pdufa_imminent" | "pdufa_upcoming" | "pdufa_distant" | "none";
  daysToPdufa: number | null;
  pdufaDateParsed: string | null;
  pdufaGranularity: string | null;
};

/**
 * Axis 1 — Imminence/certainty of a binary regulatory event (0-100).
 *
 * - CRL already happened → 100 (event materialized — maximum certainty)
 * - PDUFA within 30 days → 80-100, linear
 * - PDUFA 30-90 days → 40-80, linear
 * - PDUFA >90 days → 10-40, linear (cap at 365 days → 10)
 * - No event → 0
 *
 * This axis answers "how soon will we know something", NOT "will it be good or bad".
 * TODO: calibrate linear vs alternative shape on empirical price volatility data
 */
export function computeRegulatoryImminence(
  index: RegulatoryRiskIndex,
  nowMs: number = Date.now(),
): RegulatoryImminenceResult {
  // CRL already happened — event materialized, certainty = 100
  if (index.crlSignal.hasActive) {
    return {
      score: 100,
      reason: "crl_active",
      daysToPdufa: null,
      pdufaDateParsed: null,
      pdufaGranularity: null,
    };
  }

  // PDUFA — compute days to event
  if (index.pdufaSignal.present) {
    const pdufaDate = parseEstimatedWindowDate(index.pdufaSignal.estimatedWindow);
    const granularity = index.pdufaSignal.granularity;

    if (pdufaDate) {
      const daysToPdufa = Math.max(0, Math.round((pdufaDate.getTime() - nowMs) / 86_400_000));

      let score: number;
      let reason: RegulatoryImminenceResult["reason"];

      if (daysToPdufa <= 0) {
        // PDUFA date has passed but no CRL recorded — treat as very imminent
        score = 95;
        reason = "pdufa_imminent";
      } else if (daysToPdufa <= 30) {
        // 0-30 days → 80-100, linear
        score = 100 - (daysToPdufa / 30) * 20;
        reason = "pdufa_imminent";
      } else if (daysToPdufa <= 90) {
        // 30-90 days → 40-80, linear
        score = 80 - ((daysToPdufa - 30) / 60) * 40;
        reason = "pdufa_upcoming";
      } else {
        // >90 days → 10-40, linear (capped at 365d → 10)
        const daysOver90 = Math.min(daysToPdufa - 90, 275);
        score = 40 - (daysOver90 / 275) * 30;
        reason = "pdufa_distant";
      }

      return {
        score: Math.round(Math.max(0, Math.min(100, score))),
        reason,
        daysToPdufa,
        pdufaDateParsed: pdufaDate.toISOString().slice(0, 10),
        pdufaGranularity: granularity,
      };
    }

    // PDUFA detected but date unparseable — assign moderate imminence
    return {
      score: 30,
      reason: "pdufa_upcoming",
      daysToPdufa: null,
      pdufaDateParsed: null,
      pdufaGranularity: granularity,
    };
  }

  return {
    score: 0,
    reason: "none",
    daysToPdufa: null,
    pdufaDateParsed: null,
    pdufaGranularity: null,
  };
}

// ── Axis 2: Severity / Recoverability ────────────────────────────────────────

// Keywords indicating CRL for CMC/manufacturing reasons (lower severity, recoverable)
const CRL_CMC_REASON_KEYWORDS = [
  "manufacturing",
  "cmc",
  "chemistry, manufacturing",
  "facility",
  "gmp",
  "inspection",
  "form 483",
  "process validation",
  "quality control",
  "supply chain",
  "packaging",
  "labeling",
  "sterility",
  "contamination",
];

// Keywords indicating CRL for efficacy/safety reasons (higher severity, often not recoverable)
const CRL_EFFICACY_SAFETY_KEYWORDS = [
  "efficacy",
  "clinical hold",
  "safety signal",
  "additional trial",
  "additional study",
  "additional study required",
  "mortality",
  "adverse event",
  "adverse reaction",
  "failed endpoint",
  "primary endpoint not met",
  "lack of efficacy",
  "hepatotoxicity",
  "cardiotoxicity",
  "black box",
  "boxed warning",
  "patient death",
  "serious adverse",
  "insufficient evidence",
];

export type CrlReasonBucket = "cmc_manufacturing" | "efficacy_safety" | "mixed" | "unclassified";

export type RegulatorySeverityResult = {
  score: number | null;
  crlReasonBucket: CrlReasonBucket | null;
  crlReasonSource: "auto" | "manual_review_needed" | "manual_override";
  cmcMatchedKeywords: string[];
  efficacyMatchedKeywords: string[];
  reason: "crl_efficacy_safety" | "crl_cmc" | "crl_mixed" | "crl_unclassified" | "cmc_only" | "no_event";
};

/**
 * Axis 2 — Severity/recoverability (0-100) — if the event is negative, how recoverable?
 *
 * - CRL for efficacy/safety reasons → 70-90 (high severity)
 * - CRL for CMC/manufacturing reasons → 20-40 (low-medium severity, typically fixable 6-12 months)
 * - CRL with mixed or unclear reasons → null + "manual_review_needed"
 * - CMC deficiency only (no CRL) → 10-20 (low severity)
 * - No negative event → 0
 *
 * TODO: calibrate bucket ranges on more cases when available
 */
export function computeRegulatorySeverity(
  index: RegulatoryRiskIndex,
): RegulatorySeverityResult {
  // No negative event at all
  if (!index.crlSignal.hasActive && !index.cmcSignal.present) {
    return {
      score: 0,
      crlReasonBucket: null,
      crlReasonSource: "auto",
      cmcMatchedKeywords: [],
      efficacyMatchedKeywords: [],
      reason: "no_event",
    };
  }

  // CRL active — classify reason from entry descriptions
  if (index.crlSignal.hasActive) {
    const allCrlText = index.crlSignal.entries
      .filter((e) => !e.resolved)
      .map((e) => e.description)
      .join(" ")
      .toLowerCase();

    const cmcMatched = CRL_CMC_REASON_KEYWORDS.filter((k) => allCrlText.includes(k));
    const efficacyMatched = CRL_EFFICACY_SAFETY_KEYWORDS.filter((k) => allCrlText.includes(k));

    // Also check CMC hits from the broader CMC signal
    const cmcHitTexts = index.cmcSignal.hits.map((h) => h.text.toLowerCase()).join(" ");
    const cmcFromHits = CRL_CMC_REASON_KEYWORDS.filter(
      (k) => cmcHitTexts.includes(k) && !cmcMatched.includes(k),
    );
    const allCmcMatched = [...cmcMatched, ...cmcFromHits];

    const hasCmcSignal = allCmcMatched.length > 0;
    const hasEfficacySignal = efficacyMatched.length > 0;

    if (hasEfficacySignal && !hasCmcSignal) {
      // Clear efficacy/safety reason
      return {
        score: 80, // TODO: calibrate 70-90 range
        crlReasonBucket: "efficacy_safety",
        crlReasonSource: "auto",
        cmcMatchedKeywords: allCmcMatched,
        efficacyMatchedKeywords: efficacyMatched,
        reason: "crl_efficacy_safety",
      };
    }

    if (hasCmcSignal && !hasEfficacySignal) {
      // Clear CMC/manufacturing reason
      return {
        score: 30, // TODO: calibrate 20-40 range
        crlReasonBucket: "cmc_manufacturing",
        crlReasonSource: "auto",
        cmcMatchedKeywords: allCmcMatched,
        efficacyMatchedKeywords: efficacyMatched,
        reason: "crl_cmc",
      };
    }

    if (hasCmcSignal && hasEfficacySignal) {
      // Mixed signals — flag for manual review, don't force a bucket
      return {
        score: null,
        crlReasonBucket: "mixed",
        crlReasonSource: "manual_review_needed",
        cmcMatchedKeywords: allCmcMatched,
        efficacyMatchedKeywords: efficacyMatched,
        reason: "crl_mixed",
      };
    }

    // No keywords matched at all — CRL detected but reason unclear
    return {
      score: null,
      crlReasonBucket: "unclassified",
      crlReasonSource: "manual_review_needed",
      cmcMatchedKeywords: [],
      efficacyMatchedKeywords: [],
      reason: "crl_unclassified",
    };
  }

  // CMC deficiency only (no CRL) — low severity
  if (index.cmcSignal.present) {
    return {
      score: 15, // TODO: calibrate 10-20 range
      crlReasonBucket: null,
      crlReasonSource: "auto",
      cmcMatchedKeywords: index.cmcSignal.hits.map((h) => h.text),
      efficacyMatchedKeywords: [],
      reason: "cmc_only",
    };
  }

  return {
    score: 0,
    crlReasonBucket: null,
    crlReasonSource: "auto",
    cmcMatchedKeywords: [],
    efficacyMatchedKeywords: [],
    reason: "no_event",
  };
}

// ── Combined diagnostic result ───────────────────────────────────────────────

export type RegulatoryRiskDiagnostic = {
  imminence: RegulatoryImminenceResult;
  severity: RegulatorySeverityResult;
  /** Legacy additive score (unchanged — kept for backward compatibility) */
  legacyScore: number;
};

export function computeRegulatoryRiskDiagnostic(
  index: RegulatoryRiskIndex,
  nowMs?: number,
): RegulatoryRiskDiagnostic {
  return {
    imminence: computeRegulatoryImminence(index, nowMs),
    severity: computeRegulatorySeverity(index),
    legacyScore: computeRegulatoryRiskScore(index),
  };
}

// ── Client-side keyword lists for auto-scan ─────────────────────────────────

const CRL_KEYWORDS_SCAN = [
  "complete response letter",
  "complete response",
  "crl",
  "fda rejection",
  "refuse to file",
  "refusal to file",
  "not approved",
  "warning letter",
];

const PDUFA_KEYWORDS_SCAN = [
  "pdufa",
  "action date",
  "user fee",
  "nda",
  "new drug application",
  "bla",
  "biologics license",
  "fda approval",
  "fda accepted",
  "fda review",
];

const DEVICE_CLEARANCE_KEYWORDS_SCAN = [
  "510(k)",
  "510k",
  "premarket notification",
  "pma",
  "premarket approval",
  "de novo",
  "denovo",
  "fda clearance",
  "fda cleared",
  "breakthrough device",
  "ide approval",
  "investigational device exemption",
];

const CMC_KEYWORDS_SCAN = [
  "cmc",
  "manufacturing",
  "chemistry, manufacturing",
  "facility",
  "gmp",
  "inspection",
  "deficiency",
  "manufacturing issue",
  "process validation",
];

function kwMatch(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

function classifyDeviceClearance(hits: string[]): DeviceClearanceSignal {
  if (!hits.length) return { present: false };
  const lower = hits.join(" ").toLowerCase();
  let kind: "510k" | "pma" | "de_novo" | "device_other" = "device_other";
  if (/510\s*\(?\s*k|premarket notification/.test(lower)) kind = "510k";
  else if (/\bpma\b|premarket approval/.test(lower)) kind = "pma";
  else if (/de\s*novo|denovo/.test(lower)) kind = "de_novo";
  return { present: true, kind, hits: [...new Set(hits)] };
}

/**
 * Scan a sec_k8 SheetTable row for regulatory signals.
 * This runs entirely client-side — no backend call needed.
 */
export function scanSecK8RowForRegulatory(
  row: Record<string, unknown>,
): { crl: string[]; pdufa: string[]; cmc: string[]; device: string[] } | null {
  const combined = Object.values(row)
    .filter((v): v is string => typeof v === "string" && v.length >= 3)
    .join(" ");
  const crl = kwMatch(combined, CRL_KEYWORDS_SCAN);
  const pdufa = kwMatch(combined, PDUFA_KEYWORDS_SCAN);
  const cmc = kwMatch(combined, CMC_KEYWORDS_SCAN);
  const device = kwMatch(combined, DEVICE_CLEARANCE_KEYWORDS_SCAN);
  if (!crl.length && !pdufa.length && !cmc.length && !device.length) return null;
  return { crl, pdufa, cmc, device };
}

/**
 * Build a RegulatoryRiskIndex from raw sec_k8 SheetTable rows for a given ticker.
 * Falls back gracefully — if no data is found, returns a neutral index.
 */
export function buildRegulatoryRiskIndexFromK8(
  ticker: string,
  secK8Rows: Record<string, unknown>[] | null | undefined,
): RegulatoryRiskIndex {
  const neutral: RegulatoryRiskIndex = {
    pdufaSignal: { present: false },
    deviceClearanceSignal: { present: false },
    cmcSignal: { present: false, hits: [] },
    crlSignal: { hasActive: false, entries: [] },
    approvedSignal: { present: false, hits: [] },
    positiveSignal: { present: false, hits: [] },
    hasAnySignal: false,
  };
  if (!secK8Rows || secK8Rows.length === 0) return neutral;

  const tickerUpper = ticker.trim().toUpperCase();
  const matchingRows = secK8Rows.filter(
    (r) => String(r.Ticker ?? r.ticker ?? "").trim().toUpperCase() === tickerUpper,
  );
  if (matchingRows.length === 0) return neutral;

  let hasCrl = false;
  let hasPdufa = false;
  const deviceHits: string[] = [];
  const cmcHits: CmcHit[] = [];
  const crlEntries: CrlEntry[] = [];

  for (const row of matchingRows) {
    const signals = scanSecK8RowForRegulatory(row);
    if (!signals) continue;

    if (signals.crl.length > 0) {
      hasCrl = true;
      const desc = signals.crl.join(", ");
      if (!crlEntries.some((e) => e.description === desc)) {
        crlEntries.push({
          description: desc,
          source: "sec_k8_auto",
          flaggedAt: String(row["Filing Date"] ?? row.filing_date ?? new Date().toISOString()),
          resolved: false,
        });
      }
    }
    if (signals.pdufa.length > 0) {
      hasPdufa = true;
    }
    for (const kw of signals.device) {
      if (!deviceHits.includes(kw)) deviceHits.push(kw);
    }
    if (signals.cmc.length > 0) {
      for (const kw of signals.cmc) {
        if (!cmcHits.some((h) => h.text === kw)) {
          cmcHits.push({ source: "risk_flag", text: kw });
        }
      }
    }
  }

  const pdufaSignal: PdufaSignal = hasPdufa
    ? { present: true, kind: "pdufa_nda", estimatedWindow: "auto-detected (8-K)", granularity: "broad", catalystId: "sec_k8_auto", status: "upcoming" }
    : { present: false };
  const deviceClearanceSignal = classifyDeviceClearance(deviceHits);
  const cmcSignal: CmcSignal = { present: cmcHits.length > 0, hits: cmcHits };
  const crlSignal: CrlSignal = { hasActive: hasCrl, entries: crlEntries };

  return {
    pdufaSignal,
    deviceClearanceSignal,
    cmcSignal,
    crlSignal,
    approvedSignal: { present: false, hits: [] },
    positiveSignal: { present: false, hits: [] },
    hasAnySignal: hasPdufa || deviceClearanceSignal.present || cmcHits.length > 0 || hasCrl,
  };
}

/**
 * Merge manual localStorage signals with auto-detected snapshot signals.
 * Auto signals enrich (never override) manual data — if either source
 * detects a signal, the merged result includes it.
 */
export function mergeWithAutoSnapshot(
  manual: RegulatoryRiskIndex,
  auto: RegulatoryRiskSignal | null | undefined,
): RegulatoryRiskIndex {
  if (!auto) return manual;

  const pdufaSignal: PdufaSignal = manual.pdufaSignal.present
    ? manual.pdufaSignal
    : auto.pdufa.detected
      ? { present: true, kind: "pdufa_nda", estimatedWindow: "auto-detected", granularity: "broad", catalystId: "auto", status: "upcoming" }
      : manual.pdufaSignal;

  const cmcHits: CmcHit[] = [...manual.cmcSignal.hits];
  if (auto.cmc.detected) {
    for (const h of auto.cmc.hits) {
      if (!cmcHits.some((m) => m.text === h)) {
        cmcHits.push({ source: "risk_flag", text: h });
      }
    }
  }
  const cmcSignal: CmcSignal = {
    present: manual.cmcSignal.present || auto.cmc.detected,
    hits: cmcHits,
  };

  const crlEntries: CrlEntry[] = [...manual.crlSignal.entries];
  if (auto.crl.detected) {
    for (const src of auto.crl.sources) {
      if (!crlEntries.some((e) => e.description === src.headline)) {
        crlEntries.push({
          description: src.headline,
          source: src.source,
          flaggedAt: src.filing_date ?? new Date().toISOString(),
          resolved: false,
        });
      }
    }
  }
  const crlSignal: CrlSignal = {
    hasActive: manual.crlSignal.hasActive || auto.crl.detected,
    entries: crlEntries,
  };

  const autoApproved = auto.approved ?? { detected: false, hits: [] };
  const approvedSignal: ApprovedSignal = {
    present: manual.approvedSignal.present || autoApproved.detected,
    hits: [
      ...manual.approvedSignal.hits,
      ...(autoApproved.detected ? autoApproved.hits.filter((h) => !manual.approvedSignal.hits.includes(h)) : []),
    ],
  };

  const autoPositive = auto.positive ?? { detected: false, hits: [] };
  const positiveSignal: PositiveSignal = {
    present: manual.positiveSignal.present || autoPositive.detected,
    hits: [
      ...manual.positiveSignal.hits,
      ...(autoPositive.detected ? autoPositive.hits.filter((h) => !manual.positiveSignal.hits.includes(h)) : []),
    ],
  };

  return {
    pdufaSignal,
    cmcSignal,
    crlSignal,
    approvedSignal,
    positiveSignal,
    hasAnySignal: pdufaSignal.present || cmcSignal.present || crlSignal.hasActive ||
      approvedSignal.present || positiveSignal.present,
  };
}
