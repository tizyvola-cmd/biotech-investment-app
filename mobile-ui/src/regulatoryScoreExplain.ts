import type { RegulatoryRiskSignal } from "./api";
import { formatRegulatoryScoreDisplay } from "./mobileRegulatoryDisplay";

export type RegulatoryScoreComponent = {
  id: string;
  delta: number;
  label: string;
  detail: string;
  source: string;
};

export type RegulatoryScoreExplain = {
  components: RegulatoryScoreComponent[];
  total: number;
  primarySource: string;
  impactDisplay: string;
};

function clinicalPhaseBonus(phase: string | null | undefined): number {
  if (!phase) return 0;
  const p = phase.toLowerCase();
  if (/approv|market|commercial|launched|registrat/.test(p)) return -35;
  if (/phase\s*iii|phase\s*3|fase\s*iii|fase\s*3|pivotal/.test(p)) return -18;
  if (/phase\s*ii|phase\s*2|fase\s*ii|fase\s*2/.test(p)) return -8;
  if (/phase\s*i\b|phase\s*1|fase\s*i\b|fase\s*1/.test(p)) return -4;
  if (/preclinical|pre-clinical|preclinic/.test(p)) return -2;
  return 0;
}

function hasActiveRisk(signal: RegulatoryRiskSignal): boolean {
  return Boolean(signal.crl?.detected || signal.pdufa?.detected || signal.cmc?.detected);
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

function phaseLabel(phase: string, lang: "it" | "en"): string {
  const p = phase.trim();
  if (!p) return lang === "it" ? "Fase clinica" : "Clinical phase";
  return lang === "it" ? `Fase clinica · ${p}` : `Clinical phase · ${p}`;
}

function phaseDetail(bonus: number, lang: "it" | "en"): string {
  if (bonus === -35) {
    return lang === "it"
      ? "Proxy favorevole: asset approvato / commercializzato."
      : "Favorable proxy: approved or commercial asset.";
  }
  if (bonus === -18) {
    return lang === "it"
      ? "Proxy favorevole: Phase 3 / pivotal — percorso regolatorio avanzato."
      : "Favorable proxy: Phase 3 / pivotal — advanced regulatory path.";
  }
  if (bonus === -8) {
    return lang === "it"
      ? "Proxy favorevole: Phase 2 — segnali clinici intermedi."
      : "Favorable proxy: Phase 2 — mid-stage clinical profile.";
  }
  if (bonus === -4) {
    return lang === "it"
      ? "Proxy favorevole: Phase 1 — rischio regolatorio ancora lontano."
      : "Favorable proxy: Phase 1 — regulatory risk still distant.";
  }
  if (bonus === -2) {
    return lang === "it"
      ? "Proxy favorevole: preclinico — nessun filing FDA imminente."
      : "Favorable proxy: preclinical — no imminent FDA filing.";
  }
  return lang === "it"
    ? "Bonus da fase clinica in Simulation."
    : "Bonus from clinical phase in Simulation.";
}

/** Mirrors scripts/regulatory_risk_refresh.py::_compute_score. */
export function buildRegulatoryScoreExplain(
  signal: RegulatoryRiskSignal | null | undefined,
  clinicalPhase: string | null | undefined,
  lang: "it" | "en",
): RegulatoryScoreExplain | null {
  if (!signal) return null;

  const it = lang === "it";
  const secSource = it
    ? "SEC 8-K · feed catalyst · cache"
    : "SEC 8-K · catalyst feed · cache";
  const simPhaseSource = it ? "Foglio Simulation · fase clinica" : "Simulation sheet · clinical phase";
  const snapSource = it ? "Snapshot regolatorio (VPS)" : "Regulatory snapshot (VPS)";

  const components: RegulatoryScoreComponent[] = [];
  let score = 0;

  if (signal.crl?.detected) {
    components.push({
      id: "crl",
      delta: 50,
      label: it ? "CRL / rischio regolatorio attivo" : "CRL / active regulatory risk",
      detail: it
        ? "Complete Response Letter o flag regolatorio rilevato nei filing."
        : "Complete Response Letter or regulatory flag detected in filings.",
      source: secSource,
    });
    score += 50;
  }
  if (signal.pdufa?.detected) {
    components.push({
      id: "pdufa",
      delta: 35,
      label: "PDUFA / NDA / BLA",
      detail: it
        ? "Data PDUFA o submission NDA/BLA rilevata — evento binario imminente."
        : "PDUFA date or NDA/BLA submission detected — near-term binary event.",
      source: secSource,
    });
    score += 35;
  }
  if (signal.cmc?.detected) {
    components.push({
      id: "cmc",
      delta: 15,
      label: it ? "CMC / manufacturing" : "CMC / manufacturing",
      detail: it
        ? "Keyword CMC, GMP o manufacturing nei filing recenti."
        : "CMC, GMP or manufacturing keywords in recent filings.",
      source: secSource,
    });
    score += 15;
  }

  if (hasActiveRisk(signal)) {
    score = Math.max(-100, Math.min(100, score));
    return finalizeExplain(components, score, secSource);
  }

  const approved = signal.approved;
  if (approved?.detected) {
    const hits = approved.hits ?? [];
    const delta = hits.length ? approvedHitsBonus(hits) : -50;
    components.push({
      id: "approved",
      delta,
      label: it ? "Approvazione FDA" : "FDA approval",
      detail: hits.length
        ? hits.slice(0, 2).join(" · ")
        : it
          ? "Approvazione rilevata nel feed regolatorio."
          : "Approval detected in regulatory feed.",
      source: secSource,
    });
    score += delta;
  }

  const positive = signal.positive;
  if (positive?.detected) {
    const hits = positive.hits ?? [];
    const delta = hits.length ? positiveHitsBonus(hits) : -30;
    components.push({
      id: "positive",
      delta,
      label: it ? "Catalizzatore regolatorio positivo" : "Positive regulatory catalyst",
      detail: hits.length
        ? hits.slice(0, 2).join(" · ")
        : it
          ? "Keyword favorevole (Fast Track, breakthrough, ecc.)."
          : "Favorable keyword (Fast Track, breakthrough, etc.).",
      source: secSource,
    });
    score += delta;
  }

  const phase = String(signal.clinical_phase ?? clinicalPhase ?? "").trim();
  const phaseBonus = clinicalPhaseBonus(phase || null);
  if (phaseBonus !== 0) {
    components.push({
      id: "phase",
      delta: phaseBonus,
      label: phaseLabel(phase, lang),
      detail: phaseDetail(phaseBonus, lang),
      source: simPhaseSource,
    });
    score += phaseBonus;
  }

  const hasFavorable = approved?.detected || positive?.detected || phaseBonus < 0;

  if (!hasFavorable && signal.no_signals) {
    components.push({
      id: "clean_scan",
      delta: -5,
      label: it ? "Scan pulito (nessun segnale)" : "Clean scan (no signals)",
      detail: it
        ? "Ticker scansionato: nessuna keyword CRL, PDUFA, CMC o favorevole nei filing recenti."
        : "Ticker scanned: no CRL, PDUFA, CMC or favorable keywords in recent filings.",
      source: secSource,
    });
    score -= 5;
  }

  score = Math.max(-100, Math.min(100, score));
  const primarySource =
    components.some(
      (c) =>
        c.id === "crl" ||
        c.id === "pdufa" ||
        c.id === "cmc" ||
        c.id === "approved" ||
        c.id === "positive",
    )
      ? secSource
      : phaseBonus !== 0
        ? simPhaseSource
        : snapSource;

  return finalizeExplain(components, score, primarySource);
}

function finalizeExplain(
  components: RegulatoryScoreComponent[],
  total: number,
  primarySource: string,
): RegulatoryScoreExplain {
  const impact = Math.round(-total);
  const impactDisplay = impact > 0 ? `+${impact}` : String(impact);
  return { components, total, primarySource, impactDisplay };
}

export function formatScoreDelta(delta: number): string {
  return formatRegulatoryScoreDisplay(delta);
}
