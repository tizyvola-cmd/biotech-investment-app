/**
 * Standard-of-care comparison for efficacy readouts.
 * Flag only when vs_soc or a same-trial comparator is present — never invent SoC.
 */
import type {
  ClinicalAiSummary,
  ClinicalPreCdRecord,
  ClinicalStudyIndicator,
  DiseaseSocContext,
  SocCompareFlag,
  StudyClinicalProfile,
} from "../api/supernova";
import { indicatorIsEfficacy } from "./clinicalIndicators";

const ND = new Set(["n/d", "nd", "—", "-", "", "null", "unknown", "none"]);

export type EfficacySocCompare = {
  flag: SocCompareFlag;
  socName: string | null;
  socBenchmark: string | null;
  socIsNone: boolean;
  /** How the flag was decided — for tooltip honesty. */
  basis: "vs_soc" | "comparator" | "benchmark" | "none";
};

export type CollectDiseaseSocOpts = {
  ticker?: string | null;
  nctId?: string | null;
};

function clean(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function isNd(raw: string): boolean {
  return ND.has(raw.toLowerCase());
}

export function parseSocFlag(raw: string | null | undefined): SocCompareFlag {
  const s = clean(raw).toLowerCase();
  if (!s || isNd(s)) return "unknown";
  if (
    /\b(better|migliore|superior|superato|outperform|beat|improved|improvement)\b/.test(s)
  ) {
    return "beat";
  }
  if (
    /\b(similar|simile|comparable|equivalent|equivalente|non-?inferior|pari|match|stable)\b/.test(
      s,
    )
  ) {
    return "match";
  }
  if (
    /\b(worse|peggiore|(?<!non-)(?<!non )inferior|underperform|miss|worsening)\b/.test(s)
  ) {
    return "miss";
  }
  return "unknown";
}

function lowerBetterEndpoint(label: string): boolean {
  return /\b(hr|hazard|os hr|pfs hr|ae|sae|discontinuation|mortality|death)\b/i.test(
    label,
  );
}

function flagFromComparator(ind: ClinicalStudyIndicator): SocCompareFlag {
  const nv = ind.numeric_value;
  const comp = ind.comparator_value_numeric;
  if (nv == null || comp == null || !Number.isFinite(nv) || !Number.isFinite(comp)) {
    return "unknown";
  }
  const lowerBetter = lowerBetterEndpoint(`${ind.label ?? ""} ${ind.unit ?? ""}`);
  const delta = lowerBetter ? comp - nv : nv - comp;
  const scale = Math.max(Math.abs(comp), Math.abs(nv), 1);
  if (Math.abs(delta) / scale < 0.03) return "match";
  return delta > 0 ? "beat" : "miss";
}

function tokenizeIndication(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[,|;/]+/)
    .flatMap((part) => part.split(/\s+/))
    .map((t) => t.trim())
    .filter((t) => t.length > 3);
}

/** Reject disease_soc blocks copied from a different indication. */
export function indicationsCompatible(
  diseaseSocLabel: string | null | undefined,
  conditions: string | null | undefined,
): boolean {
  const d = clean(diseaseSocLabel);
  const c = clean(conditions);
  if (!d || !c) return true;
  const dl = d.toLowerCase();
  const cl = c.toLowerCase();
  if (dl === cl || cl.includes(dl) || dl.includes(cl)) return true;
  const dtoks = tokenizeIndication(d);
  const ctoks = tokenizeIndication(c);
  for (const dt of dtoks) {
    if (cl.includes(dt)) return true;
  }
  for (const ct of ctoks) {
    if (dl.includes(ct)) return true;
  }
  return false;
}

function parseBenchmarkNumber(bench: string, label: string): number | null {
  const blob = `${bench} ${label}`.toLowerCase();
  const pct = bench.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct && /\borr\b|response|hiscr|iga|eas|orr|rate|pct|percent/i.test(blob)) {
    return Number.parseFloat(pct[1]);
  }
  const months = bench.match(/(\d+(?:\.\d+)?)\s*(?:mo|months?|mesi)/i);
  if (months && /\bos\b|pfs|survival|months|mesi/i.test(blob)) {
    return Number.parseFloat(months[1]);
  }
  return null;
}

function flagFromDiseaseBenchmark(
  ind: ClinicalStudyIndicator,
  diseaseSoc: DiseaseSocContext,
): SocCompareFlag {
  const bench = clean(diseaseSoc.soc_efficacy_benchmark);
  if (!bench || isNd(bench)) return "unknown";
  const nv = ind.numeric_value;
  if (nv == null || !Number.isFinite(nv)) return "unknown";
  const benchNum = parseBenchmarkNumber(bench, `${ind.label ?? ""} ${ind.unit ?? ""}`);
  if (benchNum == null || !Number.isFinite(benchNum)) return "unknown";
  const lowerBetter = lowerBetterEndpoint(`${ind.label ?? ""} ${ind.unit ?? ""} ${bench}`);
  const delta = lowerBetter ? benchNum - nv : nv - benchNum;
  const scale = Math.max(Math.abs(benchNum), Math.abs(nv), 1);
  if (Math.abs(delta) / scale < 0.05) return "match";
  return delta > 0 ? "beat" : "miss";
}

export function resolveEfficacySocCompare(
  ind: ClinicalStudyIndicator,
): EfficacySocCompare | null {
  if (!indicatorIsEfficacy(ind)) return null;
  const named = clean(ind.soc_name);
  const bench = clean(ind.soc_benchmark);
  const socIsNone =
    ind.soc_is_none === true ||
    /\b(no (approved )?treatment|nessun trattamento|best supportive care|\bbsc\b|watchful waiting)\b/i.test(
      named,
    );
  const fromField = parseSocFlag(ind.soc_flag ?? null);
  const fromVs = parseSocFlag(ind.vs_soc);
  const fromComp = flagFromComparator(ind);
  const flag =
    fromField !== "unknown"
      ? fromField
      : fromVs !== "unknown"
        ? fromVs
        : fromComp;
  const basis: EfficacySocCompare["basis"] =
    fromField !== "unknown" || fromVs !== "unknown"
      ? "vs_soc"
      : fromComp !== "unknown"
        ? "comparator"
        : "none";
  if (flag === "unknown" && !named && !bench && !socIsNone) return null;
  return {
    flag,
    socName: named && !isNd(named) ? named : socIsNone ? "none" : null,
    socBenchmark: bench && !isNd(bench) ? bench : null,
    socIsNone,
    basis,
  };
}

/** Resolve SoC compare from KPI fields, then fall back to disease-level benchmark. */
export function resolveEfficacySocCompareWithDisease(
  ind: ClinicalStudyIndicator,
  diseaseSoc?: DiseaseSocContext | null,
): EfficacySocCompare | null {
  const base = resolveEfficacySocCompare(ind);
  if (base && base.flag !== "unknown") return base;
  if (!indicatorIsEfficacy(ind) || !diseaseSoc) return base;
  const fromBench = flagFromDiseaseBenchmark(ind, diseaseSoc);
  if (fromBench === "unknown") return base;
  const socName = clean(diseaseSoc.soc_name);
  const socIsNone =
    diseaseSoc.soc_is_none === true ||
    socName === "none" ||
    /\b(no (approved )?treatment|best supportive care|\bbsc\b)\b/i.test(socName);
  return {
    flag: fromBench,
    socName: socIsNone ? "none" : socName && !isNd(socName) ? socName : null,
    socBenchmark: clean(diseaseSoc.soc_efficacy_benchmark) || base?.socBenchmark || null,
    socIsNone,
    basis: "benchmark",
  };
}

function richness(ctx: DiseaseSocContext): number {
  let n = 0;
  if (clean(ctx.disease)) n += 1;
  if (clean(ctx.usa_prevalence)) n += 2;
  if (clean(ctx.five_year_survival)) n += 2;
  if (clean(ctx.soc_name) || ctx.soc_is_none) n += 3;
  if (clean(ctx.soc_efficacy_benchmark)) n += 3;
  if (clean(ctx.life_expectancy)) n += 2;
  if (clean(ctx.symptoms)) n += 2;
  return n;
}

/** Pull named SoC + efficacy snippets out of free-form SoC prose (source_note / vs SoC). */
export function promoteSocFieldsFromProse(prose: string | null | undefined): {
  socName: string | null;
  benchmark: string | null;
} {
  const text = clean(prose);
  if (!text || isNd(text)) return { socName: null, benchmark: null };

  let socName: string | null = null;
  const vsMatch =
    text.match(/\bvs\.?\s*(?:SOC|SoC|standard of care)\s*[:\-]?\s*([^.;|]+)/i) ||
    text.match(/\b(?:SOC|SoC|standard of care)\s*[:\-]\s*([^.;|]+)/i);
  if (vsMatch?.[1] && !isNd(clean(vsMatch[1]))) {
    socName = clean(vsMatch[1]);
  }
  if (!socName) {
    const includeMatch = text.match(
      /(?:typically include|usual(?:ly)?\s+(?:include|are)|(?:treatment|therapy)\s+options?\s+(?:include|are)|NCCN lists)\s+([^.;]+)/i,
    );
    if (includeMatch?.[1]) {
      let raw = clean(includeMatch[1]);
      raw = raw.replace(/\s*;.*$/i, "").replace(/\s*—.*$/i, "");
      if (raw && raw.length >= 4 && raw.length <= 180 && !isNd(raw)) {
        socName = raw;
      }
    }
  }

  let benchmark: string | null = null;
  // Prefer the whole short vs-SoC comparison string (legacy + clearest chip).
  if (/\bvs\.?\s*(soc|standard)/i.test(text) && text.length <= 220) {
    benchmark = text;
  } else {
    const eff = text.match(
      /(?:ORR|PFS|OS|DOR|HiSCR|ORR\/CR)[^.;\n]{0,90}?(?:~?\d+(?:\.\d+)?\s*(?:–|-|to)\s*\d+(?:\.\d+)?\s*%?|~?\d+(?:\.\d+)?\s*%|~?\d+(?:\.\d+)?\s*(?:mo|months?))/i,
    );
    if (eff?.[0]) {
      benchmark = clean(eff[0]);
    }
  }

  return { socName, benchmark };
}

export function diseaseSocFromProfile(
  profile: StudyClinicalProfile | null | undefined,
  conditions?: string | null,
): DiseaseSocContext {
  const extracted = profile?.disease_soc ?? {};
  const comparisonNote = clean(profile?.soc_comparison_note || profile?.vs_standard_of_care);
  const sourceNote =
    clean(extracted.source_note) && !isNd(clean(extracted.source_note))
      ? clean(extracted.source_note)
      : null;
  const proseForPromote = comparisonNote || sourceNote;
  const promoted = promoteSocFieldsFromProse(proseForPromote);

  const disease =
    clean(extracted.disease) ||
    clean(conditions) ||
    null;
  let socName = clean(extracted.soc_name);
  if ((!socName || isNd(socName)) && promoted.socName) {
    socName = promoted.socName;
  }
  const socIsNone =
    extracted.soc_is_none === true ||
    /\b(no (approved )?treatment|nessun trattamento|best supportive care|\bbsc\b)\b/i.test(
      socName || "",
    );
  let benchmark = clean(extracted.soc_efficacy_benchmark);
  if ((!benchmark || isNd(benchmark)) && promoted.benchmark) {
    benchmark = promoted.benchmark;
  }
  return {
    disease: disease && !isNd(disease) ? disease : null,
    usa_prevalence:
      clean(extracted.usa_prevalence) && !isNd(clean(extracted.usa_prevalence))
        ? clean(extracted.usa_prevalence)
        : null,
    five_year_survival:
      clean(extracted.five_year_survival) &&
      !isNd(clean(extracted.five_year_survival))
        ? clean(extracted.five_year_survival)
        : null,
    soc_name: socName && !isNd(socName) ? socName : socIsNone ? "none" : null,
    soc_is_none: socIsNone,
    soc_efficacy_benchmark: benchmark && !isNd(benchmark) ? benchmark : null,
    life_expectancy:
      clean(extracted.life_expectancy) && !isNd(clean(extracted.life_expectancy))
        ? clean(extracted.life_expectancy)
        : null,
    symptoms:
      clean(extracted.symptoms) && !isNd(clean(extracted.symptoms))
        ? clean(extracted.symptoms)
        : null,
    // Keep full prose Note even when we also promote SoC / ORR chips from it.
    source_note: sourceNote || (comparisonNote && comparisonNote !== benchmark ? comparisonNote : null),
  };
}

export function collectDiseaseSocFromRecords(
  records: ClinicalPreCdRecord[] | null | undefined,
  conditionsFallback?: string | null,
  opts?: CollectDiseaseSocOpts,
): DiseaseSocContext | null {
  const ticker = clean(opts?.ticker).toUpperCase();
  const nctId = clean(opts?.nctId).toUpperCase();
  const conditions = clean(conditionsFallback) || null;

  let pool = records ?? [];
  if (ticker) {
    pool = pool.filter((r) => clean(r.ticker).toUpperCase() === ticker);
  }
  if (nctId) {
    const nctMatch = pool.filter((r) => clean(r.nct_id).toUpperCase() === nctId);
    if (nctMatch.length) pool = nctMatch;
  }

  let best: DiseaseSocContext | null = null;
  let bestScore = -1;
  for (const rec of pool) {
    const ai = rec.ai as ClinicalAiSummary | undefined;
    const recConditions = clean(rec.meta?.conditions) || conditions;
    const ctx = diseaseSocFromProfile(ai?.study_clinical_profile, recConditions);
    if (ctx.disease && recConditions && !indicationsCompatible(ctx.disease, recConditions)) {
      continue;
    }
    const score = richness(ctx);
    if (score > bestScore) {
      best = ctx;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) return best;
  if (conditions) {
    return {
      disease: conditions,
      usa_prevalence: null,
      five_year_survival: null,
      soc_name: null,
      soc_is_none: false,
      soc_efficacy_benchmark: null,
      life_expectancy: null,
      symptoms: null,
      source_note: null,
    };
  }
  return bestScore >= 0 ? best : null;
}

export function socFlagLabel(flag: SocCompareFlag, it: boolean): string {
  if (flag === "beat") return it ? "Superato" : "Beat";
  if (flag === "match") return it ? "Pari" : "Match";
  if (flag === "miss") return it ? "Peggio" : "Worse";
  return it ? "SoC n/d" : "SoC n/a";
}

export function socNoneLabel(it: boolean): string {
  return it ? "Nessun trattamento / BSC" : "No treatment / BSC";
}
