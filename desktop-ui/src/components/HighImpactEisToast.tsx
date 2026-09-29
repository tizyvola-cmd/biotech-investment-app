import { useEffect, useMemo, useState } from "react";
import type { ClinicalPreCdRecord } from "../api/supernova";
import {
  ackHighImpactEisAlert,
  collectHighImpactEisAlerts,
  HIGH_IMPACT_EIS_ABS,
  type HighImpactEisAlert,
} from "../sheet/highImpactEisAlerts";
import { eisColor } from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";

const AUTO_DISMISS_MS = 18_000;

type Props = {
  tickers: string[];
  records: ClinicalPreCdRecord[] | null | undefined;
  lang: "it" | "en";
};

export function HighImpactEisToast({ tickers, records, lang }: Props) {
  const it = lang === "it";
  const queue = useMemo(
    () => collectHighImpactEisAlerts(tickers, records, lang),
    [tickers, records, lang],
  );
  const [active, setActive] = useState<HighImpactEisAlert | null>(null);

  useEffect(() => {
    if (active) return;
    if (!queue.length) return;
    setActive(queue[0]!);
  }, [queue, active]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => {
      ackHighImpactEisAlert(active.id);
      setActive(null);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;

  const score = active.event.breakdown.score;
  const color = eisColor(score);
  const href =
    active.event.link?.trim() ||
    active.event.studyUrl?.trim() ||
    null;
  const body = (
    active.event.summary?.trim() ||
    active.event.impactNote?.trim() ||
    active.event.title
  ).trim();
  const showTitle =
    Boolean(active.event.summary?.trim()) &&
    active.event.title.trim() !== body;

  const dismiss = () => {
    ackHighImpactEisAlert(active.id);
    setActive(null);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[80] w-[min(24rem,calc(100vw-1.5rem))]"
      role="alertdialog"
      aria-live="polite"
    >
      <div className="rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-xl px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              {it
                ? `EIS di oggi · |EIS| > ${HIGH_IMPACT_EIS_ABS}`
                : `Today’s EIS · |EIS| > ${HIGH_IMPACT_EIS_ABS}`}
            </p>
            <p className="text-sm font-bold text-ink mt-0.5">
              {active.ticker}
              <span className="ml-2 tabular-nums" style={{ color }}>
                EIS {score >= 0 ? "+" : ""}
                {score.toFixed(1)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="text-ink-muted hover:text-ink text-sm leading-none px-1"
            aria-label={it ? "Chiudi" : "Dismiss"}
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
        {active.event.eventDate ? (
          <p className="text-[10px] text-ink-muted mt-1 tabular-nums">
            {active.event.eventDate.slice(0, 10)} · {active.event.sourceLabel}
          </p>
        ) : null}
        {showTitle ? (
          <p className="text-[12px] font-semibold text-ink mt-1.5 leading-snug">
            {active.event.title}
          </p>
        ) : null}
        <p className="text-[12px] text-ink leading-snug mt-1 whitespace-pre-wrap">
          {body}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {href ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-sky-700 hover:underline"
              onClick={() => openExternalUrl(href)}
            >
              {it ? "Apri news / fonte →" : "Open news / source →"}
            </button>
          ) : (
            <span className="text-[10px] text-ink-muted">
              {it ? "Nessun link disponibile" : "No link available"}
            </span>
          )}
          <button
            type="button"
            className="ml-auto text-[10px] font-medium text-ink-muted hover:text-ink"
            onClick={dismiss}
          >
            {it ? "Nascondi" : "Dismiss"}
          </button>
        </div>
        {queue.length > 1 ? (
          <p className="text-[9px] text-ink-muted mt-1.5">
            {it
              ? `+${queue.length - 1} altri EIS di oggi`
              : `+${queue.length - 1} more today’s EIS alerts`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
