/**
 * EIS News Thermometer — Option B path (Phase 1).
 * Maps taxonomy event_id → anchorScore (−1…+1).
 * Three intrinsic axes: clinical | financial (incl. M&A / partnership /
 * restructuring) | market_access.
 * Legacy Clin/Fin taxonomy weights (±3) remain for classification; display
 * uses this unit scale.
 */
import seedDoc from "../config/thermometer_benchmarks.json";
import type { DailyNewsTaxonomyDim } from "../api/supernova";

export type ThermometerAxis = "clinical" | "financial" | "market_access";
export type ThermometerConfidence = "seed" | "provisional" | "confirmed";
/** How the ±1 score was derived (telemetry; separate from human review). */
export type ThermometerMatchSource =
  | "event_id"
  | "text"
  | "server_importance"
  | "fallback"
  | null;

export type ThermometerBenchmark = {
  id: string;
  axis: ThermometerAxis;
  subtype: string;
  label: string;
  anchorScore: number;
  confidence: ThermometerConfidence;
  taxonomyEventId?: string | null;
  sourceEventId?: string | null;
  createdAt?: string;
};

export type ThermometerAxisScore = {
  axis: ThermometerAxis;
  score: number | null;
  confidence: ThermometerConfidence;
  subtype: string | null;
  taxonomyEventId: string | null;
  taxonomyScore: number | null;
  nearest: ThermometerBenchmark[];
  /** True when |score| is meaningful enough to show the gauge. */
  relevant: boolean;
  evidence?: string | null;
  /** event_id / text / server_importance / fallback — null if unscored. */
  matchSource?: ThermometerMatchSource;
  /** Matched Excel / overlay benchmark id when known. */
  benchmarkId?: string | null;
};

export type ThermometerArticleScore = {
  clinical: ThermometerAxisScore;
  financial: ThermometerAxisScore;
  market_access: ThermometerAxisScore;
};

export type TaxonomyDimsInput = Partial<
  Record<"clinical" | "financial" | "corporate" | "market_access", DailyNewsTaxonomyDim | null | undefined>
> | null | undefined;

type SeedFile = {
  version?: number;
  provisionalWeight?: number;
  benchmarks?: ThermometerBenchmark[];
};

/** Taxonomy ±3 → unit ±1. */
const FALLBACK_SCALE = 1 / 3;
const SECONDARY_CAP = 0.15;
const RELEVANT_ABS = 0.005;

const THERMOMETER_AXES: ThermometerAxis[] = [
  "clinical",
  "financial",
  "market_access",
];

function emptyAxis(axis: ThermometerAxis): ThermometerAxisScore {
  return {
    axis,
    score: null,
    confidence: "provisional",
    subtype: null,
    taxonomyEventId: null,
    taxonomyScore: null,
    nearest: [],
    relevant: false,
    matchSource: null,
    benchmarkId: null,
  };
}

/** Taxonomy dimension → thermometer axis. */
export function taxonomyDimToAxis(
  dim: "clinical" | "financial" | "corporate" | "market_access",
): ThermometerAxis {
  if (dim === "market_access") return "market_access";
  if (dim === "financial" || dim === "corporate") return "financial";
  return "clinical";
}

export function thermometerAxisLabel(
  axis: ThermometerAxis,
  it = false,
): string {
  if (axis === "clinical") return it ? "Clinical" : "Clinical";
  if (axis === "market_access") return it ? "Market Access" : "Market Access";
  return it ? "Financial" : "Financial";
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100;
}

/** Normalize legacy ±100 anchors to unit ±1. */
function normalizeAnchorScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.abs(n) > 1.0001 ? n / 100 : n;
  return clampScore(v);
}

/** Token overlap + outcome/phase cues → pick most specific Excel row. */
function benchmarkTextScore(b: ThermometerBenchmark, text: string): number {
  const blob = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!blob) return 0;
  const label = String(b.label || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!label) return 0;
  const tokens = label
    .split(/[^a-z0-9+/]+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !["the", "and", "for", "with", "from", "into", "same", "via"].includes(t),
    );
  if (!tokens.length) return 0;
  let score = tokens.filter((t) => blob.includes(t)).length / tokens.length;
  if (
    /missed|negative|halted|failure|reject|crl|withdrawal/.test(label) &&
    /\b(miss(?:ed)?|fail(?:ed|ure)?|negative|halt(?:ed)?|crl|reject)\b/.test(blob)
  ) {
    score += 0.4;
  }
  if (
    /\b(met|positive|approval|beat|alignment)\b/.test(label) &&
    /\b(met|positive|approv(?:ed|al)|beat|success)\b/.test(blob)
  ) {
    score += 0.35;
  }
  if (
    (/phase 3|pivotal|registrational/.test(label) &&
      /\b(phase\s*3|phase\s*iii|pivotal|registrational)\b/.test(blob)) ||
    (/phase 2/.test(label) && /\b(phase\s*2|phase\s*ii)\b/.test(blob)) ||
    (/phase 1/.test(label) && /\b(phase\s*1|phase\s*i)\b/.test(blob))
  ) {
    score += 0.4;
  }
  return score;
}

function pickBenchmarkForTaxonomy(
  tid: string,
  evidence: string | null | undefined,
): ThermometerBenchmark | undefined {
  loadThermometerBenchmarks();
  const hits = _byTaxonomyId?.get(tid) || [];
  if (!hits.length) return undefined;
  if (hits.length === 1) return hits[0];
  const text = String(evidence || "");
  if (!text.trim()) {
    // Default: largest |anchor| (more specific outcome rows tend to be larger)
    return [...hits].sort(
      (a, b) => Math.abs(b.anchorScore) - Math.abs(a.anchorScore),
    )[0];
  }
  let best = hits[0]!;
  let bestS = -1;
  for (const h of hits) {
    const s = benchmarkTextScore(h, text);
    if (s > bestS) {
      bestS = s;
      best = h;
    }
  }
  if (bestS < 0.45) {
    return [...hits].sort(
      (a, b) => Math.abs(b.anchorScore) - Math.abs(a.anchorScore),
    )[0];
  }
  return best;
}

/** Match article text directly to a benchmark label when taxonomy is thin. */
export function matchBenchmarkByEvidence(
  axis: ThermometerAxis,
  text: string,
  minScore = 0.55,
): ThermometerBenchmark | null {
  const blob = String(text || "").trim();
  if (!blob) return null;
  let best: ThermometerBenchmark | null = null;
  let bestS = 0;
  for (const b of loadThermometerBenchmarks()) {
    if (b.axis !== axis) continue;
    const s = benchmarkTextScore(b, blob);
    if (s > bestS) {
      bestS = s;
      best = b;
    }
  }
  return bestS >= minScore ? best : null;
}

let _benchmarks: ThermometerBenchmark[] | null = null;
/** One taxonomy id may map to several outcome-specific Excel rows. */
let _byTaxonomyId: Map<string, ThermometerBenchmark[]> | null = null;

const OVERLAY_KEY = "supernova.thermometer.benchmarks.v1";

type OverlayDoc = { entries: ThermometerBenchmark[] };

/** In-memory fallback when localStorage is unavailable (tests / SSR). */
let _memoryOverlay: ThermometerBenchmark[] | null = null;

function readBenchmarkOverlay(): ThermometerBenchmark[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(OVERLAY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as OverlayDoc;
      const list = Array.isArray(parsed.entries) ? parsed.entries : [];
      return list
        .filter((b) => b && typeof b === "object" && b.id && b.axis)
        .map((b) => ({
          ...b,
          anchorScore: normalizeAnchorScore(Number(b.anchorScore)),
          confidence: (b.confidence || "provisional") as ThermometerConfidence,
        }));
    }
  } catch {
    /* fall through to memory */
  }
  return _memoryOverlay ? [..._memoryOverlay] : [];
}

function writeBenchmarkOverlay(entries: ThermometerBenchmark[]): void {
  const capped = entries.slice(-200);
  _memoryOverlay = capped;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(OVERLAY_KEY, JSON.stringify({ entries: capped }));
    }
  } catch {
    /* memory still holds */
  }
}

function rebuildBenchmarkIndex(list: ThermometerBenchmark[]): void {
  _benchmarks = list;
  _byTaxonomyId = new Map();
  for (const b of _benchmarks) {
    const tid = String(b.taxonomyEventId || "").trim().toUpperCase();
    if (!tid) continue;
    const arr = _byTaxonomyId.get(tid) || [];
    arr.push(b);
    _byTaxonomyId.set(tid, arr);
  }
}

/**
 * Seed JSON + local confirmed/re-scored overlay (human write-back).
 * Overlay wins on same id; also indexed by taxonomyEventId for matching.
 */
export function loadThermometerBenchmarks(): ThermometerBenchmark[] {
  if (_benchmarks) return _benchmarks;
  const doc = seedDoc as SeedFile;
  const seed = Array.isArray(doc.benchmarks) ? doc.benchmarks : [];
  const byId = new Map<string, ThermometerBenchmark>();
  for (const b of seed) {
    byId.set(String(b.id), {
      ...b,
      anchorScore: normalizeAnchorScore(Number(b.anchorScore)),
      confidence: (b.confidence || "seed") as ThermometerConfidence,
    });
  }
  for (const b of readBenchmarkOverlay()) {
    byId.set(String(b.id), b);
  }
  rebuildBenchmarkIndex([...byId.values()]);
  return _benchmarks!;
}

export function resetThermometerBenchmarkCacheForTests(): void {
  _benchmarks = null;
  _byTaxonomyId = null;
}

/** Upsert a human-confirmed / re-scored row into the growing local benchmark. */
export function upsertConfirmedBenchmark(input: {
  axis: ThermometerAxis;
  score: number;
  taxonomyEventId?: string | null;
  subtype?: string | null;
  evidence?: string | null;
  articleKey?: string | null;
  priorBenchmarkId?: string | null;
}): ThermometerBenchmark {
  const score = clampScore(input.score);
  const tid = String(input.taxonomyEventId || "").trim().toUpperCase() || null;
  const overlay = readBenchmarkOverlay();
  const priorId = String(input.priorBenchmarkId || "").trim();
  let existing =
    (priorId ? overlay.find((e) => e.id === priorId) : undefined) ||
    (tid
      ? overlay.find(
          (e) =>
            String(e.taxonomyEventId || "").toUpperCase() === tid &&
            e.axis === input.axis,
        )
      : undefined);

  const id =
    existing?.id ||
    `user.${input.axis}.${tid || "na"}.${Date.now().toString(36)}`;
  const label =
    existing?.label ||
    (input.evidence
      ? String(input.evidence).slice(0, 120)
      : tid
        ? `Confirmed ${tid}`
        : `Confirmed ${input.axis} ${score >= 0 ? "+" : ""}${score}`);

  const row: ThermometerBenchmark = {
    id,
    axis: input.axis,
    subtype: input.subtype || existing?.subtype || input.axis,
    label,
    anchorScore: score,
    confidence: "confirmed",
    taxonomyEventId: tid || existing?.taxonomyEventId || null,
    sourceEventId: input.articleKey || existing?.sourceEventId || null,
    createdAt: new Date().toISOString().slice(0, 10),
  };

  const next = overlay.filter((e) => e.id !== id);
  next.push(row);
  writeBenchmarkOverlay(next);
  // Invalidate cache so next load merges the new anchor
  _benchmarks = null;
  _byTaxonomyId = null;
  return row;
}

export function listBenchmarkOverlayForTests(): ThermometerBenchmark[] {
  return readBenchmarkOverlay();
}

export function clearBenchmarkOverlayForTests(): void {
  _memoryOverlay = null;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(OVERLAY_KEY);
  } catch {
    /* ignore */
  }
  _benchmarks = null;
  _byTaxonomyId = null;
}

export function provisionalWeight(): number {
  const w = Number((seedDoc as SeedFile).provisionalWeight);
  return Number.isFinite(w) && w > 0 && w <= 1 ? w : 0.35;
}

function benchmarkWeight(b: ThermometerBenchmark): number {
  if (b.confidence === "confirmed") return 1;
  if (b.confidence === "provisional") return provisionalWeight();
  return 0.55; // seed
}

function confidenceFromMatch(
  source: ThermometerMatchSource,
): ThermometerConfidence {
  // Exact / server Excel importance → seed (still needs human OK for "confirmed")
  if (source === "event_id" || source === "server_importance") return "seed";
  // Fuzzy text or formula fallback → provisional (weaker nearest ranking)
  return "provisional";
}

export function matchSourceLabel(
  source: ThermometerMatchSource | undefined,
  it = false,
): string | null {
  if (!source) return null;
  if (source === "event_id") return it ? "ID" : "ID";
  if (source === "server_importance") return it ? "XLS" : "XLS";
  if (source === "text") return it ? "TXT" : "TXT";
  if (source === "fallback") return it ? "FB" : "FB";
  return null;
}

export function matchSourceTitle(
  source: ThermometerMatchSource | undefined,
  it = false,
): string {
  if (source === "event_id")
    return it
      ? "Match esatto su taxonomy event_id → riga Excel"
      : "Exact taxonomy event_id → Excel row";
  if (source === "server_importance")
    return it
      ? "Importance Excel dal backend"
      : "Excel importance from backend";
  if (source === "text")
    return it
      ? "Match fuzzy sul testo / evidence"
      : "Fuzzy text / evidence match";
  if (source === "fallback")
    return it
      ? "Fallback: score tassonomia × (100/3)"
      : "Fallback: taxonomy score × (100/3)";
  return "";
}

/** Nearest benchmarks on the same axis by absolute score distance. */
export function nearestBenchmarks(
  axis: ThermometerAxis,
  score: number,
  k = 3,
): ThermometerBenchmark[] {
  const all = loadThermometerBenchmarks().filter((b) => b.axis === axis);
  return [...all]
    .sort((a, b) => {
      const da = Math.abs(a.anchorScore - score);
      const db = Math.abs(b.anchorScore - score);
      if (da !== db) return da - db;
      return benchmarkWeight(b) - benchmarkWeight(a);
    })
    .slice(0, Math.max(0, k));
}

/**
 * Resolve thermometer score for one taxonomy dimension hit.
 * Option B: prefer event_id anchor; else fallback taxonomy±3 → ±100.
 * Benchmark axis wins when the Excel row is on market_access / financial
 * even if taxonomy stored it under another dim.
 */
export function scoreFromTaxonomyDim(
  dimKey: "clinical" | "financial" | "corporate" | "market_access",
  dim: DailyNewsTaxonomyDim | null | undefined,
): ThermometerAxisScore {
  let axis = taxonomyDimToAxis(dimKey);
  const empty: ThermometerAxisScore = emptyAxis(axis);
  if (!dim || dim.unclassified) return empty;

  const tid = String(dim.event_id || "").trim().toUpperCase() || null;
  const taxScore =
    typeof dim.score === "number" && Number.isFinite(dim.score) ? dim.score : null;
  const evidence = dim.evidence ?? dim.event_type ?? null;

  loadThermometerBenchmarks();
  let matchSource: ThermometerMatchSource = null;
  let anchorFromTid = tid ? pickBenchmarkForTaxonomy(tid, evidence) : undefined;
  let anchor = anchorFromTid;
  if (anchorFromTid) matchSource = "event_id";

  // Prefer server-attached Excel importance when present (type + outcome).
  const serverImp =
    typeof (dim as { thermometer_importance?: number }).thermometer_importance ===
      "number" &&
    Number.isFinite((dim as { thermometer_importance?: number }).thermometer_importance)
      ? Number((dim as { thermometer_importance?: number }).thermometer_importance)
      : null;
  // Refine / fill from Excel label match when evidence names a more specific row
  // (event type + outcome already encoded in importance_score).
  let textReplaced = false;
  if (evidence) {
    // Prefer same taxonomy-dim axis first, then any axis
    const byText =
      matchBenchmarkByEvidence(axis, String(evidence), 0.6) ||
      matchBenchmarkByEvidence("clinical", String(evidence), 0.7) ||
      matchBenchmarkByEvidence("financial", String(evidence), 0.7) ||
      matchBenchmarkByEvidence("market_access", String(evidence), 0.7);
    if (byText) {
      if (
        !anchor ||
        Math.abs(byText.anchorScore) >= Math.abs(anchor.anchorScore) * 0.85
      ) {
        if (!anchor || byText.id !== anchor.id) textReplaced = true;
        anchor = byText;
      }
    }
  }

  if (anchor?.axis && THERMOMETER_AXES.includes(anchor.axis)) {
    axis = anchor.axis;
  }

  let score: number | null = null;
  let subtype: string | null = null;
  if (serverImp != null && (anchor || tid)) {
    score = normalizeAnchorScore(serverImp);
    subtype = anchor?.subtype ?? dimKey;
    matchSource = "server_importance";
  } else if (anchor) {
    // Soft-blend anchor with taxonomy magnitude when modifiers moved the ±3 score.
    const baseW = typeof dim.base_weight === "number" ? dim.base_weight : null;
    if (
      taxScore != null &&
      baseW != null &&
      Math.abs(baseW) > 1e-9 &&
      Math.abs(taxScore - baseW) > 0.05
    ) {
      const ratio = taxScore / baseW;
      score = clampScore(anchor.anchorScore * ratio);
    } else {
      score = clampScore(anchor.anchorScore);
    }
    subtype = anchor.subtype;
    if (textReplaced && !anchorFromTid) matchSource = "text";
    else if (textReplaced && anchorFromTid && anchor.id !== anchorFromTid.id)
      matchSource = "text";
    else matchSource = "event_id";
  } else if (taxScore != null) {
    score = clampScore(taxScore * FALLBACK_SCALE);
    subtype = dimKey;
    matchSource = "fallback";
  }

  if (score == null) return emptyAxis(axis);

  const nearest = nearestBenchmarks(axis, score, 3);
  return {
    axis,
    score,
    confidence: confidenceFromMatch(matchSource),
    subtype,
    taxonomyEventId: tid || (anchor?.taxonomyEventId ?? null),
    taxonomyScore: taxScore,
    nearest,
    relevant: Math.abs(score) >= RELEVANT_ABS || Boolean(tid),
    evidence,
    matchSource,
    benchmarkId: anchor?.id ?? null,
  };
}

/**
 * Aggregate multiple hits on the same axis: max-|score| leads;
 * others apply a capped secondary adjustment (±SECONDARY_CAP).
 */
export function aggregateAxisScores(
  parts: ThermometerAxisScore[],
  axis: ThermometerAxis,
): ThermometerAxisScore {
  const usable = parts.filter((p) => p.axis === axis && p.score != null);
  if (!usable.length) {
    return emptyAxis(axis);
  }
  usable.sort((a, b) => Math.abs(b.score!) - Math.abs(a.score!));
  const lead = usable[0]!;
  let score = lead.score!;
  for (const sec of usable.slice(1)) {
    const delta = Math.max(
      -SECONDARY_CAP,
      Math.min(SECONDARY_CAP, (sec.score! - score) * 0.25),
    );
    score = clampScore(score + delta);
  }
  return {
    ...lead,
    axis,
    score,
    nearest: nearestBenchmarks(axis, score, 3),
    relevant: true,
    confidence: usable.every((u) => u.confidence === "confirmed")
      ? "confirmed"
      : usable.some((u) => u.confidence === "provisional")
        ? "provisional"
        : lead.confidence,
    matchSource: lead.matchSource ?? null,
    benchmarkId: lead.benchmarkId ?? null,
  };
}

/** Build three-axis thermometer from Daily News / brief taxonomy_dimensions. */
export function scoreArticleThermometer(
  dims: TaxonomyDimsInput,
): ThermometerArticleScore {
  const buckets: Record<ThermometerAxis, ThermometerAxisScore[]> = {
    clinical: [],
    financial: [],
    market_access: [],
  };

  const keys = ["clinical", "financial", "corporate", "market_access"] as const;
  for (const k of keys) {
    const part = scoreFromTaxonomyDim(k, dims?.[k]);
    if (part.score == null && !part.relevant) continue;
    buckets[part.axis].push(part);
  }

  return {
    clinical: aggregateAxisScores(buckets.clinical, "clinical"),
    financial: aggregateAxisScores(buckets.financial, "financial"),
    market_access: aggregateAxisScores(buckets.market_access, "market_access"),
  };
}

/** Apply a human correction / confirm onto an axis score. */
export function applyManualAxisScore(
  current: ThermometerAxisScore,
  nextScore: number,
  opts?: {
    confirmOnly?: boolean;
    articleKey?: string | null;
    /** Skip growing-benchmark write-back (e.g. replaying stored corrections). */
    skipWriteBack?: boolean;
  },
): ThermometerAxisScore {
  const score = opts?.confirmOnly
    ? current.score
    : clampScore(nextScore);
  if (score == null) return { ...current, confidence: "confirmed" };
  const confirmed: ThermometerAxisScore = {
    ...current,
    score,
    confidence: "confirmed",
    nearest: nearestBenchmarks(current.axis, score, 3),
    relevant: true,
    matchSource: current.matchSource ?? "event_id",
  };
  // Growing benchmark library: confirmed / re-scored events write back locally
  if (!opts?.skipWriteBack) {
    try {
      const row = upsertConfirmedBenchmark({
        axis: confirmed.axis,
        score,
        taxonomyEventId: confirmed.taxonomyEventId,
        subtype: confirmed.subtype,
        evidence: confirmed.evidence,
        articleKey: opts?.articleKey,
        priorBenchmarkId: confirmed.benchmarkId,
      });
      confirmed.benchmarkId = row.id;
    } catch {
      /* overlay optional */
    }
  }
  return confirmed;
}

export function formatThermometerScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = clampScore(n);
  const abs = Math.abs(u).toFixed(2);
  return `${u >= 0 ? "+" : "−"}${abs}`;
}

/** Scores are already unit −1…+1. */
export function thermometerToUnit(n: number): number {
  return clampScore(n);
}

/** Clamp unit −1…+1 (identity after migrate from ±100). */
export function thermometerFromUnit(u: number): number {
  return clampScore(u);
}

/** Color for −1…+1 (aligned with EIS red/gray/green). */
export function thermometerColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "rgb(100 116 139)"; // slate
  const s = clampScore(score);
  if (Math.abs(s) < 0.04) return "rgb(100 116 139)";
  if (s > 0) {
    const t = s;
    const g = Math.round(120 + 80 * t);
    const r = Math.round(40 + 40 * (1 - t));
    return `rgb(${r} ${g} 90)`;
  }
  const t = Math.abs(s);
  const r = Math.round(160 + 70 * t);
  const g = Math.round(70 * (1 - t));
  return `rgb(${r} ${g} 70)`;
}

// ── local corrections (Phase 1 — no backend yet) ────────────────────────────

const CORRECTIONS_KEY = "supernova.thermometer.corrections.v1";

export type ThermometerCorrection = {
  articleKey: string;
  axis: ThermometerAxis;
  oldScore: number | null;
  newScore: number;
  confirmedOnly: boolean;
  correctedAt: string;
  note?: string;
  matchSource?: ThermometerMatchSource;
  benchmarkId?: string | null;
};

type CorrectionsDoc = { entries: ThermometerCorrection[] };

function readCorrections(): CorrectionsDoc {
  try {
    const raw = localStorage.getItem(CORRECTIONS_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw) as CorrectionsDoc;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function writeCorrections(doc: CorrectionsDoc): void {
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(doc));
  } catch {
    /* ignore quota */
  }
}

export function getLatestCorrection(
  articleKey: string,
  axis: ThermometerAxis,
): ThermometerCorrection | null {
  const key = String(articleKey || "").trim();
  if (!key) return null;
  const hits = readCorrections().entries.filter(
    (e) => e.articleKey === key && e.axis === axis,
  );
  if (!hits.length) return null;
  return hits[hits.length - 1]!;
}

export function logThermometerCorrection(entry: ThermometerCorrection): void {
  const doc = readCorrections();
  doc.entries.push(entry);
  // Cap history
  if (doc.entries.length > 500) doc.entries = doc.entries.slice(-500);
  writeCorrections(doc);
}

export function applyStoredCorrections(
  articleKey: string,
  scored: ThermometerArticleScore,
): ThermometerArticleScore {
  const clin = getLatestCorrection(articleKey, "clinical");
  const fin = getLatestCorrection(articleKey, "financial");
  const access = getLatestCorrection(articleKey, "market_access");
  return {
    clinical: clin
      ? applyManualAxisScore(scored.clinical, clin.newScore, {
          confirmOnly: clin.confirmedOnly && clin.oldScore === clin.newScore,
          articleKey,
          skipWriteBack: true,
        })
      : scored.clinical,
    financial: fin
      ? applyManualAxisScore(scored.financial, fin.newScore, {
          confirmOnly: fin.confirmedOnly && fin.oldScore === fin.newScore,
          articleKey,
          skipWriteBack: true,
        })
      : scored.financial,
    market_access: access
      ? applyManualAxisScore(scored.market_access, access.newScore, {
          confirmOnly: access.confirmedOnly && access.oldScore === access.newScore,
          articleKey,
          skipWriteBack: true,
        })
      : scored.market_access,
  };
}
