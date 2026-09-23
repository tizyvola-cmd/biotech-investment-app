/**
 * Catalyst Days — Daily News box.
 *
 * 1) Top News: all ★ tickers — press + digested 8-K (scored + link).
 * 2) Rest universe: all other staged same-day headlines (not only ±EIS extremes).
 * 3) Analyze box: paste text / URL / PDF → ~10-word digest + taxonomy
 *    Clin / Fin / Access scores.
 */
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  analyzeDailyNewsSource,
  dismissDailyNewsItem,
  fetchDailyNews,
  fetchDailyNewsTop,
  migrateDailyNewsToEis,
  refreshDailyNews,
  type DailyNewsBrief,
  type DailyNewsHighlight,
  type DailyNewsPayload,
  type DailyNewsUserAnalysis,
} from "../api/supernova";
import { getAttentionStarsVersion } from "../sheet/attentionStarStore";
import { EisThermometerPanel } from "./EisThermometerPanel";
import { NewsCompanyProductDebrief } from "./NewsCompanyProductDebrief";
import { CATALYST_DESK_CACHE_CHANGED } from "../sheet/catalystDeskColumnCache";
import { dailyNewsPriorityTickers } from "../sheet/dailyNewsPriority";
import {
  peekPrefetchedDailyNewsBrief,
  prefetchDailyNewsBrief,
  prefetchDailyNewsBriefsIdle,
  rememberPrefetchedDailyNewsBrief,
  seedPrefetchedDailyNewsBriefsFromDesk,
} from "../sheet/dailyNewsBriefPrefetch";
import {
  formatThermometerScore,
  scoreArticleThermometer,
  type ThermometerArticleScore,
} from "../sheet/eisThermometer";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import { CLINICAL_PRE_CD_CHANGED_EVENT } from "../hooks/useClinicalPreCdRecords";
import { useLang } from "../shared/i18n";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { invalidateGuidanceSnapshotCache } from "./TickerCatalystEventsTable";
import { InvestorInsightBox } from "./InvestorInsightBox";

/** Token overlap for brief de-dupe (mirrors backend `_brief_text_overlap`). */
function briefTextOverlap(a: string, b: string): number {
  const stop = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "by", "as", "at", "is", "are", "was", "were", "be", "been", "that",
    "this", "from", "its", "it", "has", "have", "had", "will", "may",
  ]);
  const tok = (s: string) =>
    new Set(
      (s.toLowerCase().match(/[a-z0-9$%]+/g) || []).filter((t) => !stop.has(t)),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(Math.min(ta.size, tb.size), 1);
}

function briefEchoesAnchor(text: string, anchors: string[]): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  const tl = t.toLowerCase();
  for (const a of anchors) {
    const al = a.toLowerCase();
    if (al.includes(tl)) return true;
    if (tl.length >= 28 && al.includes(tl.slice(0, Math.min(90, tl.length)))) {
      return true;
    }
    if (briefTextOverlap(t, a) >= 0.68) return true;
  }
  return false;
}

/**
 * Client-side safety net: one fact once. Hide Key points / Data-results that
 * only echo the finance/clinical lede (covers cached briefs from older builds).
 */
function dedupeBriefForDisplay(brief: DailyNewsBrief): DailyNewsBrief {
  const detail = (brief.detail_summary || "").trim();
  const anchors = [detail].filter((x) => x.length >= 40);
  const keyResults = Array.isArray(brief.key_results)
    ? brief.key_results.filter((kr) => {
        const det = (kr.detail || "").trim();
        if (!det) return false;
        const lab = (kr.label || "").trim();
        const chip =
          /^(size|type|window|no offering|product|study|phase|date|hard number)\b/i.test(
            lab,
          ) && det.length <= 120;
        if (chip) {
          const compact = det.toLowerCase().replace(/[^\w$%]+/g, "");
          return !anchors.some((a) => {
            const al = a.toLowerCase();
            return (
              al.includes(det.toLowerCase()) ||
              (compact.length >= 6 &&
                al.replace(/[^\w$%]+/g, "").includes(compact)) ||
              briefTextOverlap(det, a) >= 0.55
            );
          });
        }
        return !briefEchoesAnchor(det, anchors);
      })
    : brief.key_results;
  const keyPoints = Array.isArray(brief.key_points)
    ? brief.key_points.filter((p) => {
        const s = String(p || "").trim();
        if (!s) return false;
        if (/^(size|type|window)\s*:/i.test(s) && s.length < 120) {
          const det = s.split(":").slice(1).join(":").trim();
          return !anchors.some(
            (a) =>
              a.toLowerCase().includes(det.toLowerCase()) ||
              briefTextOverlap(det, a) >= 0.55,
          );
        }
        return !briefEchoesAnchor(s, anchors);
      })
    : brief.key_points;
  let results = brief.results;
  if (
    results &&
    (briefEchoesAnchor(results, anchors) ||
      (keyResults || []).some(
        (kr) => briefTextOverlap(results!, kr.detail || "") >= 0.7,
      ) ||
      (keyPoints || []).some((p) => briefTextOverlap(results!, p) >= 0.7))
  ) {
    results = null;
  }
  return {
    ...brief,
    key_results: keyResults,
    key_points: keyPoints,
    results,
  };
}

export type CatalystDailyNewsBoxHandle = {
  /** Force Google News search + Top News (all ★) rebuild. */
  refresh: () => Promise<void>;
};

function hasClockTime(raw: string): boolean {
  return /T\d{2}:\d{2}/.test(raw) || /(?:^|[^\d])\d{1,2}:\d{2}/.test(raw);
}

/** Prefer a timestamp with clock time (RSS pubDate, then found_at). */
function itemPublishedAt(
  item: Pick<DailyNewsHighlight, "published_at" | "event_date" | "found_at">,
): string | null {
  const pub = String(item.published_at || "").trim();
  const found = String(item.found_at || "").trim();
  const event = String(item.event_date || "").trim();
  if (hasClockTime(pub)) return pub;
  const pubDay = pub.slice(0, 10);
  const foundDay = found.slice(0, 10);
  if (
    hasClockTime(found) &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(pubDay) || pubDay === foundDay)
  ) {
    return found;
  }
  return pub || event || found || null;
}

/** ISO YYYY-MM-DD from published_at / event_date / found_at. */
function itemPublicationDay(
  item: Pick<DailyNewsHighlight, "published_at" | "event_date" | "found_at">,
): string | null {
  for (const key of ["published_at", "event_date", "found_at"] as const) {
    const iso = String(item[key] || "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return null;
}

/** Daily News box: publication on the current Europe/Rome calendar day only. */
function isSameRomeDeskDay(
  item: Pick<DailyNewsHighlight, "published_at" | "event_date" | "found_at">,
  romeDate: string | null | undefined,
): boolean {
  const day =
    String(romeDate || "").trim().slice(0, 10) ||
    new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  const pub = itemPublicationDay(item);
  if (!pub || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(pub)) {
    return false;
  }
  return pub === day;
}

function isActiveOnDesk(item: {
  migrated_to_eis?: boolean;
  dismissed?: boolean;
  status?: string | null;
}): boolean {
  if (item.dismissed) return false;
  if (item.migrated_to_eis) return false;
  const st = String(item.status || "").trim().toLowerCase();
  if (st === "migrated" || st === "dismissed") return false;
  return true;
}

function newsTickerOf(h: DailyNewsHighlight): string {
  return String(h.ticker || "").trim().toUpperCase();
}

/** Best available |score| so Top News can prefer a classified row over an empty RSS title. */
function absNewsScore(h: DailyNewsHighlight): number {
  let m = 0;
  for (const v of [
    h.eis_score,
    h.eis?.score,
    h.clinical_score,
    h.financial_score,
    h.corporate_score,
    h.market_access_score,
  ]) {
    if (typeof v === "number" && Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  }
  const dims = h.taxonomy_dimensions;
  if (dims) {
    for (const key of ["clinical", "financial", "corporate", "market_access"] as const) {
      const block = dims[key];
      if (!block || block.unclassified) continue;
      const s = block.score;
      if (typeof s === "number" && Number.isFinite(s)) m = Math.max(m, Math.abs(s));
    }
  }
  return m;
}

function pickBestScoredNews(
  primary: DailyNewsHighlight,
  extras: DailyNewsHighlight[],
): DailyNewsHighlight {
  let best = primary;
  let bestAbs = absNewsScore(primary);
  for (const h of extras) {
    const a = absNewsScore(h);
    if (a > bestAbs + 0.001) {
      best = h;
      bestAbs = a;
    }
  }
  return best;
}

function fmtPublishedDate(
  raw: string | null | undefined,
  it: boolean,
): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const locale = it ? "it-IT" : "en-GB";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = dateOnly ? new Date(`${s}T12:00:00`) : new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "short",
      year: "numeric",
    };
    if (!dateOnly && hasClockTime(s)) {
      return d.toLocaleString(locale, {
        ...opts,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    return d.toLocaleDateString(locale, opts);
  }
  // Already a human label (e.g. September 9, 2026)
  if (s.length <= 32) return s;
  return s.slice(0, 32);
}

function sourceBadge(item: DailyNewsHighlight, it: boolean): string {
  const kind = (item.source_kind || item.source_label || "").toLowerCase();
  if (kind.includes("fda_briefing") || kind.includes("fda briefing")) {
    return it ? "Briefing FDA" : "FDA Briefing";
  }
  if (kind.includes("catalyst_outcome") || kind.includes("catalyst outcome")) {
    return it ? "Esito catalyst" : "Catalyst outcome";
  }
  if (kind.includes("8") || kind === "sec_8k") return "8-K";
  if (kind.includes("press") || kind === "press") return it ? "Press" : "Press";
  return item.source_label || (it ? "News" : "News");
}

function isFdaBriefingItem(
  item: Pick<DailyNewsHighlight, "source_kind" | "source_label">,
): boolean {
  const kind = String(item.source_kind || "").toLowerCase();
  const label = String(item.source_label || "").toLowerCase();
  return (
    kind === "fda_briefing" ||
    kind.includes("fda_briefing") ||
    label.includes("fda briefing") ||
    label.includes("briefing fda")
  );
}

/** Gold fill + blue type for FDA AdCom briefing rows in Daily News. */
const FDA_BRIEFING_BLUE = "#1D4ED8";
const FDA_BRIEFING_GOLD = "#F3C451";
const FDA_BRIEFING_STYLE: CSSProperties = {
  backgroundColor: FDA_BRIEFING_GOLD,
  borderColor: FDA_BRIEFING_GOLD,
  color: FDA_BRIEFING_BLUE,
};
const FDA_BRIEFING_ROW =
  "border-[#F3C451]/70 bg-gradient-to-r from-[#F6D56B]/28 via-[#1a1520] to-[#F3C451]/18 shadow-[inset_0_0_0_1px_rgba(246,213,107,0.5)]";
const FDA_BRIEFING_TICKER =
  "bg-[#F3C451] font-bold";
const FDA_BRIEFING_BADGE =
  "border font-bold uppercase tracking-wide";


/** Chip threshold on thermometer unit scale (−1…+1). */
const SCORE_CHIP_MIN = 0.01;

function numScore(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type TaxonomyDimKey = "clinical" | "financial" | "corporate" | "market_access";

function taxonomyTip(
  dims: DailyNewsHighlight["taxonomy_dimensions"] | null | undefined,
  key: TaxonomyDimKey,
  fallback: string,
): string {
  const block = dims?.[key];
  if (!block) return fallback;
  const parts: string[] = [];
  if (block.event_type) parts.push(String(block.event_type));
  if (block.evidence) parts.push(`«${String(block.evidence)}»`);
  if (block.review_flag) parts.push("⚠ da rivedere");
  const mods = Array.isArray(block.modifiers_applied) ? block.modifiers_applied : [];
  if (mods.length) {
    parts.push(
      `mods: ${mods
        .map((m) => `${m.modifier ?? m.id}×${m.multiplier ?? "?"}`)
        .join(", ")}`,
    );
  }
  return parts.length ? parts.join(" · ") : fallback;
}

/**
 * Chip scores = same thermometer values as the gauges (display −1…+1).
 * Avoids Fin chip vs Financial gauge mismatches.
 */
function chipScoresFromThermometer(
  taxonomy: DailyNewsHighlight["taxonomy_dimensions"] | null | undefined,
  forceAll: boolean,
): { clinical: number | null; financial: number | null; access: number | null } {
  const t = scoreArticleThermometer(taxonomy ?? null);
  const pick = (score: number | null | undefined, relevant: boolean) => {
    if (typeof score === "number" && Number.isFinite(score))
      return Math.round(score * 100) / 100;
    if (forceAll) return 0;
    return relevant ? 0 : null;
  };
  return {
    clinical: pick(t.clinical.score, t.clinical.relevant),
    financial: pick(t.financial.score, t.financial.relevant),
    access: pick(t.market_access.score, t.market_access.relevant),
  };
}

/** Clin / Fin / Access — same numbers as the news thermometer (display −1…+1). */
function RelevantScoreChips({
  clinical,
  financial,
  access,
  accessNotes,
  taxonomy,
  it,
  compact: _compact,
  forceAll,
  liveScores,
}: {
  clinical?: number | null;
  financial?: number | null;
  access?: number | null;
  accessNotes?: string;
  taxonomy?: DailyNewsHighlight["taxonomy_dimensions"] | null;
  it: boolean;
  compact?: boolean;
  /** Brief modal: always show Clin / Fin / Access with color coding. */
  forceAll?: boolean;
  /** Live thermometer overrides (manual click / confirm). */
  liveScores?: {
    clinical: number | null;
    financial: number | null;
    access: number | null;
  } | null;
}) {
  const hasTaxonomy = Boolean(
    taxonomy &&
      (taxonomy.clinical ||
        taxonomy.financial ||
        taxonomy.corporate ||
        taxonomy.market_access),
  );
  const derived = hasTaxonomy
    ? chipScoresFromThermometer(taxonomy, Boolean(forceAll))
    : {
        clinical: numScore(clinical),
        financial: numScore(financial),
        access: numScore(access),
      };
  // Legacy raw taxonomy ±3 scores → approximate thermometer scale when no dims.
  const scaleLegacy = (n: number | null) =>
    n == null ? null : Math.round((n / 3) * 100) / 100;
  let clin = hasTaxonomy
    ? derived.clinical
    : forceAll
      ? scaleLegacy(derived.clinical) ?? 0
      : scaleLegacy(derived.clinical);
  let fin = hasTaxonomy
    ? derived.financial
    : forceAll
      ? scaleLegacy(derived.financial) ?? 0
      : scaleLegacy(derived.financial);
  let acc = hasTaxonomy
    ? derived.access
    : forceAll
      ? scaleLegacy(derived.access) ?? 0
      : scaleLegacy(derived.access);
  if (liveScores) {
    if (liveScores.clinical != null) {
      clin = Math.round(liveScores.clinical * 100) / 100;
    }
    if (liveScores.financial != null) {
      fin = Math.round(liveScores.financial * 100) / 100;
    }
    if (liveScores.access != null) {
      acc = Math.round(liveScores.access * 100) / 100;
    }
  }
  const showClin = forceAll || (clin != null && Math.abs(clin) >= SCORE_CHIP_MIN);
  const showFin = forceAll || (fin != null && Math.abs(fin) >= SCORE_CHIP_MIN);
  const showAcc = forceAll || (acc != null && Math.abs(acc) >= SCORE_CHIP_MIN);
  if (!showClin && !showFin && !showAcc) return null;
  const scaleTip = it
    ? "Score termometro (−1…+1), allineato alle barre"
    : "Thermometer score (−1…+1), aligned with gauges";
  return (
    <span className="shrink-0 inline-flex items-center gap-1">
      {showClin ? (
        <ScoreChip
          label="Clin"
          score={clin}
          tip={taxonomyTip(taxonomy, "clinical", scaleTip)}
        />
      ) : null}
      {showFin ? (
        <ScoreChip
          label="Fin"
          score={fin}
          tip={
            [taxonomyTip(taxonomy, "financial", ""), taxonomyTip(taxonomy, "corporate", "")]
              .filter((t) => t && t !== scaleTip)
              .join(" · ") || scaleTip
          }
        />
      ) : null}
      {showAcc ? (
        <ScoreChip
          label="Access"
          score={acc}
          tip={taxonomyTip(taxonomy, "market_access", accessNotes || scaleTip)}
        />
      ) : null}
    </span>
  );
}

function analysisToHighlight(row: DailyNewsUserAnalysis): DailyNewsHighlight {
  const ref = (row.source_ref || "").trim();
  const fromFields = firstHttpUrl(
    ref,
    row.source_label,
    row.summary_10w,
    row.detail_summary,
    row.summary_long,
    row.source_excerpt,
    row.market_access_notes,
  );
  const title =
    (row.summary_10w || "").trim() ||
    (row.detail_summary || "").trim().slice(0, 160) ||
    (row.summary_long || "").trim() ||
    row.source_label ||
    "Manual news";
  const keyResultsBlurb = Array.isArray(row.key_results)
    ? row.key_results
        .map((kr) => `${kr.label}: ${kr.detail}`)
        .filter((x) => x.length > 8)
        .join("\n")
    : "";
  const summary = [
    row.detail_summary || "",
    keyResultsBlurb,
    row.abstract ? `Abstract:\n${row.abstract}` : "",
    Array.isArray(row.section_summaries) && row.section_summaries.length
      ? row.section_summaries
          .map(
            (s) =>
              `${String(s.heading || "Section").trim()}: ${String(s.summary || "").trim()}`,
          )
          .filter((x) => x.length > 8)
          .join("\n")
      : "",
    row.source_excerpt,
    row.summary_long,
    row.results_note,
    row.product ? `Product: ${row.product}` : "",
    row.study ? `Study: ${row.study}` : "",
    row.phase ? `Phase: ${row.phase}` : "",
    row.summary_10w,
    ref,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    id: row.id,
    ticker: row.ticker || undefined,
    title: title.slice(0, 240),
    summary: summary.slice(0, 14000),
    link: fromFields || (ref.startsWith("http") ? ref : undefined),
    source_kind: row.source_kind,
    source_label: (row.source_kind || "text").toUpperCase(),
    published_at: row.published_at || row.event_date || undefined,
    event_date: row.event_date || row.published_at || undefined,
    eis_score: row.eis_score,
    clinical_score: row.clinical_score,
    financial_score: row.financial_score,
    corporate_score: row.corporate_score,
    market_access_score: row.market_access_score,
    market_access_notes: row.market_access_notes,
    taxonomy_dimensions: row.taxonomy_dimensions,
    taxonomy_review_flags: row.taxonomy_review_flags,
    taxonomy_audit: row.taxonomy_audit,
    taxonomy_method: row.taxonomy_method,
    taxonomy_version: row.taxonomy_version,
    digest_method: row.digest_method,
    found_at: row.found_at,
  };
}

/** After brief, push taxonomy chips from modal → list row (same id / title+link). */
function scoresFromBrief(
  brief: DailyNewsBrief,
): Partial<DailyNewsHighlight> {
  const out: Partial<DailyNewsHighlight> = {};
  if (typeof brief.clinical_score === "number") out.clinical_score = brief.clinical_score;
  if (typeof brief.financial_score === "number") out.financial_score = brief.financial_score;
  if (typeof brief.corporate_score === "number") out.corporate_score = brief.corporate_score;
  if (typeof brief.market_access_score === "number") {
    out.market_access_score = brief.market_access_score;
  }
  if (typeof brief.eis_score === "number") out.eis_score = brief.eis_score;
  if (brief.taxonomy_dimensions) {
    out.taxonomy_dimensions =
      brief.taxonomy_dimensions as DailyNewsHighlight["taxonomy_dimensions"];
  }
  if (brief.taxonomy_method != null) out.taxonomy_method = brief.taxonomy_method;
  if (brief.news_kind) out.news_kind = brief.news_kind;
  if (brief.product) out.product = brief.product;
  if (brief.phase) out.phase = brief.phase;
  return out;
}

function sameNewsRow(
  a: { id?: string; ticker?: string | null; title?: string; link?: string },
  b: { id?: string; ticker?: string | null; title?: string; link?: string },
): boolean {
  const aid = String(a.id || "").trim();
  const bid = String(b.id || "").trim();
  if (aid && bid) return aid === bid;
  return (
    (a.ticker || "") === (b.ticker || "") &&
    (a.title || "") === (b.title || "") &&
    (a.link || "") === (b.link || "")
  );
}

/** First http(s) URL in free text. Google News RSS shells are not openable. */
function isGoogleNewsShellUrl(url: string): boolean {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  return (
    u.includes("news.google.com") ||
    u.includes("consent.google.com") ||
    u.includes("batchexecute") ||
    u.includes("/_/dotssplashui/")
  );
}

function firstHttpUrl(...blobs: Array<string | null | undefined>): string {
  for (const b of blobs) {
    const m = String(b || "").match(/https?:\/\/[^\s<>"'）】\]]+/i);
    if (m) {
      const url = m[0].replace(/[.,);:!]+$/g, "");
      if (!isGoogleNewsShellUrl(url)) return url;
    }
  }
  return "";
}

function decodeHtmlEntities(s: string): string {
  let raw = String(s || "");
  if (!raw) return raw;
  // Multi-pass for double-encoded RSS (&amp;nbsp; → &nbsp; → space)
  for (let i = 0; i < 3; i++) {
    const prev = raw;
    if (typeof document !== "undefined" && (raw.includes("&") || raw.includes("\u00a0"))) {
      const el = document.createElement("textarea");
      el.innerHTML = raw;
      raw = el.value;
    } else {
      raw = raw
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'");
    }
    raw = raw.replace(/\u00a0/g, " ").replace(/\u2011/g, "-");
    if (raw === prev) break;
  }
  return raw.replace(/\s+/g, " ").trim();
}

function resolveNewsSourceLink(
  item: DailyNewsHighlight,
  brief: DailyNewsBrief | null,
  it: boolean,
): { href: string; label: string; kind: "source" | "search" } {
  const direct = firstHttpUrl(
    brief?.source_url,
    item.resolved_link,
    item.link,
    item.summary,
    item.title,
    item.market_access_notes,
  );
  if (direct) {
    return { href: direct, label: direct, kind: "source" };
  }
  const q = [item.ticker, item.title || brief?.title]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" ");
  const href = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return {
    href,
    label: it ? "Cerca articolo sul web →" : "Search article on the web →",
    kind: "search",
  };
}

function itemThermoAbs(item: DailyNewsHighlight): number {
  const parts = [
    item.clinical_score,
    item.financial_score,
    item.market_access_score,
    item.corporate_score,
  ].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!parts.length) return -1;
  return Math.max(...parts.map((x) => Math.abs(x)));
}

/** Rest headlines: strongest |Clin/Fin/Acc| first (no EIS sum). */
function sortHeadlinesByEisAbs(items: DailyNewsHighlight[]): DailyNewsHighlight[] {
  return items.slice().sort((a, b) => itemThermoAbs(b) - itemThermoAbs(a));
}

type MigrateQueueBucket = "top" | "rest" | "manual";

type MigrateQueueRow = {
  key: string;
  bucket: MigrateQueueBucket;
  item: DailyNewsHighlight;
};

function bucketLabel(bucket: MigrateQueueBucket, it: boolean): string {
  if (bucket === "top") return it ? "Top" : "Top";
  if (bucket === "manual") return it ? "Manuale" : "Manual";
  return it ? "Resto" : "Rest";
}

function newsRowKey(item: {
  id?: string;
  link?: string;
  title?: string;
  summary_10w?: string;
}): string {
  return String(
    item.id || item.link || item.title || item.summary_10w || "",
  ).trim();
}

const ACTION_PILL =
  "inline-flex h-7 min-w-[1.85rem] shrink-0 items-center justify-center gap-0.5 rounded-md px-2 text-[10px] font-bold leading-none tabular-nums border shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]";
const SCORE_PILL_POS = `${ACTION_PILL} border-[#34D399]/55 bg-gradient-to-b from-[#6EE7B7] to-[#0B8F62] text-[#052e1c]`;
const SCORE_PILL_NEG = `${ACTION_PILL} border-[#F87185]/55 bg-gradient-to-b from-[#FDA4AF] to-[#BE123C] text-white`;
const SCORE_PILL_NEU = `${ACTION_PILL} border-white/20 bg-gradient-to-b from-[#C5CDDC] to-[#5B6580] text-[#0B0D17]`;
const MIG_PILL = `${ACTION_PILL} border-[#C4841A]/70 bg-gradient-to-b from-[#F6D56B] via-[#F3C451] to-[#E07A1A] text-[#0B0D17] hover:brightness-110 disabled:opacity-40`;
const DISMISS_PILL = `${ACTION_PILL} border-[#BE123C]/70 bg-gradient-to-b from-[#FDA4AF] via-[#F87185] to-[#BE123C] text-white hover:brightness-110`;

function NewsRow({
  item,
  it,
  compact,
  featured,
  liveScores,
  migrateBusy,
  migratingThis,
  onOpen,
  onMigrate,
  onDismiss,
}: {
  item: DailyNewsHighlight;
  it: boolean;
  compact?: boolean;
  /** Lead / top story styling */
  featured?: boolean;
  liveScores?: {
    clinical: number | null;
    financial: number | null;
    access: number | null;
  } | null;
  migrateBusy?: boolean;
  migratingThis?: boolean;
  onOpen: (item: DailyNewsHighlight) => void;
  onMigrate: (item: DailyNewsHighlight) => void;
  onDismiss: (item: DailyNewsHighlight) => void;
}) {
  const title = decodeHtmlEntities((item.title || "").trim() || "—");
  const href = (item.link || "").trim();
  const badge = sourceBadge(item, it);
  const tip = [item.summary, href].filter(Boolean).join("\n");
  const pubLabel = fmtPublishedDate(itemPublishedAt(item), it);
  const canMigrate = Boolean(String(item.id || "").trim()) && !item.migrated_to_eis;
  const isFdaBriefing = isFdaBriefingItem(item);
  const isOutcome =
    !isFdaBriefing &&
    (String(item.source_kind || "").toLowerCase() === "catalyst_outcome" ||
      /catalyst\s*outcome/i.test(String(item.source_label || "")));
  return (
    <div
      className={`group relative flex items-center gap-2 rounded-lg border px-2 py-1.5 pl-8 ${
        isFdaBriefing
          ? FDA_BRIEFING_ROW
          : isOutcome
            ? "border-[#34D399]/55 bg-gradient-to-r from-[#0B8F62]/25 via-[#121729] to-[#2F6BFF]/30 shadow-[inset_0_0_0_1px_rgba(243,196,81,0.35)]"
            : featured
              ? "border-[rgb(var(--warn))]/40 bg-white/[0.02]"
              : "border-white/[0.08] bg-transparent"
      }`}
    >
      <button
        type="button"
        aria-label={it ? "Elimina questa news" : "Delete this news"}
        title={it ? "Elimina (non migrare)" : "Delete (do not migrate)"}
        className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-ink-muted hover:bg-rose-500/15 hover:text-rose-500"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(item);
        }}
      >
        ×
      </button>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
        title={
          tip ||
          (it ? "Apri riassunto dettagliato" : "Open detailed summary")
        }
      >
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide ${
            isFdaBriefing
              ? FDA_BRIEFING_TICKER
              : isOutcome
                ? "bg-gradient-to-b from-[#F6D56B] to-[#E07A1A] text-[#0B0D17]"
                : featured
                  ? "bg-[#d97706] text-white"
                  : "bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))]"
          }`}
          style={isFdaBriefing ? FDA_BRIEFING_STYLE : undefined}
        >
          {isFdaBriefing || isOutcome
            ? `★ ${item.ticker || "—"}`
            : item.ticker || "—"}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[11px] font-semibold text-ink leading-snug break-words ${
              compact && !featured ? "line-clamp-2" : featured ? "" : "line-clamp-3"
            }`}
            title={tip || title}
          >
            {isFdaBriefing ? (
              <span className="mr-1" style={{ color: FDA_BRIEFING_BLUE }} aria-hidden>
                ★
              </span>
            ) : isOutcome ? (
              <span className="mr-1 text-[#F3C451]" aria-hidden>
                ★
              </span>
            ) : null}
            {title}
          </p>
          <p className="text-[9px] text-ink-muted mt-0.5 tabular-nums">
            {[
              isFdaBriefing ? (
                <span
                  key="fda-badge"
                  className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] ${FDA_BRIEFING_BADGE}`}
                  style={FDA_BRIEFING_STYLE}
                >
                  <span aria-hidden style={{ color: FDA_BRIEFING_BLUE }}>
                    ★
                  </span>
                  {it ? "Briefing FDA" : "FDA Briefing"}
                </span>
              ) : isOutcome ? (
                it ? "Esito catalyst" : "Catalyst outcome"
              ) : null,
              pubLabel
                ? it
                  ? `Pubblicato ${pubLabel}`
                  : `Published ${pubLabel}`
                : null,
              isFdaBriefing ? null : badge,
            ]
              .filter(Boolean)
              .map((x, i) =>
                typeof x === "string" ? (
                  <span key={`${i}-${x.slice(0, 12)}`}>{i > 0 ? ` · ${x}` : x}</span>
                ) : (
                  <span key={`node-${i}`} className={i > 0 ? "ml-1.5" : undefined}>
                    {x}
                  </span>
                ),
              )}
          </p>
        </div>
      </button>
      <div className="flex h-7 shrink-0 items-center gap-1 self-center">
        <RelevantScoreChips
          clinical={item.clinical_score}
          financial={item.financial_score}
          access={item.market_access_score}
          accessNotes={item.market_access_notes}
          taxonomy={item.taxonomy_dimensions}
          it={it}
          compact
          liveScores={liveScores}
        />
      <button
        type="button"
        disabled={migrateBusy || !canMigrate}
        aria-label={it ? "Migra questa news → EIS" : "Migrate this news → EIS"}
        title={
          !canMigrate
            ? it
              ? "Id mancante — usa Coda / Migrate"
              : "Missing id — use Queue / Migrate"
            : it
              ? "Migra solo questa riga → EIS Deep Dive"
              : "Migrate only this row → Deep Dive EIS"
        }
        className={MIG_PILL}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMigrate(item);
        }}
      >
        {migratingThis ? "…" : it ? "Migra" : "Mig"}
      </button>
      </div>
    </div>
  );
}

function MigrateQueueModal({
  open,
  rows,
  it,
  busy,
  migratingId,
  message,
  onClose,
  onDismiss,
  onMigrateOne,
  onConfirm,
}: {
  open: boolean;
  rows: MigrateQueueRow[];
  it: boolean;
  busy: boolean;
  migratingId: string | null;
  message: string | null;
  onClose: () => void;
  onDismiss: (item: DailyNewsHighlight) => void;
  onMigrateOne: (item: DailyNewsHighlight) => void;
  onConfirm: () => void;
}) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={it ? "Coda migrazione EIS" : "EIS migrate queue"}
      panelClassName="w-[min(96vw,52rem)]"
    >
      <div className="card w-full max-h-[88vh] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-bold text-ink">
              {it ? "Anteprima migrazione → EIS" : "Migrate preview → EIS"}
            </h3>
            <p className="text-[11px] text-ink-muted leading-snug">
              {it
                ? `${rows.length} news in coda. Controlla titoli e score; migra una riga o conferma tutte.`
                : `${rows.length} news queued. Review titles and scores; migrate one row or confirm all.`}
            </p>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </header>

        <div className="px-3 py-2 overflow-y-auto flex-1 min-h-0">
          {rows.length === 0 ? (
            <p className="text-[12px] text-ink-muted px-1 py-6 text-center">
              {it ? "Nessuna news in coda." : "No news in the queue."}
            </p>
          ) : (
            <ul className="divide-y divide-[rgb(var(--border))]/35">
              {rows.map((row) => {
                const { item, bucket } = row;
                const title = decodeHtmlEntities((item.title || "").trim() || "—");
                const href =
                  firstHttpUrl(item.resolved_link, item.link, item.summary, item.title) ||
                  `https://www.google.com/search?q=${encodeURIComponent(
                    [item.ticker, title].filter(Boolean).join(" "),
                  )}`;
                const rowId = String(item.id || "").trim();
                const rowBusy =
                  busy || (migratingId != null && migratingId === rowId);
                return (
                  <li
                    key={row.key}
                    className="flex items-start gap-2 px-1.5 py-2.5 hover:bg-[rgb(var(--surface-3))]/25"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-[rgb(var(--surface-3))]/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                          {bucketLabel(bucket, it)}
                        </span>
                        <span className="font-bold text-[12px] text-[rgb(var(--accent))] tabular-nums">
                          {item.ticker || "—"}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] ${
                            isFdaBriefingItem(item)
                              ? FDA_BRIEFING_BADGE
                              : "border border-[rgb(var(--border))]/55 text-ink-muted font-bold uppercase tracking-wide"
                          }`}
                          style={isFdaBriefingItem(item) ? FDA_BRIEFING_STYLE : undefined}
                        >
                          {isFdaBriefingItem(item) ? (
                            <span aria-hidden style={{ color: FDA_BRIEFING_BLUE }}>
                              ★
                            </span>
                          ) : null}
                          {sourceBadge(item, it)}
                        </span>
                      </div>
                      <p className="text-[12px] text-ink leading-snug break-words">
                        {title}
                      </p>
                      {href ? (
                        <button
                          type="button"
                          className="inline-flex max-w-full items-center gap-1 text-[11px] font-medium text-[rgb(var(--accent))] hover:underline"
                          title={href}
                          onClick={(e) => openExternalUrl(href, e)}
                        >
                          <span className="truncate">{href}</span>
                          <span className="shrink-0 opacity-70">↗</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-ink-muted">
                          {it ? "Nessun link" : "No link"}
                        </span>
                      )}
                      <RelevantScoreChips
                        clinical={item.clinical_score}
                        financial={item.financial_score}
                        access={item.market_access_score}
                        accessNotes={item.market_access_notes}
                        taxonomy={item.taxonomy_dimensions}
                        it={it}
                      />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        disabled={busy || !rowId}
                        aria-label={it ? "Migra solo questa" : "Migrate this only"}
                        title={
                          it
                            ? "Migra solo questa riga → EIS"
                            : "Migrate only this row → EIS"
                        }
                        className={`${MIG_PILL} px-2 py-1 text-[11px]`}
                        onClick={() => onMigrateOne(item)}
                      >
                        {rowBusy && migratingId === rowId
                          ? "…"
                          : it
                            ? "Migra"
                            : "Migrate"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={it ? "Elimina dalla coda" : "Remove from queue"}
                        title={it ? "Elimina dalla coda (non migrare)" : "Remove from queue (do not migrate)"}
                        className={`${DISMISS_PILL} px-2 py-1 text-[11px] font-semibold disabled:opacity-50`}
                        onClick={() => onDismiss(item)}
                      >
                        {it ? "Elimina" : "Remove"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-[rgb(var(--border))]/50 shrink-0 bg-[rgb(var(--surface-elevated))]">
          {message ? (
            <p className="text-[11px] text-ink-muted flex-1 min-w-[12rem]">{message}</p>
          ) : (
            <p className="text-[11px] text-ink-muted flex-1 min-w-[12rem]">
              {it
                ? "La conferma scrive le news rimanenti nelle schede Deep Dive EIS."
                : "Confirm writes remaining news into Deep Dive EIS cards."}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-[rgb(var(--surface-3))]/50 disabled:opacity-50"
          >
            {it ? "Annulla" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={busy || rows.length === 0}
            onClick={onConfirm}
            className={`${MIG_PILL} px-3 py-1.5 text-[11px] disabled:opacity-50`}
          >
            {busy && !migratingId
              ? it
                ? "Migrazione…"
                : "Migrating…"
              : it
                ? `Conferma migrazione (${rows.length})`
                : `Confirm migrate (${rows.length})`}
          </button>
        </footer>
      </div>
    </AppModal>
  );
}

/** Short labels for the Keywords block (raw digest questions are too verbose). */
function digestAnswerLabel(
  a: { id?: string; question_it?: string; question_en?: string },
  it: boolean,
): string {
  const id = String(a.id || "");
  const short: Record<string, [string, string]> = {
    news_event_type: ["Tipo news", "News type"],
    bullet_points: ["Punti chiave", "Key points"],
    products_assets: ["Prodotti / asset", "Products / assets"],
    clinical_status: ["Status clinico", "Clinical status"],
    hard_numbers: ["Cifre chiave", "Key figures"],
    deal_economics: ["Deal", "Deal"],
  };
  const hit = short[id];
  if (hit) return it ? hit[0] : hit[1];
  return (it ? a.question_it || a.question_en : a.question_en) || id;
}

/** Fin-axis block: how much paid, for what, objectives, milestones. */
function DealFinancialTermsSection({
  terms,
  it,
}: {
  terms: NonNullable<DailyNewsBrief["deal_terms"]>;
  it: boolean;
}) {
  const rows: Array<{ label: string; value: string }> = [];
  const paid = String(terms.paid || "").trim();
  const forWhat = String(terms.for_what || "").trim();
  const objectives = String(terms.objectives || "").trim();
  const milestones = String(terms.milestones || "").trim();
  if (paid)
    rows.push({
      label: it ? "Pagato / corrispettivo" : "Paid / consideration",
      value: paid,
    });
  if (forWhat) rows.push({ label: it ? "Per fare cosa" : "For what", value: forWhat });
  if (objectives) rows.push({ label: it ? "Objective" : "Objectives", value: objectives });
  if (milestones)
    rows.push({
      label: it ? "Milestone / timing" : "Milestones / timing",
      value: milestones,
    });
  if (!rows.length && terms.summary) {
    rows.push({
      label: it ? "Economia del deal" : "Deal economics",
      value: String(terms.summary),
    });
  }
  if (!rows.length) return null;
  const dtype = String(terms.deal_type || "").trim();
  return (
    <section className="space-y-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
        {it ? "Fin — termini del deal" : "Fin — deal terms"}
        {dtype ? ` · ${dtype}` : ""}
      </h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 text-[12px] leading-snug">
        {rows.map((r) => (
          <Fragment key={r.label}>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">{r.label}</dt>
            <dd className="text-ink min-w-0 break-words whitespace-pre-wrap">
              {decodeHtmlEntities(r.value)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/** Article body sections renamed to Introduction / Results / Events / Conclusion. */
function sectionHeadingLabel(heading: string | undefined): string {
  const raw = (heading || "").trim();
  if (/introduction|introduzione|background|purpose|overview/i.test(raw))
    return "Introduction";
  if (/result|risultat|event|statistic|efficac|safety/i.test(raw)) return "Results";
  if (/discussion|discussione/i.test(raw)) return "Discussion";
  if (/conclusion|conclusioni|benefit[- ]risk|panel question/i.test(raw))
    return "Conclusions";
  return raw;
}

function NewsBriefModal({
  item,
  brief: briefRaw,
  busy,
  error,
  it,
  simRows,
  onClose,
  onThermoScoresChange,
}: {
  item: DailyNewsHighlight | null;
  brief: DailyNewsBrief | null;
  busy: boolean;
  error: string | null;
  it: boolean;
  simRows?: Array<Record<string, unknown>> | null;
  onClose: () => void;
  /** Keep header chips + list row in sync when user sets a thermometer score. */
  onThermoScoresChange?: (scores: {
    clinical: number | null;
    financial: number | null;
    access: number | null;
  }) => void;
}) {
  const open = Boolean(item);
  const brief = briefRaw ? dedupeBriefForDisplay(briefRaw) : null;
  const title = decodeHtmlEntities((brief?.title || item?.title || "").trim() || "—");
  const ticker = (brief?.ticker || item?.ticker || "").trim();
  const badge = item ? sourceBadge(item, it) : "News";
  const sourceLink = item ? resolveNewsSourceLink(item, brief, it) : null;
  const newsKind = String(brief?.news_kind || "").toLowerCase();
  const taxonomy =
    (brief?.taxonomy_dimensions as DailyNewsHighlight["taxonomy_dimensions"]) ||
    item?.taxonomy_dimensions ||
    null;
  const articleKey =
    String(item?.id || item?.link || item?.title || "").trim() || null;

  const [liveScores, setLiveScores] = useState<{
    clinical: number | null;
    financial: number | null;
    access: number | null;
  } | null>(null);

  useEffect(() => {
    setLiveScores(null);
  }, [articleKey]);

  const handleThermoScores = useCallback(
    (s: ThermometerArticleScore) => {
      // Keep null when an axis has no taxonomy hit — never coerce to 0
      // (that wiped FDA / brief clinical scores on open).
      const next = {
        clinical:
          s.clinical.score == null
            ? null
            : Math.round(s.clinical.score * 100) / 100,
        financial:
          s.financial.score == null
            ? null
            : Math.round(s.financial.score * 100) / 100,
        access:
          s.market_access.score == null
            ? null
            : Math.round(s.market_access.score * 100) / 100,
      };
      setLiveScores(next);
      onThermoScoresChange?.(next);
    },
    [onThermoScoresChange],
  );

  const keyResultsHeading =
    newsKind === "ma"
      ? it
        ? "Economia e asset del deal"
        : "Deal economics & asset"
      : newsKind === "financial"
        ? it
          ? "Dettagli finanziari"
          : "Financial details"
        : newsKind === "litigation"
          ? it
            ? "Avviso legale / azionisti"
            : "Legal / shareholder alert"
          : it
            ? "Risultati chiave"
            : "Key trial results";

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={title}
      panelClassName="w-[min(94vw,40rem)]"
    >
      {item ? (
        <div className="card w-full max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
          <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
            <div className="min-w-0 space-y-1.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {ticker ? (
                  <span
                    className={`font-bold text-sm ${
                      item && isFdaBriefingItem(item)
                        ? "text-[#1D4ED8]"
                        : "text-[rgb(var(--accent))]"
                    }`}
                  >
                    {ticker}
                  </span>
                ) : null}
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[8px] ${
                    item && isFdaBriefingItem(item)
                      ? FDA_BRIEFING_BADGE
                      : badge === "8-K"
                        ? "border border-violet-500/40 text-violet-800 dark:text-violet-200 bg-violet-500/10 font-bold uppercase tracking-wide"
                        : "border border-[rgb(var(--border))]/60 text-ink-muted bg-[rgb(var(--surface-3))]/60 font-bold uppercase tracking-wide"
                  }`}
                  style={item && isFdaBriefingItem(item) ? FDA_BRIEFING_STYLE : undefined}
                >
                  {item && isFdaBriefingItem(item) ? (
                    <span aria-hidden style={{ color: FDA_BRIEFING_BLUE }}>
                      ★
                    </span>
                  ) : null}
                  {badge}
                </span>
                {newsKind && newsKind !== "other" ? (
                  <span className="rounded border border-[rgb(var(--border))]/55 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-ink-muted">
                    {newsKind === "ma"
                      ? "M&A"
                      : newsKind === "clinical"
                        ? it
                          ? "Clinico"
                          : "Clinical"
                        : newsKind === "litigation"
                          ? it
                            ? "Legale"
                            : "Legal"
                          : it
                            ? "Finanziario"
                            : "Financial"}
                  </span>
                ) : null}
                <span className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                  {it ? "Riassunto news" : "News brief"}
                </span>
                {fmtPublishedDate(itemPublishedAt(item), it) ? (
                  <span className="text-[10px] tabular-nums text-ink-muted">
                    {it ? "Pubblicato" : "Published"}{" "}
                    {fmtPublishedDate(itemPublishedAt(item), it)}
                  </span>
                ) : null}
              </div>
              <h3 className="text-sm font-bold text-ink break-words whitespace-normal">
                {title}
              </h3>
              <RelevantScoreChips
                clinical={
                  typeof brief?.clinical_score === "number"
                    ? brief.clinical_score
                    : item.clinical_score
                }
                financial={
                  typeof brief?.financial_score === "number"
                    ? brief.financial_score
                    : item.financial_score
                }
                access={
                  typeof brief?.market_access_score === "number"
                    ? brief.market_access_score
                    : item.market_access_score
                }
                accessNotes={item.market_access_notes}
                taxonomy={taxonomy}
                it={it}
                forceAll
                liveScores={liveScores}
              />
              <EisThermometerPanel
                taxonomy={taxonomy}
                articleKey={articleKey}
                it={it}
                forceShow
                className="mt-1.5"
                onScoresChange={handleThermoScores}
              />
              {sourceLink ? (
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[rgb(var(--accent))]/40 bg-[rgb(var(--accent))]/10 px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/16"
                  title={sourceLink.href}
                  onClick={(e) => openExternalUrl(sourceLink.href, e)}
                >
                  <span className="truncate">
                    {sourceLink.kind === "source"
                      ? sourceLink.label
                      : sourceLink.label}
                  </span>
                  {sourceLink.kind === "source" ? (
                    <span className="shrink-0 text-[10px] opacity-80">↗</span>
                  ) : null}
                </button>
              ) : null}
            </div>
            <AppModalCloseButton onClose={onClose} />
          </header>

          <div className="px-4 py-3 overflow-y-auto text-[12px] text-ink leading-snug space-y-3">
            {busy ? (
              <p className="text-ink-muted">
                {it
                  ? "Sto leggendo l’articolo e preparando il riassunto…"
                  : "Reading the article and preparing the brief…"}
              </p>
            ) : null}
            {error ? (
              <p className="text-[rgb(var(--signal-down))]">{error}</p>
            ) : null}
            {!busy && (brief || ticker) ? (
              <>
                <NewsCompanyProductDebrief
                  ticker={ticker}
                  title={item.title || brief?.headline || null}
                  companyHint={item.company || null}
                  productHint={brief?.product || item.product || null}
                  indicationHint={brief?.indication || null}
                  phaseHint={brief?.phase || null}
                  companySummary={brief?.company_summary || null}
                  productInset={brief?.product_inset || null}
                  simRows={simRows}
                  it={it}
                />
                {brief ? (
                <>
                {brief.detail_summary ? (
                  <section className="space-y-1">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {item && isFdaBriefingItem(item)
                        ? it
                          ? "Executive Summary"
                          : "Executive Summary"
                        : it
                          ? "Riassunto articolo"
                          : "Article summary"}
                    </h4>
                    <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap break-words">
                      {decodeHtmlEntities(brief.detail_summary)}
                    </p>
                  </section>
                ) : null}
                {brief.deal_terms ? (
                  <DealFinancialTermsSection terms={brief.deal_terms} it={it} />
                ) : null}
                {item &&
                isFdaBriefingItem(item) &&
                brief.panel_qa &&
                brief.panel_qa.length > 0 ? (
                  <section className="space-y-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {it ? "Digest panel (Q&A)" : "Panel digest (Q&A)"}
                    </h4>
                    <ol className="space-y-2 list-none">
                      {brief.panel_qa.map((qa, i) => {
                        const q = String(qa.question || "").trim();
                        const a = String(qa.answer || "").trim();
                        if (!a) return null;
                        return (
                          <li
                            key={qa.id || `qa-${i}`}
                            className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/35 px-2.5 py-2"
                          >
                            <div className="text-[11px] font-semibold text-ink leading-snug">
                              <span className="text-ink-muted tabular-nums mr-1">
                                {i + 1}.
                              </span>
                              {q
                                ? decodeHtmlEntities(q)
                                : it
                                  ? `Domanda ${i + 1}`
                                  : `Question ${i + 1}`}
                            </div>
                            <p className="text-[12px] text-ink mt-1.5 leading-relaxed whitespace-pre-wrap break-words">
                              {decodeHtmlEntities(a)}
                            </p>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ) : null}
                {(brief.digest_answers && brief.digest_answers.length > 0) &&
                  !(
                    brief.skip_page_check ||
                    brief.digest_method === "sec_8k_items" ||
                    brief.digest_method === "sec_8k_gemini" ||
                    brief.digest_method === "ai_8k" ||
                    brief.digest_method === "heuristic_8k" ||
                    brief.taxonomy_method === "ai_8k" ||
                    brief.taxonomy_method === "heuristic_8k" ||
                    (brief.item_summaries && brief.item_summaries.length > 0)
                  ) && (
                  <section className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      Keywords
                    </h4>
                    {brief.digest_answers && brief.digest_answers.length > 0 ? (
                      <ul className="space-y-1.5 mt-1">
                        {brief.digest_answers
                          .filter((a) =>
                            [
                              "bullet_points",
                              "news_event_type",
                              "products_assets",
                              "clinical_status",
                              "hard_numbers",
                              "deal_economics",
                            ].includes(String(a.id || "")),
                          )
                          .filter((a) => a.present && a.answer != null && a.answer !== "")
                          .filter((a) => {
                            // Drop takeaway when it only echoes headline + bullets.
                            if (String(a.id || "") !== "investor_takeaway") return true;
                            const take = String(a.answer || "").toLowerCase();
                            if (!take) return false;
                            if (/\bkey points:\s*/i.test(String(a.answer || ""))) return false;
                            const head = brief.digest_answers?.find(
                              (x) => x.id === "headline",
                            );
                            const headS = String(head?.answer || "").toLowerCase();
                            if (
                              headS.length >= 30 &&
                              take.startsWith(headS.slice(0, Math.min(50, headS.length)))
                            ) {
                              return false;
                            }
                            return true;
                          })
                          .map((a) => {
                            const label = digestAnswerLabel(a, it);
                            const isHardNumbers = String(a.id || "") === "hard_numbers";
                            const answerItems = Array.isArray(a.answer)
                              ? a.answer
                                  .map((x) =>
                                    typeof x === "string"
                                      ? x
                                      : JSON.stringify(x),
                                  )
                                  .map((x) => x.trim())
                                  .filter((x) => x.length > 0)
                                  .filter(
                                    (x) =>
                                      !/\b24h\s*move\b/i.test(x) &&
                                      !/topping the session|dramatic moves|broadly bullish|while .{2,40}\([A-Z]{1,5}\)|(?:rising|climbed|shed|fell)\s+\d+/i.test(
                                        x,
                                      ) &&
                                      (isHardNumbers || !/^[a-z]/.test(x)),
                                  )
                              : null;
                            let val =
                              answerItems != null
                                ? answerItems.join(" · ")
                                : typeof a.answer === "object"
                                  ? JSON.stringify(a.answer)
                                  : String(a.answer);
                            if (String(a.id || "") === "news_event_type") {
                              const raw = String(a.answer || "").trim();
                              const key = raw
                                .toLowerCase()
                                .replace(/&/g, "and")
                                .replace(/[\s/-]+/g, "_");
                              if (
                                key === "ma" ||
                                key === "closed_ma" ||
                                key === "m_and_a" ||
                                key === "manda"
                              ) {
                                val = it ? "M&A chiuso" : "closed M&A";
                              } else if (
                                key === "speculative_ma" ||
                                key === "speculative" ||
                                (key.includes("speculative") && key.includes("ma"))
                              ) {
                                val = it ? "M&A speculativo" : "speculative M&A";
                              } else if (key === "financial" || key === "financing") {
                                val = it ? "financing" : "financing";
                              } else if (
                                key === "partnership" ||
                                key === "collaboration" ||
                                key === "strategic_alliance"
                              ) {
                                val = it ? "partnership" : "partnership";
                              } else if (key === "licensing" || key === "license") {
                                val = it ? "licensing" : "licensing";
                              } else if (key === "clinical" || key === "clinico") {
                                val = it ? "clinico" : "clinical";
                              } else if (key === "other" || key === "altro") {
                                val = it ? "altro" : "other";
                              } else if (
                                key === "litigation" ||
                                key === "lawsuit" ||
                                key === "shareholder_alert" ||
                                key.includes("shareholder") ||
                                key.includes("class_action")
                              ) {
                                val = it
                                  ? "avviso azionisti / class action"
                                  : "shareholder alert";
                              } else if (/^closed\b/i.test(raw) && /m\s*&?\s*a/i.test(raw)) {
                                val = it ? "M&A chiuso" : "closed M&A";
                              }
                            }
                            if (isHardNumbers && (!answerItems || answerItems.length === 0)) {
                              return null;
                            }
                            if (!isHardNumbers && !val.trim()) return null;
                            return (
                              <li
                                key={a.id}
                                className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/30 px-2.5 py-1.5"
                              >
                                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                                  {label}
                                </div>
                                {isHardNumbers && answerItems && answerItems.length > 0 ? (
                                  <ul className="mt-0.5 space-y-0.5 text-[11px] text-ink leading-snug">
                                    {answerItems.map((line, i) => (
                                      <li key={`${a.id}-${i}`} className="flex gap-1.5">
                                        <span className="text-ink-muted shrink-0">•</span>
                                        <span className="break-words">
                                          {decodeHtmlEntities(line)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-[11px] text-ink mt-0.5 whitespace-pre-wrap break-words leading-snug">
                                    {decodeHtmlEntities(val)}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                      </ul>
                    ) : null}
                  </section>
                )}

                {brief?.item_summaries && brief.item_summaries.length > 0 ? (
                  <section className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {it ? "Voci 8-K (Item)" : "8-K Items"}
                    </h4>
                    <ul className="space-y-1.5">
                      {brief.item_summaries.map((itBlock, i) => (
                        <li
                          key={`${itBlock.item || i}-${(itBlock.title || "").slice(0, 16)}`}
                          className="rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-2.5 py-1.5"
                        >
                          <div className="font-semibold text-[11px] text-violet-900 dark:text-violet-100">
                            Item {decodeHtmlEntities(itBlock.item || "—")}
                            {itBlock.title
                              ? ` — ${decodeHtmlEntities(itBlock.title)}`
                              : ""}
                          </div>
                          {itBlock.summary ? (
                            <p className="text-ink mt-0.5 whitespace-pre-wrap break-words leading-snug">
                              {decodeHtmlEntities(itBlock.summary)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {brief?.abstract ? (
                  <section className="space-y-1">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      Abstract
                    </h4>
                    <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">
                      {decodeHtmlEntities(brief.abstract)}
                    </p>
                  </section>
                ) : null}

                {brief?.section_summaries &&
                brief.section_summaries.length > 0 ? (
                  <section className="space-y-1.5">
                    {brief.is_paper ||
                    brief.digest_method === "fda_briefing" ||
                    brief.section_summaries.some((s) =>
                      /introduction|conclusion|results/i.test(s.heading || ""),
                    ) ? null : (
                      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        {brief.item_summaries && brief.item_summaries.length
                          ? it
                            ? "Paragrafi 8-K"
                            : "8-K paragraphs"
                          : it
                            ? "Paragrafi dell'articolo"
                            : "Article paragraphs"}
                      </h4>
                    )}
                    <ul className="space-y-1.5">
                      {brief.section_summaries
                        .filter(
                          (sec) =>
                            !/^abstract$/i.test((sec.heading || "").trim()) &&
                            (brief.is_paper ||
                              brief.digest_method === "fda_briefing" ||
                              !/introduction|introduzione/i.test(sec.heading || "")),
                        )
                        .map((sec, i) => (
                        <li
                          key={`${i}-${(sec.heading || "").slice(0, 16)}`}
                          className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/35 px-2.5 py-1.5"
                        >
                          {sec.heading ? (
                            <div className="font-semibold text-[11px]">
                              {sectionHeadingLabel(decodeHtmlEntities(sec.heading))}
                            </div>
                          ) : null}
                          {sec.summary ? (
                            <p className="text-ink mt-0.5 whitespace-pre-wrap break-words">
                              {decodeHtmlEntities(sec.summary)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {brief?.study ? (
                  <section className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {it ? "Studio" : "Study"}
                    </h4>
                    <p className="text-[12px] text-ink">{decodeHtmlEntities(brief.study)}</p>
                  </section>
                ) : null}

                {brief.key_results &&
                brief.key_results.length > 0 &&
                !(brief.item_summaries && brief.item_summaries.length > 0) ? (
                  <section className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {keyResultsHeading}
                    </h4>
                    <ul className="space-y-1.5">
                      {brief.key_results.map((kr, i) => (
                        <li
                          key={`${i}-${(kr.label || "").slice(0, 16)}`}
                          className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/35 px-2.5 py-1.5"
                        >
                          {kr.label ? (
                            <div className="font-semibold text-[11px]">
                              {decodeHtmlEntities(kr.label)}
                            </div>
                          ) : null}
                          {kr.detail ? (
                            <p className="text-ink mt-0.5 whitespace-pre-wrap break-words">
                              {decodeHtmlEntities(kr.detail)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {brief.dates && brief.dates.length > 0 ? (
                  <section className="space-y-1.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                      {it
                        ? "Date calendario (conferenze / catalyst → migrate)"
                        : "Calendar dates (conferences / catalysts → migrate)"}
                    </h4>
                    <p className="text-[10px] text-ink-muted">
                      {it
                        ? "Queste date vengono scritte nel calendario Guidance alla migrazione EIS."
                        : "These dates are written to the Guidance calendar on EIS migrate."}
                    </p>
                    <ul className="space-y-1.5">
                      {brief.dates.map((d, i) => (
                        <li
                          key={`${d.date || ""}-${i}`}
                          className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1.5"
                        >
                          <div className="font-semibold tabular-nums text-[11px]">
                            {decodeHtmlEntities(
                              d.date ||
                                (it ? "Data non specificata" : "Date not specified"),
                            )}
                          </div>
                          {d.what_happens ? (
                            <p className="text-ink mt-0.5">
                              {decodeHtmlEntities(d.what_happens)}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {brief.results &&
                !(
                  brief.key_results &&
                  brief.key_results.length > 0 &&
                  brief.results.length < 120 &&
                  brief.key_results.some(
                    (kr) =>
                      (kr.detail || "")
                        .toLowerCase()
                        .includes(brief.results!.slice(0, 40).toLowerCase()),
                  )
                ) ? (
                  <section className="space-y-1">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {it ? "Dati / risultati" : "Data / results"}
                    </h4>
                    <p className="whitespace-pre-wrap break-words">
                      {decodeHtmlEntities(brief.results)}
                    </p>
                  </section>
                ) : null}

                {brief.key_points &&
                brief.key_points.length > 0 &&
                !(brief.key_results && brief.key_results.length > 0) ? (
                  <section className="space-y-1">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {it ? "Punti chiave" : "Key points"}
                    </h4>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {brief.key_points.map((p, i) => (
                        <li key={`${i}-${p.slice(0, 24)}`}>
                          {decodeHtmlEntities(p)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {!(item && isFdaBriefingItem(item)) ? (
                  <InvestorInsightBox text={brief.investor_insight} it={it} />
                ) : (
                  <InvestorInsightBox
                    text={brief.investor_insight}
                    it={it}
                    tone={
                      brief.fda_stance === "positive" ||
                      brief.fda_stance === "negative" ||
                      brief.fda_stance === "mixed"
                        ? brief.fda_stance
                        : typeof brief.clinical_score === "number" &&
                            brief.clinical_score <= -0.3
                          ? "negative"
                          : typeof brief.clinical_score === "number" &&
                              brief.clinical_score >= 0.3
                            ? "positive"
                            : null
                    }
                  />
                )}

                {brief.fetch_error ? (
                  <p className="text-[10px] text-ink-muted">
                    {it
                      ? `Nota: fetch pagina parziale (${brief.fetch_error}). Riassunto da titolo/snippet.`
                      : `Note: partial page fetch (${brief.fetch_error}). Brief from title/snippet.`}
                  </p>
                ) : null}
                </>
                ) : null}
              </>
            ) : null}
            {!busy && !brief && !error && !ticker ? (
              <p className="text-ink-muted">
                {it ? "Nessun dettaglio disponibile." : "No detail available."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppModal>
  );
}

function ScoreChip({
  label,
  score,
  tip,
}: {
  label: string;
  score: number | null | undefined;
  tip?: string;
}) {
  const n = typeof score === "number" && Number.isFinite(score) ? score : 0;
  const tone =
    n > 0.05 ? SCORE_PILL_POS : n < -0.05 ? SCORE_PILL_NEG : SCORE_PILL_NEU;
  return (
    <span className={tone} title={tip}>
      <span className="font-semibold opacity-90">{label}</span>
      <span>{formatThermometerScore(score)}</span>
    </span>
  );
}

function AnalysisCard({
  row,
  it,
  migrateBusy,
  migratingThis,
  onOpen,
  onMigrate,
  onDismiss,
}: {
  row: DailyNewsUserAnalysis;
  it: boolean;
  migrateBusy?: boolean;
  migratingThis?: boolean;
  onOpen: (item: DailyNewsHighlight) => void;
  onMigrate: (item: DailyNewsHighlight) => void;
  onDismiss: (item: DailyNewsHighlight) => void;
}) {
  const kind = (row.source_kind || "text").toUpperCase();
  const ref = (row.source_ref || "").trim();
  const asHighlight = analysisToHighlight(row);
  const canMigrate =
    Boolean(String(row.id || asHighlight.id || "").trim()) &&
    !row.migrated_to_eis;
  const pubLabel = fmtPublishedDate(
    itemPublishedAt({
      published_at: row.published_at,
      event_date: row.event_date,
      found_at: row.found_at,
    }),
    it,
  );
  return (
    <div className="group relative flex items-start gap-1.5 rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] px-1.5 py-1 pl-7">
      <button
        type="button"
        aria-label={it ? "Elimina questa news" : "Delete this news"}
        title={it ? "Elimina (non migrare)" : "Delete (do not migrate)"}
        className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-ink-muted hover:bg-rose-500/15 hover:text-rose-500"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(asHighlight);
        }}
      >
        ×
      </button>
      <button
        type="button"
        onClick={() => onOpen(asHighlight)}
        className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
        title={it ? "Apri riassunto dettagliato" : "Open detailed summary"}
      >
        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide bg-[rgb(var(--accent))]/20 text-[rgb(var(--purple-soft))]">
          {row.ticker || "MAN"}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[11px] font-semibold text-ink leading-snug line-clamp-2 break-words">
            {decodeHtmlEntities(row.summary_10w || "—")}
          </p>
          {(row.detail_summary || row.summary_long) &&
          (row.detail_summary || row.summary_long || "").trim() !==
            (row.summary_10w || "").trim() ? (
            <p className="text-[10px] text-ink-muted leading-snug line-clamp-2">
              {decodeHtmlEntities(row.detail_summary || row.summary_long || "")}
            </p>
          ) : null}
          <p className="text-[9px] text-ink-muted tabular-nums">
            {[
              pubLabel
                ? it
                  ? `Pubblicato ${pubLabel}`
                  : `Published ${pubLabel}`
                : null,
              kind,
              row.news_kind || null,
              row.product || null,
              row.phase || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </button>
      <div className="flex h-7 shrink-0 items-center gap-1 self-center">
        <RelevantScoreChips
          clinical={row.clinical_score}
          financial={row.financial_score}
          access={row.market_access_score}
          accessNotes={row.market_access_notes}
          taxonomy={row.taxonomy_dimensions}
          it={it}
          compact
        />
      <button
        type="button"
        disabled={migrateBusy || !canMigrate}
        aria-label={it ? "Migra questa news → EIS" : "Migrate this news → EIS"}
        title={
          !canMigrate
            ? it
              ? "Id mancante — usa Coda / Migrate"
              : "Missing id — use Queue / Migrate"
            : it
              ? "Migra solo questa riga → EIS Deep Dive"
              : "Migrate only this row → Deep Dive EIS"
        }
        className={MIG_PILL}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMigrate(asHighlight);
        }}
      >
        {migratingThis ? "…" : it ? "Migra" : "Mig"}
      </button>
      </div>
      {ref && ref.startsWith("http") ? (
        <span className="sr-only">{ref}</span>
      ) : null}
    </div>
  );
}

export const CatalystDailyNewsBox = forwardRef<
  CatalystDailyNewsBoxHandle,
  {
    simRows?: Array<Record<string, unknown>> | null;
    className?: string;
    /** Ticker/company add form — sits under Top News on the left. */
    aboveOtherSlot?: ReactNode;
  }
>(function CatalystDailyNewsBox({
  simRows,
  className = "",
  aboveOtherSlot,
}, ref) {
    const { lang } = useLang();
    const it = lang === "it";
    const [data, setData] = useState<DailyNewsPayload | null>(null);
    const [topBusy, setTopBusy] = useState(false);
    const [starVersion, setStarVersion] = useState(() => getAttentionStarsVersion());
    const [priorityMeta, setPriorityMeta] = useState(() => dailyNewsPriorityTickers());
    const [pasteText, setPasteText] = useState("");
    const [pasteUrl, setPasteUrl] = useState("");
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [manualComposeOpen, setManualComposeOpen] = useState(false);
    const [analyzeBusy, setAnalyzeBusy] = useState(false);
    const [analyzeErr, setAnalyzeErr] = useState<string | null>(null);
    const [migrateBusy, setMigrateBusy] = useState(false);
    const [migratingId, setMigratingId] = useState<string | null>(null);
    const [migrateMsg, setMigrateMsg] = useState<string | null>(null);
    const [queueOpen, setQueueOpen] = useState(false);
    const [briefItem, setBriefItem] = useState<DailyNewsHighlight | null>(null);
    const [briefData, setBriefData] = useState<DailyNewsBrief | null>(null);
    const [briefBusy, setBriefBusy] = useState(false);
    const [briefErr, setBriefErr] = useState<string | null>(null);
    const [thermoLiveByKey, setThermoLiveByKey] = useState<
      Record<
        string,
        { clinical: number | null; financial: number | null; access: number | null }
      >
    >({});
    const briefReqRef = useRef(0);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const syncPriority = useCallback(() => {
      setStarVersion(getAttentionStarsVersion());
      setPriorityMeta(dailyNewsPriorityTickers());
    }, []);

    const onThermoScoresChange = useCallback(
      (scores: {
        clinical: number | null;
        financial: number | null;
        access: number | null;
      }) => {
        const key = briefItem ? newsRowKey(briefItem) : "";
        if (!key) return;
        setThermoLiveByKey((prev) => {
          const cur = prev[key];
          if (
            cur &&
            cur.clinical === scores.clinical &&
            cur.financial === scores.financial &&
            cur.access === scores.access
          ) {
            return prev;
          }
          return { ...prev, [key]: scores };
        });
      },
      [briefItem],
    );

    const openNewsBrief = useCallback(
      async (item: DailyNewsHighlight) => {
        const reqId = ++briefReqRef.current;
        setBriefItem(item);
        setBriefErr(null);
        if (item.cached_brief) {
          rememberPrefetchedDailyNewsBrief(item, item.cached_brief);
        }
        const warm = peekPrefetchedDailyNewsBrief(item);
        if (warm) {
          setBriefData(warm);
          setBriefBusy(false);
        } else {
          setBriefData(null);
          setBriefBusy(true);
        }
        try {
          const brief = await prefetchDailyNewsBrief(item);
          if (reqId !== briefReqRef.current) return;
          if (brief) {
            setBriefData(brief);
            rememberPrefetchedDailyNewsBrief(item, brief);
            const patch = scoresFromBrief(brief);
            if (Object.keys(patch).length) {
              setBriefItem((prev) => (prev ? { ...prev, ...patch } : prev));
              setData((prev) => {
                if (!prev) return prev;
                const applyH = (h: DailyNewsHighlight) =>
                  sameNewsRow(h, item) ? { ...h, ...patch } : h;
                const applyA = (a: DailyNewsUserAnalysis) => {
                  const asH = analysisToHighlight(a);
                  if (!sameNewsRow(asH, item)) return a;
                  return {
                    ...a,
                    clinical_score: patch.clinical_score ?? a.clinical_score,
                    financial_score: patch.financial_score ?? a.financial_score,
                    corporate_score: patch.corporate_score ?? a.corporate_score,
                    market_access_score:
                      patch.market_access_score ?? a.market_access_score,
                    eis_score: patch.eis_score ?? a.eis_score,
                    taxonomy_dimensions:
                      patch.taxonomy_dimensions ?? a.taxonomy_dimensions,
                    taxonomy_method: patch.taxonomy_method ?? a.taxonomy_method,
                    product: patch.product ?? a.product,
                    phase: patch.phase ?? a.phase,
                  };
                };
                return {
                  ...prev,
                  top_news: (prev.top_news ?? []).map(applyH),
                  highlights: (prev.highlights ?? []).map(applyH),
                  user_analyses: (prev.user_analyses ?? []).map(applyA),
                };
              });
            }
          } else if (!warm) {
            setBriefErr(
              it
                ? "Impossibile generare il riassunto."
                : "Could not build the brief.",
            );
          }
        } catch (e) {
          if (reqId !== briefReqRef.current) return;
          if (warm) return;
          setBriefErr(
            (() => {
              const msg =
                e instanceof Error
                  ? e.message
                  : it
                    ? "Errore di rete sul riassunto."
                    : "Network error on brief.";
              if (/failed to fetch|networkerror|load failed/i.test(msg)) {
                return it
                  ? "Connessione al server interrotta mentre scaricavo l’articolo. Riprova."
                  : "Connection lost while downloading the article. Please retry.";
              }
              if (/abort/i.test(msg)) {
                return it
                  ? "Timeout sul riassunto articolo — riprova tra qualche secondo."
                  : "Article brief timed out — try again in a moment.";
              }
              if (/missing or invalid api token|401/i.test(msg)) {
                return it
                  ? "Sessione scaduta — esci e rientra con la tua email, poi riapri la news."
                  : "Session expired — sign out/in with your email, then reopen the news.";
              }
              return msg;
            })(),
          );
        } finally {
          if (reqId === briefReqRef.current) setBriefBusy(false);
        }
      },
      [it],
    );

    const closeNewsBrief = useCallback(() => {
      briefReqRef.current += 1;
      setBriefItem(null);
      setBriefData(null);
      setBriefBusy(false);
      setBriefErr(null);
    }, []);

    const dismissNews = useCallback(
      async (item: DailyNewsHighlight) => {
        const id = String(item.id || "").trim();
        if (!id) {
          // No stable id — drop locally only
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              top_news: (prev.top_news ?? []).filter(
                (h) =>
                  !(
                    h.ticker === item.ticker &&
                    h.title === item.title &&
                    h.link === item.link
                  ),
              ),
              highlights: (prev.highlights ?? []).filter(
                (h) =>
                  !(
                    h.ticker === item.ticker &&
                    h.title === item.title &&
                    h.link === item.link
                  ),
              ),
              user_analyses: (prev.user_analyses ?? []).filter(
                (a) =>
                  !(
                    a.summary_10w === item.title &&
                    (a.ticker || "") === (item.ticker || "")
                  ),
              ),
            };
          });
          if (briefItem?.id === item.id || briefItem?.title === item.title) {
            closeNewsBrief();
          }
          return;
        }
        try {
          const snap = await dismissDailyNewsItem(id);
          setData((prev) => ({
            ...(prev ?? {}),
            ...snap,
            top_news: snap.top_news ?? prev?.top_news ?? [],
            highlights: snap.highlights ?? prev?.highlights ?? [],
            user_analyses: snap.user_analyses ?? prev?.user_analyses ?? [],
          }));
          if (briefItem?.id === id) closeNewsBrief();
        } catch {
          /* keep row if network fails */
        }
      },
      [briefItem, closeNewsBrief],
    );

    const loadTop = useCallback(
      async (force = false) => {
        const prio = dailyNewsPriorityTickers();
        setPriorityMeta(prio);
        if (!prio.tickers.length) {
          setData((prev) =>
            prev
              ? { ...prev, top_news: [], top_news_tickers: [] }
              : { top_news: [], highlights: [], count: 0, user_analyses: [] },
          );
          return;
        }
        const allowed = new Set(prio.tickers);
        setTopBusy(true);
        try {
          const snap = await fetchDailyNewsTop(prio.tickers, { force });
          const onlyPrio = (snap.top_news ?? []).filter((h) =>
            allowed.has(String(h.ticker || "").trim().toUpperCase()),
          );
          setData((prev) => {
            const deskDay = snap.rome_date ?? prev?.rome_date ?? null;
            const serverTop = (snap.top_news ?? []).filter(
              (h) =>
                allowed.has(String(h.ticker || "").trim().toUpperCase()) &&
                isSameRomeDeskDay(h, deskDay) &&
                isActiveOnDesk(h),
            );
            // Trust an empty successful payload — keeping prevTop after migrate /
            // desk clear left zombie Mig buttons that always hit id_not_found.
            const nextTop = (
              onlyPrio.length > 0 ? onlyPrio : serverTop
            ).filter((h) => isActiveOnDesk(h));
            const serverHl = Array.isArray(snap.highlights) ? snap.highlights : null;
            const nextHl =
              serverHl != null
                ? serverHl.filter((h) => isActiveOnDesk(h))
                : (prev?.highlights ?? []).filter((h) => isActiveOnDesk(h));
            return {
              ...(prev ?? {}),
              ...snap,
              highlights: nextHl,
              user_analyses:
                Array.isArray(snap.user_analyses)
                  ? snap.user_analyses.filter((a) => isActiveOnDesk(a))
                  : (prev?.user_analyses ?? []).filter((a) => isActiveOnDesk(a)),
              last_search_hour:
                snap.last_search_hour ?? prev?.last_search_hour ?? null,
              last_search_at: snap.last_search_at ?? prev?.last_search_at ?? null,
              top_news: nextTop,
              top_news_tickers: prio.tickers,
            };
          });
        } finally {
          setTopBusy(false);
        }
      },
      [],
    );

    const load = useCallback(async () => {
      const snap = await fetchDailyNews();
      const prio = dailyNewsPriorityTickers();
      setPriorityMeta(prio);
      setStarVersion(getAttentionStarsVersion());
      const allowed = new Set(prio.tickers);
      setData({
        ...snap,
        highlights: (snap.highlights ?? []).filter((h) => isActiveOnDesk(h)),
        user_analyses: (snap.user_analyses ?? []).filter((a) => isActiveOnDesk(a)),
        top_news: prio.tickers.length
          ? (snap.top_news ?? []).filter(
              (h) =>
                allowed.has(String(h.ticker || "").trim().toUpperCase()) &&
                isActiveOnDesk(h),
            )
          : [],
        top_news_tickers: prio.tickers,
      });
      void loadTop(false);
    }, [loadTop]);

    const refresh = useCallback(async () => {
      syncPriority();
      const prio = dailyNewsPriorityTickers();
      setTopBusy(true);
      try {
        const snap = await refreshDailyNews(true, prio.tickers);
        if (!prio.tickers.length) {
          setData({
            ...snap,
            top_news: [],
            top_news_tickers: [],
          });
          return;
        }
        const top = await fetchDailyNewsTop(prio.tickers, { force: true });
        const allowed = new Set(prio.tickers);
        const onlyPrio = (top.top_news ?? []).filter(
          (h) =>
            allowed.has(String(h.ticker || "").trim().toUpperCase()) &&
            isActiveOnDesk(h),
        );
        setData({
          ...snap,
          ...top,
          highlights: snap.highlights ?? top.highlights ?? [],
          user_analyses: top.user_analyses ?? snap.user_analyses ?? [],
          top_news: onlyPrio,
          top_news_tickers: prio.tickers,
        });
      } finally {
        setTopBusy(false);
      }
    }, [syncPriority]);

    useImperativeHandle(ref, () => ({ refresh }), [refresh]);

    useEffect(() => {
      void load();
      const id = window.setInterval(() => {
        void load();
      }, 5 * 60_000);
      return () => window.clearInterval(id);
    }, [load]);

    // Warm briefs as soon as desk rows appear — not on first modal open.
    const deskBriefWarmKey = useMemo(() => {
      if (!data) return "";
      const rows = [
        ...(data.top_news ?? []),
        ...(data.highlights ?? []).slice(0, 10),
        ...(data.user_analyses ?? []).slice(0, 4).map(analysisToHighlight),
      ];
      return rows
        .map((h) => String(h.id || h.title || "").trim())
        .filter(Boolean)
        .slice(0, 16)
        .join("|");
    }, [data]);

    useEffect(() => {
      if (!data || !deskBriefWarmKey) return;
      const queue = [
        ...(data.top_news ?? []),
        ...(data.highlights ?? []),
        ...(data.user_analyses ?? []).map(analysisToHighlight),
      ];
      seedPrefetchedDailyNewsBriefsFromDesk(queue);
      // Immediate parallel warm (top news first); modal open hits cache.
      return prefetchDailyNewsBriefsIdle(queue, 12, 3);
      // deskBriefWarmKey: avoid restarting when only score patches change.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    }, [deskBriefWarmKey]);

    useEffect(() => {
      const onStars = () => {
        syncPriority();
        void loadTop(true);
      };
      window.addEventListener("supernova:attention-stars-changed", onStars);
      window.addEventListener("supernova:catalyst-interest-tickers-changed", onStars);
      return () => {
        window.removeEventListener("supernova:attention-stars-changed", onStars);
        window.removeEventListener("supernova:catalyst-interest-tickers-changed", onStars);
      };
    }, [loadTop, syncPriority]);

    useEffect(() => {
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onDesk = () => {
        if (debounce != null) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = null;
          syncPriority();
          void loadTop(false);
        }, 500);
      };
      const onStorage = (e: StorageEvent) => {
        if (e.key && e.key.includes("catalystDeskColumnCache")) onDesk();
      };
      window.addEventListener(CATALYST_DESK_CACHE_CHANGED, onDesk);
      window.addEventListener("storage", onStorage);
      return () => {
        if (debounce != null) clearTimeout(debounce);
        window.removeEventListener(CATALYST_DESK_CACHE_CHANGED, onDesk);
        window.removeEventListener("storage", onStorage);
      };
    }, [loadTop, syncPriority]);

    // All staged rest-universe candidates (any score, including unscored).
    const deskDay = data?.rome_date ?? null;
    const highlightPool = (data?.highlights ?? []).filter((h) => {
      if (!h || !isActiveOnDesk(h)) return false;
      if (h.status != null && h.status !== "staged") return false;
      if (!isSameRomeDeskDay(h, deskDay)) return false;
      return Boolean((h.title || "").trim() || (h.link || "").trim());
    });
    const allowedTop = new Set(priorityMeta.tickers);
    const rawTopNews = (data?.top_news ?? []).filter((h) => {
      if (!h || !(h.link || "").trim()) return false;
      if (!isActiveOnDesk(h)) return false;
      if (!allowedTop.size) return false;
      if (!isSameRomeDeskDay(h, deskDay)) return false;
      return allowedTop.has(newsTickerOf(h));
    });
    const extrasByTicker = new Map<string, DailyNewsHighlight[]>();
    for (const h of highlightPool) {
      const tk = newsTickerOf(h);
      if (!tk || !allowedTop.has(tk)) continue;
      const arr = extrasByTicker.get(tk) ?? [];
      arr.push(h);
      extrasByTicker.set(tk, arr);
    }
    const usedTopIds = new Set<string>();
    const topNews: DailyNewsHighlight[] = [];
    for (const row of rawTopNews) {
      const best = pickBestScoredNews(row, extrasByTicker.get(newsTickerOf(row)) ?? []);
      const id = String(best.id || "").trim();
      if (id && usedTopIds.has(id)) continue;
      if (id) usedTopIds.add(id);
      topNews.push(best);
    }
    for (const tk of allowedTop) {
      if (topNews.some((h) => newsTickerOf(h) === tk)) continue;
      const extras = extrasByTicker.get(tk) ?? [];
      if (!extras.length) continue;
      extras.sort((a, b) => absNewsScore(b) - absNewsScore(a));
      const best = extras[0]!;
      const id = String(best.id || "").trim();
      if (id && usedTopIds.has(id)) continue;
      if (id) usedTopIds.add(id);
      topNews.push(best);
    }
    const topIds = new Set(
      topNews.map((h) => h.id).filter((id): id is string => Boolean(id)),
    );
    const topClusters = new Set(
      topNews
        .map((h) => String(h.story_cluster || "").trim())
        .filter(Boolean),
    );
    const restPool = highlightPool.filter((h) => {
      if (h.id && topIds.has(h.id)) return false;
      const ck = String(h.story_cluster || "").trim();
      if (ck && topClusters.has(ck)) return false;
      return true;
    });
    const restShown = sortHeadlinesByEisAbs(restPool);
    const analyses = (data?.user_analyses ?? []).filter(
      (a) =>
        isActiveOnDesk(a) &&
        isSameRomeDeskDay(
          {
            published_at: a.published_at,
            event_date: a.event_date,
            found_at: a.found_at,
          },
          deskDay,
        ),
    );
    const hourLabel =
      data?.last_search_hour != null
        ? `${String(data.last_search_hour).padStart(2, "0")}:00`
        : null;
    const lastUpdateRaw =
      data?.last_search_at || data?.updated_at || data?.top_news_updated_at || null;
    let lastUpdateLabel: string | null = null;
    if (lastUpdateRaw) {
      const d = new Date(lastUpdateRaw);
      if (!Number.isNaN(d.getTime())) {
        lastUpdateLabel = d.toLocaleString(it ? "it-IT" : "en-US", {
          timeZone: "Europe/Rome",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    const runAnalyze = async () => {
      setAnalyzeErr(null);
      if (!pasteText.trim() && !pasteUrl.trim() && !pdfFile) {
        setAnalyzeErr(
          it
            ? "Incolla testo, URL o scegli un PDF."
            : "Paste text, a URL, or choose a PDF.",
        );
        return;
      }
      setAnalyzeBusy(true);
      try {
        const snap = await analyzeDailyNewsSource({
          text: pasteText,
          url: pasteUrl,
          pdf: pdfFile,
        });
        if (snap.ok === false || (!(snap.analysis || snap.user_analyses?.length) && (snap as { error?: string }).error)) {
          const errCode = (snap as { error?: string }).error || "";
          const hint = (snap as { hint?: string }).hint;
          let err =
            errCode || (it ? "Analisi fallita" : "Analyze failed");
          if (errCode === "pdf_text_empty" || errCode === "content_too_short") {
            err =
              hint ||
              (it
                ? "PDF senza testo estraibile (scansione/immagine). Incolla l’abstract o usa un PDF testuale."
                : "Could not extract text from this PDF (scanned/image-only). Paste the abstract or use a text PDF.");
          }
          setAnalyzeErr(err);
          return;
        }
        setData((prev) => ({
          ...(prev ?? {}),
          ...snap,
          top_news: prev?.top_news ?? snap.top_news ?? [],
          highlights: snap.highlights ?? prev?.highlights ?? [],
          user_analyses: snap.user_analyses ?? prev?.user_analyses ?? [],
        }));
        setPasteText("");
        setPasteUrl("");
        setPdfFile(null);
        if (fileRef.current) fileRef.current.value = "";
        window.dispatchEvent(new Event(CLINICAL_PRE_CD_CHANGED_EVENT));
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (/missing or invalid api token/i.test(raw)) {
          setAnalyzeErr(
            it
              ? "Token API mancante — in Settings salva il SUPERNOVA_API_TOKEN del VPS, oppure riprova (route Daily News ora esentata)."
              : "API token missing — save SUPERNOVA_API_TOKEN in Settings, or retry (Daily News routes now exempt).",
          );
        } else {
          setAnalyzeErr(raw);
        }
      } finally {
        setAnalyzeBusy(false);
      }
    };

    const isPendingItem = (h: {
      migrated_to_eis?: boolean;
      dismissed?: boolean;
      status?: string | null;
    }) => isActiveOnDesk(h);

    const pendingTop = topNews.filter((h) =>
      isPendingItem(h as { migrated_to_eis?: boolean; dismissed?: boolean }),
    );
    const pendingRest = restShown.filter((h) =>
      isPendingItem(h as { migrated_to_eis?: boolean; dismissed?: boolean }),
    );
    const pendingAnalyses = analyses.filter((a) =>
      isPendingItem(a as { migrated_to_eis?: boolean; dismissed?: boolean }),
    );

    const migrateQueue: MigrateQueueRow[] = [
      ...pendingTop.map((item, i) => ({
        key: `top-${item.id || `${item.ticker}-${item.title}-${i}`}`,
        bucket: "top" as const,
        item,
      })),
      ...pendingRest.map((item, i) => ({
        key: `rest-${item.id || `${item.ticker}-${item.title}-${i}`}`,
        bucket: "rest" as const,
        item,
      })),
      ...pendingAnalyses.map((a, i) => {
        const item = analysisToHighlight(a);
        return {
          key: `manual-${a.id || `${a.source_kind}-${a.summary_10w}-${i}`}`,
          bucket: "manual" as const,
          item,
        };
      }),
    ];
    const pendingMigrate = migrateQueue.length;

    const runMigrate = async (itemId?: string) => {
      const id = String(itemId || "").trim();
      setMigrateMsg(null);
      setMigrateBusy(true);
      if (id) setMigratingId(id);
      try {
        const snap = await migrateDailyNewsToEis(id ? { id } : undefined);
        // Prefer server lists after migrate so migrated / empty queues stick
        // (keeping prev emptied the queue visually but left Migrate N forever).
        setData((prev) => ({
          ...(prev ?? {}),
          ...snap,
          top_news: Array.isArray(snap.top_news)
            ? snap.top_news.filter((h) => isActiveOnDesk(h))
            : (prev?.top_news ?? []).filter((h) => isActiveOnDesk(h)),
          highlights: Array.isArray(snap.highlights)
            ? snap.highlights.filter((h) => isActiveOnDesk(h))
            : (prev?.highlights ?? []).filter((h) => isActiveOnDesk(h)),
          user_analyses: Array.isArray(snap.user_analyses)
            ? snap.user_analyses.filter((a) => isActiveOnDesk(a))
            : (prev?.user_analyses ?? []).filter((a) => isActiveOnDesk(a)),
        }));
        const n = snap.migrated ?? 0;
        const cal = snap.calendar_dates ?? 0;
        const skip = snap.skipped_no_record ?? 0;
        if (n > 0 || cal > 0) {
          invalidateGuidanceSnapshotCache();
          window.dispatchEvent(new Event(CLINICAL_PRE_CD_CHANGED_EVENT));
        }
        let msg = "";
        if (snap.ok === false && (snap as { error?: string }).error) {
          const err = String((snap as { error?: string }).error);
          if (err === "id_not_found" && id) {
            // Drop zombie card that the desk still showed after server clear.
            setData((prev) => {
              if (!prev) return prev;
              const drop = (h: { id?: string }) => String(h.id || "").trim() !== id;
              return {
                ...prev,
                top_news: (prev.top_news ?? []).filter(drop),
                highlights: (prev.highlights ?? []).filter(drop),
                user_analyses: (prev.user_analyses ?? []).filter(drop),
              };
            });
          }
          msg =
            err === "id_not_found"
              ? it
                ? "News non in coda (già migrata o scaduta) — rimossa dalla lista."
                : "News not in queue (already migrated or expired) — removed from list."
              : err;
        } else if (n === 0 && cal === 0) {
          msg = it
            ? skip
              ? `Niente migrato (${skip} senza scheda clinical EIS).`
              : "Niente da migrare."
            : skip
              ? `Nothing migrated (${skip} without clinical EIS card).`
              : "Nothing to migrate.";
        } else if (n === 0 && cal > 0) {
          msg = it
            ? `Nessuna nuova card EIS · ${cal} date in calendario/plot.`
            : `No new EIS cards · ${cal} calendar/plot dates.`;
        } else if (id) {
          msg = it
            ? `Migrata 1 → EIS Deep Dive${cal ? ` · ${cal} date in calendario/plot` : ""}.`
            : `Migrated 1 → Deep Dive EIS${cal ? ` · ${cal} calendar/plot dates` : ""}.`;
        } else {
          msg = it
            ? `Migrati ${n} → EIS Deep Dive${cal ? ` · ${cal} date in calendario/plot` : ""}${skip ? ` · ${skip} senza scheda` : ""}.`
            : `Migrated ${n} → Deep Dive EIS${cal ? ` · ${cal} calendar/plot dates` : ""}${skip ? ` · ${skip} no card` : ""}.`;
        }
        setMigrateMsg(msg);
        if (!id && n > 0) setQueueOpen(false);
      } catch (e) {
        setMigrateMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setMigrateBusy(false);
        setMigratingId(null);
      }
    };

    const migrateOneNews = (item: DailyNewsHighlight) => {
      const id = String(item.id || "").trim();
      if (!id || migrateBusy) return;
      void runMigrate(id);
    };

    return (
      <>
      <div
        className={`shrink-0 grid grid-cols-1 xl:grid-cols-2 gap-3 items-start ${className}`.trim()}
        data-star-version={starVersion}
      >
      <div className="flex flex-col gap-3 min-w-0">
      <section
        aria-label="Top News"
        className="rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))] p-3 space-y-2 min-h-0 flex flex-col"
      >
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-[rgb(var(--warn))] tracking-tight">
              {it ? "Top News ★" : "Top News ★"}
              {topBusy ? " · …" : ""}
            </h3>
            <p className="text-[10px] leading-snug text-[#C5CDDC] mt-0.5">
              {it
                ? "Notizie fresche sulle società d'interesse (★) — aggiornate ogni ora"
                : "Fresh news on companies of interest (★) — updated every hour"}
            </p>
            <p className="text-[9px] text-ink-muted tabular-nums mt-0.5">
              {lastUpdateLabel
                ? lastUpdateLabel
                : hourLabel
                  ? `Search ${hourLabel}`
                  : it
                    ? "In attesa aggiornamento"
                    : "Awaiting update"}
              {priorityMeta.tickers.length
                ? ` · ★ ${priorityMeta.tickers.join(" · ")}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={migrateBusy}
              onClick={() => {
                setMigrateMsg(null);
                setQueueOpen(true);
              }}
              className="rounded-full border border-white/[0.16] px-2.5 py-1 text-[10px] font-semibold text-ink hover:bg-white/[0.04] disabled:opacity-50"
              title={
                it
                  ? "Apri la lista completa prima di migrare"
                  : "Open the full list before migrating"
              }
            >
              {it ? `Coda ${pendingMigrate}` : `Queue ${pendingMigrate}`}
            </button>
            <button
              type="button"
              disabled={migrateBusy || pendingMigrate === 0}
              onClick={() => {
                setMigrateMsg(null);
                setQueueOpen(true);
              }}
              className="rounded-full border border-[#C4841A]/70 bg-gradient-to-b from-[#F3C451] via-[#E59A1A] to-[#E07A1A] px-2.5 py-1 text-[10px] font-semibold text-[#0B0D17] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-110 disabled:opacity-50"
              title={
                it
                  ? "Rivedi titoli e score, poi conferma la migrazione"
                  : "Review titles and scores, then confirm migration"
              }
            >
              {it
                ? `Migra${pendingMigrate ? ` ${pendingMigrate}` : ""}`
                : `Migrate${pendingMigrate ? ` ${pendingMigrate}` : ""}`}
            </button>
          </div>
        </div>

        {migrateMsg ? (
          <p className="inline-flex max-w-full truncate rounded-md border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/10 px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--warn))]">
            {migrateMsg}
          </p>
        ) : null}

        {topNews.length ? (
          <div className="max-h-[28rem] overflow-y-auto overscroll-contain space-y-1">
            {topNews.map((h) => (
              <NewsRow
                key={h.id || `${h.ticker}-${h.title}-${h.source_kind}`}
                item={h}
                it={it}
                featured
                liveScores={thermoLiveByKey[newsRowKey(h)] ?? null}
                migrateBusy={migrateBusy}
                migratingThis={
                  migratingId != null && migratingId === String(h.id || "")
                }
                onOpen={openNewsBrief}
                onMigrate={migrateOneNews}
                onDismiss={dismissNews}
              />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-ink-muted px-0.5 py-1">
            {!priorityMeta.starred.length
              ? it
                ? "Nessuna priorità: marca ★ su una riga Catalyst."
                : "No priority names — star ★ a Catalyst row."
              : priorityMeta.tickers.length
                ? it
                  ? `Nessun comunicato recente per ${priorityMeta.tickers.join(", ")}.`
                  : `No recent releases for ${priorityMeta.tickers.join(", ")}.`
                : it
                  ? "Nessun ticker prioritario."
                  : "No priority tickers."}
          </p>
        )}
        {aboveOtherSlot ? (
          <div className="border-t border-white/[0.08] pt-2 mt-0.5">{aboveOtherSlot}</div>
        ) : null}
      </section>
      </div>

      <div className="flex flex-col gap-3 min-w-0">
        <section
          aria-label="Other headlines"
          className="rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))] p-4 space-y-2.5 min-h-0 flex flex-col"
        >
        <div className="rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] p-2 space-y-1">
          <h4 className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
            {it ? "Altri titoli" : "Other headlines"}
            {restShown.length ? ` · ${restShown.length}` : ""}
          </h4>
          {restShown.length ? (
            <div className="max-h-[16rem] overflow-y-auto overscroll-contain space-y-1">
              {restShown.map((h) => (
                <NewsRow
                  key={h.id || `${h.ticker}-${h.title}`}
                  item={h}
                  it={it}
                  compact
                  liveScores={thermoLiveByKey[newsRowKey(h)] ?? null}
                  migrateBusy={migrateBusy}
                  migratingThis={
                    migratingId != null && migratingId === String(h.id || "")
                  }
                  onOpen={openNewsBrief}
                  onMigrate={migrateOneNews}
                  onDismiss={dismissNews}
                />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-ink-muted px-0.5 py-1">
              {it ? "Nessun altro titolo in coda." : "No other headlines queued."}
            </p>
          )}
        </div>

        <div className="rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] p-2 space-y-1">
          <button
            type="button"
            onClick={() => setManualComposeOpen((o) => !o)}
            aria-expanded={manualComposeOpen}
            className="flex w-full items-baseline justify-between gap-2 text-left focus:outline-none"
          >
            <h4 className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
              {it ? "Manual News" : "Manual News"}
            </h4>
            <span className="text-[9px] text-ink-muted tabular-nums">
              {manualComposeOpen
                ? it
                  ? "Chiudi"
                  : "Close"
                : analyses.length
                  ? String(analyses.length)
                  : it
                    ? "Apri"
                    : "Open"}
            </span>
          </button>
          {manualComposeOpen ? (
            <div className="space-y-2 pt-0.5">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={2}
                placeholder={
                  it ? "Testo da analizzare…" : "Text to analyze…"
                }
                className="w-full rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] px-2 py-1.5 text-[11px] text-ink placeholder:text-[#5B6580] focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--accent))]/50 resize-y min-h-[2.75rem]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="https://…"
                  className="min-w-[11rem] flex-1 rounded-md border border-white/[0.08] bg-[rgb(var(--surface-elevated))] px-2 py-1.5 text-[11px] text-ink placeholder:text-[#5B6580] focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--accent))]/50"
                />
                <label className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer">
                  <span className="rounded border border-[rgb(var(--border))]/55 px-2 py-1.5 text-ink font-semibold uppercase tracking-wide text-[9px]">
                    PDF
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                  {pdfFile ? (
                    <span className="max-w-[9rem] truncate text-ink">{pdfFile.name}</span>
                  ) : null}
                </label>
                <button
                  type="button"
                  disabled={analyzeBusy}
                  onClick={() => void runAnalyze()}
                  className="ml-auto rounded-md bg-[rgb(var(--accent))] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {analyzeBusy
                    ? it
                      ? "Analizzo…"
                      : "Analyzing…"
                    : it
                      ? "Analizza"
                      : "Analyze"}
                </button>
              </div>
              {analyzeErr ? (
                <p className="text-[10px] text-[rgb(var(--signal-down))]">{analyzeErr}</p>
              ) : null}
            </div>
          ) : null}
          {analyses.length ? (
            <div className="max-h-[9rem] overflow-y-auto overscroll-contain space-y-1 mt-0.5">
              {analyses.map((a) => (
                <AnalysisCard
                  key={a.id || `${a.source_kind}-${a.summary_10w}`}
                  row={a}
                  it={it}
                  migrateBusy={migrateBusy}
                  migratingThis={
                    migratingId != null && migratingId === String(a.id || "")
                  }
                  onOpen={openNewsBrief}
                  onMigrate={migrateOneNews}
                  onDismiss={dismissNews}
                />
              ))}
            </div>
          ) : null}
        </div>

        <footer className="text-[9px] text-ink-muted tabular-nums pt-0.5">
          {lastUpdateLabel
            ? it
              ? `Ultimo aggiornamento · ${lastUpdateLabel}`
              : `Last update · ${lastUpdateLabel}`
            : it
              ? "Nessun aggiornamento ancora"
              : "No update yet"}
        </footer>
      </section>
      </div>
      </div>
      <MigrateQueueModal
        open={queueOpen}
        rows={migrateQueue}
        it={it}
        busy={migrateBusy}
        migratingId={migratingId}
        message={migrateMsg}
        onClose={() => setQueueOpen(false)}
        onDismiss={dismissNews}
        onMigrateOne={migrateOneNews}
        onConfirm={() => void runMigrate()}
      />
      <NewsBriefModal
        item={briefItem}
        brief={briefData}
        busy={briefBusy}
        error={briefErr}
        it={it}
        simRows={simRows}
        onClose={closeNewsBrief}
        onThermoScoresChange={onThermoScoresChange}
      />
      </>
    );
  },
);
