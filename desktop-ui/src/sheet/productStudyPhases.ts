import type { ProductStudyCard } from "../api/supernova";
import type { StudyOutcomeBriefing } from "./studyOutcomeBriefing";
import { localizeStudyPhase, localizeStudyStatus } from "./clinicalIndicators";

export type ProductPhaseStudyPick = {
  nctId: string | null;
  title: string | null;
  phase: string | null;
  status: string | null;
  date: string | null;
  completed: boolean;
  ongoing: boolean;
};

const COMPLETED_RE = /\b(complet(?:ed|e)|terminat(?:ed|e)|withdrawn|suspended)\b/i;
const ONGOING_RE =
  /\b(not yet recruiting|active not recruiting|enrolling(?: by invitation)?|recruiting|available|ongoing|active)\b/i;

function normStatus(status: string | null | undefined): string {
  return (status || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function isCompletedStudyStatus(status: string | null | undefined): boolean {
  return COMPLETED_RE.test(normStatus(status));
}

export function isOngoingStudyStatus(status: string | null | undefined): boolean {
  const s = normStatus(status);
  if (isCompletedStudyStatus(s)) return false;
  return ONGOING_RE.test(s);
}

function fromBriefing(b: StudyOutcomeBriefing): ProductPhaseStudyPick {
  const status = b.status || null;
  const completed = isCompletedStudyStatus(status);
  const ongoing = !completed && isOngoingStudyStatus(status);
  return {
    nctId: b.nctId,
    title: b.studyTitle,
    phase: b.phase,
    status,
    date: b.endedDate,
    completed,
    ongoing,
  };
}

function fromCtgov(s: ProductStudyCard): ProductPhaseStudyPick {
  const status = s.status || null;
  const completed = isCompletedStudyStatus(status) || Boolean(s.has_results);
  const ongoing = !completed && isOngoingStudyStatus(status);
  return {
    nctId: s.nct_id || null,
    title: s.title || null,
    phase: s.phase || null,
    status,
    date: s.completion_date || null,
    completed,
    ongoing,
  };
}

function nctKey(nct: string | null | undefined): string {
  return (nct || "").trim().toUpperCase();
}

function mergePicks(rows: ProductPhaseStudyPick[]): ProductPhaseStudyPick[] {
  const byNct = new Map<string, ProductPhaseStudyPick>();
  const extras: ProductPhaseStudyPick[] = [];
  for (const row of rows) {
    const k = nctKey(row.nctId);
    if (!k) {
      extras.push(row);
      continue;
    }
    const prev = byNct.get(k);
    if (!prev) {
      byNct.set(k, row);
      continue;
    }
    byNct.set(k, {
      ...prev,
      ...row,
      nctId: row.nctId || prev.nctId,
      title: row.title || prev.title,
      phase: row.phase || prev.phase,
      status: row.status || prev.status,
      date: row.date || prev.date,
      completed: prev.completed || row.completed,
      ongoing: (prev.ongoing || row.ongoing) && !(prev.completed || row.completed),
    });
  }
  return [...byNct.values(), ...extras];
}

function dateRank(iso: string | null | undefined): string {
  return (iso || "").slice(0, 10);
}

export function pickLatestCompletedAndOngoing(
  opts: {
    briefings?: StudyOutcomeBriefing[];
    ctgov?: ProductStudyCard[];
    primaryNctId?: string | null;
  } = {},
): { completed: ProductPhaseStudyPick | null; ongoing: ProductPhaseStudyPick | null } {
  const merged = mergePicks([
    ...(opts.ctgov ?? []).map(fromCtgov),
    ...(opts.briefings ?? []).map(fromBriefing),
  ]);
  const completedRows = merged
    .filter((r) => r.completed)
    .sort((a, b) => dateRank(b.date).localeCompare(dateRank(a.date)));
  const ongoingRows = merged.filter((r) => r.ongoing);
  const primary = nctKey(opts.primaryNctId);
  const ongoingPrimary = primary
    ? ongoingRows.find((r) => nctKey(r.nctId) === primary)
    : undefined;
  const ongoingSorted = [...ongoingRows].sort((a, b) => {
    const recA = /recruiting/i.test(a.status || "") ? 1 : 0;
    const recB = /recruiting/i.test(b.status || "") ? 1 : 0;
    if (recA !== recB) return recB - recA;
    return dateRank(b.date).localeCompare(dateRank(a.date));
  });
  return {
    completed: completedRows[0] ?? null,
    ongoing: ongoingPrimary ?? ongoingSorted[0] ?? null,
  };
}

/** All ongoing studies for a product (primary NCT first, then recruiting, then by date). */
export function listOngoingProductStudies(
  opts: {
    briefings?: StudyOutcomeBriefing[];
    ctgov?: ProductStudyCard[];
    primaryNctId?: string | null;
  } = {},
): ProductPhaseStudyPick[] {
  const merged = mergePicks([
    ...(opts.ctgov ?? []).map(fromCtgov),
    ...(opts.briefings ?? []).map(fromBriefing),
  ]);
  const primary = nctKey(opts.primaryNctId);
  return merged
    .filter((r) => r.ongoing)
    .sort((a, b) => {
      const aPri = primary && nctKey(a.nctId) === primary ? 1 : 0;
      const bPri = primary && nctKey(b.nctId) === primary ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      const recA = /recruiting/i.test(a.status || "") ? 1 : 0;
      const recB = /recruiting/i.test(b.status || "") ? 1 : 0;
      if (recA !== recB) return recB - recA;
      return dateRank(b.date).localeCompare(dateRank(a.date));
    });
}

export function formatProductPhaseStudyLine(
  row: ProductPhaseStudyPick,
  it = false,
): string {
  const phase = row.phase ? localizeStudyPhase(row.phase, it) : it ? "Fase —" : "Phase —";
  const nct = (row.nctId || "").trim();
  const status = row.status ? localizeStudyStatus(row.status, it) : "";
  const date = (row.date || "").slice(0, 10);
  return [phase, nct || null, status || date || null].filter(Boolean).join(" · ");
}
