import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClinicalPreCdRecord,
  DiseaseSocContext,
  GuidanceCalendarEvent,
  ProductStudyCard,
  ProductStudyDossier,
} from "../api/supernova";
import { fetchClinicalStudyMeta } from "../api/supernova";
import {
  attachEisScoresToStudyBriefings,
  collectStudyOutcomeBriefings,
  mergeStudyOutcomeWithCtgovMeta,
  preserveStudyOutcomeCtgovFills,
  type StudyEisEventLike,
  type StudyOutcomeBriefing,
} from "../sheet/studyOutcomeBriefing";
import { CdProductStudySummary } from "./CdProductStudySummary";
import { ProductStudyDossierPanel } from "./ProductStudyDossierPanel";
import { EisEventCard } from "./EisDetailPanel";
import { collectEisProductBriefing } from "../sheet/eisProductBriefing";
import {
  blobMentionsProduct,
  collectTickerPipelineProducts,
  type PipelineProductGroup,
} from "../sheet/studyProductLink";
import { clinicalDrugFromSimRow, usableProductName } from "../sheet/simRowClinicalMeta";
import {
  clinicalEventsLinkedToProduct,
  fdaBriefingEventsLinkedToProduct,
  isFdaBriefingEvent,
} from "../sheet/tickerImpactEvents";
import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { isCtgovRegistryFeedEvent } from "../sheet/tickerEisSummary";
import {
  eisClinicalNewsStableId,
  useDismissedEisNewsIds,
} from "../sheet/eisNewsDismiss";
import { useLang } from "../shared/i18n";

function needsCtgovFill(b: StudyOutcomeBriefing): boolean {
  return Boolean(
    b.nctId &&
      (!b.design || !b.inclusionCriteria || b.enrollment == null || !b.endedDate),
  );
}

function briefingsForProduct(
  all: StudyOutcomeBriefing[],
  product: PipelineProductGroup,
): StudyOutcomeBriefing[] {
  return all.filter((b) =>
    blobMentionsProduct(`${b.studyTitle || ""} ${b.nctId || ""}`, product.name),
  );
}

const PRODUCT_NEWS_PREVIEW = 3;

function ProductNewsList({
  events,
  ticker,
  it,
}: {
  events: TickerEisEventDetail[];
  ticker: string;
  it: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const dismissedNews = useDismissedEisNewsIds();
  const active = useMemo(
    () =>
      events.filter(
        (ev) =>
          !dismissedNews.has(
            eisClinicalNewsStableId({
              ticker,
              eventDate: ev.eventDate,
              title: ev.title,
              link: ev.link,
              sourceType: ev.sourceType,
            }),
          ),
      ),
    [events, dismissedNews, ticker],
  );
  if (!active.length) return null;
  const visible = expanded ? active : active.slice(0, PRODUCT_NEWS_PREVIEW);
  const hidden = Math.max(0, active.length - PRODUCT_NEWS_PREVIEW);
  return (
    <div className="space-y-2">
      {visible.map((ev, i) => (
        <EisEventCard
          key={`prod-news-${ev.eventDate}-${ev.title}-${i}`}
          ev={ev}
          it={it}
          ticker={ticker}
          compact
        />
      ))}
      {!expanded && hidden > 0 ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
          onClick={() => setExpanded(true)}
        >
          {it ? `Mostra altre ${hidden} news →` : `Show ${hidden} more news →`}
        </button>
      ) : null}
      {expanded && active.length > PRODUCT_NEWS_PREVIEW ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-ink-muted hover:underline"
          onClick={() => setExpanded(false)}
        >
          {it ? "Mostra meno" : "Show less"}
        </button>
      ) : null}
    </div>
  );
}

function PipelineProductCard({
  ticker,
  company,
  product,
  briefings,
  primaryNctId,
  autoLoad = false,
  showCompetition = true,
  indication = null,
  clinicalRecords = null,
  clinicalNewsEvents = [],
  fdaBriefingEvents = [],
  cdIso = null,
  guidanceEvents = null,
  onDossierPaperClinSum,
}: {
  ticker: string;
  company?: string | null;
  product: PipelineProductGroup;
  briefings: StudyOutcomeBriefing[];
  primaryNctId?: string | null;
  autoLoad?: boolean;
  showCompetition?: boolean;
  indication?: string | null;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  clinicalNewsEvents?: TickerEisEventDetail[];
  /** Migrated FDA AdCom briefings for this product (dedicated session). */
  fdaBriefingEvents?: TickerEisEventDetail[];
  cdIso?: string | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  onDossierPaperClinSum?: (sum: number | null) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [aliases, setAliases] = useState<string[]>([]);
  /** Auto-load CT.gov for Ongoing trials; PubMed still on demand via publications panel. */
  const [showDossier, setShowDossier] = useState(Boolean(autoLoad));
  const [ctgovStudies, setCtgovStudies] = useState<ProductStudyCard[]>([]);
  const [dossier, setDossier] = useState<ProductStudyDossier | null>(null);
  const handleAliases = useCallback((next: string[]) => {
    setAliases((prev) => {
      const merged = [...new Set([...prev, ...next.map((s) => s.trim()).filter(Boolean)])];
      if (merged.length === prev.length && merged.every((x, i) => x === prev[i])) return prev;
      return merged;
    });
  }, []);

  useEffect(() => {
    if (!onDossierPaperClinSum) return;
    const papers = dossier?.papers ?? [];
    let s = 0;
    let n = 0;
    for (const p of papers) {
      const v = p.clinical_score;
      if (v == null || !Number.isFinite(v)) continue;
      s += v;
      n += 1;
    }
    onDossierPaperClinSum(n > 0 ? Math.round(s * 10) / 10 : null);
  }, [dossier, onDossierPaperClinSum]);

  const nct = product.isCompletingCd ? primaryNctId : product.nctId;
  const productNews = useMemo(
    () =>
      clinicalEventsLinkedToProduct(clinicalNewsEvents, {
        productName: product.name,
        nctId: nct || null,
      }),
    [clinicalNewsEvents, product.name, nct],
  );
  const dismissedNews = useDismissedEisNewsIds();
  const pressNews = useMemo(
    () =>
      productNews.filter(
        (ev) =>
          !isFdaBriefingEvent(ev) &&
          (!ev.isPaper || isCtgovRegistryFeedEvent(ev)) &&
          !dismissedNews.has(
            eisClinicalNewsStableId({
              ticker,
              eventDate: ev.eventDate,
              title: ev.title,
              link: ev.link,
              sourceType: ev.sourceType,
            }),
          ),
      ),
    [productNews, dismissedNews, ticker],
  );
  const paperNews = useMemo(
    () =>
      productNews.filter(
        (ev) =>
          Boolean(ev.isPaper) &&
          !isCtgovRegistryFeedEvent(ev) &&
          !dismissedNews.has(
            eisClinicalNewsStableId({
              ticker,
              eventDate: ev.eventDate,
              title: ev.title,
              link: ev.link,
              sourceType: ev.sourceType,
            }),
          ),
      ),
    [productNews, dismissedNews, ticker],
  );
  const fdaNews = useMemo(() => {
    const linked = fdaBriefingEventsLinkedToProduct(fdaBriefingEvents, {
      productName: product.name,
      nctId: nct || null,
    });
    return linked.filter(
      (ev) =>
        !dismissedNews.has(
          eisClinicalNewsStableId({
            ticker,
            eventDate: ev.eventDate,
            title: ev.title,
            link: ev.link,
            sourceType: ev.sourceType,
          }),
        ),
    );
  }, [fdaBriefingEvents, product.name, nct, dismissedNews, ticker]);

  const dossierNode = showDossier ? (
    <ProductStudyDossierPanel
      ticker={ticker}
      productName={product.name}
      company={company}
      primaryNctId={nct}
      aliases={aliases}
      section="trials"
      clinicalRecords={clinicalRecords}
      guidanceEvents={guidanceEvents}
      it={it}
      onStudies={setCtgovStudies}
      onDossier={setDossier}
    />
  ) : (
    <button
      type="button"
      className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
      onClick={() => setShowDossier(true)}
    >
      {it
        ? `Carica ClinicalTrials.gov + PubMed per ${product.name}`
        : `Load ClinicalTrials.gov + PubMed for ${product.name}`}
    </button>
  );

  const pubsNode = (
    <div className="space-y-2">
      {paperNews.length ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
            {it
              ? `Dal feed Daily News (${paperNews.length})`
              : `From Daily News feed (${paperNews.length})`}
          </p>
          {paperNews.map((ev, i) => (
            <EisEventCard
              key={`prod-paper-${ev.eventDate}-${ev.title}-${i}`}
              ev={ev}
              it={it}
              ticker={ticker}
              compact={false}
            />
          ))}
        </div>
      ) : null}
      {showDossier ? (
        <ProductStudyDossierPanel
          ticker={ticker}
          productName={product.name}
          company={company}
          primaryNctId={nct}
          aliases={aliases}
          section="publications"
          dossierOverride={dossier}
          clinicalRecords={clinicalRecords}
          guidanceEvents={guidanceEvents}
          it={it}
        />
      ) : (
        <button
          type="button"
          className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
          onClick={() => setShowDossier(true)}
        >
          {it
            ? "Carica CT.gov / PubMed per le pubblicazioni →"
            : "Load CT.gov / PubMed for publications →"}
        </button>
      )}
    </div>
  );

  const newsNode =
    pressNews.length > 0 ? (
      <ProductNewsList events={pressNews} ticker={ticker} it={it} />
    ) : null;

  const fdaNode =
    fdaNews.length > 0 ? (
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
          {it
            ? `Briefing AdCom migrati (${fdaNews.length}) · EIS 12/24/36h in arrivo`
            : `Migrated AdCom briefings (${fdaNews.length}) · EIS 12/24/36h coming`}
        </p>
        {fdaNews.map((ev, i) => (
          <EisEventCard
            key={`prod-fda-${ev.eventDate}-${ev.title}-${i}`}
            ev={ev}
            it={it}
            ticker={ticker}
            compact={false}
          />
        ))}
      </div>
    ) : null;

  return (
    <div className="space-y-2">
      <CdProductStudySummary
        ticker={ticker}
        company={company}
        productName={product.name}
        primaryNctId={nct}
        briefings={briefings}
        ctgovStudies={ctgovStudies}
        onAliases={handleAliases}
        kind={product.isCompletingCd ? "completing_cd" : "pipeline"}
        indication={indication}
        clinicalRecords={clinicalRecords}
        showCompetition={showCompetition}
        clinicalNews={newsNode}
        fdaBriefings={fdaNode}
        scientificPublications={pubsNode}
        ongoingTrialsExtra={dossierNode}
        cdIso={product.isCompletingCd ? cdIso : null}
        guidanceEvents={guidanceEvents}
      />
    </div>
  );
}

/**
 * One product summary card per pipeline asset. Completing CD is first;
 * CT.gov auto-loads for focal / completing-CD products.
 */
export function StudyOutcomesSection({
  clinicalRecords,
  ticker,
  primaryNctId,
  productName = null,
  company = null,
  eisEvents,
  clinicalNewsEvents,
  fdaBriefingEvents,
  indication = null,
  skipCompletingCd = false,
  focalProductOnly = false,
  showCompetition = true,
  guidanceEvents = null,
  cdIso = null,
  simRow = null,
  onDossierPaperClinSum,
}: {
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  ticker: string;
  primaryNctId?: string | null;
  productName?: string | null;
  company?: string | null;
  diseaseSoc?: DiseaseSocContext | null;
  eisEvents?: StudyEisEventLike[] | null;
  /** Full EIS event cards for the Clinical News box (product-filtered per card). */
  clinicalNewsEvents?: TickerEisEventDetail[] | null;
  /** Migrated FDA AdCom briefings for the FDA Briefings session. */
  fdaBriefingEvents?: TickerEisEventDetail[] | null;
  /** Indication shown in the Indication box (e.g. CT.gov conditions). */
  indication?: string | null;
  /** Lead product briefing + CT.gov/PubMed already sit at the top of Clinical news. */
  skipCompletingCd?: boolean;
  /** Deep Dive / CD: only the catalyst product — sibling pipeline assets stay on issuer news. */
  focalProductOnly?: boolean;
  /** Competition accordion inside product sheet. */
  showCompetition?: boolean;
  /** Guidance calendar — seeds product cards when clinical feed has no ticker row. */
  guidanceEvents?: import("../api/supernova").GuidanceCalendarEvent[] | null;
  /** Simulation / calendar CD ISO used to pick the completing guidance event. */
  cdIso?: string | null;
  /** Simulation / Catalyst row — Product column (never use NCT as product). */
  simRow?: Record<string, unknown> | null;
  /** Σ Clin from PubMed product-study papers (separate from Daily News feed). */
  onDossierPaperClinSum?: (sum: number | null) => void;
}) {
  const resolvedProduct = useMemo(() => {
    const fromSim = clinicalDrugFromSimRow(simRow ?? undefined);
    if (fromSim) return fromSim;
    const hint = usableProductName(productName);
    if (hint) return hint;
    if (!primaryNctId) return null;
    return (
      usableProductName(
        collectEisProductBriefing(clinicalRecords, {
          ticker,
          nctId: primaryNctId,
        }).productName,
      ) || null
    );
  }, [productName, clinicalRecords, ticker, primaryNctId, simRow]);

  const products = useMemo(
    () =>
      collectTickerPipelineProducts(clinicalRecords, {
        ticker,
        primaryNctId,
        completingProduct: resolvedProduct,
        guidanceEvents,
        cdIso,
      }),
    [clinicalRecords, ticker, primaryNctId, resolvedProduct, guidanceEvents, cdIso],
  );

  const base = useMemo(
    () =>
      attachEisScoresToStudyBriefings(
        collectStudyOutcomeBriefings(clinicalRecords, {
          ticker,
          it: false,
        }),
        eisEvents,
      ),
    [clinicalRecords, ticker, eisEvents],
  );

  const [enriched, setEnriched] = useState<StudyOutcomeBriefing[]>(base);
  const metaFillByNct = useRef<Map<string, StudyOutcomeBriefing>>(new Map());

  useEffect(() => {
    setEnriched((prev) => {
      const withPrev = preserveStudyOutcomeCtgovFills(base, prev);
      const withCache = withPrev.map((b) => {
        const nct = (b.nctId || "").trim().toUpperCase();
        const cached = nct ? metaFillByNct.current.get(nct) : undefined;
        return cached ? preserveStudyOutcomeCtgovFills([b], [cached])[0]! : b;
      });
      return withCache;
    });
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    let need = base.filter((b) => {
      if (!needsCtgovFill(b)) return false;
      const nct = (b.nctId || "").trim().toUpperCase();
      const cached = nct ? metaFillByNct.current.get(nct) : undefined;
      return !cached || needsCtgovFill(cached);
    });
    // Cap parallel CT.gov meta calls — prefer primary NCT, then a few more.
    const primary = (primaryNctId || "").trim().toUpperCase();
    if (primary) {
      need = [
        ...need.filter((b) => (b.nctId || "").trim().toUpperCase() === primary),
        ...need.filter((b) => (b.nctId || "").trim().toUpperCase() !== primary),
      ];
    }
    need = need.slice(0, focalProductOnly ? 1 : 3);
    if (!need.length) return;

    void (async () => {
      const updates = await Promise.all(
        need.map(async (b) => {
          try {
            const meta = await fetchClinicalStudyMeta(b.nctId!);
            if (meta.error) return b;
            return mergeStudyOutcomeWithCtgovMeta(b, meta);
          } catch {
            return b;
          }
        }),
      );
      if (cancelled) return;
      for (const u of updates) {
        const nct = (u.nctId || "").trim().toUpperCase();
        if (!nct) continue;
        const prev = metaFillByNct.current.get(nct);
        metaFillByNct.current.set(
          nct,
          prev ? preserveStudyOutcomeCtgovFills([u], [prev])[0]! : u,
        );
      }
      setEnriched((prev) => {
        const byNct = new Map(
          updates
            .filter((u) => u.nctId)
            .map((u) => [String(u.nctId).trim().toUpperCase(), u] as const),
        );
        const merged = prev.map((b) => {
          const nct = (b.nctId || "").trim().toUpperCase();
          const u = nct ? byNct.get(nct) : undefined;
          if (!u) return b;
          return preserveStudyOutcomeCtgovFills([u], [b])[0]!;
        });
        return preserveStudyOutcomeCtgovFills(
          preserveStudyOutcomeCtgovFills(base, merged),
          merged,
        );
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [base, primaryNctId, focalProductOnly]);

  const visible = useMemo(() => {
    let rows = skipCompletingCd
      ? products.filter((p) => !p.isCompletingCd)
      : products;
    if (focalProductOnly) {
      const focal = (resolvedProduct || "").trim().toLowerCase();
      rows = rows.filter((p) => {
        if (p.isCompletingCd) return true;
        if (!focal) return false;
        return (
          p.name.trim().toLowerCase() === focal || blobMentionsProduct(p.name, focal)
        );
      });
      if (rows.length > 1) {
        const cd = rows.find((p) => p.isCompletingCd);
        if (cd) rows = [cd];
        else if (focal) {
          const exact = rows.find((p) => p.name.trim().toLowerCase() === focal);
          rows = exact ? [exact] : rows.slice(0, 1);
        } else {
          rows = rows.slice(0, 1);
        }
      }
    }
    return rows;
  }, [products, skipCompletingCd, focalProductOnly, resolvedProduct]);

  if (!visible.length) {
    if (skipCompletingCd && products.length) return null;
    return (
      <div className="rounded-md border border-dashed border-[rgb(var(--border))]/50 px-2.5 py-2">
        <p className="text-[10px] text-ink-muted leading-snug">
          No product name on Catalyst / Simulation for this ticker — NCT alone is not
          used as the product for patents.
        </p>
      </div>
    );
  }

  const newsPool = clinicalNewsEvents ?? [];
  const fdaPool = fdaBriefingEvents ?? [];

  return (
    <div className="space-y-4">
      {visible.map((p) => (
        <PipelineProductCard
          key={p.key}
          ticker={ticker}
          company={company}
          product={p}
          briefings={briefingsForProduct(enriched, p)}
          primaryNctId={primaryNctId}
          autoLoad={Boolean(focalProductOnly || p.isCompletingCd)}
          showCompetition={showCompetition}
          indication={indication}
          clinicalRecords={clinicalRecords}
          clinicalNewsEvents={newsPool}
          fdaBriefingEvents={fdaPool}
          cdIso={cdIso}
          guidanceEvents={guidanceEvents}
          onDossierPaperClinSum={onDossierPaperClinSum}
        />
      ))}
    </div>
  );
}
