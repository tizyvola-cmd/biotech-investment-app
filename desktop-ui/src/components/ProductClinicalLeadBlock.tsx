/**
 * Clinical news intro: Gemini pipeline overview with per-product Competition
 * modal (peers racing / approved on the same indication), then product sheets.
 * Display only — not Soft BUY/SELL.
 *
 * Development table paints immediately from feed seeds; Gemini enriches in background.
 * Lookup is ticker-scoped (hints do not retrigger Gemini).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  lookupDeskPipelineOverview,
  type ClinicalPreCdRecord,
  type DiseaseSocContext,
  type GuidanceCalendarEvent,
  type PipelineOverviewProduct,
} from "../api/supernova";
import type { EisProductBriefing } from "../sheet/eisProductBriefing";
import type { StudyEisEventLike } from "../sheet/studyOutcomeBriefing";
import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { isApprovedPhase } from "../sheet/companyProfileOverview";
import { collectTickerPipelineProducts } from "../sheet/studyProductLink";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { EisCompetitionNotesBox } from "./EisCompetitionNotesBox";
import { StudyOutcomesSection } from "./StudyOutcomesSection";

function productIsApproved(row: PipelineOverviewProduct): boolean {
  const life = String(row.lifecycle ?? "").trim().toLowerCase();
  if (life === "approved" || life === "marketed" || life === "commercial") return true;
  if (life === "development" || life === "clinical" || life === "pipeline") return false;
  return isApprovedPhase(row.phase);
}

function mergePipelineRows(
  base: PipelineOverviewProduct[],
  enrich: PipelineOverviewProduct[],
): PipelineOverviewProduct[] {
  const byKey = new Map<string, PipelineOverviewProduct>();
  const keyOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const r of base) {
    const k = keyOf(String(r.name || ""));
    if (k) byKey.set(k, { ...r });
  }
  for (const r of enrich) {
    const k = keyOf(String(r.name || ""));
    if (!k) continue;
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...prev, ...r, name: r.name || prev.name } : { ...r });
  }
  return [...byKey.values()];
}

function seedDevelopmentRows(opts: {
  hintNames: string[];
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  briefing: EisProductBriefing;
  diseaseSoc?: DiseaseSocContext | null;
}): PipelineOverviewProduct[] {
  const out: PipelineOverviewProduct[] = [];
  const seen = new Set<string>();
  for (const name of opts.hintNames) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let indication: string | null =
      opts.briefing.indication || opts.diseaseSoc?.disease || null;
    let phase: string | null = null;
    let prevalence: string | null =
      opts.briefing.usaPrevalence || opts.diseaseSoc?.usa_prevalence || null;
    for (const rec of opts.clinicalRecords ?? []) {
      const pn = String(rec.ai?.study_clinical_profile?.product_name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      if (pn && pn !== key) continue;
      const cond = String(rec.meta?.conditions || "").trim();
      if (cond) indication = indication || cond;
      const ph = String(rec.meta?.phase || "").trim();
      if (ph) phase = phase || ph;
      break;
    }
    out.push({
      name,
      lifecycle: "development",
      indication,
      usa_prevalence: prevalence,
      phase,
      therapeutic_area: null,
      mechanism_of_action: null,
      modality: null,
    });
  }
  return out;
}

function CellText({
  value,
  title,
  className = "",
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`line-clamp-2 break-words ${className}`} title={title || value}>
      {value}
    </span>
  );
}

export function ProductClinicalLeadBlock({
  ticker,
  company,
  productName,
  nctId,
  briefing,
  clinicalRecords,
  eisEvents,
  clinicalNewsEvents,
  fdaBriefingEvents,
  diseaseSoc,
  showStudyOutcomes = true,
  focalProductOnly = false,
  it = false,
  guidanceEvents = null,
  cdIso = null,
  onDossierPaperClinSum,
}: {
  ticker: string;
  company?: string | null;
  productName?: string | null;
  nctId?: string | null;
  briefing: EisProductBriefing;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  eisEvents?: StudyEisEventLike[] | null;
  clinicalNewsEvents?: TickerEisEventDetail[] | null;
  fdaBriefingEvents?: TickerEisEventDetail[] | null;
  diseaseSoc?: DiseaseSocContext | null;
  showStudyOutcomes?: boolean;
  /** Study detail: only the catalyst product — sibling assets stay on issuer news. */
  focalProductOnly?: boolean;
  it?: boolean;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  cdIso?: string | null;
  onDossierPaperClinSum?: (sum: number | null) => void;
}) {
  const product = (productName || briefing.productName || "").trim();
  const groups = useMemo(
    () =>
      collectTickerPipelineProducts(clinicalRecords, {
        ticker,
        primaryNctId: nctId,
        completingProduct: product || null,
        guidanceEvents,
        cdIso,
      }),
    [clinicalRecords, ticker, nctId, product, guidanceEvents, cdIso],
  );
  const hintNames = useMemo(() => {
    const names = groups.map((g) => g.name);
    if (product && !names.some((n) => n.toLowerCase() === product.toLowerCase())) {
      return [product, ...names];
    }
    return names.length ? names : product ? [product] : [];
  }, [groups, product]);

  const seedRows = useMemo(
    () =>
      seedDevelopmentRows({
        hintNames,
        clinicalRecords,
        briefing,
        diseaseSoc,
      }),
    [hintNames, clinicalRecords, briefing, diseaseSoc],
  );

  const [rows, setRows] = useState<PipelineOverviewProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [competitionTarget, setCompetitionTarget] = useState<{
    name: string;
    indication: string | null;
    nctId: string | null;
  } | null>(null);
  const lookupTickerRef = useRef<string | null>(null);
  const hintsRef = useRef(hintNames);
  hintsRef.current = hintNames;
  const seedRowsRef = useRef(seedRows);
  seedRowsRef.current = seedRows;

  // Paint feed seeds immediately; reset when ticker changes.
  useEffect(() => {
    const tk = ticker.trim().toUpperCase();
    if (lookupTickerRef.current !== tk) {
      setRows(seedRows);
      setNote(null);
      setError(null);
      return;
    }
    setRows((prev) => {
      if (!seedRows.length) return prev;
      if (!prev.length) return seedRows;
      return mergePipelineRows(seedRows, prev);
    });
  }, [ticker, seedRows]);

  // Gemini enrich — once per ticker (hints do not retrigger).
  useEffect(() => {
    const tk = ticker.trim().toUpperCase();
    if (!tk) return;
    if (lookupTickerRef.current === tk) return;
    lookupTickerRef.current = tk;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void lookupDeskPipelineOverview({
      ticker: tk,
      company: company ?? undefined,
      products: hintsRef.current,
      nct_id: nctId ?? undefined,
      conditions: briefing.indication || diseaseSoc?.disease || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        const next = Array.isArray(res.products) ? res.products.filter((p) => p.name) : [];
        if (!res.ok && !next.length) {
          setError(
            res.hint ||
              res.detail ||
              res.error ||
              (it ? "Ricerca non disponibile" : "Lookup unavailable"),
          );
          return;
        }
        if (next.length) {
          setRows((prev) =>
            mergePipelineRows(prev.length ? prev : seedRowsRef.current, next),
          );
        }
        setNote(
          res.cached
            ? it
              ? "Da cache Gemini"
              : "From Gemini cache"
            : it
              ? "Da ricerca Gemini"
              : "From Gemini lookup",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setError(it ? "Errore di rete" : "Network error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, company, nctId, briefing.indication, diseaseSoc?.disease, it]);

  const empty = it ? "—" : "—";
  const loadEmpty = loading ? (it ? "…" : "…") : empty;
  const displayRows = rows.length ? rows : seedRows;
  const approvedRows = displayRows.filter(productIsApproved);
  const developmentRows = displayRows.filter((r) => !productIsApproved(r));

  const nctForProduct = (name: string): string | null => {
    const g = groups.find(
      (x) => x.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (g?.nctId) return g.nctId;
    if (product && name.trim().toLowerCase() === product.toLowerCase()) {
      return nctId ?? null;
    }
    return null;
  };

  const moaLabel = (row: PipelineOverviewProduct): string => {
    const moa = row.mechanism_of_action?.trim() || "";
    return moa || (loading ? loadEmpty : empty);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.12] bg-[#1A2136] px-3 py-3 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#F3C451]">
            {it ? "Pipeline società" : "Company pipeline"}
          </p>
          {note ? (
            <p className="text-[9px] text-[#97A2BA]">{note}</p>
          ) : loading ? (
            <p className="text-[9px] text-[#97A2BA] animate-pulse">
              {it
                ? "Arricchimento Gemini in corso (tabella già visibile)…"
                : "Gemini enriching (table already visible)…"}
            </p>
          ) : null}
        </div>
        <p className="text-[11px] text-[#C5CDDC] leading-snug">
          {it
            ? "In sviluppo: nome, indication, therapeutic area, prevalenza USA, MoA/target, stadio. Sul mercato: + patent cliff."
            : "In development: name, indication, therapeutic area, USA prevalence, MoA/target, stage. On market: + patent cliff."}
        </p>
        {error ? <p className="text-[10px] text-[#F87185]">{error}</p> : null}
        {displayRows.length === 0 && !loading ? (
          <p className="text-[11px] text-[#97A2BA]">
            {it
              ? "Nessun prodotto di pipeline trovato per questo ticker."
              : "No pipeline products found for this ticker."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#38BDF8]">
                {it ? "In sviluppo clinico" : "In clinical development"}
                {developmentRows.length ? ` · ${developmentRows.length}` : ""}
              </p>
              {developmentRows.length ? (
                <div className="rounded-lg border border-white/[0.08] overflow-hidden">
                  <table className="w-full table-fixed text-left border-collapse">
                    <colgroup>
                      <col style={{ width: "3%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "8%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-[#121729] text-[8px] uppercase tracking-wide text-[#97A2BA]">
                        <th className="px-0.5 py-1 font-bold text-center">#</th>
                        <th className="px-1 py-1 font-bold">{it ? "Prodotto" : "Product"}</th>
                        <th className="px-1 py-1 font-bold">Indication</th>
                        <th className="px-1 py-1 font-bold">Area</th>
                        <th className="px-1 py-1 font-bold">{it ? "Prev. USA" : "USA prev."}</th>
                        <th className="px-1 py-1 font-bold">MoA / target</th>
                        <th className="px-1 py-1 font-bold">{it ? "Stadio" : "Stage"}</th>
                        <th className="px-1 py-1 font-bold" />
                      </tr>
                    </thead>
                    <tbody>
                      {developmentRows.map((row, i) => {
                        const name = (row.name || "").trim() || "—";
                        const indication =
                          row.indication ||
                          diseaseSoc?.disease ||
                          briefing.indication ||
                          null;
                        const ta = row.therapeutic_area?.trim() || (loading ? loadEmpty : empty);
                        const prev =
                          row.usa_prevalence?.trim() || (loading ? loadEmpty : empty);
                        const moa = moaLabel(row);
                        return (
                          <tr
                            key={`dev-${name}-${i}`}
                            className="border-t border-white/[0.06] text-[10px] text-[#F3F5FA] align-top"
                          >
                            <td className="px-0.5 py-1 tabular-nums text-center text-[#5B6580]">
                              {i + 1}
                            </td>
                            <td className="px-1 py-1 font-semibold text-[#A79AFF]">
                              <CellText value={name} />
                            </td>
                            <td className="px-1 py-1 text-[#C5CDDC]">
                              <CellText
                                value={indication || (loading ? loadEmpty : empty)}
                              />
                            </td>
                            <td className="px-1 py-1 text-[#C5CDDC]">
                              <CellText value={ta} />
                            </td>
                            <td className="px-1 py-1 text-[#97A2BA]">
                              <CellText value={prev} />
                            </td>
                            <td className="px-1 py-1 text-[#A79AFF]/95">
                              <CellText value={moa} title={row.mechanism_of_action || undefined} />
                            </td>
                            <td className="px-1 py-1">
                              {row.phase ? (
                                <span className="inline-block max-w-full truncate rounded-full border border-[#7C6CF3]/40 bg-[#7C6CF3]/15 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-[#A79AFF]">
                                  {row.phase}
                                </span>
                              ) : (
                                empty
                              )}
                            </td>
                            <td className="px-1 py-1 text-right">
                              <button
                                type="button"
                                className="inline-flex items-center rounded-md border border-[#F3C451]/55 bg-[#F3C451]/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#F3C451] hover:bg-[#F3C451]/25"
                                onClick={() =>
                                  setCompetitionTarget({
                                    name: name === "—" ? "" : name,
                                    indication,
                                    nctId: nctForProduct(name),
                                  })
                                }
                              >
                                Comp.
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !loading && (
                  <p className="text-[11px] text-[#97A2BA]">
                    {it ? "Nessun asset clinico in lista." : "No clinical assets listed."}
                  </p>
                )
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#34D399]">
                {it ? "Approvati / sul mercato (USA)" : "Approved / on market (US)"}
                {approvedRows.length ? ` · ${approvedRows.length}` : ""}
              </p>
              {approvedRows.length ? (
                <div className="rounded-lg border border-white/[0.08] overflow-hidden">
                  <table className="w-full table-fixed text-left border-collapse">
                    <colgroup>
                      <col style={{ width: "3%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "8%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-[#121729] text-[8px] uppercase tracking-wide text-[#97A2BA]">
                        <th className="px-0.5 py-1 font-bold text-center">#</th>
                        <th className="px-1 py-1 font-bold">{it ? "Prodotto" : "Product"}</th>
                        <th className="px-1 py-1 font-bold">Indication</th>
                        <th className="px-1 py-1 font-bold">Area</th>
                        <th className="px-1 py-1 font-bold">{it ? "Prev. USA" : "USA prev."}</th>
                        <th className="px-1 py-1 font-bold">MoA / target</th>
                        <th className="px-1 py-1 font-bold">Mod.</th>
                        <th className="px-1 py-1 font-bold">Patent</th>
                        <th className="px-1 py-1 font-bold" />
                      </tr>
                    </thead>
                    <tbody>
                      {approvedRows.map((row, i) => {
                        const name = (row.name || "").trim() || "—";
                        const indication =
                          row.indication ||
                          diseaseSoc?.disease ||
                          briefing.indication ||
                          null;
                        const ta = row.therapeutic_area?.trim() || (loading ? loadEmpty : empty);
                        return (
                          <tr
                            key={`mkt-${name}-${i}`}
                            className="border-t border-white/[0.06] text-[10px] text-[#F3F5FA] align-top"
                          >
                            <td className="px-0.5 py-1 tabular-nums text-center text-[#5B6580]">
                              {i + 1}
                            </td>
                            <td className="px-1 py-1 font-semibold text-[#A79AFF]">
                              <CellText value={name} />
                            </td>
                            <td className="px-1 py-1 text-[#C5CDDC]">
                              <CellText
                                value={indication || (loading ? loadEmpty : empty)}
                              />
                            </td>
                            <td className="px-1 py-1 text-[#C5CDDC]">
                              <CellText value={ta} />
                            </td>
                            <td className="px-1 py-1 text-[#97A2BA]">
                              <CellText
                                value={
                                  row.usa_prevalence?.trim() || (loading ? loadEmpty : empty)
                                }
                              />
                            </td>
                            <td className="px-1 py-1 text-[#A79AFF]/95">
                              <CellText
                                value={moaLabel(row)}
                                title={row.mechanism_of_action || undefined}
                              />
                            </td>
                            <td className="px-1 py-1 text-[#C5CDDC]">
                              <CellText
                                value={row.modality?.trim() || (loading ? loadEmpty : empty)}
                              />
                            </td>
                            <td className="px-1 py-1 text-[#FBBF24]">
                              <CellText
                                value={
                                  row.patent_cliff?.trim() || (loading ? loadEmpty : empty)
                                }
                              />
                            </td>
                            <td className="px-1 py-1 text-right">
                              <button
                                type="button"
                                className="inline-flex items-center rounded-md border border-[#F3C451]/55 bg-[#F3C451]/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#F3C451] hover:bg-[#F3C451]/25"
                                onClick={() =>
                                  setCompetitionTarget({
                                    name: name === "—" ? "" : name,
                                    indication,
                                    nctId: nctForProduct(name),
                                  })
                                }
                              >
                                Comp.
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !loading && (
                  <p className="text-[11px] text-[#97A2BA]">
                    {it
                      ? "Nessun brand commerciale in lista (tipico per pure-play cliniche)."
                      : "No commercial brands listed (typical for clinical-stage pure plays)."}
                  </p>
                )
              )}
            </div>
          </div>
        )}
        <p className="text-[9px] text-[#5B6580] leading-snug">
          {it
            ? "Da Gemini / IR pubblici. Solo display — non è Soft BUY/SELL."
            : "From Gemini / public IR. Display only — not Soft BUY/SELL."}
        </p>
      </div>

      {competitionTarget ? (
        <AppModal
          open
          onClose={() => setCompetitionTarget(null)}
          aria-label={
            it
              ? `Competition · ${competitionTarget.name || ticker}`
              : `Competition · ${competitionTarget.name || ticker}`
          }
          panelClassName="w-full max-w-2xl overflow-hidden rounded-2xl border border-[rgb(var(--border))]/50 bg-[#121729] shadow-2xl flex flex-col"
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-white/[0.10] bg-[#1A2136] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#F3C451]">
                Competition
              </p>
              <p className="text-[15px] font-bold text-[#A79AFF] leading-snug mt-0.5">
                {competitionTarget.name || ticker}
              </p>
              {competitionTarget.indication ? (
                <p className="text-[11px] text-[#97A2BA] mt-0.5 leading-snug">
                  {it ? "Indicazione: " : "Indication: "}
                  {competitionTarget.indication}
                </p>
              ) : null}
              <p className="text-[10px] text-[#5B6580] mt-1 leading-snug">
                {it
                  ? "Altri prodotti in corsa e/o già approvati per la stessa indicazione."
                  : "Other products racing and/or already approved for the same indication."}
              </p>
            </div>
            <AppModalCloseButton onClose={() => setCompetitionTarget(null)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <EisCompetitionNotesBox
              ticker={ticker}
              it={it}
              productName={competitionTarget.name || null}
              company={company}
              indication={competitionTarget.indication}
              nctId={competitionTarget.nctId}
            />
          </div>
        </AppModal>
      ) : null}

      {showStudyOutcomes ? (
        <StudyOutcomesSection
          clinicalRecords={clinicalRecords}
          ticker={ticker}
          primaryNctId={nctId}
          productName={product || null}
          company={company}
          diseaseSoc={diseaseSoc}
          eisEvents={eisEvents}
          clinicalNewsEvents={clinicalNewsEvents ?? null}
          fdaBriefingEvents={fdaBriefingEvents ?? null}
          indication={briefing.indication || diseaseSoc?.disease || null}
          focalProductOnly={focalProductOnly}
          showCompetition
          guidanceEvents={guidanceEvents}
          cdIso={cdIso}
          onDossierPaperClinSum={onDossierPaperClinSum}
        />
      ) : null}
    </div>
  );
}
