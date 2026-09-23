/**
 * Catalyst / Top KPI — one study phase per row (+ list of other company trials).
 */
import type { ClinicalPreCdRecord } from "../api/supernova";
import { localizeStudyPhase } from "./clinicalIndicators";
import {
  clinicalDrugFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
} from "./simRowClinicalMeta";
import {
  deskClinicalStudyFromRecord,
  listClinicalStudyRecordsForTicker,
  pickPrimaryClinicalPreCdRecord,
  type DeskClinicalStudyListItem,
} from "./tickerEisSummary";

export type { DeskClinicalStudyListItem };

export function listDeskClinicalStudiesForTicker(
  ticker: string,
  records: ClinicalPreCdRecord[] | null | undefined,
): DeskClinicalStudyListItem[] {
  const recs = listClinicalStudyRecordsForTicker(ticker, records);
  const seen = new Set<string>();
  const out: DeskClinicalStudyListItem[] = [];
  for (const rec of recs) {
    const item = deskClinicalStudyFromRecord(rec);
    const key = item.nctId || `${item.cdDate ?? ""}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.cdDate ?? "").localeCompare(a.cdDate ?? ""));
}

export function resolveDeskRowClinicalStudies(
  ticker: string,
  records: ClinicalPreCdRecord[] | null | undefined,
  opts?: {
    simRow?: Record<string, unknown> | null;
    completionDate?: unknown;
    drugHint?: string | null;
  },
): { primary: DeskClinicalStudyListItem | null; others: DeskClinicalStudyListItem[] } {
  const all = listDeskClinicalStudiesForTicker(ticker, records);
  if (!all.length) return { primary: null, others: [] };

  const simRow = opts?.simRow ?? undefined;
  const simNct = clinicalNctFromSimRow(simRow)?.trim().toUpperCase() || "";
  const drugHint =
    opts?.drugHint?.trim() ||
    clinicalDrugFromSimRow(simRow)?.trim() ||
    null;

  let primaryRec: ClinicalPreCdRecord | null = null;
  if (simNct && records?.length) {
    primaryRec =
      records.find((r) => r.nct_id?.trim().toUpperCase() === simNct) ?? null;
  }
  if (!primaryRec && records?.length) {
    primaryRec = pickPrimaryClinicalPreCdRecord(
      ticker,
      records,
      opts?.completionDate,
      drugHint,
    );
  }

  let primary: DeskClinicalStudyListItem | null = null;
  if (primaryRec) {
    const nct = primaryRec.nct_id?.trim().toUpperCase() || "";
    primary =
      (nct ? all.find((s) => s.nctId === nct) : null) ??
      deskClinicalStudyFromRecord(primaryRec);
  }
  if (!primary) primary = all[0] ?? null;

  const primaryKey = primary?.nctId || `${primary?.cdDate ?? ""}|${primary?.title}`;
  const others = all.filter((s) => {
    const k = s.nctId || `${s.cdDate ?? ""}|${s.title}`;
    return k !== primaryKey;
  });

  return { primary, others };
}

/** Phase label for the catalyst row — not a semicolon-joined company dump. */
export function deskRowStudyPhaseLabel(
  simRow: Record<string, unknown> | null | undefined,
  primary: DeskClinicalStudyListItem | null,
  it: boolean,
): string {
  const fromSim = clinicalPhaseFromSimRow(simRow ?? undefined)?.trim();
  if (fromSim) return fromSim;
  const raw = primary?.phaseRaw?.trim();
  if (!raw) return "";
  return localizeStudyPhase(raw, it);
}

export function allDeskClinicalStudiesForModal(
  primary: DeskClinicalStudyListItem | null,
  others: DeskClinicalStudyListItem[],
): DeskClinicalStudyListItem[] {
  if (!primary) return others;
  return [primary, ...others];
}
