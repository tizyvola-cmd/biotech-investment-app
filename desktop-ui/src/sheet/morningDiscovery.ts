/**
 * Rilevamento novità mattutine (IPO, nuovi CD in Simulation) vs baseline salvata.
 * Alimenta il popup PortfolioRefreshAlertsModal quando il VPS aggiorna i dati
 * o all’apertura app con snapshot più recente della baseline.
 */

import type { NewBioIpoSummary } from "../api/supernova";
import type { TranslationKey } from "../shared/i18n";
import type { SheetTable } from "../types";
import { normalizedRowKey } from "./investSimKeys";
import type { PortfolioRefreshAlert } from "./portfolioRefreshAlerts";

const BASELINE_KEY = "supernova_sim_baseline_v1";
const ACK_KEY = "supernova_morning_discovery_ack_v1";
const IPO_SEEN_KEY = "supernova_last_seen_ipo_summary";

/** Oltre 120 gg ≈ 4 mesi — nuovi trial più lontani. */
export const CD_FAR_HORIZON_DAYS = 120;

export type SimRowBaseline = {
  key: string;
  ticker: string;
  cd: string;
  daysToCd: number | null;
};

export type SimulationBaseline = {
  savedAt: string;
  rows: SimRowBaseline[];
};

export type MorningDiscoveryAck = {
  manifestSig: string;
  ipoFinishedAt: string;
  shownAt: string;
};

function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export function daysFromTodayCd(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

export function buildSimBaselineFromTable(simTable: SheetTable | null): SimulationBaseline | null {
  if (!simTable?.rows?.length) return null;
  const cols = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
  const colCD = findCol(cols, "Completion Date") ?? "Completion Date";
  const rows: SimRowBaseline[] = [];
  for (const row of simTable.rows) {
    const ticker = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    const cd = String(row[colCD] ?? "").trim();
    if (!ticker || !cd) continue;
    rows.push({
      key: normalizedRowKey(ticker, cd),
      ticker,
      cd,
      daysToCd: daysFromTodayCd(cd),
    });
  }
  if (!rows.length) return null;
  return { savedAt: new Date().toISOString(), rows };
}

export function loadSimulationBaseline(): SimulationBaseline | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SimulationBaseline;
  } catch {
    return null;
  }
}

export function saveSimulationBaseline(simTable: SheetTable | null): void {
  const baseline = buildSimBaselineFromTable(simTable);
  if (!baseline || typeof window === "undefined") return;
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
  } catch {
    /* quota */
  }
}

export function loadMorningDiscoveryAck(): MorningDiscoveryAck | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MorningDiscoveryAck;
  } catch {
    return null;
  }
}

export function saveMorningDiscoveryAck(manifestSig: string, ipoFinishedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    const payload: MorningDiscoveryAck = {
      manifestSig,
      ipoFinishedAt,
      shownAt: new Date().toISOString(),
    };
    localStorage.setItem(ACK_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readLastSeenIpoSummary(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(IPO_SEEN_KEY)?.trim() ?? "";
}

export function writeLastSeenIpoSummary(value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(IPO_SEEN_KEY, value.trim());
  } catch {
    /* ignore */
  }
}

export function manifestSignature(m: {
  workbook_mtime?: string | null;
  updated_at?: string | null;
} | null): string {
  if (!m) return "";
  return `${m.workbook_mtime ?? ""}|${m.updated_at ?? ""}`.trim();
}

function pushAlert(
  out: PortfolioRefreshAlert[],
  seen: Set<string>,
  alert: Omit<PortfolioRefreshAlert, "id">,
): void {
  const id = `${alert.ticker}|${alert.cd}|${alert.category}|${alert.titleKey}`;
  if (seen.has(id)) return;
  seen.add(id);
  out.push({ ...alert, id });
}

function fmtIpoPrice(price: number | string | null | undefined): string {
  if (price == null || price === "") return "—";
  if (typeof price === "string" && /[-–]/.test(price.trim())) return price.trim();
  const n =
    typeof price === "number"
      ? price
      : Number(String(price).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return String(price);
  return `$${n.toFixed(2)}`;
}

function normalizeWebsiteUrl(url: string | null | undefined): string | undefined {
  const raw = String(url ?? "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

/** Nuove righe Simulation vs baseline (inclusi CD oltre 4 mesi). */
export function diffSimulationBaseline(
  before: SimulationBaseline | null,
  after: SimulationBaseline | null,
): PortfolioRefreshAlert[] {
  if (!after?.rows.length) return [];
  const out: PortfolioRefreshAlert[] = [];
  const seen = new Set<string>();
  const beforeKeys = new Set((before?.rows ?? []).map((r) => r.key));
  const beforeByTicker = new Map<string, SimRowBaseline>();
  for (const r of before?.rows ?? []) {
    if (!beforeByTicker.has(r.ticker)) beforeByTicker.set(r.ticker, r);
  }

  for (const row of after.rows) {
    if (beforeKeys.has(row.key)) continue;
    const prev = beforeByTicker.get(row.ticker);
    if (prev && prev.cd !== row.cd) {
      pushAlert(out, seen, {
        severity: "info",
        category: "cd_changed",
        ticker: row.ticker,
        cd: row.cd,
        titleKey: "portfolioRefresh.alert.cdChanged.title",
        detailKey: "portfolioRefresh.alert.cdChanged.detail",
        detailVars: { before: prev.cd, after: row.cd },
      });
      continue;
    }
    if (prev) continue;

    const days = row.daysToCd;
    const far = days != null && days > CD_FAR_HORIZON_DAYS;
    pushAlert(out, seen, {
      severity: far ? "info" : "warning",
      category: "new_simulation_row",
      ticker: row.ticker,
      cd: row.cd,
      titleKey: far
        ? "morningDiscovery.alert.newSimRowFar.title"
        : "portfolioRefresh.alert.newSimRow.title",
      detailKey: far
        ? "morningDiscovery.alert.newSimRowFar.detail"
        : "morningDiscovery.alert.newSimRow.detail",
      detailVars:
        days != null
          ? { days, cd: row.cd }
          : { cd: row.cd },
    });
  }

  return out;
}

export function buildIpoDiscoveryAlerts(
  summary: NewBioIpoSummary | null | undefined,
  lastSeenFinishedAt: string,
): PortfolioRefreshAlert[] {
  if (!summary?.finished_at || (summary.added_count ?? 0) <= 0) return [];
  if (summary.finished_at === lastSeenFinishedAt) return [];
  const out: PortfolioRefreshAlert[] = [];
  const seen = new Set<string>();
  for (const a of summary.added ?? []) {
    const ticker = String(a.symbol ?? "").trim().toUpperCase();
    if (!ticker) continue;
    pushAlert(out, seen, {
      severity: "info",
      category: "new_biotech_ticker",
      ticker,
      cd: a.ipo_date ? String(a.ipo_date).slice(0, 10) : "—",
      titleKey: "morningDiscovery.alert.newIpo.title",
      detailKey: "morningDiscovery.alert.newIpo.detail",
      detailVars: {
        ticker,
        name: a.name ?? ticker,
        ipoDate: a.ipo_date ?? "—",
        ipoPrice: fmtIpoPrice(a.price ?? a.current_price),
      },
      linkUrl: normalizeWebsiteUrl(a.website),
    });
  }
  if (!out.length && (summary.added_count ?? 0) > 0) {
    pushAlert(out, seen, {
      severity: "info",
      category: "new_biotech_ticker",
      ticker: "IPO",
      cd: "—",
      titleKey: "morningDiscovery.alert.newIpoBatch.title",
      detailKey: "morningDiscovery.alert.newIpoBatch.detail",
      detailVars: { count: summary.added_count ?? 0 },
    });
  }
  return out;
}

export function buildMorningDiscoveryAlerts(
  simTable: SheetTable | null,
  ipoSummary: NewBioIpoSummary | null | undefined,
): PortfolioRefreshAlert[] {
  const baseline = loadSimulationBaseline();
  const current = buildSimBaselineFromTable(simTable);
  const simAlerts = diffSimulationBaseline(baseline, current);
  const ipoAlerts = buildIpoDiscoveryAlerts(ipoSummary, readLastSeenIpoSummary());
  const merged = [...simAlerts, ...ipoAlerts];
  const order: Record<PortfolioRefreshAlert["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  merged.sort((a, b) => order[a.severity] - order[b.severity]);
  return merged;
}

export function shouldShowMorningDiscovery(
  alerts: PortfolioRefreshAlert[],
  manifestSig: string,
  ipoFinishedAt: string,
): boolean {
  if (!alerts.length) return false;
  const ack = loadMorningDiscoveryAck();
  if (
    ack &&
    ack.manifestSig === manifestSig &&
    ack.ipoFinishedAt === (ipoFinishedAt || "")
  ) {
    return false;
  }
  return true;
}

export function acknowledgeMorningDiscovery(
  simTable: SheetTable | null,
  manifestSig: string,
  ipoFinishedAt: string,
): void {
  saveSimulationBaseline(simTable);
  saveMorningDiscoveryAck(manifestSig, ipoFinishedAt || "");
  if (ipoFinishedAt) writeLastSeenIpoSummary(ipoFinishedAt);
}

/** Prima installazione: salva baseline senza popup. */
export function ensureSimulationBaseline(simTable: SheetTable | null): void {
  if (loadSimulationBaseline()) return;
  saveSimulationBaseline(simTable);
}

export type MorningDiscoveryModalCopy = {
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
};

export const MORNING_DISCOVERY_COPY: MorningDiscoveryModalCopy = {
  titleKey: "morningDiscovery.modal.title",
  subtitleKey: "morningDiscovery.modal.subtitle",
};
