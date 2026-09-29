import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { PortfolioLossAnalysisItem } from "../sheet/portfolioLossAnalysis";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import {
  buildManualNewsTemplate,
  buildNegativeCatalystManualNewsTemplate,
  buildNoCatalystManualNewsTemplate,
  dismissManualNewsPrompt,
} from "../sheet/manualFeedDropPrompt";
import { eisColor } from "../sheet/eventImpactScore";
import {
  parseManualFeedForSubmit,
  previewManualFeedEis,
  submitManualFeedRaw,
} from "../sheet/manualFeedSubmit";
import { MANUAL_FEED_BATCH_MAX_ROWS } from "../sheet/manualFeedEvents";
import { useLang, useT } from "../shared/i18n";

const PLACEHOLDER_IT = `Formato rapido:
LTRN | 07/07/2026 | titolo | fonte | riassunto…

Oppure:
TICKER: LTRN
DATA: 2026-07-07
FONTE: GlobeNewswire
NEWS: …`;

const PLACEHOLDER_EN = `Quick format:
LTRN | Jul 7, 2026 | headline | source | summary…

Or:
TICKER: LTRN
DATE: 2026-07-07
SOURCE: GlobeNewswire
NEWS: …`;

export function ManualNewsDropPromptModal({
  item,
  onClose,
  onGoToNewsBox,
  onSaved,
}: {
  item: PortfolioLossAnalysisItem;
  onClose: () => void;
  /** Deep-link: scroll to ticker free-text box in 24h tab + focus. */
  onGoToNewsBox: () => void;
  onSaved?: (meta?: { tickers: string[]; count: number }) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const pnlAccent = portfolioPnlAccentClass(item.pnlEur, item.pnlPct);
  const resolvedPriceMovePct = useMemo(() => {
    const pnl =
      item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)
        ? item.pnlPct24h
        : item.pnlPct;
    return pnl != null && Number.isFinite(pnl) ? pnl : null;
  }, [item.pnlPct, item.pnlPct24h]);

  const [raw, setRaw] = useState(() =>
    buildManualNewsTemplate(item.ticker, it ? "it" : "en"),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deferredRaw = useDeferredValue(raw);
  const parsedList = useMemo(
    () =>
      parseManualFeedForSubmit({
        raw: deferredRaw,
        defaultTicker: item.ticker,
        priceMovePct: resolvedPriceMovePct,
      }),
    [deferredRaw, item.ticker, resolvedPriceMovePct],
  );

  const previewEisRows = useMemo(() => {
    const blobLen = deferredRaw.trim().length;
    const skipHeavyEis = blobLen > 4000;
    return parsedList.slice(0, 2).map((parsed) => ({
      parsed,
      previewEis: skipHeavyEis ? null : previewManualFeedEis(parsed),
    }));
  }, [parsedList, deferredRaw]);

  const handleDismiss = () => {
    dismissManualNewsPrompt(item.ticker);
    onClose();
  };

  const handleGoToNewsBox = () => {
    dismissManualNewsPrompt(item.ticker);
    onGoToNewsBox();
  };

  const handleSave = useCallback(() => {
    setError(null);
    setBusy(true);
    try {
      const result = submitManualFeedRaw({
        raw,
        defaultTicker: item.ticker,
        priceMovePct: resolvedPriceMovePct,
        investigationContext: "loss",
      });
      if (!result.ok) {
        if (result.error === "too_many") {
          setError(
            it
              ? `Troppe righe (${result.lineCount ?? 0}). Massimo ${MANUAL_FEED_BATCH_MAX_ROWS} news per invio.`
              : `Too many rows (${result.lineCount ?? 0}). Max ${MANUAL_FEED_BATCH_MAX_ROWS} news per submit.`,
          );
        } else {
          setError(t("manualFeed.error.parse"));
        }
        return;
      }
      onSaved?.({ tickers: result.tickers, count: result.count });
      onClose();
    } finally {
      setBusy(false);
    }
  }, [raw, item.ticker, resolvedPriceMovePct, it, t, onSaved, onClose]);

  return (
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      role="presentation"
      onClick={handleDismiss}
    >
      <div
        className="card w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl border-2 border-[rgb(var(--signal-down))]/35 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-news-drop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[rgb(var(--signal-down))]/25 bg-[rgb(var(--signal-down))]/8 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none shrink-0" aria-hidden>
              📰
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="manual-news-drop-title"
                className="text-base font-bold text-ink leading-tight"
              >
                {t("manualFeed.dropPrompt.title", { ticker: item.ticker })}
              </h2>
              <p className="text-xs text-ink-muted mt-1 leading-snug">
                {t("manualFeed.dropPrompt.subtitle")}
              </p>
              {item.hasPosition && item.pnlPct != null ? (
                <p className={`text-sm font-semibold tabular-nums mt-2 ${pnlAccent}`}>
                  {fmtPortfolioPnlPct(item.pnlPct)}
                  {item.pnlEur != null ? (
                    <span className="ml-2">{fmtPortfolioPnlUsd(item.pnlEur)}</span>
                  ) : null}
                </p>
              ) : item.pnlPct24h != null ? (
                <p
                  className={`text-sm font-semibold tabular-nums mt-2 ${portfolioPnlAccentClass(item.pnlEur24h, item.pnlPct24h)}`}
                >
                  24h {fmtPortfolioPnlPct(item.pnlPct24h)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn-ghost text-lg leading-none shrink-0 px-1"
              aria-label={it ? "Chiudi" : "Close"}
              onClick={handleDismiss}
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[12px] text-ink leading-relaxed">
          <p>{t("manualFeed.dropPrompt.body")}</p>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-900 dark:text-emerald-100 hover:border-emerald-600/60"
              onClick={() => {
                setRaw(
                  buildNoCatalystManualNewsTemplate(
                    item.ticker,
                    resolvedPriceMovePct,
                    it ? "it" : "en",
                  ),
                );
                setError(null);
              }}
            >
              {t("manualFeed.quick.noCatalyst")}
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-900 dark:text-rose-100 hover:border-rose-600/60"
              onClick={() => {
                setRaw(
                  buildNegativeCatalystManualNewsTemplate(
                    item.ticker,
                    resolvedPriceMovePct,
                    it ? "it" : "en",
                  ),
                );
                setError(null);
              }}
            >
              {t("manualFeed.quick.negativeCatalyst")}
            </button>
          </div>

          <textarea
            className="input w-full min-h-[8.5rem] rounded-lg px-3 py-2 text-[12px] font-mono leading-relaxed resize-y"
            placeholder={it ? PLACEHOLDER_IT : PLACEHOLDER_EN}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
          />

          {parsedList.length > 0 ? (
            <div className="rounded-lg border border-[rgb(var(--border))]/35 bg-white/30 dark:bg-black/10 px-3 py-2 text-[10px] space-y-1.5">
              <p className="font-semibold text-ink">
                {t("manualFeed.preview.count", { n: String(parsedList.length) })}
              </p>
              {previewEisRows.map(({ parsed, previewEis }, idx) => (
                <div key={`${parsed.ticker}-${parsed.eventDate}-${idx}`} className="space-y-0.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      <strong>{t("manualFeed.preview.ticker")}:</strong> {parsed.ticker}
                    </span>
                    <span>
                      <strong>{t("manualFeed.preview.date")}:</strong> {parsed.eventDate}
                    </span>
                    {previewEis ? (
                      <span style={{ color: eisColor(previewEis.score) }}>
                        <strong>EIS:</strong> {previewEis.score >= 0 ? "+" : ""}
                        {previewEis.score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-ink-muted">
                        <strong>EIS:</strong> {it ? "dopo invio" : "on submit"}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-ink line-clamp-2">{parsed.title}</p>
                </div>
              ))}
            </div>
          ) : raw.trim() ? (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 leading-snug">
              {t("manualFeed.error.incomplete")}
            </p>
          ) : null}

          {error ? (
            <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
          ) : null}

          <ul className="list-disc pl-4 space-y-1 text-ink-muted text-[11px]">
            <li>{t("manualFeed.dropPrompt.bulletFormat")}</li>
            <li>{t("manualFeed.dropPrompt.bulletEis")}</li>
            <li>{t("manualFeed.dropPrompt.bulletRec")}</li>
          </ul>

          <button
            type="button"
            className="w-full text-left rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/5 px-3 py-2 text-[11px] font-medium text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10 transition"
            onClick={handleGoToNewsBox}
          >
            {t("manualFeed.dropPrompt.directLink", { ticker: item.ticker })}
          </button>
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-[rgb(var(--border))]/40 px-4 py-3 bg-surface/40">
          <button type="button" className="btn-ghost text-xs" onClick={handleDismiss}>
            {t("manualFeed.dropPrompt.dismiss")}
          </button>
          <button
            type="button"
            className="btn-primary text-xs font-semibold disabled:opacity-40"
            disabled={busy || parsedList.length === 0}
            onClick={handleSave}
          >
            {parsedList.length > 1
              ? t("manualFeed.submitMany", { n: String(parsedList.length) })
              : t("manualFeed.dropPrompt.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
