import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { eisBarPercent, eisColor, resolvePrimaryEisScore } from "../sheet/eventImpactScore";
import { openExternalUrl, normalizeExternalHref } from "../sheet/k8ChartLinks";
import { useInvestorArticleBrief } from "../hooks/useInvestorArticleBrief";
import { InvestorArticleBriefBody } from "./InvestorArticleBriefBody";
import { InvestorInsightBox } from "./InvestorInsightBox";
import { NewsCompanyProductDebrief } from "./NewsCompanyProductDebrief";
import type { DailyNewsBrief } from "../api/supernova";

function fmtDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * News / paper detail — docks to the right so the CD / study modal stays visible
 * on the left (side-by-side, not stacked behind).
 */
export function EisEventDetailModal({
  ev,
  ticker,
  it,
  onClose,
}: {
  ev: TickerEisEventDetail;
  ticker?: string;
  it: boolean;
  onClose: () => void;
}) {
  const primaryScore = resolvePrimaryEisScore(ev.breakdown);
  const color = eisColor(primaryScore);
  const w = eisBarPercent(primaryScore);
  const arrow = primaryScore >= 5 ? "↑" : primaryScore <= -5 ? "↓" : "–";
  const bodyText = (ev.summary?.trim() || ev.title).trim();
  const href = normalizeExternalHref(ev.link) || normalizeExternalHref(ev.studyUrl);
  const studyHref = normalizeExternalHref(ev.studyUrl);

  const articleUrl = normalizeExternalHref(ev.link);
  const dailyNewsId = String(
    (ev.rawEvent as { _daily_news_id?: unknown } | null | undefined)?._daily_news_id ?? "",
  ).trim();
  const { brief, busy, error } = useInvestorArticleBrief({
    title: ev.title,
    url: articleUrl,
    summary: ev.summary,
    ticker,
    id: dailyNewsId || undefined,
    enabled: Boolean(articleUrl || (ev.summary && ev.summary.length > 40)),
  });

  /** Prefer live Daily News digest; fall back to fields already on the EIS event. */
  const seededBrief: DailyNewsBrief | null =
    !brief &&
    ((ev.sectionSummaries && ev.sectionSummaries.length > 0) ||
      Boolean((ev.abstract || "").trim()) ||
      Boolean((ev.investorInsight || "").trim()) ||
      (Boolean(ev.summary?.trim()) &&
        (ev.summary || "").trim() !== (ev.title || "").trim() &&
        (ev.summary || "").trim().length >= 80))
      ? {
          detail_summary:
            (ev.summary || "").trim() !== (ev.title || "").trim()
              ? (ev.summary || "").trim()
              : undefined,
          abstract: (ev.abstract || "").trim() || undefined,
          section_summaries: ev.sectionSummaries ?? undefined,
          product: ev.asset ?? undefined,
          phase: ev.studyPhase ?? undefined,
          indication: ev.studyConditions ?? undefined,
          is_paper: ev.isPaper || undefined,
          investor_insight: ev.investorInsight ?? undefined,
        }
      : null;
  const displayBrief = brief
    ? {
        ...brief,
        investor_insight:
          brief.investor_insight || ev.investorInsight || undefined,
      }
    : seededBrief;
  const paperAbstract = (
    displayBrief?.abstract ||
    ev.abstract ||
    ""
  ).trim();
  const paperSections =
    displayBrief?.section_summaries && displayBrief.section_summaries.length > 0
      ? displayBrief.section_summaries
      : ev.sectionSummaries && ev.sectionSummaries.length > 0
        ? ev.sectionSummaries
        : null;
  const showScientific =
    Boolean(ev.isPaper) ||
    Boolean(paperAbstract) ||
    Boolean(paperSections) ||
    Boolean(articleUrl && /pubmed\.ncbi\.nlm\.nih\.gov/i.test(articleUrl));
  const displayDate =
    (typeof displayBrief?.pub_date === "string" && displayBrief.pub_date.trim()) ||
    displayBrief?.dates?.find((d) => /^\d{4}-\d{2}-\d{2}/.test(String(d.date || "")))
      ?.date ||
    ev.eventDate;

  useEffect(() => {
    document.documentElement.dataset.eisDetailDock = "1";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Capture after AppModal so Escape closes Detail first, not the CD modal.
    window.addEventListener("keydown", onKey, true);
    return () => {
      delete document.documentElement.dataset.eisDetailDock;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[10050] flex justify-end"
      role="presentation"
    >
      {/* Left stays click-through so the CD / study modal remains usable. */}
      <aside
        className="pointer-events-auto flex h-full w-full max-w-full flex-col border-l border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] shadow-[-12px_0_40px_rgba(0,0,0,0.35)] sm:w-[min(28rem,42vw)]"
        role="dialog"
        aria-modal="false"
        aria-label={it ? "Dettaglio evento EIS" : "EIS event detail"}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {ticker ? (
                <span className="text-[10px] font-bold tabular-nums text-ink">
                  {ticker.toUpperCase()}
                </span>
              ) : null}
              <span className="rounded bg-[rgb(var(--surface-3))]/80 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                {ev.sourceLabel}
              </span>
              <span className="text-[10px] tabular-nums text-ink-muted">
                {fmtDate(displayDate ?? null, it)}
              </span>
            </div>
            <h3 className="text-sm font-bold leading-snug text-ink">{ev.title}</h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold"
              style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
            >
              {arrow} EIS {primaryScore >= 0 ? "+" : ""}
              {primaryScore.toFixed(1)}
            </span>
            <div className="ml-auto mt-0.5 h-1.5 w-20 overflow-hidden rounded-full bg-slate-200/80">
              <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
            </div>
            <button
              type="button"
              className="mt-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted hover:bg-ink/10 hover:text-ink"
              onClick={onClose}
              aria-label={it ? "Chiudi" : "Close"}
            >
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          <NewsCompanyProductDebrief
            ticker={ticker}
            title={ev.title || displayBrief?.headline || null}
            productHint={
              displayBrief?.product || ev.asset || null
            }
            indicationHint={
              displayBrief?.indication || ev.studyConditions || null
            }
            phaseHint={displayBrief?.phase || ev.studyPhase || null}
            it={it}
          />
          {showScientific ? (
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
                {it ? "Articolo scientifico" : "Scientific article"}
              </p>
              {(() => {
                const ordered = (["Introduction", "Results", "Discussion"] as const)
                  .map((label) => {
                    const hit = (paperSections || []).find((s) => {
                      const h = (s.heading || "").trim();
                      if (label === "Introduction")
                        return /introduction|background|introduzione/i.test(h);
                      if (label === "Results")
                        return /results?|risultat|methods?/i.test(h);
                      return /discussion|discussione|conclusions?/i.test(h);
                    });
                    const body = (hit?.summary || "").trim();
                    if (!body || /^pdf not available$/i.test(body)) return null;
                    return { label, body };
                  })
                  .filter(Boolean) as Array<{ label: string; body: string }>;
                if (ordered.length) {
                  return ordered.map((sec) => (
                    <div key={sec.label}>
                      <p className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
                        {sec.label}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug text-ink">
                        {sec.body}
                      </p>
                    </div>
                  ));
                }
                return (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
                      Abstract
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug text-ink">
                      {paperAbstract ||
                        (busy
                          ? it
                            ? "Caricamento abstract…"
                            : "Loading abstract…"
                          : it
                            ? "Abstract non disponibile."
                            : "Abstract not available.")}
                    </p>
                  </div>
                );
              })()}
            </section>
          ) : null}
          {/* Papers: Intro/Results/Discussion above — Investor Insight at end. */}
          {ev.isPaper ? (
            <>
              <InvestorInsightBox
                text={
                  displayBrief?.investor_insight || ev.investorInsight || null
                }
                it={it}
              />
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
                  onClick={(e) => openExternalUrl(href, e)}
                >
                  {it ? "Apri articolo →" : "Open article →"}
                </a>
              ) : null}
            </>
          ) : (
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
                {it ? "Articolo / riassunto" : "Article / brief"}
              </p>
              <InvestorArticleBriefBody
                brief={displayBrief}
                busy={busy && !displayBrief}
                error={error}
                fallbackText={bodyText}
                it={it}
              />
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
                  onClick={(e) => openExternalUrl(href, e)}
                >
                  {it ? "Apri link esterno →" : "Open external link →"}
                </a>
              ) : null}
            </section>
          )}

          {ev.studyTitle || ev.nctId ? (
            <section className="space-y-1 rounded-lg border border-[rgb(var(--border))]/35 bg-surface/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
                {it ? "Studio collegato" : "Linked study"}
              </p>
              {ev.studyTitle ? (
                <p className="text-[12px] font-medium leading-snug text-ink">{ev.studyTitle}</p>
              ) : null}
              {ev.nctId && studyHref ? (
                <a
                  href={studyHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
                  onClick={(e) => openExternalUrl(studyHref, e)}
                >
                  {ev.nctId} · ClinicalTrials.gov ↗
                </a>
              ) : ev.nctId ? (
                <span className="font-mono text-[11px] text-ink-muted">{ev.nctId}</span>
              ) : null}
            </section>
          ) : null}

          {ev.impactNote ? (
            <section className="border-t border-[rgb(var(--border))]/30 pt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
                {it ? "Nota impatto" : "Impact note"}
              </p>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">
                {ev.impactNote}
              </p>
            </section>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end border-t border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))] px-4 py-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            {it ? "Chiudi" : "Close"}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
