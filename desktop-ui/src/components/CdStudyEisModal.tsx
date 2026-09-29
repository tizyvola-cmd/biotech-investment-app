import { useCallback, useMemo, useState } from "react";
import type {
  ClinicalPreCdRecord,
  ClinicalStudySummary,
  GuidanceCalendarEvent,
} from "../api/supernova";
import {
  fetchClinicalStudySummary,
  generateClinicalStudySummary,
} from "../api/supernova";
import { hydrateClinicalPreCdRecords } from "../sheet/clinicalPreCdSnapshotCache";
import { findClinicalPreCdRecord } from "../sheet/eisPolyAdjust";
import { nctClinicalTrialsUrl } from "../sheet/cellLinks";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import {
  localizeStudyPhase,
  localizeStudyStatus,
} from "../sheet/clinicalIndicators";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { NctStudyLink } from "./EisStudyContextHeader";
import { StudyOutcomesSection } from "./StudyOutcomesSection";
import { collectEisProductBriefing } from "../sheet/eisProductBriefing";
import { buildTickerEisDetail } from "../sheet/tickerEisSummary";
import { clinicalEventsLinkedToProduct, fdaBriefingEventsLinkedToProduct } from "../sheet/tickerImpactEvents";
import {
  eisClinicalNewsStableId,
  useDismissedEisNewsIds,
} from "../sheet/eisNewsDismiss";
import {
  findGuidanceEventForCd,
  nctFromGuidanceEvent,
} from "../sheet/studyProductLink";
import {
  clinicalDrugFromSimRow,
  usableProductName,
} from "../sheet/simRowClinicalMeta";

function fmtDate(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function CdStudyEisModal({
  ticker,
  cdIso,
  clinicalRecords,
  guidanceEvents = null,
  simRow = null,
  productHint = null,
  it,
  onClose,
}: {
  ticker: string;
  cdIso: string | null | undefined;
  clinicalRecords?: ClinicalPreCdRecord[];
  /** Calendar / interest enroll — fills product sheet when clinical feed has no row. */
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  /** Simulation / Catalyst row — Product column + guidance_asset_name. */
  simRow?: Record<string, unknown> | null;
  /** Explicit product from Catalyst desk / Deep Dive when already resolved. */
  productHint?: string | null;
  it: boolean;
  onClose: () => void;
}) {
  const tk = ticker.trim().toUpperCase();
  const dismissedNews = useDismissedEisNewsIds();
  const records = useMemo(
    () => (clinicalRecords?.length ? clinicalRecords : hydrateClinicalPreCdRecords()),
    [clinicalRecords],
  );
  const rec = useMemo(
    () => findClinicalPreCdRecord(tk, cdIso?.slice(0, 10) ?? null, records),
    [tk, cdIso, records],
  );
  const guidanceHit = useMemo(
    () => findGuidanceEventForCd(tk, cdIso, guidanceEvents),
    [tk, cdIso, guidanceEvents],
  );
  const nctId =
    rec?.nct_id?.trim() ||
    nctFromGuidanceEvent(guidanceHit) ||
    "";
  const company =
    rec?.company ||
    rec?.meta?.lead_sponsor ||
    guidanceHit?.company ||
    tk;
  const productName = useMemo(() => {
    const fromSim = clinicalDrugFromSimRow(simRow ?? undefined);
    const fromHint = usableProductName(productHint);
    const fromGuidance = usableProductName(guidanceHit?.asset_name);
    if (fromSim) return fromSim;
    if (fromHint) return fromHint;
    if (fromGuidance) return fromGuidance;
    if (rec) {
      return (
        collectEisProductBriefing([rec], {
          ticker: tk,
          nctId,
          productHint: rec.ai?.study_clinical_profile?.product_name,
        }).productName || null
      );
    }
    // NCT is the study id — never use it as the product name for patents / summary.
    return null;
  }, [rec, tk, nctId, guidanceHit, simRow, productHint]);
  const [summary, setSummary] = useState<ClinicalStudySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (force = false) => {
      if (!nctId) return;
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        if (!force) {
          const cached = await fetchClinicalStudySummary(nctId);
          if (cached?.ai && Object.keys(cached.ai).length > 0) {
            setSummary(cached);
            return;
          }
        }
        setSummary(await generateClinicalStudySummary(nctId, tk, company));
      } catch (e) {
        setSummaryError(e instanceof Error ? e.message : String(e));
      } finally {
        setSummaryLoading(false);
      }
    },
    [nctId, tk, company],
  );

  // Prefer feed/cache already on the record — no auto network on open.
  const meta = summary?.meta ?? rec?.meta ?? {};
  const ai = summary?.ai ?? rec?.ai ?? {};
  const hasAiBody = Boolean(
    ai.executive_summary ||
      ai.primary_endpoint ||
      ai.key_metrics ||
      ai.safety_profile ||
      ai.investment_note,
  );
  const ctgovHref = nctId ? nctClinicalTrialsUrl(nctId) : null;
  const title =
    meta.brief_title ||
    rec?.meta?.brief_title ||
    (productName
      ? it
        ? `${productName} · giorno di completamento`
        : `${productName} · trial completion day`
      : null) ||
    (it ? "Studio collegato al giorno di completamento" : "Study linked to trial completion day");
  const phaseLabel =
    meta.phase || rec?.study_phase || guidanceHit?.trial_phase || null;
  const indication =
    meta.conditions || guidanceHit?.indication || null;

  const productNews = useMemo(() => {
    const detail = buildTickerEisDetail(
      tk,
      it ? "it" : "en",
      null,
      records,
      cdIso ?? rec?.cd_date ?? null,
    );
    return clinicalEventsLinkedToProduct(detail.events, {
      productName,
      nctId,
    }).filter(
      (ev) =>
        !dismissedNews.has(
          eisClinicalNewsStableId({
            ticker: tk,
            eventDate: ev.eventDate,
            title: ev.title,
            link: ev.link,
            sourceType: ev.sourceType,
          }),
        ),
    );
  }, [tk, it, records, cdIso, rec?.cd_date, productName, nctId, dismissedNews]);

  const productFdaBriefings = useMemo(() => {
    const detail = buildTickerEisDetail(
      tk,
      it ? "it" : "en",
      null,
      records,
      cdIso ?? rec?.cd_date ?? null,
    );
    return fdaBriefingEventsLinkedToProduct(detail.events, {
      productName,
      nctId,
    }).filter(
      (ev) =>
        !dismissedNews.has(
          eisClinicalNewsStableId({
            ticker: tk,
            eventDate: ev.eventDate,
            title: ev.title,
            link: ev.link,
            sourceType: ev.sourceType,
          }),
        ),
    );
  }, [tk, it, records, cdIso, rec?.cd_date, productName, nctId, dismissedNews]);

  return (
    <AppModal
      open
      onClose={onClose}
      aria-label={it ? `Studio e EIS · ${tk}` : `Study and EIS · ${tk}`}
      panelClassName="flex h-[min(94vh,56rem)] w-full max-w-3xl min-h-0 flex-col overflow-hidden overscroll-contain rounded-2xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] shadow-2xl"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-[#1D4ED8] bg-[#2F6BFF] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[#F3C451]/80 bg-[#F3C451] px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#1a2136]">
              {it ? "Giorno di completamento dello studio" : "Trial completion day"}
            </span>
            <span className="text-[13px] font-extrabold text-white tabular-nums">{tk}</span>
            <span className="text-[12px] font-semibold text-white tabular-nums">
              {fmtDate(cdIso, it)}
            </span>
            {phaseLabel ? (
              <span className="rounded-full border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {localizeStudyPhase(String(phaseLabel), it)}
              </span>
            ) : null}
            {meta.overall_status ? (
              <span className="rounded-full border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {localizeStudyStatus(String(meta.overall_status), it)}
              </span>
            ) : null}
            {!rec && guidanceHit ? (
              <span className="rounded-full border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {it ? "Da calendario" : "From calendar"}
              </span>
            ) : null}
          </div>
          <p
            className="mt-1 text-[13px] font-semibold text-white leading-snug line-clamp-3"
            title={title}
          >
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/85">
            {nctId && ctgovHref ? (
              <NctStudyLink
                nctId={nctId}
                href={ctgovHref}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-white underline decoration-white/55 underline-offset-2 hover:decoration-white"
              />
            ) : nctId ? (
              <span className="font-mono text-white">{nctId}</span>
            ) : null}
            {company && company !== tk ? <span>{company}</span> : null}
            {rec?.last_ctgov_update ? (
              <span>
                {it ? "CT.gov" : "CT.gov"} {fmtDate(rec.last_ctgov_update, it)}
              </span>
            ) : null}
            {meta.enrollment != null ? (
              <span>
                {meta.enrollment} {it ? "pazienti" : "patients"}
              </span>
            ) : null}
          </div>
        </div>
        <AppModalCloseButton
          onClose={onClose}
          className="text-white hover:text-white hover:bg-white/15"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
        {meta.interventions || rec?.data_gaps || (!rec && guidanceHit?.timing_quote) ? (
          <section className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/50 px-3 py-2 space-y-1">
            {meta.interventions ? (
              <p className="text-[11px] text-ink-muted leading-snug">
                {it ? "Intervento: " : "Intervention: "}
                {meta.interventions}
              </p>
            ) : null}
            {!rec && guidanceHit?.timing_quote ? (
              <p className="text-[11px] text-ink-muted leading-snug">
                {it ? "Calendario: " : "Calendar: "}
                {guidanceHit.timing_quote}
              </p>
            ) : null}
            {rec?.data_gaps ? (
              <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                {it ? "Lacune: " : "Gaps: "}
                {rec.data_gaps}
              </p>
            ) : null}
          </section>
        ) : null}

        <StudyOutcomesSection
          clinicalRecords={records}
          ticker={tk}
          primaryNctId={nctId || null}
          productName={productName}
          company={company}
          indication={indication}
          clinicalNewsEvents={productNews}
          fdaBriefingEvents={productFdaBriefings}
          focalProductOnly
          guidanceEvents={guidanceEvents}
          cdIso={cdIso ?? null}
          simRow={simRow}
        />

        {nctId ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {it ? "Studio aggiornato (CT.gov / PubMed)" : "Updated study (CT.gov / PubMed)"}
              </p>
              <button
                type="button"
                className="text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline disabled:opacity-50"
                disabled={summaryLoading}
                onClick={() => void loadSummary(Boolean(summary || hasAiBody))}
              >
                {summaryLoading
                  ? it
                    ? "Aggiornamento…"
                    : "Updating…"
                  : summary || hasAiBody
                    ? it
                      ? "Rigenera"
                      : "Refresh"
                    : it
                      ? "Carica summary AI"
                      : "Load AI summary"}
              </button>
            </div>
            {summaryLoading && !summary ? (
              <p className="text-[12px] text-ink-muted py-3">
                {it
                  ? "Recupero risultati CT.gov + abstract PubMed…"
                  : "Fetching CT.gov results + PubMed abstracts…"}
              </p>
            ) : null}
            {summaryError ? (
              <p className="text-[12px] text-rose-700 dark:text-rose-300">{summaryError}</p>
            ) : null}
            {!summaryLoading && !hasAiBody && !summaryError ? (
              <p className="text-[12px] text-ink-muted">
                {it
                  ? "Summary AI non caricato — clicca Carica quando ti serve."
                  : "AI summary not loaded — click Load when you need it."}
              </p>
            ) : null}
            {ai.executive_summary ? (
              <p className="text-[13px] text-ink leading-relaxed">{ai.executive_summary}</p>
            ) : null}
            {ai.primary_endpoint || ai.key_metrics ? (
              <div className="rounded-md border border-[rgb(var(--border))]/35 px-3 py-2 text-[12px] space-y-1">
                {ai.primary_endpoint ? <p>{ai.primary_endpoint}</p> : null}
                {ai.key_metrics ? (
                  <p className="font-mono text-[11px] text-ink-muted">{ai.key_metrics}</p>
                ) : null}
              </div>
            ) : null}
            {ai.safety_profile ? (
              <p className="text-[12px] text-ink leading-snug">{ai.safety_profile}</p>
            ) : null}
            {ai.investment_note ? (
              <p className="text-[12px] font-medium text-ink leading-snug">{ai.investment_note}</p>
            ) : null}
            {ctgovHref ? (
              <a
                href={ctgovHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
                onClick={(e) => openExternalUrl(ctgovHref, e)}
              >
                ClinicalTrials.gov ↗
              </a>
            ) : null}
          </section>
        ) : (
          <p className="text-[12px] text-ink-muted">
            {guidanceHit
              ? it
                ? "Nessun NCT nel feed clinico — scheda costruita dal calendario guidance. Carica CT.gov sul prodotto sopra se serve il dossier."
                : "No NCT on the clinical feed — sheet built from the guidance calendar. Load CT.gov on the product card above if you need the dossier."
              : it
                ? "Nessun NCT sul feed clinico per questo CD."
                : "No NCT on the clinical feed for this CD."}
          </p>
        )}
      </div>
    </AppModal>
  );
}
