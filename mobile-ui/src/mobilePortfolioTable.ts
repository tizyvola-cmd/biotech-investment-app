/** Righe portfolio mobile — da sheet + snapshot desktop (no import desktop). */
import type {
  MobileDashboardRecRow,
  MobilePortfolioCheckSnapshotRow,
  PortfolioCheckEnrich,
} from "./dashboardTypes";
import { daysFromCompletionDate } from "./opportunityLogic";
import { denseCurvePoints, forwardRiseSegmentPeak } from "./mobileCurvePeakOutlook";
import {
  computeSimulationPosition,
  parseNum,
  rowHasActivePortfolio,
  type SimulationPosition,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export type Verdict = "RISE" | "DROP" | "WATCH" | "FLAT" | "REVIEW";

export type PortfolioCheckRow = {
  key: string;
  ticker: string;
  ppi: number | null;
  roiPct: number | null;
  mv1d: number | null;
  mv1w: number | null;
  mv1m: number | null;
  roiTarget: number | null;
  roiTargetDays: number | null;
  verdict: Verdict;
  verdictProbPct: number | null;
  pos: SimulationPosition;
};

export type PortfolioPnlRow = {
  key: string;
  ticker: string;
  cd: string;
  totalPnlPct: number | null;
  totalPnlEur: number | null;
  pnl24hPct: number | null;
  pnl24hEur: number | null;
  roiTarget: number | null;
};

export type { PortfolioCheckEnrich, MobilePortfolioCheckSnapshotRow } from "./dashboardTypes";

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function numFromRow(r: Record<string, unknown>, ...keywords: string[]): number | null {
  const cols = Object.keys(r);
  for (const kw of keywords) {
    const col = findCol(cols, kw);
    if (!col) continue;
    let v = parseNum(r[col]);
    if (v == null) continue;
    if (Math.abs(v) <= 1.5) v *= 100;
    return v;
  }
  return null;
}

function pred7FromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Δ% vs Pred−60\nPred\n+7"]) ??
    parseNum(r["Δ% vs Pred−60\nPred\n+4"]) ??
    parseNum(r["Pred +7"]) ??
    parseNum(r["Pred +7 (%)"])
  );
}

function roiTargetFromRow(r: Record<string, unknown>): number | null {
  const explicit = numFromRow(r, "roi target", "target roi", "roi plan", "gain target", "roi→cd");
  if (explicit != null) return explicit;
  const pred7 = pred7FromRow(r);
  return pred7 != null && pred7 > 0 ? pred7 : null;
}

function cdProximityUrgency(days: number | null): number {
  if (days == null || !Number.isFinite(days)) return 40;
  if (days <= 0) return 100;
  if (days <= 7) return 100;
  if (days <= 14) return 88;
  if (days <= 30) return 70;
  if (days <= 60) return 50;
  return 25;
}

function ppiFromSheetRow(r: Record<string, unknown>, daysToCd: number | null): number | null {
  const explicit = numFromRow(r, "ppi", "portfolio pattern");
  if (explicit != null) return explicit;

  const aff = numFromRow(r, "affidabilità calib", "affidabilit");
  const r2raw = parseNum(r["R² fit"]);
  const r2 = r2raw != null ? (Math.abs(r2raw) <= 1.5 ? r2raw * 100 : r2raw) : null;
  const pred7 = pred7FromRow(r);
  if (aff == null && r2 == null && pred7 == null) return null;

  const cdUrg = cdProximityUrgency(daysToCd);
  const affScore = aff ?? 50;
  const r2Score = r2 ?? 50;
  const momentum =
    pred7 != null && Number.isFinite(pred7)
      ? Math.min(100, Math.max(0, Math.round(50 + pred7 * 2.5)))
      : 50;
  let score = affScore * 0.38 + cdUrg * 0.27 + r2Score * 0.2 + momentum * 0.1 + 50 * 0.05 + 4;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function probFromSheetRow(r: Record<string, unknown>, pnlPct: number): number | null {
  const explicit = numFromRow(r, "recovery", "p(rec", "prob rec", "p(plan");
  if (explicit != null) return explicit;

  const aff = numFromRow(r, "affidabilità calib", "affidabilit");
  if (aff == null) return null;

  if (pnlPct < -0.5) {
    const plan = roiTargetFromRow(r);
    if (plan != null && plan > 0) {
      return Math.round(Math.min(95, Math.max(15, aff * 0.55 + Math.min(plan, 30))));
    }
    return Math.round(Math.max(10, aff * 0.72));
  }
  return Math.round(aff);
}

function var1dFromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Var. Giorn. %"]) ??
    parseNum(r["Var. Giorn %"]) ??
    parseNum(r["Var. Giornaliera %"]) ??
    numFromRow(r, "var. giorn", "var giorn")
  );
}

function var1mFromRow(r: Record<string, unknown>): number | null {
  return parseNum(r["Var. 1M %"]) ?? numFromRow(r, "var. 1m", "var 1m");
}

/** ~7d price change — run_up_7d when present, else scaled from 1M or 1d. */
function var1wFromRow(r: Record<string, unknown>): number | null {
  const run7 = parseNum(r["run_up_7d"]) ?? numFromRow(r, "run_up_7", "runup_7");
  if (run7 != null) return run7;

  const var1m = var1mFromRow(r);
  if (var1m != null) return Math.round(((var1m * 7) / 22) * 100) / 100;

  const var1d = var1dFromRow(r);
  if (var1d != null) return Math.round(var1d * 5 * 100) / 100;

  return null;
}

function clampProb(n: number): number {
  return Math.min(95, Math.max(35, Math.round(n)));
}

function recoveryProbFromRow(
  r: Record<string, unknown>,
  pnlPct: number,
  snapProb: number | null | undefined,
  recProb: number | null | undefined,
): number | null {
  return snapProb ?? recProb ?? probFromSheetRow(r, pnlPct);
}

function verdictFrom(pnlPct: number, mv1d: number | null, recoveryProb: number | null): Verdict {
  if (recoveryProb != null && recoveryProb < 45) return "REVIEW";
  if (mv1d != null && mv1d <= -2) return "DROP";
  if (mv1d != null && mv1d >= 2) return "RISE";
  if (Math.abs(pnlPct) < 0.5 && (mv1d == null || Math.abs(mv1d) < 0.3)) return "FLAT";
  return "WATCH";
}

/** Estimated confidence that the 24h verdict call is correct (0–100). */
function verdictConfidencePct(
  verdict: Verdict,
  mv1d: number | null,
  mv1w: number | null,
  mv1m: number | null,
  recoveryProb: number | null,
  r: Record<string, unknown>,
): number | null {
  const aff = numFromRow(r, "affidabilità calib", "affidabilit") ?? 60;

  switch (verdict) {
    case "REVIEW":
      if (recoveryProb == null) return null;
      return clampProb(100 - recoveryProb * 0.82 + aff * 0.08);
    case "RISE": {
      const mag = mv1d ?? 0;
      const aligned =
        (mv1w == null || mv1w > 0) && (mv1m == null || mv1m > -1.5);
      return clampProb(48 + Math.max(0, mag) * 5.5 + (aligned ? 14 : 0) + aff * 0.12);
    }
    case "DROP": {
      const mag = mv1d ?? 0;
      const aligned = (mv1w == null || mv1w < 0) && (mv1m == null || mv1m < 1.5);
      return clampProb(48 + Math.max(0, -mag) * 5.5 + (aligned ? 14 : 0) + aff * 0.12);
    }
    case "FLAT": {
      const small =
        (mv1d == null || Math.abs(mv1d) < 0.4) &&
        (mv1w == null || Math.abs(mv1w) < 1.2);
      return clampProb(small ? 68 + aff * 0.1 : 52 + aff * 0.15);
    }
    case "WATCH":
    default:
      return clampProb(50 + aff * 0.22);
  }
}

function parseDaysFromGainText(text: string | null | undefined): number | null {
  if (!text || text === "—") return null;
  const m = text.match(/\bin\s+(\d+)\s*[gd]\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roiTargetDaysForRow(
  r: Record<string, unknown>,
  snap: MobilePortfolioCheckSnapshotRow | undefined,
  rec: MobileDashboardRecRow | undefined,
  roiTarget: number | null,
): number | null {
  if (snap?.daysToTarget != null && snap.daysToTarget > 0) return Math.round(snap.daysToTarget);
  if (rec?.daysToTarget != null && rec.daysToTarget > 0) return Math.round(rec.daysToTarget);
  const fromText =
    parseDaysFromGainText(snap?.gainIdeaText) ?? parseDaysFromGainText(rec?.gainIdeaText);
  if (fromText != null) return fromText;
  if (roiTarget != null && roiTarget > 0 && rec?.curvePoints?.length) {
    const peak = forwardRiseSegmentPeak(r, denseCurvePoints(r, null, rec.curvePoints));
    if (peak && peak.days > 0) return peak.days;
  }
  return null;
}

function ppiFromRec(rec: MobileDashboardRecRow | undefined): number | null {
  if (!rec) return null;
  if (rec.scorePct != null && Number.isFinite(rec.scorePct)) return Math.round(rec.scorePct);
  const match = rec.curveCharts?.polygon?.matchPct;
  if (match != null && Number.isFinite(match)) {
    const cdUrg = cdProximityUrgency(rec.daysToCd);
    return Math.min(100, Math.max(0, Math.round(match * 0.55 + cdUrg * 0.35 + 4)));
  }
  return null;
}

export function buildPortfolioCheckRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  enrich?: PortfolioCheckEnrich,
): PortfolioCheckRow[] {
  const checkByKey = new Map((enrich?.portfolioCheck ?? []).map((r) => [r.key, r]));
  const recByKey = new Map((enrich?.recommendations ?? []).map((r) => [r.key, r]));
  const rows: PortfolioCheckRow[] = [];

  for (const r of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(r, inputs)) continue;
    const pos = computeSimulationPosition(r, inputs);
    if (!pos || pos.capital <= 0) continue;

    const snap = checkByKey.get(pos.key);
    const rec = recByKey.get(pos.key);
    const daysToCd = daysFromCompletionDate(pos.completionDate);
    const mv1d = var1dFromRow(r);
    const mv1w = var1wFromRow(r);
    const mv1m = var1mFromRow(r);

    const ppi =
      snap?.ppi ??
      ppiFromRec(rec) ??
      ppiFromSheetRow(r, daysToCd);

    const recoveryProb = recoveryProbFromRow(r, pos.pnlPct, snap?.probPct, rec?.probPct);
    const verdict = verdictFrom(pos.pnlPct, mv1d, recoveryProb);
    const roiTarget = snap?.planReturnPct ?? rec?.planReturnPct ?? roiTargetFromRow(r);
    const roiTargetDays = roiTargetDaysForRow(r, snap, rec, roiTarget);

    rows.push({
      key: pos.key,
      ticker: pos.ticker,
      ppi,
      roiPct: pos.pnlPct,
      mv1d,
      mv1w,
      mv1m,
      roiTarget,
      roiTargetDays,
      verdict,
      verdictProbPct: verdictConfidencePct(verdict, mv1d, mv1w, mv1m, recoveryProb, r),
      pos,
    });
  }
  return rows.sort((a, b) => Math.abs(b.pos.pnlPct) - Math.abs(a.pos.pnlPct));
}

export function buildPortfolioPnlRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  enrich?: PortfolioCheckEnrich,
): PortfolioPnlRow[] {
  const checkByKey = new Map((enrich?.portfolioCheck ?? []).map((r) => [r.key, r]));
  const rows: PortfolioPnlRow[] = [];
  for (const r of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(r, inputs)) continue;
    const pos = computeSimulationPosition(r, inputs);
    if (!pos || pos.capital <= 0) continue;
    const mv24 = var1dFromRow(r);
    const pnl24hEur = mv24 != null ? (pos.capital * mv24) / 100 : null;
    const snap = checkByKey.get(pos.key);
    rows.push({
      key: pos.key,
      ticker: pos.ticker,
      cd: pos.completionDate,
      totalPnlPct: pos.pnlUnavailable ? null : pos.pnlPct,
      totalPnlEur: pos.pnlUnavailable ? null : pos.pnlEur,
      pnl24hPct: mv24,
      pnl24hEur,
      roiTarget: snap?.planReturnPct ?? roiTargetFromRow(r),
    });
  }
  return rows.sort((a, b) => (b.totalPnlPct ?? 0) - (a.totalPnlPct ?? 0));
}

export function portfolioSummary(sheet: SheetTable | null, inputs: InvestSimInputs) {
  let capital = 0;
  let value = 0;
  let pnl = 0;
  let gainCount = 0;
  let lossCount = 0;
  let pnl24h = 0;
  let covered24h = 0;
  for (const r of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(r, inputs)) continue;
    const pos = computeSimulationPosition(r, inputs);
    if (!pos || pos.capital <= 0) continue;
    capital += pos.capital;
    if (!pos.pnlUnavailable) {
      value += pos.valueNow;
      pnl += pos.pnlEur;
      if (pos.pnlEur >= 0) gainCount++;
      else lossCount++;
    }
    const mv = var1dFromRow(r);
    if (mv != null) {
      covered24h++;
      pnl24h += (pos.capital * mv) / 100;
    }
  }
  const pnlPct = capital > 0 ? (pnl / capital) * 100 : null;
  const pnl24hPct = capital > 0 ? (pnl24h / capital) * 100 : null;
  return {
    count: gainCount + lossCount,
    gainCount,
    lossCount,
    capital,
    value,
    pnl,
    pnlPct,
    pnl24h,
    pnl24hPct,
    covered24h,
  };
}
