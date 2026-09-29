import type { DailyNewsBrief } from "../api/supernova";
import { InvestorInsightBox } from "./InvestorInsightBox";

function decodeHtmlEntities(raw: string): string {
  if (typeof document === "undefined") return raw;
  const el = document.createElement("textarea");
  el.innerHTML = raw;
  return el.value;
}

function sectionHeadingLabel(heading: string | undefined): string {
  const raw = (heading || "").trim();
  if (/introduction|introduzione|background/i.test(raw)) return "Introduction";
  if (/result|risultat|method/i.test(raw)) return "Results";
  if (/discussion|discussione|conclusion/i.test(raw)) return "Discussion";
  return raw || "Section";
}

function isPaperDigestHeading(heading: string | undefined): boolean {
  const raw = (heading || "").trim();
  return /introduction|introduzione|background|results?|risultat|methods?|discussion|discussione|conclusions?/i.test(
    raw,
  );
}

/**
 * Renders Daily News–style investor digest:
 * For papers: Introduction / Results / Discussion only, then Investor Insight.
 * For other news: detail_summary + section_summaries + key results/points, then Insight.
 */
export function InvestorArticleBriefBody({
  brief,
  busy,
  error,
  fallbackText,
  it,
}: {
  brief: DailyNewsBrief | null;
  busy: boolean;
  error: string | null;
  fallbackText: string;
  it: boolean;
}) {
  const isPaper = Boolean(brief?.is_paper);
  const detail = String(brief?.detail_summary || "").trim();
  const sectionsRaw = (brief?.section_summaries || [])
    .filter((sec) => {
      const heading = (sec.heading || "").trim();
      const summary = (sec.summary || "").trim();
      if (!summary) return false;
      if (/^abstract$/i.test(heading)) return false;
      if (/article\s*\/\s*brief/i.test(heading)) return false;
      if (isPaper) return isPaperDigestHeading(heading);
      return true;
    })
    .slice(0, 12);

  /** Dedupe paper chapters to Intro → Results → Discussion. */
  const sections = (() => {
    if (!isPaper) return sectionsRaw;
    const byLabel = new Map<string, (typeof sectionsRaw)[number]>();
    for (const sec of sectionsRaw) {
      const label = sectionHeadingLabel(sec.heading);
      if (!byLabel.has(label)) byLabel.set(label, { ...sec, heading: label });
    }
    return (["Introduction", "Results", "Discussion"] as const)
      .map((h) => byLabel.get(h))
      .filter(Boolean) as typeof sectionsRaw;
  })();

  const points = isPaper
    ? []
    : (brief?.key_points || [])
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .slice(0, 8);
  const results = isPaper
    ? []
    : (brief?.key_results || [])
        .map((r) => ({
          label: String(r?.label || "").trim(),
          detail: String(r?.detail || "").trim(),
        }))
        .filter((r) => r.label || r.detail)
        .slice(0, 8);

  const hasDigest =
    (!isPaper && Boolean(detail)) ||
    sections.length > 0 ||
    points.length > 0 ||
    results.length > 0 ||
    Boolean(brief?.investor_insight?.trim());
  const fallback = String(fallbackText || "").trim();
  /** Prefer digest; only show raw feed text when digest is not ready. */
  const showFallback = !hasDigest && Boolean(fallback) && (!busy || Boolean(error));

  return (
    <div className="space-y-2">
      {busy && !hasDigest ? (
        <p className="text-[11px] text-ink-muted">
          {it
            ? "Riassunto articolo (stesso motore Daily News)…"
            : "Article brief (same Daily News engine)…"}
        </p>
      ) : null}
      {error && !hasDigest ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          {it
            ? `Digest non disponibile (${error}) — testo feed sotto.`
            : `Digest unavailable (${error}) — showing feed text.`}
        </p>
      ) : null}

      {!isPaper && detail ? (
        <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap break-words">
          {decodeHtmlEntities(detail)}
        </p>
      ) : null}

      {sections.length ? (
        <div className="space-y-1.5">
          {!isPaper ? (
            <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/85">
              {it ? "Paragrafi dell'articolo" : "Article paragraphs"}
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {sections.map((sec, i) => (
              <li
                key={`${i}-${(sec.heading || "").slice(0, 16)}`}
                className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/35 px-2.5 py-1.5"
              >
                {sec.heading ? (
                  <div className="font-semibold text-[11px] text-ink">
                    {sectionHeadingLabel(decodeHtmlEntities(sec.heading))}
                  </div>
                ) : null}
                {sec.summary ? (
                  <p className="text-ink mt-0.5 text-[12px] leading-snug whitespace-pre-wrap break-words">
                    {decodeHtmlEntities(sec.summary)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {results.length ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/85">
            {it ? "Risultati chiave" : "Key results"}
          </p>
          <ul className="space-y-1.5">
            {results.map((r, i) => (
              <li
                key={`${i}-${r.label.slice(0, 16)}`}
                className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-3))]/35 px-2.5 py-1.5"
              >
                {r.label ? (
                  <div className="font-semibold text-[11px]">
                    {decodeHtmlEntities(r.label)}
                  </div>
                ) : null}
                {r.detail ? (
                  <p className="text-ink mt-0.5 text-[12px] leading-snug whitespace-pre-wrap break-words">
                    {decodeHtmlEntities(r.detail)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {points.length ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/85">
            {it ? "Punti chiave" : "Key points"}
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-ink leading-snug">
            {points.map((p) => (
              <li key={p}>{decodeHtmlEntities(p)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showFallback ? (
        <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap break-words">
          {decodeHtmlEntities(fallback)}
        </p>
      ) : null}

      {/* Always last: teal Investor Insight (papers + news). */}
      <InvestorInsightBox text={brief?.investor_insight} it={it} />
    </div>
  );
}
