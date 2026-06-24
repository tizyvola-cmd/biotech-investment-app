import { daysFromCompletionDate } from "./opportunityLogic";
import { parseNum, rowHasActivePortfolio } from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";
import type {
  DashboardListMode,
  MobileDashboardAiFeedRow,
  MobileDashboardSnapshot,
  MobileDashboardUpcomingRow,
} from "./dashboardTypes";

function pred7FromRow(r: Record<string, unknown>): number | null {
  const raw = r["Δ% vs Pred−60\nPred\n+7"];
  return parseNum(raw);
}

function cellPlainText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  return String(v).trim();
}

function normNctId(v: unknown): string | null {
  const s = cellPlainText(v).toUpperCase();
  const m = /^NCT\d{8,}/.exec(s.replace(/\s/g, ""));
  return m ? m[0] : null;
}

function nctClinicalTrialsUrl(nct: string): string {
  return `https://clinicaltrials.gov/study/${nct}`;
}

function companyNameFromRow(r: Record<string, unknown>): string | null {
  const name = String(r.Nome ?? r.Company ?? r.Società ?? r["Company Name"] ?? "").trim();
  return name || null;
}

function cdMetaFromRow(r: Record<string, unknown>): {
  companyName: string | null;
  nct: string | null;
  studyHref: string | null;
} {
  const linkStudio = r["Link studio"];
  if (typeof linkStudio === "object" && linkStudio !== null && "href" in linkStudio) {
    const href = String((linkStudio as { href?: string }).href ?? "").trim();
    const nctFromLink = href ? normNctId(href) : null;
    if (href.includes("clinicaltrials.gov") || nctFromLink) {
      return {
        companyName: companyNameFromRow(r),
        nct: nctFromLink ?? normNctId(linkStudio),
        studyHref: href || (nctFromLink ? nctClinicalTrialsUrl(nctFromLink) : null),
      };
    }
  }

  for (const key of ["NCT", "nct", "nct_id", "NCTId", "NCT ID"]) {
    const raw = r[key];
    if (typeof raw === "object" && raw !== null && "href" in raw) {
      const href = String((raw as { href?: string }).href ?? "").trim();
      const nct = normNctId(raw) ?? normNctId(href);
      if (href || nct) {
        return {
          companyName: companyNameFromRow(r),
          nct,
          studyHref: href || (nct ? nctClinicalTrialsUrl(nct) : null),
        };
      }
    }
    const nct = normNctId(raw);
    if (nct) {
      return {
        companyName: companyNameFromRow(r),
        nct,
        studyHref: nctClinicalTrialsUrl(nct),
      };
    }
  }

  return {
    companyName: companyNameFromRow(r),
    nct: null,
    studyHref: null,
  };
}

function rowByTicker(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    map.set(tk, r);
  }
  return map;
}

function enrichUpcomingRow(
  row: MobileDashboardUpcomingRow,
  sheetRow: Record<string, unknown> | undefined,
): MobileDashboardUpcomingRow {
  if (!sheetRow) return row;
  const meta = cdMetaFromRow(sheetRow);
  return {
    ...row,
    companyName: row.companyName ?? meta.companyName,
    nct: row.nct ?? meta.nct,
    studyHref: row.studyHref ?? meta.studyHref,
  };
}

export function buildLocalUpcoming(
  rows: Record<string, unknown>[],
): MobileDashboardUpcomingRow[] {
  return rows
    .map((r) => {
      const meta = cdMetaFromRow(r);
      return {
        ticker: String(r.Ticker ?? ""),
        cd: String(r["Completion Date"] ?? ""),
        days: daysFromCompletionDate(String(r["Completion Date"] ?? "")),
        pred7: pred7FromRow(r),
        companyName: meta.companyName,
        nct: meta.nct,
        studyHref: meta.studyHref,
      };
    })
    .filter((r) => r.days != null && r.days >= 0)
    .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
    .slice(0, 6);
}

export function scopeRowsForListMode(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  mode: DashboardListMode,
): Record<string, unknown>[] {
  const rows = sheet?.rows ?? [];
  if (mode === "portfolio") {
    return rows.filter((r) => rowHasActivePortfolio(r, inputs));
  }
  return rows.filter((r) => {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) return false;
    if (rowHasActivePortfolio(r, inputs)) return false;
    const days = daysFromCompletionDate(String(r["Completion Date"] ?? ""));
    return days != null && days >= 0 && days <= 60;
  });
}

export function upcomingForMode(
  snapshot: MobileDashboardSnapshot | null,
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  mode: DashboardListMode,
): MobileDashboardUpcomingRow[] {
  const scoped = scopeRowsForListMode(sheet, inputs, mode);
  const byTicker = rowByTicker(scoped);
  const fromSnap =
    mode === "portfolio"
      ? snapshot?.upcoming?.portfolio
      : snapshot?.upcoming?.topOpps;
  if (fromSnap?.length) {
    return fromSnap
      .slice(0, 6)
      .map((row) => enrichUpcomingRow(row, byTicker.get(row.ticker.trim().toUpperCase())));
  }
  return buildLocalUpcoming(scoped);
}

export function recommendationsForMode(
  snapshot: MobileDashboardSnapshot | null,
  mode: DashboardListMode | "all",
) {
  const rows = snapshot?.recommendations ?? [];
  if (!rows.length) return [];
  if (mode === "all") return rows;
  const profile = mode === "portfolio" ? "portfolio" : "opportunity";
  return rows.filter((r) => r.profile === profile);
}

export function aiFeedForScope(
  snapshot: MobileDashboardSnapshot | null,
  scopeTickers: Set<string>,
): MobileDashboardAiFeedRow[] {
  const feed = snapshot?.aiFeed ?? [];
  if (!feed.length) return [];
  return feed.filter((r) => scopeTickers.has(r.ticker.toUpperCase())).slice(0, 8);
}

export function fmtPred7Pct(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const pct = Math.abs(v) <= 1.5 ? v * 100 : v;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function recActionTone(action: string): "up" | "down" | "warn" | "neutral" {
  const a = action.toUpperCase();
  if (a === "BUY") return "up";
  if (a === "SELL") return "down";
  if (a === "REVIEW" || a === "MANTIENI" || a === "HOLD") return "warn";
  return "neutral";
}

import { t } from "./i18n";
import { localeForLang, type MobileLang } from "./langStorage";

export function fmtFeedDate(iso: string, lang: MobileLang = "en"): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(localeForLang(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function snapshotAgeLabel(
  updatedAt: string | null | undefined,
  lang: MobileLang = "en",
): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 2) return t("sync.now", lang);
  if (diffMin < 60) return t("sync.minAgo", lang, { n: diffMin });
  const h = Math.round(diffMin / 60);
  return t("sync.hAgo", lang, { n: h });
}
