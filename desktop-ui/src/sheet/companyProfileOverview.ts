/**
 * Company mission / pipeline / approved products — assembled from sheet,
 * clinical feed and guidance calendar. Does not invent programs.
 */
import type {
  ClinicalPreCdRecord,
  GuidanceCalendarEvent,
  SdsRow,
} from "../api/supernova";
import {
  clinicalDrugFromSimRow,
  clinicalIndicationFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
  isRegulatoryMilestoneLabel,
} from "./simRowClinicalMeta";

export type CompanyProfileProgram = {
  name: string;
  indication: string | null;
  phase: string | null;
  nctId: string | null;
  source: "sheet" | "feed" | "guidance";
};

export type CompanyProfileOverview = {
  ticker: string;
  company: string;
  mission: string | null;
  pipeline: CompanyProfileProgram[];
  approved: CompanyProfileProgram[];
};

function cellText(v: unknown): string {
  if (v == null || v === "" || v === "—") return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  return String(v).trim();
}

function tickerOf(row: Record<string, unknown>): string {
  return String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
}

export function simRowsForTicker(
  rows: Record<string, unknown>[] | null | undefined,
  ticker: string,
): Record<string, unknown>[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return [];
  return (rows ?? []).filter((r) => tickerOf(r) === tk);
}

function businessSummaryFromRow(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  for (const [k, v] of Object.entries(row)) {
    if (/business\s*summary|longbusinesssummary|company\s*(overview|description)|descrizione/i.test(k)) {
      const t = cellText(v);
      if (t.length >= 24) return t;
    }
  }
  return null;
}

export function isApprovedPhase(phase: string | null | undefined): boolean {
  const p = String(phase ?? "");
  if (!p) return false;
  return /approv|marketed|commercial|launched|on[\s-]?market|510\s*\(\s*k\s*\)|cleared|pma\b/i.test(
    p,
  );
}

function isApprovedGuidance(ev: GuidanceCalendarEvent): boolean {
  return ev.fda_outcome === "approved" || ev.event_type === "approval";
}

function programKey(p: CompanyProfileProgram): string {
  return `${p.name}|${p.indication ?? ""}|${p.nctId ?? ""}`.toLowerCase();
}

function pushUnique(list: CompanyProfileProgram[], next: CompanyProfileProgram): void {
  const name = next.name.trim();
  if (!name || isRegulatoryMilestoneLabel(name)) return;
  const key = programKey({ ...next, name });
  if (list.some((p) => programKey(p) === key)) return;
  list.push({ ...next, name });
}

function synthesizeMission(
  company: string,
  indications: string[],
  drugs: string[],
  sds: SdsRow | null | undefined,
): string | null {
  const ind = indications.filter(Boolean);
  const dr = drugs.filter(Boolean);
  const sdsInd = String(sds?.indication ?? "").trim();
  const mech = String(sds?.mechanism_class ?? "").trim();
  if (!company && !ind.length && !dr.length && !sdsInd) return null;
  const who = company || "Company";
  const focus = ind[0] || sdsInd;
  const bits: string[] = [];
  if (focus) bits.push(focus);
  if (mech) bits.push(mech);
  if (dr.length) bits.push(dr.slice(0, 4).join(", "));
  if (!bits.length) return null;
  return `${who} — ${bits.join(" · ")}.`;
}

export function buildCompanyProfileOverview(opts: {
  ticker: string;
  company?: string | null;
  simRows?: Record<string, unknown>[] | null;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  sdsRow?: SdsRow | null;
}): CompanyProfileOverview {
  const ticker = opts.ticker.trim().toUpperCase();
  const company = String(opts.company ?? "").trim();
  const pipeline: CompanyProfileProgram[] = [];
  const approved: CompanyProfileProgram[] = [];
  const indications: string[] = [];
  const drugs: string[] = [];
  let mission = null as string | null;

  for (const row of opts.simRows ?? []) {
    mission = mission || businessSummaryFromRow(row);
    const name = clinicalDrugFromSimRow(row);
    const indication = clinicalIndicationFromSimRow(row, 120) || null;
    const phase = clinicalPhaseFromSimRow(row) || null;
    const nctId = clinicalNctFromSimRow(row);
    if (indication) indications.push(indication);
    if (name) drugs.push(name);
    const prog: CompanyProfileProgram = {
      name: name || indication || nctId || "Program",
      indication,
      phase,
      nctId,
      source: "sheet",
    };
    if (isApprovedPhase(phase)) pushUnique(approved, prog);
    else pushUnique(pipeline, prog);
  }

  for (const rec of opts.clinicalRecords ?? []) {
    if (String(rec.ticker ?? "").toUpperCase() !== ticker) continue;
    const name =
      String(rec.meta?.interventions ?? "")
        .split(/[|;,/]/)[0]
        ?.trim() ||
      String(rec.ai?.programs_mentioned?.[0] ?? "").trim();
    const indication = String(rec.meta?.conditions ?? "").trim() || null;
    const phase = String(rec.meta?.phase ?? rec.study_phase ?? "").trim() || null;
    const nctId = rec.nct_id ?? null;
    if (indication) indications.push(indication);
    if (name) drugs.push(name);
    if (!name && !indication && !nctId) continue;
    const prog: CompanyProfileProgram = {
      name: name || indication || nctId || "Study",
      indication,
      phase,
      nctId,
      source: "feed",
    };
    if (isApprovedPhase(phase)) pushUnique(approved, prog);
    else pushUnique(pipeline, prog);
  }

  for (const ev of opts.guidanceEvents ?? []) {
    if (String(ev.ticker ?? "").toUpperCase() !== ticker) continue;
    const name = String(ev.asset_name ?? "").trim();
    const indication = String(ev.indication ?? "").trim() || null;
    const phase = String(ev.trial_phase ?? ev.event_type ?? "").trim() || null;
    if (indication) indications.push(indication);
    if (name) drugs.push(name);
    if (!name && !indication) continue;
    const prog: CompanyProfileProgram = {
      name: name || indication || "Asset",
      indication,
      phase,
      nctId: null,
      source: "guidance",
    };
    if (isApprovedGuidance(ev) || isApprovedPhase(phase)) pushUnique(approved, prog);
    else if (ev.event_type !== "approval") pushUnique(pipeline, prog);
  }

  if (mission && mission.length < 24) mission = null;
  if (!mission) {
    mission = synthesizeMission(company, [...new Set(indications)], [...new Set(drugs)], opts.sdsRow);
  }

  return {
    ticker,
    company: company || ticker,
    mission,
    pipeline,
    approved,
  };
}
