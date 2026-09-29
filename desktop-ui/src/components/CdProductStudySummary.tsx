import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  lookupDeskProductBriefing,
  lookupDeskProductPatent,
  type ClinicalPreCdRecord,
  type ProductCompetitiveSignal,
  type ProductCorePatent,
  type ProductPatentCard,
  type ProductStudyCard,
} from "../api/supernova";
import { isMedtechTicker } from "../sheet/medtechSymbols";
import type { StudyOutcomeBriefing } from "../sheet/studyOutcomeBriefing";
import { classifyStudy } from "../sheet/studyClassifier";
import {
  collectEisProductBriefing,
  looksLikeDiseaseNotMolecularTarget,
  mergeProductBriefingWithAiLookup,
  productBriefingNeedsAiEnrichment,
  type EisProductBriefing,
} from "../sheet/eisProductBriefing";
import {
  buildProductIndicationRows,
  type DiseaseSocEpiInput,
} from "../sheet/indicationEpidemiology";
import { EisCompetitionNotesBox } from "./EisCompetitionNotesBox";
import {
  looksLikeNctOrStudyLabel,
  usableProductName,
} from "../sheet/simRowClinicalMeta";
import { daysToCdFromIso } from "../sheet/tickerEisSummary";
import { useLang } from "../shared/i18n";
import type { GuidanceCalendarEvent } from "../api/supernova";

/** Product name — always bold blue; size variants for summary vs inline/competition. */
const PRODUCT_NAME_SUMMARY_CLASS =
  "text-[13px] font-bold leading-snug text-[#A79AFF]";
const PRODUCT_NAME_INLINE_CLASS =
  "text-[10px] font-bold leading-snug text-[#A79AFF]";

function ProductNameText({
  name,
  variant = "inline",
  className = "",
}: {
  name: string;
  variant?: "summary" | "inline";
  className?: string;
}) {
  const text = name.trim();
  if (!text) return null;
  return (
    <span
      className={`${variant === "summary" ? PRODUCT_NAME_SUMMARY_CLASS : PRODUCT_NAME_INLINE_CLASS} ${className}`}
    >
      {text}
    </span>
  );
}

function formatCatalystCountdown(
  cdIso: string | null | undefined,
  it: boolean,
): string | null {
  const iso = (cdIso || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const days = daysToCdFromIso(iso);
  if (days == null) {
    return it
      ? `Catalyst day ${iso} — countdown non disponibile`
      : `Catalyst day ${iso} — countdown unavailable`;
  }
  if (days > 1) {
    return it
      ? `Trial completion day in avvicinamento — mancano ${days} giorni (${iso})`
      : `Trial completion day approaching — ${days} days left (${iso})`;
  }
  if (days === 1) {
    return it
      ? `Trial completion day in avvicinamento — manca 1 giorno (${iso})`
      : `Trial completion day approaching — 1 day left (${iso})`;
  }
  if (days === 0) {
    return it
      ? `Catalyst day oggi (${iso})`
      : `Catalyst day is today (${iso})`;
  }
  const ago = Math.abs(days);
  return it
    ? `Catalyst day passato — ${ago} giorn${ago === 1 ? "o" : "i"} fa (${iso})`
    : `Catalyst day passed — ${ago} day${ago === 1 ? "" : "s"} ago (${iso})`;
}

function SummaryField({
  label,
  value,
  empty,
  valueClassName = "text-[12px] leading-snug text-[#F3F5FA]",
  valueNode,
}: {
  label: string;
  value?: string | null;
  empty: string;
  valueClassName?: string;
  valueNode?: ReactNode;
}) {
  const text = (value || "").trim();
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
        {label}
      </p>
      {valueNode ? (
        valueNode
      ) : (
        <p className={valueClassName}>
          {text ? text : <span className="text-[#97A2BA] font-normal">{empty}</span>}
        </p>
      )}
    </div>
  );
}

function splitIndicationTokens(raw: string | null | undefined): string[] {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  return s
    .split(/\s*[|;/]\s*|\s+·\s+|\s+•\s+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 2 && !/^(n\/d|nd|none|null|unknown|—|-)$/i.test(x));
}

function collectProductDesignation(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts: { ticker: string; productName: string; nctId?: string | null },
): string | null {
  const tk = opts.ticker.trim().toUpperCase();
  const product = opts.productName.trim().toLowerCase();
  const nct = (opts.nctId || "").trim().toUpperCase();
  const hits: string[] = [];
  for (const rec of records ?? []) {
    if ((rec.ticker || "").trim().toUpperCase() !== tk) continue;
    if (nct && (rec.nct_id || "").trim().toUpperCase() === nct) {
      const d = (rec.ai?.study_clinical_profile?.fda_designation || "").trim();
      if (d) hits.push(d);
      continue;
    }
    const pname = (
      rec.ai?.study_clinical_profile?.product_name ||
      rec.meta?.interventions ||
      ""
    )
      .toLowerCase();
    if (product && pname.includes(product)) {
      const d = (rec.ai?.study_clinical_profile?.fda_designation || "").trim();
      if (d) hits.push(d);
    }
  }
  const uniq = [...new Set(hits.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];
  return uniq.length ? uniq.join(" · ") : null;
}

function collectProductIndications(opts: {
  indication?: string | null;
  briefingIndication?: string | null;
  ctgov: ProductStudyCard[];
  records: ClinicalPreCdRecord[] | null | undefined;
  ticker: string;
  productName: string;
  nctId?: string | null;
}): string[] {
  const out = new Map<string, string>();
  const push = (raw: string | null | undefined) => {
    for (const tok of splitIndicationTokens(raw)) {
      const key = tok.toLowerCase();
      if (!out.has(key)) out.set(key, tok);
    }
  };
  push(opts.indication);
  push(opts.briefingIndication);
  for (const s of opts.ctgov) push(s.conditions);
  const tk = opts.ticker.trim().toUpperCase();
  const product = opts.productName.trim().toLowerCase();
  const nct = (opts.nctId || "").trim().toUpperCase();
  for (const rec of opts.records ?? []) {
    if ((rec.ticker || "").trim().toUpperCase() !== tk) continue;
    const recNct = (rec.nct_id || "").trim().toUpperCase();
    const pname = (
      rec.ai?.study_clinical_profile?.product_name ||
      rec.meta?.interventions ||
      ""
    ).toLowerCase();
    const linked =
      (nct && recNct === nct) ||
      (product && pname.includes(product)) ||
      !product;
    if (!linked) continue;
    push(rec.meta?.conditions);
    push(rec.ai?.study_clinical_profile?.disease_soc?.disease);
  }
  return [...out.values()];
}

const SECTION_TITLE =
  "text-[11px] font-bold uppercase tracking-wide text-[#F3C451]";

function ProductSectionBox({
  title,
  children,
  className = "",
  collapsible = false,
  open = true,
  onToggle,
  collapsedHint,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  collapsedHint?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-white/[0.12] bg-[#1A2136] px-3 py-2.5 space-y-2 ${className}`}
    >
      {collapsible && onToggle ? (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="text-[#97A2BA] tabular-nums text-[12px]" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <p className={`${SECTION_TITLE} mb-0`}>{title}</p>
        </button>
      ) : (
        <p className={SECTION_TITLE}>{title}</p>
      )}
      {open ? (
        <div className="text-[12px] leading-snug text-[#F3F5FA]">{children}</div>
      ) : collapsedHint ? (
        <p className="text-[11px] text-[#97A2BA]">{collapsedHint}</p>
      ) : null}
    </section>
  );
}

function fmtYears(years: number | null | undefined, expiry: string | null | undefined): string {
  if (years == null || !Number.isFinite(years)) {
    return expiry ? `Expiry ${expiry}` : "Filing / expiry not found yet";
  }
  const exp = expiry ? ` · ${expiry}` : "";
  if (years < 0) return `Expired${exp} · ${Math.abs(Math.round(years))}y past LOE`;
  if (years < 1) return `LOE this year${exp}`;
  return `~${years.toFixed(1)} years remaining${exp}`;
}

function formatCorePatentLine(p: ProductCorePatent): string {
  const head = [p.patent_number, p.title].filter(Boolean).join(" — ");
  const life =
    p.expiry_date || p.years_remaining != null
      ? fmtYears(p.years_remaining, p.expiry_date)
      : p.filing_date
        ? `Filing ${p.filing_date}`
        : null;
  if (head && life) return `${head} · ${life}`;
  return head || life || "—";
}

function PatentFamilyList({
  patents,
  loading,
  empty,
  loadingLabel = "Searching Gemini aliases + Google Patents family…",
}: {
  patents: ProductCorePatent[] | undefined;
  loading: boolean;
  empty: string;
  loadingLabel?: string;
}) {
  if (loading && !patents?.length) {
    return <span className="text-[#97A2BA]">{loadingLabel}</span>;
  }
  const rows = (patents ?? []).filter(
    (p) => p.patent_number || p.title || p.expiry_date || p.filing_date,
  );
  if (!rows.length) {
    return <p className="text-[#97A2BA]">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((p, i) => {
        const label = formatCorePatentLine(p);
        const href = p.url?.trim();
        return (
          <li key={`${p.patent_number || p.title || "p"}-${i}`}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#F3F5FA] underline decoration-white/25 underline-offset-2 hover:decoration-[#F3C451]"
              >
                {label}
              </a>
            ) : (
              <span>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CompetitiveSignalCell({
  signal,
  loading,
}: {
  signal: ProductCompetitiveSignal | null | undefined;
  loading: boolean;
}) {
  if (loading && !signal) {
    return (
      <span className="text-[#97A2BA]">
        Looking up FDA device database (product code / 510(k)–PMA)…
      </span>
    );
  }
  if (!signal) {
    return (
      <p className="text-[#97A2BA]">
        No same-code 510(k)/PMA clearance found yet for this device class.
      </p>
    );
  }
  const head = [
    signal.clearance_type,
    signal.clearance_id,
    signal.product_code ? `code ${signal.product_code}` : null,
    signal.decision_date,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div>
      <p className="font-semibold">{head || "Clearance signal"}</p>
      {signal.device_name ? (
        <p className="mt-0.5 text-[11px] text-[#97A2BA] leading-snug">
          {signal.device_name}
          {signal.applicant ? ` · ${signal.applicant}` : ""}
        </p>
      ) : signal.applicant ? (
        <p className="mt-0.5 text-[11px] text-[#97A2BA] leading-snug">{signal.applicant}</p>
      ) : null}
      {signal.notes ? (
        <p className="mt-0.5 text-[11px] text-[#F3F5FA]">{signal.notes}</p>
      ) : null}
      {signal.source ? (
        <p className="mt-0.5 text-[10px] text-[#97A2BA]">
          Source: {signal.source === "openfda" ? "FDA device database (openFDA)" : signal.source}
        </p>
      ) : null}
    </div>
  );
}

export function CdProductStudySummary({
  ticker,
  company,
  productName,
  primaryNctId,
  briefings: _briefings,
  ctgovStudies = [],
  onAliases,
  kind = null,
  indication = null,
  clinicalRecords = null,
  showCompetition = true,
  clinicalNews = null,
  fdaBriefings = null,
  scientificPublications = null,
  ongoingTrialsExtra = null,
  cdIso = null,
  guidanceEvents: _guidanceEvents = null,
}: {
  ticker: string;
  company?: string | null;
  productName: string;
  primaryNctId?: string | null;
  briefings: StudyOutcomeBriefing[];
  ctgovStudies?: ProductStudyCard[];
  onAliases?: (aliases: string[]) => void;
  kind?: "completing_cd" | "pipeline" | null;
  indication?: string | null;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  /** Competition accordion under Product Summary. */
  showCompetition?: boolean;
  /** Optional Clinical News body (already wrapped by parent or raw). */
  clinicalNews?: ReactNode;
  /** Dedicated FDA AdCom briefing session (migrate from Daily News). */
  fdaBriefings?: ReactNode;
  /** Optional Scientific Publications body. */
  scientificPublications?: ReactNode;
  /** Extra content under Ongoing Clinical trials (e.g. CT.gov list). */
  ongoingTrialsExtra?: ReactNode;
  /** Completing CD date (YYYY-MM-DD) for Catalyst countdown. */
  cdIso?: string | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const empty = it ? "Non ancora disponibile" : "Not available yet";
  const [patent, setPatent] = useState<ProductPatentCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [patentsOpen, setPatentsOpen] = useState(false);
  /** Patent Gemini starts with the card (not on accordion expand). */
  const patentsRequested = true;
  const [briefing, setBriefing] = useState<EisProductBriefing>(() =>
    collectEisProductBriefing(clinicalRecords, {
      ticker,
      nctId: primaryNctId,
      productHint: productName,
    }),
  );
  const [briefingLoading, setBriefingLoading] = useState(false);
  const onAliasesRef = useRef(onAliases);
  onAliasesRef.current = onAliases;
  /** Prevents re-fetch / seed wipe when clinicalRecords array identity churns. */
  const productKey = `${ticker}|${productName.trim()}|${(primaryNctId || "").trim()}`;
  const briefingLookupKeyRef = useRef<string | null>(null);
  const stickyMoaRef = useRef<string | null>(null);
  const stickyDesignationRef = useRef<string | null>(null);

  const deviceHint = useMemo(() => {
    if (isMedtechTicker(ticker)) return true;
    const klass = classifyStudy(productName).klass;
    return klass === "device";
  }, [ticker, productName]);

  useEffect(() => {
    if (!patentsRequested) return;
    const product = productName.trim();
    // NCT / "Study NCT…" are study ids — never query patents with them.
    if (!product || looksLikeNctOrStudyLabel(product)) {
      setPatent(null);
      setLoading(false);
      setErr(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    void lookupDeskProductPatent({
      ticker,
      product_name: product,
      company: company || undefined,
      nct_id: primaryNctId || undefined,
      product_kind: deviceHint ? "device" : undefined,
    })
      .then((res) => {
        if (!alive) return;
        if (!res?.ok || !res.patent) {
          setErr(res?.error || "patent_lookup_failed");
          setPatent(null);
          return;
        }
        setPatent(res.patent);
        const aliases = [
          res.patent.brand_name,
          res.patent.generic_name,
          ...(res.patent.aliases ?? []),
        ].filter((x): x is string => Boolean(x && String(x).trim()));
        onAliasesRef.current?.(aliases);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [patentsRequested, ticker, productName, company, primaryNctId, deviceHint]);

  // Hard reset only when the product identity changes — not on feed refreshes.
  useEffect(() => {
    const seed = collectEisProductBriefing(clinicalRecords, {
      ticker,
      nctId: primaryNctId,
      productHint: productName,
    });
    setBriefing(seed);
    briefingLookupKeyRef.current = null;
    stickyMoaRef.current = null;
    stickyDesignationRef.current = null;
    // clinicalRecords intentionally omitted — soft-merge below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey]);

  // Soft-fill from feed without wiping AI-enriched MoA / indication.
  useEffect(() => {
    const seed = collectEisProductBriefing(clinicalRecords, {
      ticker,
      nctId: primaryNctId,
      productHint: productName,
    });
    setBriefing((prev) => ({
      ...prev,
      productName: prev.productName || seed.productName,
      productTechnology: prev.productTechnology || seed.productTechnology,
      modality: prev.modality || seed.modality,
      mechanismOfAction: prev.mechanismOfAction || seed.mechanismOfAction,
      therapeuticTarget: prev.therapeuticTarget || seed.therapeuticTarget,
      interventions: prev.interventions || seed.interventions,
      indication: prev.indication || seed.indication,
      usaPrevalence: prev.usaPrevalence || seed.usaPrevalence,
      standardOfCare: prev.standardOfCare || seed.standardOfCare,
      phase3And4Products: prev.phase3And4Products || seed.phase3And4Products,
      source:
        prev.source && prev.source !== "none" ? prev.source : seed.source,
    }));
  }, [clinicalRecords, ticker, primaryNctId, productName]);

  useEffect(() => {
    const product = productName.trim();
    if (!product) return;
    if (briefingLookupKeyRef.current === productKey) return;
    const seed = collectEisProductBriefing(clinicalRecords, {
      ticker,
      nctId: primaryNctId,
      productHint: productName,
    });
    if (!productBriefingNeedsAiEnrichment(seed)) {
      briefingLookupKeyRef.current = productKey;
      return;
    }
    briefingLookupKeyRef.current = productKey;
    let alive = true;
    setBriefingLoading(true);
    void lookupDeskProductBriefing({
      ticker,
      product_name: product,
      company: company || undefined,
      nct_id: primaryNctId || undefined,
      interventions: seed.interventions ?? undefined,
      conditions: indication || seed.indication || undefined,
    })
      .then((res) => {
        if (!alive || !res?.ok || !res.briefing) return;
        setBriefing((prev) => mergeProductBriefingWithAiLookup(prev, res.briefing!));
      })
      .finally(() => {
        if (alive) setBriefingLoading(false);
      });
    return () => {
      alive = false;
    };
    // Do not re-run on clinicalRecords churn — productKey gates the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey, company, indication]);

  const isDevice =
    deviceHint ||
    patent?.product_kind === "device" ||
    patent?.method === "device_ip";

  const designationRaw = useMemo(
    () =>
      collectProductDesignation(clinicalRecords, {
        ticker,
        productName,
        nctId: primaryNctId,
      }),
    [clinicalRecords, ticker, productName, primaryNctId],
  );

  const moaTargetRaw = useMemo(() => {
    const moa = (briefing.mechanismOfAction || "").trim();
    const rawTarget = (briefing.therapeuticTarget || "").trim();
    const target =
      rawTarget &&
      !looksLikeDiseaseNotMolecularTarget(rawTarget, briefing.indication)
        ? rawTarget
        : "";
    if (moa && target && !moa.toLowerCase().includes(target.toLowerCase())) {
      return `${moa} · Target: ${target}`;
    }
    return moa || (target ? `Target: ${target}` : null);
  }, [briefing.mechanismOfAction, briefing.therapeuticTarget, briefing.indication]);

  useEffect(() => {
    if (designationRaw) stickyDesignationRef.current = designationRaw;
  }, [designationRaw]);
  useEffect(() => {
    if (moaTargetRaw) stickyMoaRef.current = moaTargetRaw;
  }, [moaTargetRaw]);

  const designation = designationRaw || stickyDesignationRef.current;
  const moaTarget = moaTargetRaw || stickyMoaRef.current;

  const indications = useMemo(
    () =>
      collectProductIndications({
        indication,
        briefingIndication: briefing.indication,
        ctgov: ctgovStudies,
        records: clinicalRecords,
        ticker,
        productName,
        nctId: primaryNctId,
      }),
    [
      indication,
      briefing.indication,
      ctgovStudies,
      clinicalRecords,
      ticker,
      productName,
      primaryNctId,
    ],
  );

  const indicationRows = useMemo(() => {
    const diseaseSocs: DiseaseSocEpiInput[] = [];
    const tk = ticker.trim().toUpperCase();
    for (const rec of clinicalRecords ?? []) {
      if ((rec.ticker || "").trim().toUpperCase() !== tk) continue;
      const soc = rec.ai?.study_clinical_profile?.disease_soc;
      if (soc) diseaseSocs.push(soc);
    }
    return buildProductIndicationRows(indications, {
      diseaseSocs,
      briefingPrevalence: briefing.usaPrevalence,
      briefingIndication: briefing.indication,
    });
  }, [
    indications,
    clinicalRecords,
    ticker,
    briefing.usaPrevalence,
    briefing.indication,
  ]);

  const displayName =
    patent?.brand_name && patent.generic_name
      ? `${patent.brand_name} (${patent.generic_name})`
      : patent?.brand_name || patent?.generic_name || productName;

  // The card label can be a study placeholder ("CD study"): the competition
  // search uses the resolved drug and disease shown in the Product Summary.
  const competitionProduct =
    usableProductName(briefing.productName) ||
    usableProductName(patent?.generic_name) ||
    usableProductName(patent?.brand_name) ||
    usableProductName(productName) ||
    null;
  const competitionIndication =
    String(indication || "").trim() ||
    indicationRows[0]?.label ||
    indications[0] ||
    briefing.indication ||
    null;

  const methodNote =
    patent?.method === "20y_from_filing"
      ? "Estimate: US composition-of-matter term ≈ filing + 20 years (no PTE/SPC)."
      : patent?.method === "published_loe"
        ? "Published loss-of-exclusivity / Orange Book date."
        : patent?.method === "google_patents_family" ||
            patent?.method === "google_patents_anticipated"
          ? "Google Patents Events → Anticipated expiration (per patent title)."
          : null;

  const corePatents = patent?.core_patents?.filter(
    (p) => p.patent_number || p.title || p.expiry_date || p.filing_date,
  );
  const aliasNote =
    !isDevice && (patent?.aliases?.length || patent?.generic_name)
      ? [
          patent?.generic_name ? `INN: ${patent.generic_name}` : null,
          patent?.aliases?.length
            ? `Also searched: ${patent.aliases.slice(0, 6).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const catalystLine = useMemo(
    () =>
      kind === "completing_cd" || cdIso
        ? formatCatalystCountdown(cdIso, it)
        : null,
    [cdIso, kind, it],
  );

  return (
    <div className="space-y-3">
      <ProductSectionBox title="Product Summary">
        <div className="space-y-2.5">
          <SummaryField
            label="Catalyst"
            value={
              catalystLine ||
              (kind === "completing_cd"
                ? it
                  ? "Catalyst day in avvicinamento — data non ancora disponibile"
                  : "Catalyst day approaching — date not available yet"
                : kind === "pipeline"
                  ? it
                    ? "Nessun catalyst day vicino su questo asset"
                    : "No near-term catalyst day on this asset"
                  : null)
            }
            empty={empty}
          />
          <SummaryField
            label={it ? "Nome prodotto" : "Product name"}
            empty={empty}
            valueNode={
              displayName.trim() ? (
                <ProductNameText name={displayName} variant="summary" />
              ) : (
                <p className="text-[12px] text-[#97A2BA]">{empty}</p>
              )
            }
          />
          <SummaryField
            label={it ? "Designation" : "Designation"}
            value={designation}
            empty={empty}
          />
          <SummaryField
            label={it ? "MoA / target molecolare" : "MoA / molecular target"}
            value={moaTarget}
            empty={
              briefingLoading && !moaTarget
                ? it
                  ? "In caricamento…"
                  : "Loading…"
                : empty
            }
          />
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
              {it
                ? "Indicazioni (test / sviluppo)"
                : "Indications (tested / in development)"}
            </p>
            {indicationRows.length ? (
              <ul className="list-disc pl-4 space-y-2 text-[12px] leading-snug text-[#F3F5FA]">
                {indicationRows.map((row) => (
                  <li key={row.label.toLowerCase()}>
                    <span className="font-medium">{row.label}</span>
                    {row.epi.usaPrevalence ||
                    row.epi.fiveYearSurvival ||
                    row.epi.lifeExpectancy ? (
                      <div className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-[#C5CDDC] font-normal list-none">
                        {row.epi.usaPrevalence ? (
                          <p>
                            <span className="text-[#97A2BA]">
                              {it ? "Prevalenza USA" : "US prevalence"}:
                            </span>{" "}
                            {row.epi.usaPrevalence}
                          </p>
                        ) : null}
                        {row.epi.fiveYearSurvival ? (
                          <p>
                            <span className="text-[#97A2BA]">
                              {it
                                ? "Sopravvivenza a 5 anni"
                                : "5-year survival"}
                              :
                            </span>{" "}
                            {row.epi.fiveYearSurvival}
                          </p>
                        ) : null}
                        {row.epi.lifeExpectancy &&
                        !row.epi.fiveYearSurvival ? (
                          <p>
                            <span className="text-[#97A2BA]">
                              {it ? "Aspettativa di vita" : "Life expectancy"}:
                            </span>{" "}
                            {row.epi.lifeExpectancy}
                          </p>
                        ) : null}
                        {row.epi.lifeExpectancy && row.epi.fiveYearSurvival ? (
                          <p>
                            <span className="text-[#97A2BA]">
                              {it ? "Prognosi / OS" : "Prognosis / OS"}:
                            </span>{" "}
                            {row.epi.lifeExpectancy}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-[#97A2BA] font-normal">
                        {it
                          ? "Prevalenza USA / sopravvivenza 5 anni: non ancora mappate per questa indicazione."
                          : "US prevalence / 5-year survival: not mapped yet for this indication."}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#97A2BA]">
                {briefingLoading && !indicationRows.length
                  ? it
                    ? "In caricamento…"
                    : "Loading…"
                  : empty}
              </p>
            )}
          </div>
          {err && patentsRequested && !patent ? (
            <p className="text-[11px] text-[#F87185]">
              Lookup unavailable — {err}
            </p>
          ) : null}
        </div>
      </ProductSectionBox>

      {showCompetition ? (
        <ProductSectionBox title="Competition">
          <EisCompetitionNotesBox
            ticker={ticker}
            it={it}
            productName={competitionProduct}
            company={company}
            indication={competitionIndication}
            nctId={primaryNctId || null}
          />
        </ProductSectionBox>
      ) : null}

      <ProductSectionBox
        title="Patent Families"
        collapsible
        open={patentsOpen}
        onToggle={() => {
          setPatentsOpen((v) => !v);
        }}
        collapsedHint={
          it
            ? "Ricerca brevetti già avviata con la scheda — apri per vedere i risultati."
            : "Patent search starts with the card — expand to see results."
        }
      >
        {isDevice ? (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA] mb-1">
                Core Patent(s)
              </p>
              <PatentFamilyList
                patents={corePatents}
                loading={loading && !patent}
                loadingLabel="Searching patents for this device…"
                empty="No core device patent identified yet (USPTO / company filings)."
              />
              {patent?.notes ? (
                <p className="mt-1 text-[11px] text-[#F3F5FA] leading-snug">{patent.notes}</p>
              ) : null}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA] mb-1">
                Competitive Signal — first same-code 510(k)/PMA
              </p>
              <CompetitiveSignalCell
                signal={patent?.competitive_signal}
                loading={loading}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {corePatents && corePatents.length ? (
              <>
                <PatentFamilyList
                  patents={corePatents}
                  loading={loading && !patent}
                  empty="Filing / expiry not found yet"
                />
                {aliasNote ? (
                  <p className="mt-1 text-[10px] text-[#97A2BA]">{aliasNote}</p>
                ) : null}
                {patent?.notes ? (
                  <p className="mt-1 text-[11px] text-[#F3F5FA] leading-snug">{patent.notes}</p>
                ) : null}
                {methodNote ? (
                  <p className="mt-0.5 text-[10px] text-[#97A2BA]">{methodNote}</p>
                ) : null}
              </>
            ) : loading && !patent ? (
              <span className="text-[#97A2BA]">
                Searching Gemini aliases + Google Patents family…
              </span>
            ) : (
              <>
                <p>{fmtYears(patent?.years_remaining, patent?.expiry_date)}</p>
                {patent?.filing_date ? (
                  <p className="text-[11px] text-[#97A2BA]">Filing {patent.filing_date}</p>
                ) : null}
                {patent?.patent_number ? (
                  <p className="text-[11px] text-[#97A2BA]">{patent.patent_number}</p>
                ) : null}
                {aliasNote ? (
                  <p className="mt-0.5 text-[10px] text-[#97A2BA]">{aliasNote}</p>
                ) : null}
                {patent?.notes ? (
                  <p className="mt-0.5 text-[11px] text-[#F3F5FA] leading-snug">
                    {patent.notes}
                  </p>
                ) : null}
                {methodNote ? (
                  <p className="mt-0.5 text-[10px] text-[#97A2BA]">{methodNote}</p>
                ) : null}
                {err && !patent ? (
                  <p className="text-[11px] text-[#F87185]">
                    Patent lookup unavailable — {err}
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </ProductSectionBox>

      <ProductSectionBox title="Ongoing Clinical trials">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
              {it ? "Studi ongoing su questo prodotto" : "Ongoing studies for this product"}
            </p>
            {ongoingTrialsExtra}
          </div>
        </div>
      </ProductSectionBox>

      <ProductSectionBox title={it ? "Briefing FDA" : "FDA Briefings"}>
        {fdaBriefings ?? (
          <p className="text-[#97A2BA]">
            {it
              ? "Nessun briefing AdCom migrato per questo prodotto. EIS a 12 / 24 / 36 h arriverà qui."
              : "No migrated AdCom briefing for this product yet. EIS at 12 / 24 / 36 h will land here."}
          </p>
        )}
      </ProductSectionBox>

      <ProductSectionBox title="Clinical News">
        {clinicalNews ?? (
          <p className="text-[#97A2BA]">
            {it
              ? "Nessuna news clinica collegata a questo prodotto nel feed."
              : "No clinical news in the feed linked to this product."}
          </p>
        )}
      </ProductSectionBox>

      <ProductSectionBox title="Scientific Publications">
        {scientificPublications ?? (
          <p className="text-[#97A2BA]">
            {it
              ? "Carica CT.gov / PubMed per vedere le pubblicazioni."
              : "Load CT.gov / PubMed to see publications."}
          </p>
        )}
      </ProductSectionBox>
    </div>
  );
}
