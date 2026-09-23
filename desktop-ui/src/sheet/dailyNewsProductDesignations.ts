/**
 * Product + FDA designations mined from Daily News (auto + manual).
 * Complements Discovery / FDA-site lookup for Top KPI columns.
 */
import type {
  DailyNewsHighlight,
  DailyNewsPayload,
  DailyNewsUserAnalysis,
} from "../api/supernova";
import {
  designationsFromText,
  formatSourceList,
  normalizeFdaDesignationLabel,
} from "./calendarPhase1";

export type NewsProductDesignationHint = {
  product?: string;
  designations: string[];
};

/** Drug codes: NEO100, NEO-100, ALK-001 (skip plain tickers / years). */
const PRODUCT_CODE_RE = /\b([A-Z]{2,6}-?\d{1,4}[A-Z]?)\b/g;

function pushDesigs(into: Set<string>, ...parts: Array<string | null | undefined>) {
  // Free text → needle extract only (Orphan / Fast Track / …).
  // Never normalizeFdaDesignationLabel(wholeBlob) — that used to promote taxonomy notes.
  for (const d of designationsFromText(...parts)) into.add(d);
}

function pushStructuredDesigs(
  into: Set<string>,
  list: Array<string | null | undefined> | null | undefined,
) {
  if (!Array.isArray(list)) return;
  for (const d of list) {
    const n = normalizeFdaDesignationLabel(d) || null;
    if (n) into.add(n);
    else {
      for (const x of designationsFromText(d)) into.add(x);
    }
  }
}

function productCodesFromText(...parts: Array<string | null | undefined>): string[] {
  const blob = parts.filter(Boolean).join("\n");
  if (!blob) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of blob.matchAll(PRODUCT_CODE_RE)) {
    const raw = (m[1] || "").toUpperCase();
    if (!raw || seen.has(raw)) continue;
    // Skip years / tiny numbers glued to letters that look like codes
    if (/^20\d{2}$/.test(raw.replace(/-/g, ""))) continue;
    seen.add(raw);
    out.push(raw.includes("-") ? raw : raw.replace(/([A-Z]+)(\d)/, "$1$2"));
  }
  return out;
}

function pickProduct(
  explicit: string | null | undefined,
  ...textParts: Array<string | null | undefined>
): string | undefined {
  const e = String(explicit || "").trim();
  if (e) return e.slice(0, 80);
  const codes = productCodesFromText(...textParts);
  // Prefer codes near designation language when present
  const desigBlob = textParts.filter(Boolean).join(" | ");
  if (desigBlob && /orphan|fast\s*track|breakthrough|rare\s*pediatric|rmat|priority\s*review/i.test(desigBlob)) {
    for (const c of codes) {
      const re = new RegExp(
        `${c.replace(/-/g, "-?")}.{0,120}(?:orphan|fast\\s*track|breakthrough|rare\\s*pediatric)|` +
          `(?:orphan|fast\\s*track|breakthrough|rare\\s*pediatric).{0,120}${c.replace(/-/g, "-?")}`,
        "i",
      );
      if (re.test(desigBlob)) return c;
    }
  }
  return codes[0];
}

function fromHighlight(h: DailyNewsHighlight): NewsProductDesignationHint | null {
  const tk = String(h.ticker || "")
    .trim()
    .toUpperCase();
  if (!tk) return null;
  const des = new Set<string>();
  pushStructuredDesigs(des, h.fda_designations);
  pushDesigs(des, h.title, h.summary);
  // market_access_notes is EIS taxonomy text — mine designation needles only, never as a label.
  pushDesigs(des, h.market_access_notes);
  const product = pickProduct(h.product, h.title, h.summary);
  if (!des.size && !product) return null;
  return { product, designations: [...des] };
}

function fromAnalysis(a: DailyNewsUserAnalysis): NewsProductDesignationHint | null {
  const tk = String(a.ticker || "")
    .trim()
    .toUpperCase();
  if (!tk) return null;
  const des = new Set<string>();
  pushStructuredDesigs(des, a.fda_designations);
  const krBlob = Array.isArray(a.key_results)
    ? a.key_results.map((kr) => `${kr.label}: ${kr.detail}`).join("\n")
    : "";
  const kpBlob = Array.isArray(a.key_points) ? a.key_points.join("\n") : "";
  pushDesigs(
    des,
    a.summary_10w,
    a.detail_summary,
    a.summary_long,
    a.source_excerpt,
    a.abstract,
    a.results_note,
    krBlob,
    kpBlob,
  );
  const product = pickProduct(
    a.product,
    a.summary_10w,
    a.detail_summary,
    a.summary_long,
    a.source_excerpt,
    krBlob,
    kpBlob,
  );
  if (!des.size && !product) return null;
  return { product, designations: [...des] };
}

/** Merge Daily News payload → ticker → product + designations. */
export function newsProductDesignationByTicker(
  payload: DailyNewsPayload | null | undefined,
): Record<string, NewsProductDesignationHint> {
  const out: Record<string, NewsProductDesignationHint> = {};
  const merge = (tk: string, hint: NewsProductDesignationHint) => {
    const prev = out[tk] ?? { designations: [] };
    const des = new Set<string>([...prev.designations, ...hint.designations]);
    out[tk] = {
      product: hint.product || prev.product,
      designations: [...des],
    };
  };
  for (const h of payload?.highlights ?? []) {
    const tk = String(h.ticker || "")
      .trim()
      .toUpperCase();
    const hint = fromHighlight(h);
    if (tk && hint) merge(tk, hint);
  }
  for (const h of payload?.top_news ?? []) {
    const tk = String(h.ticker || "")
      .trim()
      .toUpperCase();
    const hint = fromHighlight(h);
    if (tk && hint) merge(tk, hint);
  }
  for (const a of payload?.user_analyses ?? []) {
    const tk = String(a.ticker || "")
      .trim()
      .toUpperCase();
    const hint = fromAnalysis(a);
    if (tk && hint) merge(tk, hint);
  }
  return out;
}

export function formatProductDesignationCell(
  product: string | null | undefined,
  designations: string[] | string | null | undefined,
): string {
  const p = String(product || "").trim();
  const d =
    typeof designations === "string"
      ? designations.trim()
      : formatSourceList(designations ?? []);
  if (p && d) return `${p} · ${d}`;
  return p || d || "";
}
