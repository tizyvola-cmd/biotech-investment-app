import type { RegulatoryRiskSnapshot } from "./api";
import type { MobileDashboardSnapshot } from "./dashboardTypes";
import { regRiskFromSignedScore } from "./decisionChartLogic";
import { normalizedRowKey, parseNum } from "./simLogic";

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

export function probPctFromRow(
  row: Record<string, unknown>,
  snapshot: MobileDashboardSnapshot | null,
  key: string,
): number | null {
  const snap = snapshot?.recommendations?.find((r) => r.key === key);
  if (snap?.probPct != null && Number.isFinite(snap.probPct)) return snap.probPct;
  const check = snapshot?.portfolioCheck?.find((r) => r.key === key);
  if (check?.probPct != null && Number.isFinite(check.probPct)) return check.probPct;
  const raw = parseNum(findCol(row, "recovery", "p(rec", "prob rec", "p(plan"));
  if (raw == null) return null;
  return raw <= 1.5 ? Math.round(raw * 100) : Math.round(raw);
}

export function riskV2FromRow(row: Record<string, unknown>): number | null {
  const raw = parseNum(findCol(row, "risk v2", "risk score", "rischio v2"));
  if (raw == null) return null;
  return Math.round(100 - raw);
}

export function sdsFromSources(
  row: Record<string, unknown>,
  ticker: string,
  sdsByTicker: Map<string, number>,
): number | null {
  const tk = ticker.trim().toUpperCase();
  const fromApi = sdsByTicker.get(tk);
  if (fromApi != null && Number.isFinite(fromApi)) return Math.round(fromApi);
  const fromRow =
    parseNum(findCol(row, "sds score", "sds tot", "supernova distance", "distance score", "sds ")) ??
    parseNum(findCol(row, "sds"));
  if (fromRow == null) return null;
  if (fromRow >= 0 && fromRow <= 1.5) return Math.round(fromRow * 100);
  return Math.round(Math.max(0, Math.min(100, fromRow)));
}

export function regRiskFromSources(
  row: Record<string, unknown>,
  ticker: string,
  regSnap: RegulatoryRiskSnapshot | null | undefined,
): number | null {
  const tk = ticker.trim().toUpperCase();
  const snapEntry = regSnap?.tickers?.[tk];
  if (snapEntry?.score != null && Number.isFinite(snapEntry.score)) {
    return regRiskFromSignedScore(snapEntry.score);
  }
  const signed = parseNum(findCol(row, "reg risk", "regulatory", "rischio reg", "reg risk score"));
  if (signed == null) return null;
  if (signed >= 0 && signed <= 100 && signed > 50) return Math.round(signed);
  return regRiskFromSignedScore(signed);
}

export function eisFromSources(
  snapshot: MobileDashboardSnapshot | null,
  key: string,
  row: Record<string, unknown>,
): { display: number | null; raw: number | null } {
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const manual = snapshot?.manualEisByTicker?.[ticker];
  if (manual?.score != null && Number.isFinite(manual.score)) {
    const raw = manual.score;
    return { display: Math.round(Math.max(0, Math.min(100, 50 + raw))), raw };
  }
  const rec = snapshot?.recommendations?.find((r) => r.key === key);
  if (rec?.eisScore != null && Number.isFinite(rec.eisScore)) {
    const raw = rec.eisScore;
    return { display: Math.round(Math.max(0, Math.min(100, 50 + raw))), raw };
  }
  const raw =
    parseNum(findCol(row, "eis", "event impact", "eis score", "eis super")) ??
    parseNum(row["EIS"]) ??
    parseNum(row["EIS score"]);
  if (raw == null) return { display: null, raw: null };
  if (raw >= -50 && raw <= 50) {
    return { display: Math.round(Math.max(0, Math.min(100, 50 + raw))), raw };
  }
  return { display: Math.round(Math.max(0, Math.min(100, raw))), raw: raw - 50 };
}

export function rowKeyFromSimRow(row: Record<string, unknown>): string {
  return normalizedRowKey(String(row.Ticker ?? ""), row["Completion Date"]);
}
