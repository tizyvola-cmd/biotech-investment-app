import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import {
  fetchClinicalStudyMeta,
  type ClinicalStudyProtocolMeta,
} from "../api/supernova";
import type { SheetTable } from "../types";
import {
  clinicalRowCanonicalCd,
  findLooseClinicalRowForCatalyst,
  normNctId,
  type SimCdCatalyst,
} from "../sheet/clinicalSimulationFilter";
import {
  nctClinicalTrialsUrl,
  sheetCellAsLink,
  sheetCellPlainText,
} from "../sheet/cellLinks";
import { useLang } from "../shared/i18n";

// ── Field helpers ────────────────────────────────────────────────────────────

function cellText(v: unknown): string {
  const t = sheetCellPlainText(v).trim();
  return t && t !== "—" ? t : "";
}

function normCol(c: string): string {
  return c.toLowerCase().replace(/[\s\n_-]+/g, "");
}

function pickField(
  row: Record<string, unknown>,
  columns: string[],
  patterns: RegExp[],
): string {
  for (const col of columns) {
    const n = normCol(col);
    if (!patterns.some((p) => p.test(n))) continue;
    const v = cellText(row[col]);
    if (v) return v;
  }
  return "";
}

/** Legge campi snapshot per chiave diretta, poi fallback su pickField. */
function fieldFromRow(
  row: Record<string, unknown>,
  columns: string[],
  patterns: RegExp[],
  ...directKeys: string[]
): string {
  for (const key of directKeys) {
    const v = cellText(row[key]);
    if (v && v.toLowerCase() !== "none" && v.toLowerCase() !== "n/d") return v;
  }
  return pickField(row, columns, patterns);
}

/** Cache CT.gov — memoria + sessionStorage (sopravvive al reload tab Clinical). */
const CTGOV_CACHE_LS = "sn_ctgov_card_enrich_v2";
const CTGOV_ENRICHMENT_CACHE = new Map<string, ClinicalStudyCardModel>();

function enrichCacheKey(ticker: string, nct: string | null): string {
  return `${ticker.toUpperCase()}|${(nct ?? "").toUpperCase()}`;
}

function hydrateCtgovCacheFromStorage(): void {
  try {
    const raw = sessionStorage.getItem(CTGOV_CACHE_LS);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ClinicalStudyCardModel>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.ticker) CTGOV_ENRICHMENT_CACHE.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

function persistCtgovCacheToStorage(): void {
  try {
    const obj: Record<string, ClinicalStudyCardModel> = {};
    for (const [k, v] of CTGOV_ENRICHMENT_CACHE.entries()) obj[k] = v;
    sessionStorage.setItem(CTGOV_CACHE_LS, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

hydrateCtgovCacheFromStorage();

function mergeCachedOntoStudy(
  study: ClinicalStudyCardModel,
  cached: ClinicalStudyCardModel,
): ClinicalStudyCardModel {
  const pick = (cur: string, next: string) =>
    fieldMissing(cur) && !fieldMissing(next) ? next : cur;
  return {
    ...study,
    title: pick(study.title, cached.title),
    conditions: pick(study.conditions, cached.conditions),
    interventions: pick(study.interventions, cached.interventions),
    leadSponsor: pick(study.leadSponsor, cached.leadSponsor),
    collaborators: pick(study.collaborators, cached.collaborators),
    interventionType: pick(study.interventionType, cached.interventionType),
    studyType: pick(study.studyType, cached.studyType),
    startDate: pick(study.startDate, cached.startDate),
    lastUpdate: pick(study.lastUpdate, cached.lastUpdate),
    phase: study.phase || cached.phase,
    status: study.status || cached.status,
    sponsorRelationRaw: pick(study.sponsorRelationRaw, cached.sponsorRelationRaw),
    enrichedFromCtgov: study.enrichedFromCtgov || cached.enrichedFromCtgov,
  };
}

function applyEnrichmentCache(
  studies: ClinicalStudyCardModel[],
): ClinicalStudyCardModel[] {
  return studies.map((s) => {
    const cached = CTGOV_ENRICHMENT_CACHE.get(enrichCacheKey(s.ticker, s.nct));
    return cached ? mergeCachedOntoStudy(s, cached) : s;
  });
}

function pickNct(row: Record<string, unknown>, columns: string[]): {
  nct: string | null;
  href: string | null;
} {
  const nctCol = columns.find((c) => /^(nct_id|nctid|nct)$/.test(normCol(c)));
  const raw = nctCol ? row[nctCol] : row.nct_id ?? row.nct;
  const link = sheetCellAsLink(raw);
  const text = cellText(raw).toUpperCase().replace(/\s/g, "");
  const m = /NCT\d{8,}/.exec(text);
  const nct = m ? m[0] : null;
  const href = link?.href ?? (nct ? nctClinicalTrialsUrl(nct) : null);
  return { nct, href };
}

function formatCd(iso: string, fallback: string): string {
  if (!iso) return fallback || "—";
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return fallback || iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function urgencyClass(days: number | null): string {
  if (days == null) return "text-ink-muted";
  if (days <= 14) return "text-[rgb(var(--signal-down))] font-bold";
  if (days <= 60) return "text-[rgb(var(--warn))] font-semibold";
  return "text-ink-muted";
}

export function formatNctRelationLabel(
  raw: string,
  lang: "en" | "it",
): string {
  const s = raw.trim().toLowerCase().replace(/·/g, " ");
  if (!s || s === "n/d" || s === "nd" || s === "—") return "—";
  if (s === "exact" || s === "direct sponsor") {
    return lang === "it" ? "Sponsor diretto" : "Direct sponsor";
  }
  if (s === "partial") {
    return lang === "it" ? "Match parziale sponsor" : "Partial sponsor match";
  }
  if (s === "collaborator") {
    return lang === "it" ? "Collaboratore" : "Collaborator";
  }
  if (s === "correlated company/subsidiary" || s === "subsidiary") {
    return lang === "it" ? "Controllata / correlata" : "Subsidiary / correlated";
  }
  if (s === "indirect connections") {
    return lang === "it" ? "Collegamenti indiretti" : "Indirect connections";
  }
  return raw.trim();
}

function fieldMissing(v: string): boolean {
  return !v || v === "—";
}

function profileIncomplete(study: ClinicalStudyCardModel): boolean {
  return (
    fieldMissing(study.title) ||
    fieldMissing(study.leadSponsor) ||
    fieldMissing(study.conditions) ||
    fieldMissing(study.interventions) ||
    fieldMissing(study.startDate) ||
    fieldMissing(study.lastUpdate) ||
    fieldMissing(study.collaborators) ||
    fieldMissing(study.sponsorRelationRaw)
  );
}

function needsCtgovEnrichment(study: ClinicalStudyCardModel): boolean {
  if (!study.nct) return false;
  const ck = enrichCacheKey(study.ticker, study.nct);
  if (CTGOV_ENRICHMENT_CACHE.has(ck)) return false;
  if (study.enrichedFromCtgov && !profileIncomplete(study)) return false;
  return !study.openFdaMatched || profileIncomplete(study);
}

function mergeStudyWithCtgovMeta(
  study: ClinicalStudyCardModel,
  meta: ClinicalStudyProtocolMeta,
): ClinicalStudyCardModel {
  if (meta.error || !meta.nct_id) return study;
  const pick = (cur: string, next?: string) =>
    !fieldMissing(cur) ? cur : next?.trim() && !fieldMissing(next) ? next.trim() : cur;
  return {
    ...study,
    title: pick(study.title, meta.brief_title || meta.official_title) || "—",
    conditions: pick(study.conditions, meta.conditions) || "—",
    interventions: pick(study.interventions, meta.interventions) || "—",
    leadSponsor: pick(study.leadSponsor, meta.lead_sponsor) || "—",
    collaborators: pick(study.collaborators, meta.collaborators) || "—",
    interventionType:
      pick(study.interventionType, meta.intervention_type) || "—",
    studyType: pick(study.studyType, meta.study_type) || "—",
    startDate: pick(study.startDate, meta.start_date) || "—",
    lastUpdate:
      pick(study.lastUpdate, meta.last_update_posted_date) || "—",
    phase: study.phase || meta.phase || "",
    status: study.status || meta.overall_status || "",
    sponsorRelationRaw: pick(study.sponsorRelationRaw, meta.nct_relation_type),
    enrichedFromCtgov: true,
    openFdaMatched: true,
  };
}

function cdBadge(days: number | null): string {
  if (days == null) return "—";
  if (days === 0) return "⚡ Today";
  if (days <= 7) return `🔴 ${days}d`;
  if (days <= 14) return `⚠ ${days}d`;
  return `${days}d`;
}

function cardTone(days: number | null): {
  border: string;
  bg: string;
  badge: string;
} {
  if (days != null && days <= 14) {
    return {
      border: "border-[rgb(var(--signal-down))]/35",
      bg: "bg-[rgb(var(--signal-down))]/[0.06]",
      badge: "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))]",
    };
  }
  if (days != null && days <= 60) {
    return {
      border: "border-[rgb(var(--warn))]/35",
      bg: "bg-[rgb(var(--warn))]/[0.06]",
      badge: "bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))]",
    };
  }
  return {
    border: "border-[rgb(var(--accent))]/30",
    bg: "bg-[rgb(var(--accent))]/[0.05]",
    badge: "bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))]",
  };
}

export type ClinicalStudyCardModel = {
  key: string;
  ticker: string;
  company: string;
  nct: string | null;
  studyHref: string | null;
  title: string;
  conditions: string;
  cdDisplay: string;
  daysToCd: number | null;
  interventions: string;
  leadSponsor: string;
  collaborators: string;
  interventionType: string;
  phase: string;
  status: string;
  studyType: string;
  startDate: string;
  lastUpdate: string;
  /** False when only Simulation CD exists — no OpenFDA row matched yet. */
  openFdaMatched: boolean;
  /** OpenFDA row matched on CD but NCT differs from Simulation. */
  nctMismatch?: boolean;
  /** NCT on the OpenFDA / loose-match row (if different from Simulation). */
  clinicalNct?: string | null;
  /** Fields from a loose CD match in the local clinical snapshot. */
  enrichedFromClinicalLoose?: boolean;
  /** Populated from CT.gov when OpenFDA row missing or NCT mismatch. */
  enrichedFromCtgov?: boolean;
  /** Raw ``nct_relation_type`` (CT.gov / OpenFDA). */
  sponsorRelationRaw: string;
};

export function buildClinicalStudyCardFromLooseMatch(
  row: Record<string, unknown>,
  columns: string[],
  catalyst: SimCdCatalyst,
  companyName?: string,
): ClinicalStudyCardModel {
  const study = buildClinicalStudyCard(row, columns, catalyst);
  const rowNct = study.nct;
  const simNct = catalyst.nct ?? normNctId(catalyst.studyHref);
  const nctMismatch = Boolean(simNct && rowNct && simNct !== rowNct);
  const simName = companyName || catalyst.company || catalyst.ticker;
  return {
    ...study,
    key: `${catalyst.ticker}|loose|${catalyst.completionDate}|${simNct ?? rowNct ?? ""}`,
    company: simName && study.company === catalyst.ticker ? simName : study.company,
    nct: simNct ?? rowNct,
    studyHref:
      catalyst.studyHref ??
      study.studyHref ??
      (simNct ? nctClinicalTrialsUrl(simNct) : null),
    openFdaMatched: false,
    nctMismatch,
    clinicalNct: rowNct,
    enrichedFromClinicalLoose: true,
  };
}

export function buildClinicalStudyCardFromCatalyst(
  catalyst: SimCdCatalyst,
  companyName?: string,
): ClinicalStudyCardModel {
  const tk = catalyst.ticker;
  const nct = catalyst.nct ?? normNctId(catalyst.studyHref);
  return {
    key: `${tk}|sim|${catalyst.completionDate}|${nct ?? ""}`,
    ticker: tk,
    company: companyName || catalyst.company || tk,
    nct,
    studyHref:
      catalyst.studyHref ?? (nct ? nctClinicalTrialsUrl(nct) : null),
    title: "—",
    conditions: "",
    cdDisplay: catalyst.completionDateDisplay,
    daysToCd: catalyst.daysToCd,
    interventions: "",
    leadSponsor: "",
    collaborators: "",
    interventionType: "—",
    phase: "",
    status: "",
    studyType: "",
    startDate: "",
    lastUpdate: "",
    openFdaMatched: false,
    enrichedFromCtgov: false,
    sponsorRelationRaw: "",
  };
}

export function buildClinicalStudyCard(
  row: Record<string, unknown>,
  columns: string[],
  catalyst?: SimCdCatalyst,
): ClinicalStudyCardModel {
  const ticker = String(row.ticker ?? row.Ticker ?? "")
    .trim()
    .toUpperCase();
  const { nct, href } = pickNct(row, columns);
  const canonCd = clinicalRowCanonicalCd(row, columns);
  const cdDisplay =
    catalyst?.completionDateDisplay ??
    formatCd(canonCd ?? "", cellText(row.primary_completion_date ?? row.completion_date));
  const daysToCd = catalyst?.daysToCd ?? null;

  const company =
    catalyst?.company ||
    cellText(row.company_name_full) ||
    cellText(row.query_company) ||
    cellText(row.companyName) ||
    ticker;

  const collaboratorsRaw =
    fieldFromRow(row, columns, [/^collaborators$/, /collaborator/, /collabs/], "collaborators") ||
    (Array.isArray(row.collaborators)
      ? (row.collaborators as unknown[])
          .map((x) => cellText(x))
          .filter((v) => v && v.toLowerCase() !== "none")
          .join(", ")
      : "");
  const collaborators = collaboratorsRaw;

  const conditions = [
    fieldFromRow(row, columns, [/conditions/, /condition/, /indication/], "conditions"),
    cellText(row.indications_and_usage),
    cellText(row.purpose),
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");

  const interventions = [
    fieldFromRow(
      row,
      columns,
      [/^interventions$/, /interventions/, /interventionname/, /^intervention$/],
      "interventions",
    ),
    cellText(row.brand_name),
    cellText(row.generic_name),
    cellText(row.substance_name),
    cellText(row.product_type),
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");

  const leadSponsor = [
    fieldFromRow(
      row,
      columns,
      [/leadsponsor/, /^sponsor$/, /responsibleparty/],
      "lead_sponsor",
    ),
    cellText(row.responsible_party_org),
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");

  const relationRaw =
    fieldFromRow(
      row,
      columns,
      [/nctrelation/, /relationtype/, /sponsorrelation/],
      "nct_relation_type",
    ) || cellText(row.sponsor_match);

  const interventionType = [
    fieldFromRow(row, columns, [/modality/, /interventiontype/], "intervention_type"),
    cellText(row.study_type),
    cellText(row.product_type),
    cellText(row.purpose),
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");

  return {
    key: `${ticker}|${nct ?? ""}|${canonCd ?? cdDisplay}`,
    ticker,
    company,
    nct,
    studyHref: href ?? catalyst?.studyHref ?? null,
    title:
      cellText(row.brief_title) ||
      cellText(row.official_title) ||
      "—",
    conditions: conditions || "—",
    cdDisplay,
    daysToCd,
    interventions: interventions || "—",
    leadSponsor: leadSponsor || "—",
    collaborators: collaborators || "—",
    interventionType: interventionType || "—",
    phase: cellText(row.phase),
    status: cellText(row.overall_status ?? row.status),
    studyType: cellText(row.study_type) || "—",
    startDate: cellText(row.start_date) || "—",
    lastUpdate: cellText(row.last_update_posted_date) || "—",
    openFdaMatched: true,
    enrichedFromCtgov: false,
    sponsorRelationRaw: relationRaw,
  };
}

// ── UI pieces ────────────────────────────────────────────────────────────────

function InfoBlock({
  label,
  value,
  multiline = true,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const shown = value && value !== "—" ? value : "—";
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide clinical-card-label font-semibold">
        {label}
      </p>
      <p
        className={`text-[11px] clinical-card-value leading-snug mt-0.5 ${
          multiline ? "line-clamp-3" : ""
        }`}
        title={shown}
      >
        {shown}
      </p>
    </div>
  );
}

function ExternalBtn({
  href,
  children,
  variant = "accent",
}: {
  href: string;
  children: ReactNode;
  variant?: "accent" | "neutral";
}) {
  const cls =
    variant === "accent"
      ? "border-[rgb(var(--accent))]/40 bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/20"
      : "border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/60 text-ink-muted hover:text-ink";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition ${cls}`}
    >
      {children}
      <span className="opacity-60">↗</span>
    </a>
  );
}

export function ClinicalStudyCard({ study }: { study: ClinicalStudyCardModel }) {
  const { lang } = useLang();
  const tone = cardTone(study.daysToCd);
  const unmatched = !study.openFdaMatched;
  return (
    <article
      className={`clinical-card-surface rounded-xl border px-4 py-3 transition-shadow hover:shadow-sm ${
        unmatched ? "border-dashed" : tone.border
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold clinical-card-title leading-tight" title={study.company}>
              {study.company}
            </h3>
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${tone.badge}`}
            >
              {study.ticker}
            </span>
          </div>

          {!study.openFdaMatched && !study.enrichedFromCtgov && !study.enrichedFromClinicalLoose && (
            <p className="text-[10px] clinical-card-muted italic">
              {lang === "it"
                ? "Catalyst da Simulation — nessuno studio OpenFDA abbinato (NCT/CD)."
                : "Simulation catalyst — no OpenFDA study matched yet (NCT/CD)."}
            </p>
          )}
          {study.enrichedFromClinicalLoose && study.nctMismatch && (
            <p className="text-[10px] text-[rgb(var(--warn))]/90">
              {lang === "it"
                ? `Dati OpenFDA su CD (±7 g) — NCT Simulation (${study.nct ?? "—"}) ≠ OpenFDA (${study.clinicalNct ?? "—"}).`
                : `OpenFDA data matched on CD (±7 d) — Simulation NCT (${study.nct ?? "—"}) ≠ OpenFDA (${study.clinicalNct ?? "—"}).`}
            </p>
          )}
          {study.enrichedFromClinicalLoose && !study.nctMismatch && (
            <p className="text-[10px] text-[rgb(var(--signal-up))]/90">
              {lang === "it"
                ? "Dati studio da snapshot OpenFDA locale (match CD)."
                : "Study fields from local OpenFDA snapshot (CD match)."}
            </p>
          )}
          {study.enrichedFromCtgov && (
            <p className="text-[10px] text-[rgb(var(--signal-up))]/90">
              {lang === "it"
                ? "Dati studio da ClinicalTrials.gov (NCT Simulation)."
                : "Study fields from ClinicalTrials.gov (Simulation NCT)."}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {study.studyHref && (
              <ExternalBtn href={study.studyHref} variant="accent">
                ClinicalTrials.gov
                {study.nct ? ` · ${study.nct}` : ""}
              </ExternalBtn>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <InfoBlock label={lang === "it" ? "Titolo" : "Title"} value={study.title} />
            <InfoBlock label={lang === "it" ? "Indicazione / condizioni" : "Indication / conditions"} value={study.conditions} />
            <InfoBlock label={lang === "it" ? "Data completamento (CD)" : "Completion date (CD)"} value={study.cdDisplay} multiline={false} />
            <InfoBlock label={lang === "it" ? "Interventi" : "Interventions"} value={study.interventions} />
            <InfoBlock label={lang === "it" ? "Lead sponsor" : "Lead sponsor"} value={study.leadSponsor} />
            <InfoBlock
              label={lang === "it" ? "Relazione sponsor" : "Sponsor relationship"}
              value={formatNctRelationLabel(study.sponsorRelationRaw, lang)}
              multiline={false}
            />
            <InfoBlock label={lang === "it" ? "Collaboratori" : "Collaborators"} value={study.collaborators} />
            <InfoBlock label={lang === "it" ? "Tipo di intervento" : "Type of intervention"} value={study.interventionType} />
            <InfoBlock label={lang === "it" ? "Tipo studio" : "Study type"} value={study.studyType} />
            <InfoBlock label={lang === "it" ? "Data inizio" : "Start date"} value={study.startDate} multiline={false} />
            <InfoBlock label={lang === "it" ? "Ultimo aggiornamento" : "Last update"} value={study.lastUpdate} multiline={false} />
          </div>

          {(study.phase || study.status) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {study.phase && (
                <span className="clinical-chip text-[9px] px-1.5 py-0.5 rounded-full clinical-card-muted">
                  {study.phase.replace(/_/g, " ")}
                </span>
              )}
              {study.status && (
                <span className="clinical-chip text-[9px] px-1.5 py-0.5 rounded-full clinical-card-muted">
                  {study.status.replace(/_/g, " ")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className={`text-[12px] tabular-nums ${urgencyClass(study.daysToCd)}`}>
            {cdBadge(study.daysToCd)}
          </p>
          <p className="text-[10px] clinical-card-muted tabular-nums mt-0.5">{study.cdDisplay}</p>
        </div>
      </div>
    </article>
  );
}

// ── List panel (replaces wide grid for 2-month clinical match) ───────────────

export function ClinicalStudyCardsPanel({
  title,
  sourceHint,
  dataTable,
  fullClinicalTable,
  loading,
  error,
  simTable,
  simCdByTicker,
  emptyTickerHint,
  onReload,
}: {
  title: string;
  sourceHint: ReactNode;
  dataTable: SheetTable | null;
  /** Unfiltered clinical snapshot — used for loose CD match when strict NCT filter excludes a row. */
  fullClinicalTable?: SheetTable | null;
  loading: boolean;
  error: string | null;
  simTable: SheetTable | null;
  simCdByTicker?: Record<string, SimCdCatalyst>;
  emptyTickerHint?: string;
  onReload?: () => void;
}) {
  const { lang } = useLang();
  const columns = dataTable?.columns ?? fullClinicalTable?.columns ?? [];
  const tickers = useMemo(() => {
    const fromSim = Object.keys(simCdByTicker ?? {}).sort();
    if (fromSim.length > 0) return fromSim;
    const fromRows = new Set(
      (dataTable?.rows ?? []).map((r) =>
        String(r.ticker ?? r.Ticker ?? "")
          .trim()
          .toUpperCase()
      )
    );
    return [...fromRows].filter(Boolean).sort();
  }, [simCdByTicker, dataTable?.rows]);

  const [selected, setSelected] = useState<string | "all">("all");

  const simNameByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of simTable?.rows ?? []) {
      const t = String(r.Ticker ?? "").trim().toUpperCase();
      if (!t) continue;
      const name = String(r.Società ?? r.Nome ?? r.Company ?? "").trim();
      if (name) m.set(t, name);
    }
    return m;
  }, [simTable?.rows]);

  const studies = useMemo(() => {
    const matched = new Set<string>();
    const list: ClinicalStudyCardModel[] = [];

    for (const row of dataTable?.rows ?? []) {
      const tk = String(row.ticker ?? row.Ticker ?? "")
        .trim()
        .toUpperCase();
      let study = buildClinicalStudyCard(row, columns, simCdByTicker?.[tk]);
      const simName = simNameByTicker.get(tk);
      if (simName && (!study.company || study.company === tk)) {
        study = { ...study, company: simName };
      }
      matched.add(tk);
      list.push(study);
    }

    for (const [tk, cat] of Object.entries(simCdByTicker ?? {})) {
      if (matched.has(tk)) continue;
      const simName = simNameByTicker.get(tk);
      // Match OpenFDA per CD anche se Simulation ha NCT diverso (evita card vuote).
      const looseRow = findLooseClinicalRowForCatalyst(
        fullClinicalTable ?? dataTable,
        cat,
      );
      if (looseRow) {
        list.push(buildClinicalStudyCardFromLooseMatch(looseRow, columns, cat, simName));
      } else {
        list.push(buildClinicalStudyCardFromCatalyst(cat, simName));
      }
    }

    // Righe filtrate NCT-strict ma dati incompleti: arricchisci da loose match stesso CD.
    const fullTable = fullClinicalTable ?? dataTable;
    for (let i = 0; i < list.length; i++) {
      const study = list[i];
      const cat = simCdByTicker?.[study.ticker];
      if (!cat || !profileIncomplete(study)) continue;
      const looseRow = findLooseClinicalRowForCatalyst(fullTable, cat);
      if (!looseRow) continue;
      const looseCard = buildClinicalStudyCard(looseRow, columns, cat);
      const pick = (cur: string, next: string) =>
        fieldMissing(cur) && !fieldMissing(next) ? next : cur;
      list[i] = {
        ...study,
        title: pick(study.title, looseCard.title),
        conditions: pick(study.conditions, looseCard.conditions),
        interventions: pick(study.interventions, looseCard.interventions),
        leadSponsor: pick(study.leadSponsor, looseCard.leadSponsor),
        collaborators: pick(study.collaborators, looseCard.collaborators),
        interventionType: pick(study.interventionType, looseCard.interventionType),
        studyType: pick(study.studyType, looseCard.studyType),
        startDate: pick(study.startDate, looseCard.startDate),
        lastUpdate: pick(study.lastUpdate, looseCard.lastUpdate),
        sponsorRelationRaw: pick(study.sponsorRelationRaw, looseCard.sponsorRelationRaw),
        phase: study.phase || looseCard.phase,
        status: study.status || looseCard.status,
        openFdaMatched: study.openFdaMatched || looseCard.openFdaMatched,
      };
    }

    return list.sort((a, b) => {
      const da = a.daysToCd ?? 9999;
      const db = b.daysToCd ?? 9999;
      if (da !== db) return da - db;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [dataTable?.rows, columns, simCdByTicker, simNameByTicker, fullClinicalTable]);

  const studiesSig = useMemo(
    () => studies.map((s) => `${s.key}|${s.nct ?? ""}`).join(";"),
    [studies],
  );

  const [cacheTick, setCacheTick] = useState(0);
  const inFlightRef = useRef(new Set<string>());

  const enrichedStudies = useMemo(
    () => applyEnrichmentCache(studies),
    [studies, cacheTick],
  );

  useEffect(() => {
    const pending = applyEnrichmentCache(studies).filter(
      (s) =>
        s.nct &&
        needsCtgovEnrichment(s) &&
        !inFlightRef.current.has(enrichCacheKey(s.ticker, s.nct)),
    );
    if (pending.length === 0) return;

    let cancelled = false;

    const run = async () => {
      for (const batch of chunkArray(pending, 3)) {
        if (cancelled) return;
        await Promise.all(
          batch.map(async (study) => {
            if (!study.nct) return;
            const ck = enrichCacheKey(study.ticker, study.nct);
            if (CTGOV_ENRICHMENT_CACHE.has(ck) || inFlightRef.current.has(ck)) return;
            inFlightRef.current.add(ck);
            try {
              const meta = await fetchClinicalStudyMeta(study.nct, study.company);
              const merged = mergeStudyWithCtgovMeta(study, meta);
              if (merged.enrichedFromCtgov) {
                CTGOV_ENRICHMENT_CACHE.set(ck, merged);
                persistCtgovCacheToStorage();
              }
            } catch {
              /* rete / API offline */
            } finally {
              inFlightRef.current.delete(ck);
            }
          }),
        );
        if (!cancelled) setCacheTick((t) => t + 1);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [studiesSig, studies]);

  const displayStudies = useMemo(() => {
    if (selected === "all") return enrichedStudies;
    return enrichedStudies.filter((s) => s.ticker === selected);
  }, [enrichedStudies, selected]);

  const countsByTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of enrichedStudies) m.set(s.ticker, (m.get(s.ticker) ?? 0) + 1);
    return m;
  }, [enrichedStudies]);

  return (
    <div className="clinical-list-panel flex flex-col gap-3 p-3">
      <div className="clinical-card-surface rounded-lg border px-4 py-3">
        <h2 className="text-sm font-semibold clinical-card-title">{title}</h2>
        <p className="text-xs clinical-card-muted mt-1 leading-snug">
          {simCdByTicker && Object.keys(simCdByTicker).length > 0
            ? lang === "it"
              ? `${Object.keys(simCdByTicker).length} catalyst Simulation (CD ≤ 60 g)`
              : `${Object.keys(simCdByTicker).length} Simulation catalysts (CD ≤ 60 d)`
            : lang === "it"
              ? `${tickers.length} società`
              : `${tickers.length} companies`}
          {" — "}
          {sourceHint}
          {dataTable?.row_count != null && (
            <>
              {" · "}
              <strong className="clinical-card-value">{dataTable.row_count}</strong>{" "}
              {lang === "it" ? "studi abbinati" : "matched studies"}
            </>
          )}
        </p>
        {dataTable?.filter_note && (
          <p className="text-[10px] clinical-card-muted mt-1">{dataTable.filter_note}</p>
        )}
        {error && (
          <p className="text-xs text-[rgb(var(--signal-down))] mt-2">{error}</p>
        )}
        {onReload && error && (
          <button type="button" className="btn-ghost text-xs mt-2" onClick={onReload}>
            {lang === "it" ? "Riprova caricamento" : "Retry load"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={selected === "all" ? "seg-btn-active" : "seg-btn-outline"}
          onClick={() => setSelected("all")}
        >
          {lang === "it" ? "Tutte" : "All"} ({studies.length})
        </button>
        {tickers.map((tk) => {
          const n = countsByTicker.get(tk) ?? 0;
          const label = simNameByTicker.get(tk);
          return (
            <button
              key={tk}
              type="button"
              title={
                n === 0 && emptyTickerHint
                  ? `${label || tk}: ${emptyTickerHint}`
                  : label || tk
              }
              className={`${selected === tk ? "seg-btn-active" : "seg-btn-outline"} ${
                n === 0 ? "opacity-50" : ""
              }`}
              onClick={() => setSelected(tk)}
            >
              {tk}
              {n > 0 ? ` (${n})` : " ·0"}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-xs text-ink-muted/60 py-8 text-center animate-pulse">
          {lang === "it" ? "Caricamento studi clinici…" : "Loading clinical studies…"}
        </p>
      ) : displayStudies.length === 0 ? (
        <p className="text-xs text-ink-muted/70 py-8 text-center">
          {emptyTickerHint ?? (lang === "it" ? "Nessuno studio clinico in questo filtro." : "No clinical studies in this filter.")}
        </p>
      ) : (
        <div className="space-y-3">
          {displayStudies.map((study) => (
            <ClinicalStudyCard key={study.key} study={study} />
          ))}
        </div>
      )}
    </div>
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
