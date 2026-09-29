import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import {
  formatTickerEisEventRichContext,
  tickerEisEventHasRichContext,
} from "../sheet/tickerEisEventRich";
import { eisColor } from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";

export function EisEventRichSnippet({
  ev,
  it,
  dense = false,
  minimal = false,
}: {
  ev: TickerEisEventDetail;
  it: boolean;
  dense?: boolean;
  /**
   * When true, hide the verbose lines (asset name, 8-K items, free-form summary paragraph,
   * clinical KPI list) and render only the compact reaction tag (ΔP / Volume / KPI · note).
   * Rely on the row title link for full detail. Used by the High-Impact overview list.
   */
  minimal?: boolean;
}) {
  const lang = it ? "it" : "en";
  const ctx = formatTickerEisEventRichContext(ev, lang);
  if (!tickerEisEventHasRichContext(ctx)) return null;

  const textCls = dense
    ? "text-[9px] text-ink-muted leading-snug"
    : "text-[10px] text-ink-muted leading-snug";

  if (minimal) {
    if (!ctx.reactionLine) return null;
    return (
      <div className={`mt-0.5 ${dense ? "" : "mt-1"}`}>
        <p className={textCls}>{ctx.reactionLine}</p>
      </div>
    );
  }

  return (
    <div className={`mt-0.5 space-y-0.5 ${dense ? "" : "mt-1"}`}>
      {ctx.assetLine ? <p className={textCls}>{ctx.assetLine}</p> : null}
      {ctx.itemsLine ? <p className={`${textCls} font-medium text-ink/85`}>{ctx.itemsLine}</p> : null}
      {ctx.summaryLine ? (
        <p className={`${textCls} ${dense ? "line-clamp-2" : "line-clamp-3"}`}>{ctx.summaryLine}</p>
      ) : null}
      {ctx.kpiLine ? <p className={`${textCls} font-medium text-ink/80`}>{ctx.kpiLine}</p> : null}
      {ctx.reactionLine ? <p className={textCls}>{ctx.reactionLine}</p> : null}
    </div>
  );
}

export function RegulatoryBreakdownEventRow({
  ev,
  it,
}: {
  ev: TickerEisEventDetail;
  it: boolean;
}) {
  const lang = it ? "it" : "en";
  const ctx = formatTickerEisEventRichContext(ev, lang);
  const href = ev.link?.trim() || ev.studyUrl?.trim() || null;

  return (
    <li className="rounded border border-[rgb(var(--border))]/35 bg-white/40 dark:bg-black/10 px-2.5 py-2 space-y-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-100/90 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
              {ev.sourceLabel}
            </span>
            <span className="text-[9px] text-ink-muted tabular-nums">
              {ev.eventDate
                ? new Date(`${ev.eventDate}T12:00:00`).toLocaleDateString(it ? "it-IT" : "en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </span>
          </div>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2 leading-snug line-clamp-2"
              onClick={(e) => openExternalUrl(href, e)}
            >
              {ev.title}
            </a>
          ) : (
            <p className="text-[11px] font-semibold text-ink leading-snug">{ev.title}</p>
          )}
          <EisEventRichSnippet ev={ev} it={it} />
          {!tickerEisEventHasRichContext(ctx) && ev.impactNote?.trim() ? (
            <p className="text-[10px] text-ink-muted leading-snug">{ev.impactNote}</p>
          ) : null}
        </div>
        <span
          className="shrink-0 text-[11px] font-bold tabular-nums pt-0.5"
          style={{ color: eisColor(ev.breakdown.score) }}
        >
          {ev.breakdown.score >= 0 ? "+" : ""}
          {ev.breakdown.score.toFixed(1)}
        </span>
      </div>
    </li>
  );
}
