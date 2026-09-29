import { useMemo, useState, type SyntheticEvent } from "react";
import { buildTickerEisDetail, isCtgovRegistryFeedEvent, type TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { clinicalEventsLinkedToProduct, clinicalNewsEventsOnly, fdaBriefingEventsLinkedToProduct, isFdaBriefingEvent } from "../sheet/tickerImpactEvents";
import { resolveEventMarketEisHorizons } from "../sheet/eventMarketEisHorizons";
import { formatNewsDimScore } from "../sheet/newsDimensionScores";
import { EisFreeNotesBox } from "./EisCompetitionNotesBox";
import { ProductClinicalLeadBlock } from "./ProductClinicalLeadBlock";
import { TickerCompany30dCatalystPanel } from "./ClinicalDevelopmentLaneChart";
import { useTickerGuidanceEvents } from "./TickerCatalystEventsTable";
import { collectDiseaseSocFromRecords } from "../sheet/clinicalSocCompare";
import {
  collectEisProductBriefing,
} from "../sheet/eisProductBriefing";
import { EisEventDetailModal } from "./EisEventDetailModal";
import { EventMarketEisHorizonChips } from "./EventMarketEisHorizonChips";
import { eisScoreLegendCopy, ScoreChipTip } from "./EisScoreLegendHover";
import { NctStudyLink } from "./EisStudyContextHeader";
import { openExternalUrl, normalizeExternalHref } from "../sheet/k8ChartLinks";
import type { ClinicalPreCdRecord, RegulatoryRiskSnapshot } from "../api/supernova";
import {
  dismissEisNews,
  eisClinicalNewsStableId,
  useDismissedEisNewsIds,
} from "../sheet/eisNewsDismiss";

/** Green / red pill tone (readable on light + dark — not muted grey). */
function dimTone(n: number): { color: string; border: string; bg: string } {
  if (n > 0) {
    return { color: "#16a34a", border: "rgba(22,163,74,0.55)", bg: "rgba(22,163,74,0.16)" };
  }
  if (n < 0) {
    return { color: "#dc2626", border: "rgba(220,38,38,0.55)", bg: "rgba(220,38,38,0.14)" };
  }
  return { color: "#64748b", border: "rgba(100,116,139,0.45)", bg: "rgba(100,116,139,0.12)" };
}

function sumDimScores(
  events: TickerEisEventDetail[],
  pick: (ev: TickerEisEventDetail) => number | null | undefined,
): number | null {
  let sum = 0;
  let n = 0;
  for (const ev of events) {
    const s = pick(ev);
    if (s == null || !Number.isFinite(s)) continue;
    sum += s;
    n += 1;
  }
  return n > 0 ? Math.round(sum * 10) / 10 : null;
}

/** Header Σ chip — same layout as Financial “Σ Fin +0.3” (one dimension only). */
function SumDimChip({
  label,
  sum,
  tip,
}: {
  label: string;
  sum: number | null;
  tip: string;
}) {
  if (sum == null) return null;
  const tone = dimTone(sum);
  return (
    <ScoreChipTip tip={tip} align="right">
      <span
        className="inline-flex items-center text-base font-bold px-2.5 py-1 rounded-full tabular-nums cursor-help"
        style={{
          color: tone.color,
          border: `1px solid ${tone.border}`,
          background: tone.bg,
        }}
      >
        Σ {label} {formatNewsDimScore(sum)}
      </span>
    </ScoreChipTip>
  );
}

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

export function EisEventCard({
  ev,
  it,
  ticker,
  compact = false,
}: {
  ev: TickerEisEventDetail;
  it: boolean;
  ticker?: string;
  /** Lean card for dense lists. */
  compact?: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  /** Local hide so × always removes the card even if list filters lag. */
  const [removed, setRemoved] = useState(false);
  const dismissedNews = useDismissedEisNewsIds();
  const horizons = resolveEventMarketEisHorizons(ev.rawEvent ?? {});
  const bodyPreview = ev.summary?.trim() || ev.title;
  const isTruncated = bodyPreview.length > 180;
  const articleHref = normalizeExternalHref(ev.link);
  const studyHref = normalizeExternalHref(ev.studyUrl);
  const dismissId = eisClinicalNewsStableId({
    ticker: ticker || "",
    eventDate: ev.eventDate,
    title: ev.title,
    link: ev.link,
    sourceType: ev.sourceType,
  });
  if (removed || dismissedNews.has(dismissId)) return null;

  const clin = ev.clinicalScore;
  const clinTone = clin != null && Number.isFinite(clin) ? dimTone(clin) : null;
  const fin = ev.financialScore;
  const corp = ev.corporateScore;
  const acc = ev.marketAccessScore;
  const showFin = fin != null && Number.isFinite(fin) && Math.abs(fin) >= 0.15;
  const showCorp = corp != null && Number.isFinite(corp) && Math.abs(corp) >= 0.15;
  const showAcc = acc != null && Number.isFinite(acc) && Math.abs(acc) >= 0.15;

  const removeCard = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRemoved(true);
    dismissEisNews(dismissId);
  };

  return (
    <>
      <article
        className={`relative rounded-lg border border-[rgb(var(--border))]/45 bg-surface/60 space-y-2 ${
          compact ? "p-2.5 pt-5" : "p-3 pt-6"
        }`}
      >
        <button
          type="button"
          className="absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-3))]/90 text-[12px] leading-none text-ink-muted hover:bg-rose-500/20 hover:text-rose-500 hover:border-rose-500/40 transition-colors cursor-pointer"
          aria-label={it ? "Elimina questa news" : "Delete this news"}
          title={it ? "Elimina dalla lista" : "Remove from list"}
          onPointerDown={removeCard}
          onClick={removeCard}
        >
          ×
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgb(var(--surface-3))]/80 text-ink-muted">
                {ev.sourceLabel}
              </span>
              <span className="text-[10px] text-ink-muted tabular-nums">{fmtDate(ev.eventDate, it)}</span>
            </div>
            <h4
              className={`font-semibold text-ink leading-snug ${compact ? "text-[13px] line-clamp-2" : "text-sm"}`}
            >
              {ev.companyAffiliated ? (
                <span
                  className="mr-1 inline-block text-amber-300"
                  title={
                    it
                      ? "Autore affiliato alla società"
                      : "Author affiliated with the company"
                  }
                  aria-label={
                    it
                      ? "Autore affiliato alla società"
                      : "Author affiliated with the company"
                  }
                >
                  ★
                </span>
              ) : null}
              {ev.title}
            </h4>
            {ev.isPaper || ev.abstract || (!compact && ev.summary && ev.summary !== ev.title) ? (
              <div className="mt-2 space-y-1.5">
                {ev.isPaper || ev.abstract ? (
                  <>
                    {(() => {
                      const paperSecs = (ev.sectionSummaries || [])
                        .map((s) => ({
                          heading: (s.heading || "").trim(),
                          summary: (s.summary || "").trim(),
                        }))
                        .filter((s) => s.summary)
                        .filter((s) => {
                          const h = s.heading;
                          if (/^abstract$/i.test(h)) return false;
                          if (/article\s*\/\s*brief/i.test(h)) return false;
                          return /introduction|background|results?|discussion|conclusions?/i.test(
                            h,
                          );
                        })
                        .map((s) => {
                          const h = s.heading;
                          const label = /introduction|background/i.test(h)
                            ? "Introduction"
                            : /results?/i.test(h)
                              ? "Results"
                              : "Discussion";
                          return { label, summary: s.summary };
                        });
                      const order = ["Introduction", "Results", "Discussion"] as const;
                      const byLabel = new Map<string, string>();
                      for (const s of paperSecs) {
                        if (!byLabel.has(s.label)) byLabel.set(s.label, s.summary);
                      }
                      const ordered = order
                        .filter((l) => byLabel.has(l))
                        .map((l) => ({ label: l, summary: byLabel.get(l)! }));
                      /** Company papers: full Intro/Results/Discussion in the main card. */
                      const showFull = Boolean(ev.companyAffiliated) || !compact;
                      if (ordered.length) {
                        return ordered.map((sec) => (
                          <div key={sec.label}>
                            <p className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
                              {sec.label}
                            </p>
                            <p
                              className={`text-[11px] leading-snug mt-0.5 text-ink whitespace-pre-wrap ${
                                showFull ? "" : "line-clamp-5"
                              }`}
                            >
                              {sec.summary}
                            </p>
                          </div>
                        ));
                      }
                      return (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">
                            Abstract
                          </p>
                          <p
                            className={`text-[11px] text-ink leading-snug mt-0.5 whitespace-pre-wrap ${
                              showFull ? "" : "line-clamp-6"
                            }`}
                          >
                            {(ev.abstract || "").trim() ||
                              (it
                                ? "Abstract non disponibile."
                                : "Abstract not available.")}
                          </p>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-[11px] text-ink-muted leading-snug line-clamp-3">
                    {ev.summary}
                  </p>
                )}
              </div>
            ) : null}
            {!compact && ev.studyTitle ? (
              <p className="text-[11px] font-medium text-ink/90 mt-1.5 leading-snug">{ev.studyTitle}</p>
            ) : null}
            {!compact && ev.nctId && studyHref ? (
              <div className="mt-1">
                <NctStudyLink nctId={ev.nctId} href={studyHref} />
              </div>
            ) : !compact && ev.nctId ? (
              <span className="text-[10px] font-mono text-ink-muted mt-1 inline-block">{ev.nctId}</span>
            ) : null}
          </div>
          <div className="shrink-0 text-right space-y-1.5">
            <ScoreChipTip tip={eisScoreLegendCopy(it).clin} align="right">
              <span
                className="inline-flex items-center text-[12px] font-bold px-2 py-0.5 rounded-full tabular-nums cursor-help"
                style={
                  clinTone
                    ? {
                        background: clinTone.bg,
                        color: clinTone.color,
                        border: `1px solid ${clinTone.border}`,
                      }
                    : {
                        background: "rgba(100,116,139,0.12)",
                        color: "#64748b",
                        border: "1px solid rgba(100,116,139,0.4)",
                      }
                }
              >
                Clin {formatNewsDimScore(clin ?? null)}
              </span>
            </ScoreChipTip>
            {showFin || showCorp || showAcc ? (
              <div className="flex flex-wrap justify-end gap-1">
                {showFin ? (
                  <ScoreChipTip tip={eisScoreLegendCopy(it).fin} align="right">
                    <span
                      className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums cursor-help"
                      style={{
                        background: dimTone(fin!).bg,
                        color: dimTone(fin!).color,
                        border: `1px solid ${dimTone(fin!).border}`,
                      }}
                    >
                      Fin {formatNewsDimScore(fin)}
                    </span>
                  </ScoreChipTip>
                ) : null}
                {showCorp ? (
                  <ScoreChipTip tip={eisScoreLegendCopy(it).corp} align="right">
                    <span
                      className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums cursor-help"
                      style={{
                        background: dimTone(corp!).bg,
                        color: dimTone(corp!).color,
                        border: `1px solid ${dimTone(corp!).border}`,
                      }}
                    >
                      Corp {formatNewsDimScore(corp)}
                    </span>
                  </ScoreChipTip>
                ) : null}
                {showAcc ? (
                  <ScoreChipTip tip={eisScoreLegendCopy(it).acc} align="right">
                    <span
                      className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums cursor-help"
                      style={{
                        background: dimTone(acc!).bg,
                        color: dimTone(acc!).color,
                        border: `1px solid ${dimTone(acc!).border}`,
                      }}
                    >
                      Acc {formatNewsDimScore(acc)}
                    </span>
                  </ScoreChipTip>
                ) : null}
              </div>
            ) : null}
            <EventMarketEisHorizonChips horizons={horizons} it={it} />
          </div>
        </div>
        {!compact && ev.impactNote ? (
          <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2 line-clamp-2">
            {ev.impactNote}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          {articleHref ? (
            <a
              href={articleHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2"
              onClick={(e) => openExternalUrl(articleHref, e)}
            >
              {it
                ? ev.isPaper
                  ? "Apri articolo PubMed →"
                  : "Apri news / fonte →"
                : ev.isPaper
                  ? "Open PubMed article →"
                  : "Open news / source →"}
            </a>
          ) : null}
          <button
            type="button"
            className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailOpen(true);
            }}
          >
            {compact
              ? it
                ? "Dettaglio →"
                : "Detail →"
              : isTruncated
                ? it
                  ? "Leggi testo completo →"
                  : "Read full text →"
                : it
                  ? "Dettaglio completo EIS →"
                  : "Full EIS detail →"}
          </button>
        </div>
      </article>
      {detailOpen ? (
        <EisEventDetailModal
          ev={ev}
          ticker={ticker}
          it={it}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </>
  );
}

export function EisDetailPanel({
  ticker,
  clinicalKpi,
  clinicalRecords,
  simRow,
  autoRegSnap,
  sdsMechanismClass,
  it = false,
  showStudyOutcomes = true,
}: {
  ticker: string;
  clinicalKpi?: number | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  simRow?: Record<string, unknown> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  /** SDS mechanism_class fallback when AI profile has no MoA yet. */
  sdsMechanismClass?: string | null;
  it?: boolean;
  /** Hide when a parent already renders the product dossier. */
  showStudyOutcomes?: boolean;
}) {
  const resolvedTicker = ticker.trim().toUpperCase();
  const dismissedNews = useDismissedEisNewsIds();
  const guidanceEvents = useTickerGuidanceEvents(resolvedTicker);
  const completionDate = simRow?.["Completion Date"];
  const detail = useMemo(
    () =>
      buildTickerEisDetail(
        ticker,
        it ? "it" : "en",
        clinicalKpi,
        clinicalRecords,
        completionDate,
      ),
    [ticker, it, clinicalKpi, clinicalRecords, completionDate],
  );
  const clinicalEvents = useMemo(
    () => clinicalNewsEventsOnly(detail.events),
    [detail.events],
  );
  const productBriefing = useMemo(
    () =>
      collectEisProductBriefing(clinicalRecords, {
        ticker: resolvedTicker,
        nctId: detail.nctId,
        studyDrug: detail.studyDrug,
        sdsMechanismClass,
      }),
    [clinicalRecords, resolvedTicker, detail.nctId, detail.studyDrug, sdsMechanismClass],
  );
  const productClinicalEvents = useMemo(
    () =>
      clinicalEventsLinkedToProduct(clinicalEvents, {
        productName: productBriefing.productName || detail.studyDrug,
        nctId: detail.nctId,
      }).filter(
        (ev) =>
          !dismissedNews.has(
            eisClinicalNewsStableId({
              ticker: resolvedTicker,
              eventDate: ev.eventDate,
              title: ev.title,
              link: ev.link,
              sourceType: ev.sourceType,
            }),
          ),
      ),
    [
      clinicalEvents,
      productBriefing.productName,
      detail.studyDrug,
      detail.nctId,
      dismissedNews,
      resolvedTicker,
    ],
  );
  const productFdaBriefings = useMemo(
    () =>
      fdaBriefingEventsLinkedToProduct(detail.events, {
        productName: productBriefing.productName || detail.studyDrug,
        nctId: detail.nctId,
      }).filter(
        (ev) =>
          !dismissedNews.has(
            eisClinicalNewsStableId({
              ticker: resolvedTicker,
              eventDate: ev.eventDate,
              title: ev.title,
              link: ev.link,
              sourceType: ev.sourceType,
            }),
          ),
      ),
    [
      detail.events,
      productBriefing.productName,
      detail.studyDrug,
      detail.nctId,
      dismissedNews,
      resolvedTicker,
    ],
  );
  const diseaseSoc = useMemo(
    () =>
      collectDiseaseSocFromRecords(clinicalRecords, detail.studyConditions, {
        ticker: resolvedTicker,
        nctId: detail.nctId,
      }),
    [clinicalRecords, detail.studyConditions, resolvedTicker, detail.nctId],
  );

  void autoRegSnap;
  const [dossierPaperClinSum, setDossierPaperClinSum] = useState<number | null>(null);
  /** Header: Σ Clin / Fin / Acc only — never Σ EIS. Clin includes PubMed product papers. */
  const clinSumFeed = useMemo(
    () => sumDimScores(productClinicalEvents, (e) => e.clinicalScore),
    [productClinicalEvents],
  );
  const clinSum = useMemo(() => {
    const parts = [clinSumFeed, dossierPaperClinSum].filter(
      (x): x is number => x != null && Number.isFinite(x),
    );
    if (!parts.length) return null;
    return Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10;
  }, [clinSumFeed, dossierPaperClinSum]);
  const finSum = useMemo(
    () => sumDimScores(productClinicalEvents, (e) => e.financialScore),
    [productClinicalEvents],
  );
  const accSum = useMemo(
    () => sumDimScores(productClinicalEvents, (e) => e.marketAccessScore),
    [productClinicalEvents],
  );
  const completionIso =
    typeof completionDate === "string"
      ? completionDate
      : completionDate != null
        ? String(completionDate)
        : detail.cdDate;

  return (
    <div className="space-y-4">
      <div className="eis-thermo-gloss rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
              {it ? "R&D" : "R&D"}
            </p>
            <h3 className="text-xl font-bold text-ink">{ticker.toUpperCase()}</h3>
            {detail.company ? (
              <p className="text-[12px] text-ink-muted">{detail.company}</p>
            ) : null}
            {detail.catalystFit === "unexplained_readthrough" ? (
              <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200 leading-snug mt-1.5 max-w-prose">
                {it
                  ? "Possibile lettura settoriale — nessuna news di trial del ticker spiega il movimento."
                  : "Possible sector read-through — no own-ticker trial news explains the move."}
              </p>
            ) : null}
          </div>
          <div className="text-right shrink-0 space-y-2">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ScoreChipTip tip={eisScoreLegendCopy(it).eis} align="right">
                <span
                  className="inline-flex items-center cursor-help rounded-full border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted"
                  aria-label={eisScoreLegendCopy(it).eis}
                >
                  EIS
                </span>
              </ScoreChipTip>
              <SumDimChip label="Clin" sum={clinSum} tip={eisScoreLegendCopy(it).clin} />
              <SumDimChip label="Fin" sum={finSum} tip={eisScoreLegendCopy(it).fin} />
              <SumDimChip label="Acc" sum={accSum} tip={eisScoreLegendCopy(it).acc} />
            </div>
            {productClinicalEvents.length > 0 ? (
              <p className="text-[10px] text-[#4C3FD1] font-medium mt-1 max-w-[16rem] ml-auto">
                {it
                  ? `${productClinicalEvents.length} news · Clin, Fin e Acc sommati ciascuno a parte (EIS solo per evento)`
                  : `${productClinicalEvents.length} news · Clin, Fin & Acc each summed separately (EIS per event only)`}
              </p>
            ) : detail.breakdownHint ? (
              <p className="text-[10px] text-[#4C3FD1] font-medium mt-1 max-w-[14rem] ml-auto">{detail.breakdownHint}</p>
            ) : null}
          </div>
        </div>

        <TickerCompany30dCatalystPanel
          ticker={resolvedTicker}
          completionDate={completionIso}
          records={clinicalRecords}
          guidanceEvents={guidanceEvents}
          clinicalKpi={clinicalKpi}
          simRow={simRow}
          it={it}
        />

        {detail.sheetFallback ? (
          <p className="text-[11px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border border-[rgb(var(--warn))]/25 rounded-md px-2.5 py-1.5">
            {it
              ? "Score da colonna Simulation — nessun evento nel feed clinico. Aggiorna il feed per il breakdown completo."
              : "Score from Simulation sheet column — no clinical feed events. Refresh feed for full breakdown."}
          </p>
        ) : null}
      </div>

      <ProductClinicalLeadBlock
        ticker={resolvedTicker}
        company={detail.company}
        productName={productBriefing.productName || detail.studyDrug}
        nctId={detail.nctId}
        briefing={productBriefing}
        clinicalRecords={clinicalRecords}
        eisEvents={productClinicalEvents}
        clinicalNewsEvents={productClinicalEvents}
        fdaBriefingEvents={productFdaBriefings}
        diseaseSoc={diseaseSoc}
        showStudyOutcomes={showStudyOutcomes}
        focalProductOnly
        it={it}
        guidanceEvents={guidanceEvents}
        cdIso={completionIso}
        onDossierPaperClinSum={setDossierPaperClinSum}
      />

      {!showStudyOutcomes && (productClinicalEvents.length > 0 || productFdaBriefings.length > 0) ? (
        <div className="space-y-2">
          {(() => {
            const press = productClinicalEvents.filter(
              (ev) =>
                !isFdaBriefingEvent(ev) &&
                (!ev.isPaper || isCtgovRegistryFeedEvent(ev)),
            );
            const papers = productClinicalEvents.filter(
              (ev) => Boolean(ev.isPaper) && !isCtgovRegistryFeedEvent(ev),
            );
            return (
              <>
                {productFdaBriefings.length ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-ink">
                      {it
                        ? `Briefing FDA (${productFdaBriefings.length})`
                        : `FDA Briefings (${productFdaBriefings.length})`}
                    </h4>
                    {productFdaBriefings.map((ev, i) => (
                      <EisEventCard
                        key={`fda-${ev.eventDate}-${ev.title}-${i}`}
                        ev={ev}
                        it={it}
                        ticker={resolvedTicker}
                        compact={false}
                      />
                    ))}
                  </div>
                ) : null}
                {press.length ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-ink">
                      {it
                        ? `News del prodotto (${press.length})`
                        : `Product news (${press.length})`}
                    </h4>
                    {press.map((ev, i) => (
                      <EisEventCard
                        key={`clin-${ev.eventDate}-${ev.title}-${i}`}
                        ev={ev}
                        it={it}
                        ticker={resolvedTicker}
                      />
                    ))}
                  </div>
                ) : null}
                {papers.length ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-ink">
                      {it
                        ? `Articoli scientifici (${papers.length})`
                        : `Scientific articles (${papers.length})`}
                    </h4>
                    {papers.map((ev, i) => (
                      <EisEventCard
                        key={`paper-${ev.eventDate}-${ev.title}-${i}`}
                        ev={ev}
                        it={it}
                        ticker={resolvedTicker}
                        compact={false}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : !showStudyOutcomes && !detail.sheetFallback ? (
        <p className="text-[12px] text-ink-muted text-center py-6 border border-dashed rounded-lg">
          {it
            ? "Nessuna news clinica collegata a questo prodotto nel feed."
            : "No clinical news in the feed linked to this product."}
        </p>
      ) : null}

      <EisFreeNotesBox ticker={resolvedTicker} it={it} />
    </div>
  );
}
