import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { useLang, useT } from "../shared/i18n";
import {
  dismissManualFeedFromLossPanel,
  loadManualFeedEvents,
  MANUAL_FEED_BATCH_MAX_ROWS,
  MANUAL_FEED_EVENTS_CHANGED_EVENT,
  MANUAL_FEED_LOSS_PANEL_DISMISSED_EVENT,
  removeManualFeedEvent,
  resolveManualEventEis,
  resolveManualEventNewsKind,
  resolveManualEventPrimaryEisScore,
  type ManualFeedEventDraft,
} from "../sheet/manualFeedEvents";
import {
  formatManualNewsEisShort,
  manualNewsEisKindLabel,
} from "../sheet/manualNewsEis";
import {
  buildManualNewsTemplate,
  buildNegativeCatalystManualNewsTemplate,
  buildNoCatalystManualNewsTemplate,
  buildPositiveCatalystManualNewsTemplate,
  buildResearchManualNewsTemplate,
  MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT,
} from "../sheet/manualFeedDropPrompt";
import { filterManualFeedEventsForAnchoredLossPanel } from "../sheet/manualFeedGainStar";
import { getTickerGainStars } from "../sheet/gainStarLedger";
import {
  parseManualFeedForSubmit,
  previewManualFeedEis,
  submitManualFeedRaw,
} from "../sheet/manualFeedSubmit";
import { buildManualCatalystPreviewCard } from "../sheet/manualResearchScoreImpact";
import { resolveManualInvestigationContext } from "../sheet/gainStarLedger";
import type { DecisionRec } from "../sheet/decisionChartLogic";
import { eisColor } from "../sheet/eventImpactScore";
import { ManualNewsDetailModal } from "./ManualNewsDetailModal";
import { GainStarMarks, ManualGainStarMark } from "./PortfolioScopeToggle";
const PLACEHOLDER_IT = `Formato rapido (una news per riga):
INBS | 13/05/2026 | FDA orphan drug designation | GlobeNewswire | breve riassunto…

Oppure formato etichettato:
TICKER: PMVP
DATA: 2026-03-01
FONTE: BioSpace
NEWS: Phase 2 topline met primary endpoint…`;

const PLACEHOLDER_EN = `Quick format (one news per line):
INBS | May 13, 2026 | FDA orphan drug designation | GlobeNewswire | short summary…

Or labeled block:
TICKER: PMVP
DATE: 2026-03-01
SOURCE: BioSpace
NEWS: Phase 2 topline met primary endpoint…`;

function fmtDate(iso: string, it: boolean): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtEisScore(score: number): string {
  return `${score >= 0 ? "+" : ""}${score.toFixed(1)}`;
}

function ManualFeedEisMarks({
  ev,
  it,
}: {
  ev: ManualFeedEventDraft;
  it: boolean;
}) {
  const eis = manualEventEis(ev);
  const kind = resolveManualEventNewsKind(ev);
  const newsLabel = formatManualNewsEisShort(eis.eis_intrinsic, kind);
  const marketAbs = Math.abs(eis.score);
  const showMarket = marketAbs >= 0.05;
  return (
    <span className="shrink-0 inline-flex flex-col items-end gap-0 leading-tight">
      {showMarket ? (
        <span
          className="text-[10px] font-bold tabular-nums"
          style={{ color: eisColor(eis.score) }}
          title={it ? "EIS mercato (prezzo/volume)" : "Market EIS (price/volume)"}
        >
          {fmtEisScore(eis.score)}
        </span>
      ) : (
        <span
          className="text-[10px] font-semibold tabular-nums text-ink-muted"
          title={
            it
              ? "EIS mercato n.d. — nessun Δ prezzo collegato"
              : "Market EIS n/a — no linked price move"
          }
        >
          —
        </span>
      )}
      {newsLabel ? (
        <span
          className="text-[9px] font-semibold tabular-nums"
          style={{
            color:
              eis.eis_intrinsic != null ? eisColor(eis.eis_intrinsic) : undefined,
          }}
          title={
            it
              ? `EIS news (${manualNewsEisKindLabel(kind, true)}) — non sommato nel market`
              : `News EIS (${manualNewsEisKindLabel(kind, false)}) — not added into market`
          }
        >
          {newsLabel}
        </span>
      ) : null}
    </span>
  );
}

function manualEventEis(ev: ManualFeedEventDraft) {
  return resolveManualEventEis(ev);
}

function previewEisForParsed(
  parsed: import("../sheet/manualFeedEvents").ParsedManualFeedInput,
) {
  return previewManualFeedEis(parsed);
}

function compactManualNewsTitle(ev: ManualFeedEventDraft, maxLen = 64): string {
  const text = (ev.title?.trim() || ev.body?.trim() || "").replace(/\s+/g, " ");
  if (!text) return ev.ticker;
  const short = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  return short;
}

function PortfolioTickerMark({ title }: { title: string }) {
  return (
    <span className="text-[10px] leading-none shrink-0" title={title} aria-label={title}>
      💼
    </span>
  );
}

/** ★ on positive manual EIS — ledger stars when 24h confirmed, else gold star on the row. */
function ManualFeedRowStar({
  ev,
  eisScore,
  starTitle,
}: {
  ev: ManualFeedEventDraft;
  eisScore: number;
  starTitle: string;
}) {
  if (eisScore <= 0) return null;
  const stars = getTickerGainStars(ev.ticker);
  if (stars.length > 0) {
    return <GainStarMarks stars={stars} sizeClass="text-[9px]" />;
  }
  return <ManualGainStarMark title={starTitle} className="text-[9px]" />;
}

export type ManualNewsResearchCandidate = {
  key: string;
  ticker: string;
  pnlPct: number | null;
  pnlPct24h: number | null;
  hasPosition: boolean;
  direction: "loss" | "gain";
  /** Decision chart zone — show B/S badge on research chips. */
  decisionRec?: DecisionRec | null;
};

function ManualFeedDecisionRecBadge({ rec }: { rec: DecisionRec | null | undefined }) {
  if (rec !== "buy" && rec !== "sell") return null;
  const label = rec === "buy" ? "B" : "S";
  const title = rec === "buy" ? "Buy" : "Sell";
  return (
    <span
      className={`text-[9px] font-extrabold leading-none tabular-nums ${
        rec === "buy"
          ? "text-[rgb(var(--signal-up))]"
          : "text-[rgb(var(--signal-down))]"
      }`}
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  );
}

/** @deprecated Use ManualNewsResearchCandidate */
export type ManualNewsLossCandidate = ManualNewsResearchCandidate;

function resolveInvestigationContextForTicker(
  ticker: string,
  opts: {
    activeLossTicker: string | null;
    activeGainTicker: string | null;
    lossResearchCandidates?: ManualNewsResearchCandidate[];
    gainResearchCandidates?: ManualNewsResearchCandidate[];
    variant: "panel" | "embedded";
    filterTicker: string | null;
    resolvedPriceMovePct: number | null;
  },
): "loss" | "gain" | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  if (opts.activeGainTicker?.trim().toUpperCase() === tk) return "gain";
  if (opts.activeLossTicker?.trim().toUpperCase() === tk) return "loss";
  if (opts.gainResearchCandidates?.some((c) => c.ticker.trim().toUpperCase() === tk)) {
    return "gain";
  }
  if (opts.lossResearchCandidates?.some((c) => c.ticker.trim().toUpperCase() === tk)) {
    return "loss";
  }
  const in24hPanel =
    (opts.lossResearchCandidates?.length ?? 0) > 0 ||
    (opts.gainResearchCandidates?.length ?? 0) > 0;
  if (!in24hPanel && opts.variant !== "embedded") return null;
  const move = opts.resolvedPriceMovePct;
  if (move != null && move > MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT) return "gain";
  if (move != null && move < -MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT) return "loss";
  if (opts.variant === "embedded" && opts.filterTicker?.trim().toUpperCase() === tk) {
    if (move != null && move > 0) return "gain";
    if (move != null && move < 0) return "loss";
  }
  return null;
}

export function ManualFeedNewsBox({
  onSaved,
  defaultTicker = null,
  filterTicker = null,
  variant = "panel",
  defaultExpanded = true,
  seedTemplate = false,
  seedTemplateNonce,
  forceExpanded = false,
  sectionId,
  textareaId,
  focusTextarea = false,
  hintMode,
  lossResearchCandidates,
  gainResearchCandidates,
  onPickLossCandidate,
  onPickGainCandidate,
  activeLossTicker = null,
  activeGainTicker = null,
  portfolioTickers,
  savedListRemoveMode = "delete-feed",
  currentMovePctByTicker,
}: {
  /** Called after manual events are added or removed (feed list refresh). */
  onSaved?: (meta?: { tickers: string[]; count: number }) => void;
  /** Pre-fill labeled template for this ticker (loss-analysis drop prompt). */
  defaultTicker?: string | null;
  /** Show only saved rows for this ticker (embedded card). */
  filterTicker?: string | null;
  variant?: "panel" | "embedded";
  defaultExpanded?: boolean;
  /** Insert TICKER/DATE/SOURCE/NEWS template when empty on mount. */
  seedTemplate?: boolean;
  /** Re-seed template when deep-linking to a different ticker. */
  seedTemplateNonce?: number;
  /** Keep section open (after modal CTA). */
  forceExpanded?: boolean;
  hintMode?: "embedded" | "global" | "panel";
  /** Tickers in loss without manual news yet (24h global box). */
  lossResearchCandidates?: ManualNewsResearchCandidate[];
  /** Tickers in gain without manual news yet (24h global box). */
  gainResearchCandidates?: ManualNewsResearchCandidate[];
  onPickLossCandidate?: (candidate: ManualNewsResearchCandidate) => void;
  onPickGainCandidate?: (candidate: ManualNewsResearchCandidate) => void;
  activeLossTicker?: string | null;
  activeGainTicker?: string | null;
  /** Tickers with an open portfolio position (for 💼 mark on chips / saved rows). */
  portfolioTickers?: ReadonlySet<string>;
  /**
   * hide-local: × only hides from this 24h checklist (Feed tab + EIS blocks unchanged).
   * delete-feed: × removes the event from all views (Feed tab default).
   */
  savedListRemoveMode?: "hide-local" | "delete-feed";
  /** Latest Var.24h % per ticker — hides checklist rows after a new material move. */
  currentMovePctByTicker?: ReadonlyMap<string, number | null>;
  /** Anchor id for deep-link scroll from warning modal. */
  sectionId?: string;
  textareaId?: string;
  /** Focus textarea after deep-link navigation. */
  focusTextarea?: boolean;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const [raw, setRaw] = useState("");
  const [saved, setSaved] = useState<ManualFeedEventDraft[]>(() => loadManualFeedEvents());
  const hideLocalOnly = savedListRemoveMode === "hide-local";
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded || forceExpanded);
  const [detailEvent, setDetailEvent] = useState<ManualFeedEventDraft | null>(null);
  const embedded = variant === "embedded";
  const resolvedHintMode = hintMode ?? (embedded ? "embedded" : "panel");
  const compactSavedList = resolvedHintMode === "global" || resolvedHintMode === "panel";
  const activeCandidate = useMemo(() => {
    const tk = (activeLossTicker ?? activeGainTicker ?? defaultTicker ?? "").trim().toUpperCase();
    if (!tk) return null;
    const loss = lossResearchCandidates?.find((c) => c.ticker.trim().toUpperCase() === tk);
    if (loss) return loss;
    const gain = gainResearchCandidates?.find((c) => c.ticker.trim().toUpperCase() === tk);
    if (gain) return gain;
    return null;
  }, [activeLossTicker, activeGainTicker, defaultTicker, lossResearchCandidates, gainResearchCandidates]);

  const resolvedPriceMovePct = useMemo(() => {
    if (!activeCandidate) return null;
    const pnl =
      activeCandidate.pnlPct24h != null && Number.isFinite(activeCandidate.pnlPct24h)
        ? activeCandidate.pnlPct24h
        : activeCandidate.pnlPct;
    return pnl != null && Number.isFinite(pnl) ? pnl : null;
  }, [activeCandidate]);

  const tkFilter = (filterTicker ?? defaultTicker)?.trim().toUpperCase() ?? "";
  const portfolioMarkTitle = t("sim.lossAnalysis.summaryTable.portfolioMark");
  const isPortfolioTicker = useCallback(
    (ticker: string) => portfolioTickers?.has(ticker.trim().toUpperCase()) ?? false,
    [portfolioTickers],
  );
  /** Avoid re-seeding template on every keystroke/paste (was wiping user input). */
  const lastTemplateSeedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  useEffect(() => {
    if (!seedTemplate || !defaultTicker?.trim()) return;
    const seedKey = `${defaultTicker.trim().toUpperCase()}|${seedTemplateNonce ?? "init"}`;
    if (lastTemplateSeedKeyRef.current === seedKey) return;
    lastTemplateSeedKeyRef.current = seedKey;
    setRaw(buildManualNewsTemplate(defaultTicker, it ? "it" : "en"));
  }, [seedTemplate, seedTemplateNonce, defaultTicker, it]);

  useEffect(() => {
    if (!focusTextarea || !textareaId || !expanded) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById(textareaId);
      if (el instanceof HTMLTextAreaElement) {
        el.focus({ preventScroll: true });
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [focusTextarea, textareaId, expanded]);

  const deferredRaw = useDeferredValue(raw);
  const parsedList = useMemo(
    () =>
      parseManualFeedForSubmit({
        raw: deferredRaw,
        defaultTicker,
        priceMovePct: resolvedPriceMovePct,
      }),
    [deferredRaw, defaultTicker, resolvedPriceMovePct],
  );

  const previewEisRows = useMemo(() => {
    const blobLen = deferredRaw.trim().length;
    const skipHeavyEis = blobLen > 4000;
    return parsedList.slice(0, 4).map((parsed) => ({
      parsed,
      previewEis: skipHeavyEis ? null : previewEisForParsed(parsed),
    }));
  }, [parsedList, deferredRaw]);

  const visibleSaved = useMemo(() => {
    const base = hideLocalOnly
      ? filterManualFeedEventsForAnchoredLossPanel(saved, currentMovePctByTicker)
      : saved;
    if (!tkFilter) return base;
    return base.filter((ev) => ev.ticker.trim().toUpperCase() === tkFilter);
  }, [saved, tkFilter, hideLocalOnly, currentMovePctByTicker]);
  const refreshSaved = useCallback(() => {
    setSaved(loadManualFeedEvents());
  }, []);

  useEffect(() => {
    const onChange = () => refreshSaved();
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
    window.addEventListener(MANUAL_FEED_LOSS_PANEL_DISMISSED_EVENT, onChange);
    return () => {
      window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onChange);
      window.removeEventListener(MANUAL_FEED_LOSS_PANEL_DISMISSED_EVENT, onChange);
    };
  }, [refreshSaved]);

  const handleSubmit = useCallback(() => {
    setError(null);
    setSuccess(null);
    const result = submitManualFeedRaw({
      raw,
      defaultTicker,
      priceMovePct: resolvedPriceMovePct,
      resolveInvestigationContext: (ticker, parsed) =>
        resolveInvestigationContextForTicker(ticker, {
          activeLossTicker,
          activeGainTicker,
          lossResearchCandidates,
          gainResearchCandidates,
          variant,
          filterTicker: filterTicker ?? defaultTicker,
          resolvedPriceMovePct,
        }) ??
        resolveManualInvestigationContext({
          id: "",
          createdAt: "",
          ticker: parsed.ticker,
          eventDate: parsed.eventDate,
          source: parsed.source,
          title: parsed.title,
          body: parsed.body,
          sentiment: parsed.sentiment,
          deltaP1d: parsed.deltaP1d,
          deltaP3d: parsed.deltaP3d,
          link: parsed.link,
          priceDropPct: parsed.priceDropPct,
          investigationOutcome: parsed.investigationOutcome,
        }),
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
    lastTemplateSeedKeyRef.current = null;
    setRaw("");
    refreshSaved();
    onSaved?.({ tickers: result.tickers, count: result.count });
    setSuccess(
      t("manualFeed.success.added", {
        n: String(result.count),
        tickers: result.tickers.join(", "),
      }),
    );
  }, [
    raw,
    refreshSaved,
    onSaved,
    t,
    it,
    resolvedPriceMovePct,
    activeLossTicker,
    activeGainTicker,
    lossResearchCandidates,
    gainResearchCandidates,
    variant,
    filterTicker,
    defaultTicker,
  ]);

  const handleRemove = useCallback(
    (id: string) => {
      if (hideLocalOnly) {
        dismissManualFeedFromLossPanel(id);
        refreshSaved();
        return;
      }
      removeManualFeedEvent(id);
      refreshSaved();
      onSaved?.();
    },
    [hideLocalOnly, onSaved, refreshSaved],
  );

  const openSavedDetail = useCallback((ev: ManualFeedEventDraft) => {
    setDetailEvent(ev);
  }, []);

  const renderSavedList = () => {
    if (visibleSaved.length === 0) return null;

    if (compactSavedList) {
      return (
        <div className="mt-1.5 space-y-1">
          <p className="text-[9px] text-ink-muted leading-snug">
            {hideLocalOnly ? t("manualFeed.savedList.hintHideLocal") : t("manualFeed.savedList.hint")}
          </p>
          <ul className="space-y-0.5">
          {[...visibleSaved].reverse().map((ev) => {
            const eis = manualEventEis(ev);
            const primary = resolveManualEventPrimaryEisScore(eis);
            return (
              <li
                key={ev.id}
                className="group flex items-center gap-1 rounded border border-[rgb(var(--border))]/25 hover:border-[rgb(var(--accent))]/35 hover:bg-[rgb(var(--accent))]/5 transition-colors"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 text-left"
                  title={it ? "Apri dettaglio completo" : "Open full detail"}
                  onClick={() => openSavedDetail(ev)}
                >
                  <span className="shrink-0 text-[10px] font-bold text-ink-muted tabular-nums inline-flex items-center gap-0.5">
                    {ev.ticker}
                    {isPortfolioTicker(ev.ticker) && primary > 0 ? (
                      <PortfolioTickerMark title={portfolioMarkTitle} />
                    ) : null}
                    <ManualFeedRowStar
                      ev={ev}
                      eisScore={primary}
                      starTitle={t("manualFeed.gainStar.mark")}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium feed-panel-text">
                    {compactManualNewsTitle(ev)}
                  </span>
                  <ManualFeedEisMarks ev={ev} it={it} />
                </button>
                <button
                  type="button"
                  className="shrink-0 w-6 h-6 mr-0.5 rounded text-[13px] feed-panel-muted hover:text-rose-600 opacity-60 group-hover:opacity-100"
                  title={
                    hideLocalOnly ? t("manualFeed.remove.hideLocal") : t("manualFeed.remove")
                  }
                  aria-label={
                    hideLocalOnly ? t("manualFeed.remove.hideLocal") : t("manualFeed.remove")
                  }
                  onClick={() => handleRemove(ev.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
          </ul>
        </div>
      );
    }

    return (
      <ul className="mt-2 space-y-1">
        {[...visibleSaved].reverse().map((ev) => {
          const eis = manualEventEis(ev);
          const primary = resolveManualEventPrimaryEisScore(eis);
          return (
            <li
              key={ev.id}
              className="flex items-start gap-2 rounded border border-[rgb(var(--border))]/30 px-2 py-1.5 text-[10px]"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => openSavedDetail(ev)}
              >
                <div className="flex flex-wrap gap-x-2 font-semibold feed-panel-text items-center">
                  <span className="inline-flex items-center gap-0.5">
                    {ev.ticker}
                    {isPortfolioTicker(ev.ticker) && primary > 0 ? (
                      <PortfolioTickerMark title={portfolioMarkTitle} />
                    ) : null}
                    <ManualFeedRowStar
                      ev={ev}
                      eisScore={primary}
                      starTitle={t("manualFeed.gainStar.mark")}
                    />
                  </span>
                  <span className="font-normal feed-panel-muted">{fmtDate(ev.eventDate, it)}</span>
                  <span className="font-normal feed-panel-muted">{ev.source}</span>
                </div>
                <p className="line-clamp-1 feed-panel-muted">{ev.title}</p>
              </button>
              <ManualFeedEisMarks ev={ev} it={it} />
              <button
                type="button"
                className="shrink-0 w-5 h-5 rounded text-[13px] feed-panel-muted hover:text-rose-600"
                title={
                  hideLocalOnly ? t("manualFeed.remove.hideLocal") : t("manualFeed.remove")
                }
                aria-label={
                  hideLocalOnly ? t("manualFeed.remove.hideLocal") : t("manualFeed.remove")
                }
                onClick={() => handleRemove(ev.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      id={sectionId}
      className={
        embedded
          ? "rounded-lg border border-[rgb(var(--border))]/45 bg-surface/30 overflow-hidden scroll-mt-3"
          : "shrink-0 border-b border-[rgb(var(--border))]/40 feed-panel-toolbar"
      }
    >
      <button
        type="button"
        className={
          embedded
            ? "w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold text-ink hover:bg-surface/60"
            : "w-full flex items-center gap-2 px-4 py-2 text-left text-[11px] font-semibold feed-panel-text hover:bg-[rgb(var(--panel-mint-bg-soft))]/40"
        }
        onClick={() => setExpanded((v) => !v)}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>{embedded ? t("manualFeed.embeddedTitle") : t("manualFeed.title")}</span>
        {visibleSaved.length > 0 ? (
          <span className={`ml-1 text-[10px] font-normal ${embedded ? "text-ink-muted" : "feed-panel-muted"}`}>
            · {visibleSaved.length}
          </span>
        ) : null}
      </button>

      {!expanded && compactSavedList && visibleSaved.length > 0 ? (
        <div className={`${embedded ? "px-3 pb-2" : "px-4 pb-2"}`}>{renderSavedList()}</div>
      ) : null}

      {expanded ? (
        <div className={`${embedded ? "px-3 pb-3" : "px-4 pb-3"} space-y-2`}>
          {resolvedHintMode === "global" && lossResearchCandidates ? (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-2.5 py-2 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-200">
                {t("manualFeed.lossCandidates.title")}
              </p>
              {lossResearchCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lossResearchCandidates.map((c) => {
                    const pnl =
                      c.pnlPct24h != null && Number.isFinite(c.pnlPct24h) ? c.pnlPct24h : null;
                    const active =
                      (activeLossTicker ?? activeGainTicker)?.trim().toUpperCase() ===
                      c.ticker.trim().toUpperCase();
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                          active
                            ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]"
                            : "border-rose-500/35 bg-white/80 dark:bg-black/20 text-rose-900 dark:text-rose-100 hover:border-[rgb(var(--accent))]/40"
                        }`}
                        onClick={() => onPickLossCandidate?.(c)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {c.ticker}
                          <ManualFeedDecisionRecBadge rec={c.decisionRec} />
                          {c.hasPosition ? (
                            <PortfolioTickerMark title={portfolioMarkTitle} />
                          ) : null}
                        </span>
                        {pnl != null && Number.isFinite(pnl) ? (
                          <span
                            className="tabular-nums opacity-90 inline-flex items-baseline gap-0.5"
                            title={t("sim.lossAnalysis.summaryTable.var24hTip")}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {pnl.toFixed(1)}%
                            <span className="text-[8px] font-normal opacity-75">24h</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-ink-muted leading-snug">
                  {t("manualFeed.lossCandidates.empty")}
                </p>
              )}
            </div>
          ) : null}

          {resolvedHintMode === "global" && gainResearchCandidates ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                {t("manualFeed.gainCandidates.title")}
              </p>
              {gainResearchCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {gainResearchCandidates.map((c) => {
                    const pnl =
                      c.pnlPct24h != null && Number.isFinite(c.pnlPct24h) ? c.pnlPct24h : null;
                    const active =
                      (activeGainTicker ?? activeLossTicker)?.trim().toUpperCase() ===
                      c.ticker.trim().toUpperCase();
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                          active
                            ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]"
                            : "border-emerald-500/35 bg-white/80 dark:bg-black/20 text-emerald-900 dark:text-emerald-100 hover:border-[rgb(var(--accent))]/40"
                        }`}
                        onClick={() => onPickGainCandidate?.(c)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {c.ticker}
                          <ManualFeedDecisionRecBadge rec={c.decisionRec} />
                          {c.hasPosition ? (
                            <PortfolioTickerMark title={portfolioMarkTitle} />
                          ) : null}
                        </span>
                        {pnl != null && Number.isFinite(pnl) ? (
                          <span
                            className="tabular-nums opacity-90 inline-flex items-baseline gap-0.5"
                            title={t("sim.lossAnalysis.summaryTable.var24hTip")}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {pnl.toFixed(1)}%
                            <span className="text-[8px] font-normal opacity-75">24h</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-ink-muted leading-snug">
                  {t("manualFeed.gainCandidates.empty")}
                </p>
              )}
            </div>
          ) : null}

          <p className={`text-[10px] leading-snug ${embedded ? "text-ink-muted" : "feed-panel-muted"}`}>
            {resolvedHintMode === "global"
              ? t("manualFeed.globalHint")
              : resolvedHintMode === "panel"
                ? t("manualFeed.hint")
                : t("manualFeed.embeddedHint")}
          </p>

          {(activeCandidate ?? defaultTicker) ? (
            <div className="flex flex-wrap gap-1.5">
              {activeCandidate?.direction !== "gain" ? (
                <>
                  <button
                    type="button"
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-900 dark:text-emerald-100 hover:border-emerald-600/60"
                    onClick={() => {
                      const tk = (activeCandidate?.ticker ?? defaultTicker ?? "").trim();
                      if (!tk) return;
                      lastTemplateSeedKeyRef.current = `quick|${tk}|no_catalyst|${Date.now()}`;
                      setRaw(
                        buildNoCatalystManualNewsTemplate(tk, resolvedPriceMovePct, it ? "it" : "en"),
                      );
                      setError(null);
                      setSuccess(null);
                    }}
                  >
                    {t("manualFeed.quick.noCatalyst")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-900 dark:text-rose-100 hover:border-rose-600/60"
                    onClick={() => {
                      const tk = (activeCandidate?.ticker ?? defaultTicker ?? "").trim();
                      if (!tk) return;
                      lastTemplateSeedKeyRef.current = `quick|${tk}|negative|${Date.now()}`;
                      setRaw(
                        buildNegativeCatalystManualNewsTemplate(
                          tk,
                          resolvedPriceMovePct,
                          it ? "it" : "en",
                        ),
                      );
                      setError(null);
                      setSuccess(null);
                    }}
                  >
                    {t("manualFeed.quick.negativeCatalyst")}
                  </button>
                </>
              ) : null}
              {activeCandidate?.direction === "gain" ? (
                <button
                  type="button"
                  className="rounded-md border border-emerald-600/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-900 dark:text-emerald-100 hover:border-emerald-600/70"
                  onClick={() => {
                    const tk = (activeCandidate?.ticker ?? defaultTicker ?? "").trim();
                    if (!tk) return;
                    lastTemplateSeedKeyRef.current = `quick|${tk}|positive|${Date.now()}`;
                    setRaw(
                      buildPositiveCatalystManualNewsTemplate(
                        tk,
                        resolvedPriceMovePct,
                        it ? "it" : "en",
                      ),
                    );
                    setError(null);
                    setSuccess(null);
                  }}
                >
                  {t("manualFeed.quick.positiveCatalyst")}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-950 dark:text-sky-100 hover:border-sky-600/60"
                title={
                  it
                    ? "Template ricco per Claude — CAUSE_CLASS / EXPLAINS_MOVE rientrano in EIS e residual"
                    : "Rich Claude template — CAUSE_CLASS / EXPLAINS_MOVE feed EIS + residual"
                }
                onClick={() => {
                  const tk = (activeCandidate?.ticker ?? defaultTicker ?? "").trim();
                  if (!tk) return;
                  lastTemplateSeedKeyRef.current = `quick|${tk}|research|${Date.now()}`;
                  setRaw(
                    buildResearchManualNewsTemplate(tk, resolvedPriceMovePct, it ? "it" : "en"),
                  );
                  setError(null);
                  setSuccess(null);
                }}
              >
                {t("manualFeed.quick.research")}
              </button>
            </div>
          ) : null}

          <textarea
            id={textareaId}
            className={
              embedded
                ? "input w-full min-h-[6.5rem] rounded-lg px-3 py-2 text-[12px] font-mono leading-relaxed resize-y"
                : "feed-panel-input w-full min-h-[7rem] rounded-lg px-3 py-2 text-[12px] font-mono leading-relaxed resize-y"
            }
            placeholder={it ? PLACEHOLDER_IT : PLACEHOLDER_EN}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
              setSuccess(null);
            }}
          />

          {parsedList.length > 0 ? (
            <div className="rounded-lg border border-[rgb(var(--border))]/35 bg-white/30 dark:bg-black/10 px-3 py-2 text-[10px] space-y-1.5">
              <p className="font-semibold feed-panel-text">
                {t("manualFeed.preview.count", { n: String(parsedList.length) })}
              </p>
              {previewEisRows.map(({ parsed, previewEis }, idx) => {
                const card = buildManualCatalystPreviewCard({
                  parsed,
                  eis: previewEis,
                  lang: it ? "it" : "en",
                });
                const toneClass = (tone: "up" | "down" | "mixed" | "neutral") =>
                  tone === "down"
                    ? "text-rose-700 dark:text-rose-300"
                    : tone === "up"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-ink-muted";
                return (
                  <div
                    key={`${parsed.ticker}-${parsed.eventDate}-${idx}`}
                    className="rounded-md border border-[rgb(var(--border))]/30 bg-white/50 dark:bg-black/15 px-2.5 py-2 space-y-1.5"
                  >
                    {/* Catalyst event — only what matters */}
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-bold tracking-wide">{parsed.ticker}</span>
                      <span className="text-ink-muted">{card.eventDate}</span>
                      {card.subtype ? (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sky-900 dark:text-sky-100">
                          {card.subtype}
                        </span>
                      ) : null}
                      <span className={`text-[10px] font-semibold ${toneClass(
                        parsed.investigationOutcome === "negative_catalyst"
                          ? "down"
                          : parsed.investigationOutcome === "positive_catalyst"
                            ? "up"
                            : "mixed",
                      )}`}>
                        {card.outcome}
                      </span>
                      {card.eisLabel ? (
                        <span
                          className="text-[10px] font-bold tabular-nums"
                          style={{ color: eisColor(previewEis?.score ?? 0) }}
                        >
                          EIS {card.eisLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] font-medium feed-panel-text leading-snug line-clamp-2">
                      <span className="text-ink-muted font-normal">
                        {t("manualFeed.preview.catalyst")}:{" "}
                      </span>
                      {card.headline}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-ink-muted">
                      {card.filing ? (
                        <span>
                          <strong>{t("manualFeed.preview.filing")}:</strong> {card.filing}
                        </span>
                      ) : null}
                      {card.drugs ? (
                        <span className="line-clamp-1 max-w-full">
                          <strong>{t("manualFeed.preview.drugs")}:</strong> {card.drugs}
                        </span>
                      ) : null}
                      {card.var24h ? (
                        <span>
                          <strong>{it ? "Var." : "Var.24h"}:</strong> {card.var24h}
                        </span>
                      ) : (
                        <span>{it ? "Var. non verificata" : "Var. unverified"}</span>
                      )}
                      {card.dilutionPct != null ? (
                        <span className="font-semibold text-rose-700/90 dark:text-rose-300/90">
                          {it ? "Diluzione" : "Dilution"} {card.dilutionPct}%
                        </span>
                      ) : null}
                    </div>
                    {card.facts.length > 0 ? (
                      <ul className="grid gap-0.5 text-[9px] leading-snug text-ink-muted sm:grid-cols-2">
                        {card.facts.map((f) => (
                          <li key={f} className="truncate" title={f}>
                            · {f}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {/* Correlated score effects */}
                    <div className="border-t border-[rgb(var(--border))]/25 pt-1.5 space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                        {t("manualFeed.preview.effects")}
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {card.effects.map((ef) => (
                          <div
                            key={`${ef.label}-${ef.value}`}
                            className="rounded border border-[rgb(var(--border))]/25 px-1.5 py-1"
                          >
                            <div className="text-[9px] font-semibold text-ink">{ef.label}</div>
                            <div
                              className={`text-[9px] leading-snug line-clamp-2 ${toneClass(ef.tone)}`}
                              title={ef.value}
                            >
                              {ef.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              {parsedList.length > 4 ? (
                <p className="text-[9px] feed-panel-muted">
                  +{parsedList.length - 4} {it ? "altre" : "more"}
                </p>
              ) : null}
            </div>
          ) : raw.trim() ? (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 leading-snug">
              {t("manualFeed.error.incomplete")}
            </p>
          ) : null}

          {error ? (
            <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
          ) : null}
          {success ? (
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 leading-snug">{success}</p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="feed-panel-btn-primary rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              disabled={parsedList.length === 0}
              onClick={handleSubmit}
            >
              {parsedList.length > 1
                ? t("manualFeed.submitMany", { n: String(parsedList.length) })
                : t("manualFeed.submit")}
            </button>
            <span className="text-[9px] feed-panel-muted">{t("manualFeed.propagateHint")}</span>
          </div>

          {visibleSaved.length > 0 ? renderSavedList() : null}
        </div>
      ) : null}
      {detailEvent ? (
        <ManualNewsDetailModal
          payload={{
            ticker: detailEvent.ticker,
            eventDate: detailEvent.eventDate,
            title: detailEvent.title,
            body: detailEvent.body || detailEvent.title,
            source: detailEvent.source,
            link: detailEvent.link,
            eisScore: manualEventEis(detailEvent).score,
            eisNews: manualEventEis(detailEvent).eis_intrinsic,
            newsKind: resolveManualEventNewsKind(detailEvent),
          }}
          it={it}
          onClose={() => setDetailEvent(null)}
        />
      ) : null}
    </div>
  );
}
