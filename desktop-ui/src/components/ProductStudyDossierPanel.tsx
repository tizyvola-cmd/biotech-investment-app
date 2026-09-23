import { useEffect, useRef, useState } from "react";
import {
  lookupDeskProductStudyDossier,
  type ClinicalPreCdRecord,
  type GuidanceCalendarEvent,
  type ProductStudyCard,
  type ProductStudyDossier,
  type ProductStudyPaper,
  type ProductStudyResultRow,
} from "../api/supernova";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import { localizeStudyPhase } from "../sheet/clinicalIndicators";
import { ProductDevPathStrip } from "./ProductDevPathStrip";
import { InvestorInsightBox } from "./InvestorInsightBox";

function ResultsTable({ rows }: { rows: ProductStudyResultRow[] }) {
  if (!rows.length) {
    return (
      <p className="text-[11px] text-ink-muted">
        No posted primary/secondary results on ClinicalTrials.gov yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-[rgb(var(--border))]/20">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="bg-white/[0.04] text-[9px] uppercase tracking-wide text-ink-muted">
            <th className="px-2 py-1.5 font-bold">Endpoint</th>
            <th className="px-2 py-1.5 font-bold whitespace-nowrap">Type</th>
            <th className="px-2 py-1.5 font-bold">Result</th>
            <th className="px-2 py-1.5 font-bold">Statistic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.endpoint}-${i}`}
              className={
                row.positive
                  ? "bg-[rgb(var(--positive)/0.16)]"
                  : "border-t border-[rgb(var(--border))]/12"
              }
              style={
                row.positive
                  ? { boxShadow: "inset 3px 0 0 #0B8F62" }
                  : undefined
              }
            >
              <td className="px-2 py-1.5 align-top">
                <p className={`font-semibold leading-snug ${row.positive ? "text-[rgb(var(--positive))]" : "text-ink"}`}>
                  {row.endpoint || "—"}
                </p>
                {row.time_frame ? (
                  <p className="text-[10px] text-ink-muted mt-0.5">{row.time_frame}</p>
                ) : null}
              </td>
              <td className="px-2 py-1.5 align-top text-ink-muted whitespace-nowrap uppercase text-[9px] font-bold">
                {row.type || "—"}
              </td>
              <td className="px-2 py-1.5 align-top tabular-nums leading-snug text-ink">
                {row.result || "—"}
              </td>
              <td
                className={`px-2 py-1.5 align-top tabular-nums leading-snug font-semibold ${
                  row.positive ? "text-[rgb(var(--positive))]" : "text-ink"
                }`}
              >
                {row.statistic || row.p_value || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudyCard({
  study,
  index,
  total,
  ticker,
  productName,
  clinicalRecords = null,
  guidanceEvents = null,
  it = false,
}: {
  study: ProductStudyCard;
  index: number;
  total: number;
  ticker: string;
  productName: string;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  it?: boolean;
}) {
  const href = (study.ctgov_url || "").trim();
  const nct = (study.nct_id || "").trim();
  const structure = [
    study.design?.trim() || null,
    study.enrollment != null ? `${study.enrollment} patients` : null,
    study.phase ? localizeStudyPhase(study.phase, false) : null,
    study.status?.trim() || null,
  ].filter(Boolean);
  return (
    <section className="rounded-lg border border-white/[0.1] bg-[#121729] px-3 py-2.5 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
          Study {index} of {total}
          {study.has_results ? " · results posted" : ""}
        </p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold font-mono text-[#A79AFF] hover:underline shrink-0"
            onClick={(e) => openExternalUrl(href, e)}
          >
            {nct || "CT.gov"} →
          </a>
        ) : nct ? (
          <span className="text-[11px] font-mono text-[#A79AFF]">{nct}</span>
        ) : null}
      </div>
      <ProductDevPathStrip
        ticker={ticker}
        productName={productName}
        cdIso={study.completion_date?.trim() || null}
        nctId={nct || null}
        phaseOverride={study.phase?.trim() || null}
        clinicalRecords={clinicalRecords}
        guidanceEvents={guidanceEvents}
        it={it}
        embedded
      />
      <div className="space-y-0.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">NCT</p>
        <p className="text-[12px] font-mono font-semibold text-[#A79AFF]">{nct || "—"}</p>
      </div>
      <div className="space-y-0.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">Title</p>
        <p className="text-[12px] font-semibold text-[#F3F5FA] leading-snug">
          {study.title || "—"}
        </p>
      </div>
      <div className="space-y-0.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">
          Completion date
        </p>
        <p className="text-[12px] text-[#F3F5FA]">
          {study.completion_date?.trim() || "—"}
        </p>
      </div>
      <div className="space-y-0.5">
        <p className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">
          Study structure
        </p>
        <p className="text-[12px] text-[#C5CDDC] leading-snug">
          {structure.length ? structure.join(" · ") : "—"}
        </p>
      </div>
      {study.conditions ? (
        <p className="text-[11px] text-[#97A2BA] leading-snug">
          <span className="font-semibold text-[#C5CDDC]">Indication:</span> {study.conditions}
        </p>
      ) : null}
      <ResultsTable rows={study.results_table ?? []} />
    </section>
  );
}

function PaperCard({ paper }: { paper: ProductStudyPaper }) {
  const pubmedHref =
    (paper.url || "").trim() ||
    (paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : "");
  const doiHref = (paper.doi_url || "").trim() || (paper.doi ? `https://doi.org/${paper.doi}` : "");
  const pmcHref = (paper.pmc_url || "").trim();
  const affiliated = Boolean(paper.company_affiliated);
  const clin =
    paper.clinical_score != null && Number.isFinite(paper.clinical_score)
      ? paper.clinical_score
      : null;
  const clinTone =
    clin == null
      ? null
      : clin > 0
        ? { color: "#16a34a", border: "rgba(22,163,74,0.55)", bg: "rgba(22,163,74,0.16)" }
        : clin < 0
          ? { color: "#dc2626", border: "rgba(220,38,38,0.55)", bg: "rgba(220,38,38,0.14)" }
          : { color: "#64748b", border: "rgba(100,116,139,0.45)", bg: "rgba(100,116,139,0.12)" };
  const clinLabel =
    clin == null ? null : `${clin >= 0 ? "+" : ""}${(Math.round(clin * 10) / 10).toFixed(1)}`;
  const discussion =
    (paper.discussion || "").trim() ||
    (paper.conclusion || "").trim() ||
    "pdf not available";
  const introduction = (paper.introduction || "").trim() || "pdf not available";
  const results = (paper.results || "").trim() || "pdf not available";
  const articleHref = pubmedHref || doiHref || pmcHref;

  return (
    <article className="rounded-lg border border-[rgb(var(--border))]/16 bg-[rgb(var(--surface-elevated))] px-3 py-2.5 space-y-2">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {affiliated ? (
              <span
                className="mt-0.5 shrink-0 text-[14px] leading-none text-amber-300"
                title="Author affiliated with the company — higher clinical weight (×1.5)"
                aria-label="Company-affiliated authors"
              >
                ★
              </span>
            ) : null}
            {pubmedHref ? (
              <a
                href={pubmedHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-ink hover:text-[rgb(var(--accent))] leading-snug underline decoration-white/25 underline-offset-2"
                onClick={(e) => openExternalUrl(pubmedHref, e)}
              >
                {paper.title || `PMID ${paper.pmid}`}
              </a>
            ) : (
              <p className="text-[13px] font-semibold text-ink leading-snug">
                {paper.title || `PMID ${paper.pmid}`}
              </p>
            )}
          </div>
          {clin != null && clinTone ? (
            <span
              className="shrink-0 inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums"
              style={{
                color: clinTone.color,
                border: `1px solid ${clinTone.border}`,
                background: clinTone.bg,
              }}
              title={
                affiliated
                  ? "Clinical score (company-affiliated authors ×1.5)"
                  : "Clinical score (scientific publication)"
              }
            >
              Clin {clinLabel}
            </span>
          ) : null}
        </div>
        <p className="text-[10px] text-ink-muted mt-0.5">
          {[paper.journal, paper.year, paper.pmid ? `PMID ${paper.pmid}` : null]
            .filter(Boolean)
            .join(" · ")}
          {affiliated ? (
            <>
              {" · "}
              <span className="font-bold text-fuchsia-400">company authors</span>
            </>
          ) : (
            <>
              {" · "}
              <span>product study · no company affiliation</span>
            </>
          )}
        </p>
      </div>

      {(
        [
          ["Introduction", introduction],
          ["Results", results],
          ["Discussion", discussion],
        ] as const
      ).map(([label, body]) => (
        <div key={label}>
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">{label}</p>
          <p
            className={`text-[12px] leading-snug mt-0.5 whitespace-pre-wrap ${
              /^pdf not available$/i.test(body) ? "text-ink-muted italic" : "text-ink"
            }`}
          >
            {body}
          </p>
        </div>
      ))}

      <InvestorInsightBox text={paper.investor_insight} />

      {articleHref ? (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">
            This paper
          </p>
          <ul className="mt-1 space-y-1">
            {pubmedHref ? (
              <li>
                <a
                  href={pubmedHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/40 underline-offset-2 hover:decoration-[rgb(var(--accent))]"
                  onClick={(e) => openExternalUrl(pubmedHref, e)}
                >
                  PubMed{paper.pmid ? ` ${paper.pmid}` : ""}
                </a>
              </li>
            ) : null}
            {doiHref ? (
              <li>
                <a
                  href={doiHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/40 underline-offset-2 hover:decoration-[rgb(var(--accent))]"
                  onClick={(e) => openExternalUrl(doiHref, e)}
                >
                  DOI {paper.doi}
                </a>
              </li>
            ) : null}
            {pmcHref ? (
              <li>
                <a
                  href={pmcHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/40 underline-offset-2 hover:decoration-[rgb(var(--accent))]"
                  onClick={(e) => openExternalUrl(pmcHref, e)}
                >
                  PMC full text{paper.pmc ? ` (${paper.pmc})` : ""}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function isCompletedStatus(status: string | null | undefined): boolean {
  return /\b(complet|terminat|withdrawn)\b/i.test(status || "");
}

function CtgovLinkList({ studies }: { studies: ProductStudyCard[] }) {
  const links = studies.filter((s) => (s.ctgov_url || s.nct_id || "").trim());
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {links.map((s, i) => {
        const href = (s.ctgov_url || "").trim();
        const label = s.nct_id || href || `study ${i + 1}`;
        return (
          <li key={s.nct_id || href || i}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold font-mono text-[rgb(var(--accent))] hover:underline"
                onClick={(e) => openExternalUrl(href, e)}
              >
                {label} ↗
              </a>
            ) : (
              <span className="text-[11px] font-mono text-ink-muted">{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ProductStudyDossierPanel({
  ticker,
  productName,
  company,
  primaryNctId,
  aliases = [],
  variant = "full",
  /** When set, only render that slice (parent owns ochre section titles). */
  section = "all",
  /** Reuse a dossier already fetched by a sibling panel (no second network call). */
  dossierOverride,
  clinicalRecords = null,
  guidanceEvents = null,
  it = false,
  onStudies,
  onDossier,
}: {
  ticker: string;
  productName: string;
  company?: string | null;
  primaryNctId?: string | null;
  aliases?: string[];
  /** lead = completed summary + CT.gov links + PubMed (no full study cards). */
  variant?: "full" | "lead";
  section?: "all" | "trials" | "publications";
  dossierOverride?: ProductStudyDossier | null;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  it?: boolean;
  onStudies?: (studies: ProductStudyCard[]) => void;
  onDossier?: (dossier: ProductStudyDossier | null) => void;
}) {
  const [dossier, setDossier] = useState<ProductStudyDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onStudiesRef = useRef(onStudies);
  onStudiesRef.current = onStudies;
  const onDossierRef = useRef(onDossier);
  onDossierRef.current = onDossier;
  const skipFetch = dossierOverride !== undefined;

  useEffect(() => {
    if (skipFetch) return;
    const product = productName.trim();
    const tk = ticker.trim().toUpperCase();
    if (!product || !tk) {
      setDossier(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    void lookupDeskProductStudyDossier({
      ticker: tk,
      product_name: product,
      company: company || undefined,
      nct_id: primaryNctId || undefined,
      aliases,
    })
      .then((res) => {
        if (!alive) return;
        if (!res?.ok || !res.dossier) {
          setErr(res?.error || "dossier_failed");
          setDossier(null);
          return;
        }
        setDossier(res.dossier);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
        setDossier(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ticker, productName, company, primaryNctId, aliases.join("|"), skipFetch]);

  const resolved = skipFetch ? dossierOverride ?? null : dossier;
  const studies = resolved?.studies ?? [];
  const papers = resolved?.papers ?? [];

  useEffect(() => {
    onStudiesRef.current?.(resolved?.studies ?? []);
    onDossierRef.current?.(resolved);
  }, [resolved]);
  const completed = studies.filter(
    (s) => isCompletedStatus(s.status) || Boolean(s.has_results),
  );
  const ongoing = studies.filter((s) => !isCompletedStatus(s.status));
  const lead = variant === "lead";
  const showTrials = section === "all" || section === "trials";
  const showPubs = section === "all" || section === "publications";
  const embed = section !== "all";
  const effectiveLoading = skipFetch ? false : loading;

  if (embed) {
    return (
      <div className="space-y-2">
        {effectiveLoading ? (
          <p className="text-[12px] text-[#97A2BA]">
            Searching ClinicalTrials.gov and PubMed for {productName}…
          </p>
        ) : null}
        {err && !skipFetch ? (
          <p className="text-[12px] text-[rgb(var(--negative))]">{err}</p>
        ) : null}
        {showTrials ? (
          <>
            {!effectiveLoading && !ongoing.length && !studies.length ? (
              <p className="text-[12px] text-[#97A2BA]">
                No CT.gov studies found whose title or intervention names this drug.
              </p>
            ) : null}
            {(ongoing.length ? ongoing : studies).map((s, i) => (
              <StudyCard
                key={s.nct_id || s.title || `st-${i}`}
                study={s}
                index={i + 1}
                total={(ongoing.length ? ongoing : studies).length}
                ticker={ticker}
                productName={productName}
                clinicalRecords={clinicalRecords}
                guidanceEvents={guidanceEvents}
                it={it}
              />
            ))}
            {!effectiveLoading && studies.length ? (
              <div className="pt-1">
                <p className="text-[10px] text-[#97A2BA] mb-1">ClinicalTrials.gov links</p>
                <CtgovLinkList studies={studies} />
              </div>
            ) : null}
          </>
        ) : null}
        {showPubs ? (
          <>
            {resolved?.pubmed_query ? (
              <p className="text-[10px] text-[#97A2BA]">{resolved.pubmed_query}</p>
            ) : null}
            {!effectiveLoading && !papers.length ? (
              <p className="text-[12px] text-[#97A2BA]">
                No PubMed hits with the drug in the title or abstract.
              </p>
            ) : null}
            {papers.map((p) => (
              <PaperCard key={p.pmid || p.title || "paper"} paper={p} />
            ))}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lead ? (
        <>
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
              Completed studies · {productName}
            </p>
            {effectiveLoading ? (
              <p className="text-[12px] text-ink-muted">
                Searching ClinicalTrials.gov for completed {productName} studies…
              </p>
            ) : null}
            {err ? (
              <p className="text-[12px] text-[rgb(var(--negative))]">{err}</p>
            ) : null}
            {!effectiveLoading && !completed.length ? (
              <p className="text-[12px] text-ink-muted">
                No completed / results-posted CT.gov studies found for this product yet.
              </p>
            ) : null}
            {completed.map((s) => {
              const href = (s.ctgov_url || "").trim();
              const resultHint = s.has_results
                ? "results posted"
                : (s.status || "").trim() || "completed";
              return (
                <div
                  key={s.nct_id || s.title}
                  className="rounded-md border border-white/[0.10] bg-[#1A2136] px-2.5 py-2 space-y-0.5"
                >
                  <p className="text-[12px] font-semibold text-[#F3F5FA] leading-snug">
                    {s.title || s.nct_id || "Study"}
                  </p>
                  <p className="text-[10px] text-[#97A2BA]">
                    {[
                      s.phase ? localizeStudyPhase(s.phase, false) : null,
                      resultHint,
                      s.completion_date,
                      s.enrollment != null ? `n=${s.enrollment}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-[11px] font-semibold text-[rgb(var(--accent))] hover:underline"
                      onClick={(e) => openExternalUrl(href, e)}
                    >
                      {s.nct_id || "ClinicalTrials.gov"} ↗
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
              ClinicalTrials.gov
            </p>
            <p className="text-[10px] text-ink-muted">
              Studies whose title or intervention names this product.
            </p>
            {!effectiveLoading && !studies.length ? (
              <p className="text-[12px] text-ink-muted">No CT.gov links for this product.</p>
            ) : (
              <CtgovLinkList studies={studies} />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
              {productName} · ClinicalTrials.gov
            </p>
            <p className="text-[10px] text-ink-muted">
              Primary + secondary endpoints only. Positive statistics highlighted.
            </p>
          </div>
          {effectiveLoading ? (
            <p className="text-[12px] text-ink-muted">
              Searching ClinicalTrials.gov and PubMed for {productName}…
            </p>
          ) : null}
          {err ? (
            <p className="text-[12px] text-[rgb(var(--negative))]">{err}</p>
          ) : null}
          {!effectiveLoading && !studies.length ? (
            <p className="text-[12px] text-ink-muted">
              No CT.gov studies found whose title or intervention names this drug.
            </p>
          ) : null}
          {studies.map((s, i) => (
            <StudyCard
              key={s.nct_id || s.title || `st-${i}`}
              study={s}
              index={i + 1}
              total={studies.length}
              ticker={ticker}
              productName={productName}
              clinicalRecords={clinicalRecords}
              guidanceEvents={guidanceEvents}
              it={it}
            />
          ))}
        </>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
        <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
          PubMed · {productName} in title
        </p>
        <p className="text-[10px] text-ink-muted">
          {resolved?.pubmed_query || "Drug [Title/Abstract] (± company [Affiliation])"}
        </p>
      </div>
      {!effectiveLoading && !papers.length ? (
        <p className="text-[12px] text-ink-muted">
          No PubMed hits with the drug in the title or abstract.
        </p>
      ) : null}
      {papers.map((p) => (
        <PaperCard key={p.pmid || p.title || "paper"} paper={p} />
      ))}
    </div>
  );
}
