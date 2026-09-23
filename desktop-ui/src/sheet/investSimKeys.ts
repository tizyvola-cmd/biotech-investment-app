import type { InvestSimInputEntry, InvestSimInputs } from "./investSimStorage";
import { sanitizeInvestSimEntry, sanitizeInvestSimInputs } from "./investSimStorage";

/** Normalizza Completion Date in ``YYYY-MM-DD`` per chiavi stabili (allineato a simulation_preserve.py). */
export function normalizeCompletionDateForKey(cd: unknown): string {
  if (cd == null || cd === "" || cd === "—" || cd === "-") return "—";
  const s = String(cd).trim();
  if (!s || s === "—" || s === "-") return "—";

  const isoHead = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoHead) return isoHead[1];

  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    const dt = new Date(ms);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const da = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return s;
}

export function normalizedRowKey(ticker: string, cd: unknown): string {
  const tk = String(ticker ?? "")
    .trim()
    .toUpperCase();
  return `${tk}|${normalizeCompletionDateForKey(cd)}`;
}

/** ID DOM stabile per scroll Simulation → card Decision Lab. */
export function decisionLabSignalDomId(ticker: string, cd: unknown): string {
  const tk = String(ticker ?? "")
    .trim()
    .toUpperCase();
  const cdKey = normalizeCompletionDateForKey(cd).replace(/[^\w-]/g, "-");
  return `decision-lab-signal-${tk}-${cdKey}`;
}

/** Scroll target for 24h assessment deep-dive cards (Simulation → Returns & Loss). */
export function lossAnalysisCardDomId(key: string): string {
  const safe = String(key ?? "")
    .trim()
    .replace(/\|/g, "-")
    .replace(/[^\w-]/g, "");
  return `loss-analysis-${safe || "row"}`;
}

/** Scroll target for a single ticker row inside the "Top KPI" table.
 *  Used by the Decision Chart chip → jump to per-ticker KPI row flow. */
export function lossAnalysisTopKpiRowDomId(key: string): string {
  const safe = String(key ?? "")
    .trim()
    .replace(/\|/g, "-")
    .replace(/[^\w-]/g, "");
  return `top-kpi-row-${safe || "row"}`;
}

/** Focus target — ticker name button inside the Top KPI row. */
export function lossAnalysisTopKpiTickerDomId(key: string): string {
  const safe = String(key ?? "")
    .trim()
    .replace(/\|/g, "-")
    .replace(/[^\w-]/g, "");
  return `top-kpi-ticker-${safe || "row"}`;
}

/** Score-driven section inside a 24h assessment card (decision chart → deep dive). */
export type LossAnalysisScoreSection =
  | "priceVar"
  | "eisReg"
  | "predBlend"
  | "gainPlan"
  | "slope24h"
  | "miiSlopes"
  | "volumeEis"
  | "devLane";

export function lossAnalysisChartSectionDomId(
  key: string,
  section: LossAnalysisScoreSection,
): string {
  return `${lossAnalysisCardDomId(key)}-${section}`;
}

/** Scroll target — manual news free-text box under 24h P&L strip (legacy per-card). */
export function lossAnalysisManualNewsDomId(key: string): string {
  return `${lossAnalysisCardDomId(key)}-manual-news`;
}

export function lossAnalysisManualNewsTextareaDomId(key: string): string {
  return `${lossAnalysisManualNewsDomId(key)}-textarea`;
}

/** Global manual-news panel (24h tab — after decision chart, all tickers). */
export function lossAnalysisGlobalManualNewsDomId(): string {
  return "loss-analysis-global-manual-news";
}

export function lossAnalysisGlobalManualNewsTextareaDomId(): string {
  return "loss-analysis-global-manual-news-textarea";
}

export function lossAnalysisScoreSectionNeedsDeepCharts(section: LossAnalysisScoreSection): boolean {
  return section !== "priceVar" && section !== "eisReg";
}

export function matchDecisionLabSignalFocus(
  ticker: string,
  cd: string,
  focus: { ticker: string; cd?: string },
): boolean {
  if (ticker.trim().toUpperCase() !== focus.ticker.trim().toUpperCase()) return false;
  if (!focus.cd?.trim()) return true;
  return normalizedRowKey(ticker, cd) === normalizedRowKey(focus.ticker, focus.cd);
}

/** Mappa righe Simulation per chiave normalizzata (sparkline, dettaglio, ecc.). */
export function buildSimRowByKeyMap(
  rows: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const tk = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    map.set(normalizedRowKey(tk, row["Completion Date"]), row);
  }
  return map;
}

function entryWeight(e: InvestSimInputEntry): number {
  let w = 0;
  if (e.ignoreSheet) w += 1000;
  if (e.capital > 0) w += 100;
  if (e.buyPrice > 0) w += 10;
  return w;
}

function mergeEntry(a: InvestSimInputEntry, b: InvestSimInputEntry): InvestSimInputEntry {
  const explicitlySold = (e: InvestSimInputEntry) =>
    Boolean(e.ignoreSheet && e.soldAt);
  if (explicitlySold(a) || explicitlySold(b)) {
    const sold = explicitlySold(a) ? a : b;
    const other = sold === a ? b : a;
    const rebuy =
      !other.ignoreSheet &&
      other.capital > 0 &&
      (other.universe === "real" ||
        Boolean(
          other.investedAt &&
            sold.soldAt &&
            Date.parse(other.investedAt) > Date.parse(sold.soldAt),
        ));
    if (rebuy) {
      return sanitizeInvestSimEntry({ ...other, ignoreSheet: false });
    }
    const pickClosed = explicitlySold(a) ? a : b;
    return sanitizeInvestSimEntry({
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      investedAt: earliestInvestedAt(a.investedAt, b.investedAt),
      purchaseDate: a.purchaseDate || b.purchaseDate,
      soldAt: latestIso(a.soldAt, b.soldAt),
      closedCapital: pickClosed.closedCapital ?? other.closedCapital,
      closedValue: pickClosed.closedValue ?? other.closedValue,
      closedPnlEur: pickClosed.closedPnlEur ?? other.closedPnlEur,
    });
  }

  const pick =
    entryWeight(b) > entryWeight(a) ? b : entryWeight(a) > entryWeight(b) ? a : b;
  const other = pick === a ? b : a;
  const ignoreSheet = Boolean(pick.ignoreSheet || other.ignoreSheet);
  if (ignoreSheet) {
    const pickClosed = pick.ignoreSheet ? pick : other;
    return sanitizeInvestSimEntry({
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      investedAt: earliestInvestedAt(pick.investedAt, other.investedAt),
      purchaseDate: pick.purchaseDate || other.purchaseDate,
      soldAt: latestIso(pick.soldAt, other.soldAt),
      closedCapital: pickClosed.closedCapital ?? other.closedCapital,
      closedValue: pickClosed.closedValue ?? other.closedValue,
      closedPnlEur: pickClosed.closedPnlEur ?? other.closedPnlEur,
    });
  }
  const buyPrice =
    pick.buyPrice > 0
      ? pick.buyPrice
      : other.buyPrice > 0
        ? other.buyPrice
        : 0;
  return {
    buyPrice,
    capital: Math.max(pick.capital, other.capital),
    ignoreSheet: false,
    investedAt: earliestInvestedAt(pick.investedAt, other.investedAt),
    purchaseDate: pick.purchaseDate || other.purchaseDate,
  };
}

function earliestInvestedAt(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am)) return b;
  if (!Number.isFinite(bm)) return a;
  return am <= bm ? a : b;
}

function latestIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am)) return b;
  if (!Number.isFinite(bm)) return a;
  return am >= bm ? a : b;
}

/**
 * Riallinea chiavi localStorage al foglio Simulation corrente
 * (es. ``ANIK|31/05/2026`` → ``ANIK|2026-05-31``).
 */
export function reconcileInvestSimInputs(
  inputs: InvestSimInputs,
  rows: Record<string, unknown>[]
): InvestSimInputs {
  const canonByAlias = new Map<string, string>();

  for (const r of rows) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const cd = r["Completion Date"];
    const canon = normalizedRowKey(tk, cd);
    const aliases = [
      `${tk}|${String(cd ?? "—")}`,
      normalizedRowKey(tk, String(cd ?? "—")),
      `${tk}|${normalizeCompletionDateForKey(cd)}`,
    ];
    for (const a of aliases) canonByAlias.set(a, canon);
    canonByAlias.set(canon, canon);
    canonByAlias.set(tk, canon);
  }

  const out: InvestSimInputs = {};
  for (const [rawKey, entry] of Object.entries(inputs)) {
    if (!entry) continue;
    const parts = rawKey.split("|");
    const tk = parts[0]?.trim().toUpperCase() ?? "";
    const cdPart = parts.slice(1).join("|") || "—";
    const canon =
      canonByAlias.get(rawKey) ??
      canonByAlias.get(normalizedRowKey(tk, cdPart)) ??
      normalizedRowKey(tk, cdPart);
    const prev = out[canon];
    out[canon] = prev ? mergeEntry(prev, entry) : sanitizeInvestSimEntry({ ...entry });
  }
  return collapseGhostOpensAfterCompanySell(sanitizeInvestSimInputs(out));
}

/**
 * Close leftover open capital when the company was sold later (CD rename / partial sell).
 * Frees sim-loop cash and stops Buy from looking broken.
 */
export function collapseGhostOpensAfterCompanySell(
  inputs: InvestSimInputs,
): InvestSimInputs {
  let changed = false;
  const out: InvestSimInputs = { ...inputs };
  for (const [k, e] of Object.entries(inputs)) {
    if (!e || e.ignoreSheet || !(e.capital > 0) || !e.investedAt) continue;
    // Dashboard / other-platform adds are explicit — never treat as CD-rename ghosts.
    if (e.universe === "real") continue;
    const tk = k.split("|")[0]?.trim().toUpperCase() ?? "";
    if (!tk) continue;
    const soldAt = latestSoldAtForTicker([inputs], tk);
    if (!soldAt) continue;
    const invMs = Date.parse(e.investedAt);
    const soldMs = Date.parse(soldAt);
    if (!Number.isFinite(invMs) || !Number.isFinite(soldMs) || invMs > soldMs) continue;
    out[k] = sanitizeInvestSimEntry({
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      investedAt: e.investedAt,
      purchaseDate: e.purchaseDate,
      soldAt,
      closedCapital: e.closedCapital,
      closedValue: e.closedValue,
      closedPnlEur: e.closedPnlEur,
    });
    changed = true;
  }
  return changed ? out : inputs;
}

/** Keep Dashboard-typed opens that a stale server hydrate would otherwise drop. */
export function preserveRecentManualOpens(
  incoming: InvestSimInputs,
  local: InvestSimInputs,
  nowMs: number = Date.now(),
  maxAgeMs = 30 * 60 * 1000,
): InvestSimInputs {
  let changed = false;
  const out: InvestSimInputs = { ...incoming };
  for (const [k, e] of Object.entries(local)) {
    if (!e || e.ignoreSheet || !(e.capital > 0) || e.universe !== "real") continue;
    const inv = e.investedAt ? Date.parse(e.investedAt) : NaN;
    if (!Number.isFinite(inv) || nowMs - inv > maxAgeMs) continue;
    const cur = out[k];
    if (cur && !cur.ignoreSheet && (cur.capital ?? 0) > 0) continue;
    out[k] = e;
    changed = true;
  }
  return changed ? out : incoming;
}

export function mergeInvestSimInputs(
  a: InvestSimInputs,
  b: InvestSimInputs
): InvestSimInputs {
  const out: InvestSimInputs = { ...a };
  for (const [k, entry] of Object.entries(b)) {
    if (!entry) continue;
    const prev = out[k];
    out[k] = prev ? mergeEntry(prev, entry) : { ...entry };
  }
  // Per-key merge keeps sold CMPX|old next to open CMPX|new. Collapse leftovers
  // whose investedAt is on/before the company sell (CD rename ghosts).
  return collapseGhostOpensAfterCompanySell(out);
}

/** Sum of capital on non-ignored open rows. */
export function sumOpenCapital(inputs: InvestSimInputs): number {
  let sum = 0;
  for (const e of Object.values(inputs)) {
    if (!e || e.ignoreSheet) continue;
    const cap = e.capital ?? 0;
    if (cap > 0) sum += cap;
  }
  return sum;
}

/** Tickers with a live open book entry (capital > 0, not ignoreSheet). */
export function openTickersFromInputs(inputs: InvestSimInputs): Set<string> {
  const out = new Set<string>();
  for (const [k, e] of Object.entries(inputs)) {
    if (!e || e.ignoreSheet) continue;
    if ((e.capital ?? 0) <= 0) continue;
    const tk = k.split("|")[0]?.trim().toUpperCase();
    if (tk) out.add(tk);
  }
  return out;
}

/**
 * Drop only *conflicting* sold markers on keys we are reopening.
 * Never delete ignoreSheet rows that carry closedPnlEur on a different CD key
 * (e.g. GPCR|2026-08-26 closed while GPCR|2026-07-15 is open) — that was
 * wiping Closed piggy gains during force-restore.
 */
export function purgeSoldAliasesForOpenTickers(
  inputs: InvestSimInputs,
  opts?: { restoredKeys?: string[] },
): InvestSimInputs {
  const openExact = new Set<string>();
  const openTickers = new Set<string>();
  for (const [k, e] of Object.entries(inputs)) {
    if (!e || e.ignoreSheet) continue;
    if ((e.capital ?? 0) <= 0) continue;
    openExact.add(k);
    const tk = k.split("|")[0]?.trim().toUpperCase();
    if (tk) openTickers.add(tk);
  }
  for (const k of opts?.restoredKeys ?? []) openExact.add(k);

  if (!openExact.size && !openTickers.size) return inputs;

  const out: InvestSimInputs = {};
  for (const [k, e] of Object.entries(inputs)) {
    if (!e) continue;
    if (e.ignoreSheet) {
      const tk = k.split("|")[0]?.trim().toUpperCase() ?? "";
      const hasClosedPnl =
        e.closedPnlEur != null && Number.isFinite(e.closedPnlEur);
      // Always keep realized closed deals on other keys.
      if (hasClosedPnl && !openExact.has(k)) {
        out[k] = e;
        continue;
      }
      // Drop bogus Sell on the exact key we are reopening (or alias with no closed PnL).
      if (openExact.has(k)) continue;
      if (openTickers.has(tk) && !hasClosedPnl) continue;
    }
    out[k] = e;
  }
  return out;
}

/** Sum realized closedPnlEur on ignoreSheet rows. */
export function sumClosedPnlEur(inputs: InvestSimInputs): number {
  let sum = 0;
  for (const e of Object.values(inputs)) {
    if (!e?.ignoreSheet) continue;
    if (e.closedPnlEur == null || !Number.isFinite(e.closedPnlEur)) continue;
    sum += e.closedPnlEur;
  }
  return sum;
}

/**
 * Union closed (ignoreSheet + closedPnlEur) rows from multiple books.
 * Prefer the entry with the larger |closedPnlEur| when keys collide.
 */
export function mergeClosedBooksFromCandidates(
  base: InvestSimInputs,
  ...others: InvestSimInputs[]
): InvestSimInputs {
  const out: InvestSimInputs = { ...base };
  for (const book of others) {
    for (const [k, e] of Object.entries(book)) {
      if (!e?.ignoreSheet) continue;
      if (e.closedPnlEur == null || !Number.isFinite(e.closedPnlEur)) continue;
      // Never overwrite a live open on the same key.
      const cur = out[k];
      if (cur && !cur.ignoreSheet && (cur.capital ?? 0) > 0) continue;
      if (
        cur?.ignoreSheet &&
        cur.closedPnlEur != null &&
        Math.abs(cur.closedPnlEur) >= Math.abs(e.closedPnlEur)
      ) {
        continue;
      }
      out[k] = sanitizeInvestSimEntry({ ...e, ignoreSheet: true });
    }
  }
  return out;
}

/** Latest ignoreSheet+soldAt for a ticker across local/disk books. */
function latestSoldAtForTicker(
  books: InvestSimInputs[],
  ticker: string,
): string | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const book of books) {
    for (const [k, e] of Object.entries(book)) {
      if (!e?.ignoreSheet || !e.soldAt?.trim()) continue;
      if ((k.split("|")[0]?.trim().toUpperCase() ?? "") !== tk) continue;
      const ms = Date.parse(e.soldAt);
      if (!Number.isFinite(ms) || ms <= bestMs) continue;
      bestMs = ms;
      best = e.soldAt;
    }
  }
  return best;
}

/**
 * Re-apply disk open capital/buy onto canonical Simulation keys after reconcile.
 * Survives CD renames and leftover sold aliases.
 * Skips disk opens whose investedAt is on/before a later company sell (CD ghost).
 */
export function reassertOpenBookFromDisk(
  local: InvestSimInputs,
  disk: InvestSimInputs,
  simRows?: Record<string, unknown>[],
): InvestSimInputs {
  const canonByTicker = new Map<string, string>();
  for (const r of simRows ?? []) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    canonByTicker.set(tk, normalizedRowKey(tk, r["Completion Date"]));
  }

  const out: InvestSimInputs = { ...local };
  for (const [k, diskEntry] of Object.entries(disk)) {
    if (!diskEntry || diskEntry.ignoreSheet) continue;
    const diskCap = diskEntry.capital ?? 0;
    if (!(diskCap > 0)) continue;
    const tk = k.split("|")[0]?.trim().toUpperCase() ?? "";
    if (!tk) continue;
    const soldAt = latestSoldAtForTicker([disk, local], tk);
    if (soldAt && diskEntry.investedAt) {
      const invMs = Date.parse(diskEntry.investedAt);
      const soldMs = Date.parse(soldAt);
      if (Number.isFinite(invMs) && Number.isFinite(soldMs) && invMs <= soldMs) {
        continue;
      }
    }
    const cdPart = k.split("|").slice(1).join("|") || "—";
    const canon = canonByTicker.get(tk) ?? normalizedRowKey(tk, cdPart);
    const prev = out[canon];
    const prevCap = prev && !prev.ignoreSheet ? prev.capital ?? 0 : 0;
    out[canon] = sanitizeInvestSimEntry({
      buyPrice:
        diskEntry.buyPrice > 0
          ? diskEntry.buyPrice
          : prev && !prev.ignoreSheet && prev.buyPrice > 0
            ? prev.buyPrice
            : 0,
      capital: Math.max(diskCap, prevCap),
      ignoreSheet: false,
      // Disk first — local investedAt may be a late backfill after collapse restore.
      investedAt: diskEntry.investedAt || (prev && !prev.ignoreSheet ? prev.investedAt : undefined),
      purchaseDate:
        diskEntry.purchaseDate ||
        (prev && !prev.ignoreSheet ? prev.purchaseDate : undefined),
    });
  }
  return out;
}

/**
 * Recover open book capital from disk/API when browser localStorage lost it.
 *
 * Soft mode: restore capital=0 rows that were not explicitly Sold.
 * Force / book-collapse mode (disk open capital ≫ local): restore every disk-open
 * row even if localStorage has a bogus Sell — used when Pulse shows ~$8k while
 * server still has ~$37k (BNTX/CERS/SYRE/…).
 */
export function restoreOpenCapitalFromDisk(
  local: InvestSimInputs,
  disk: InvestSimInputs,
  opts?: { forceBookCollapse?: boolean },
): { inputs: InvestSimInputs; restoredKeys: string[]; bookCollapsed: boolean } {
  const localOpen = sumOpenCapital(local);
  const diskOpen = sumOpenCapital(disk);
  const bookCollapsed =
    opts?.forceBookCollapse === true ||
    (diskOpen >= 10_000 && localOpen < diskOpen * 0.5);

  const out: InvestSimInputs = { ...local };
  const restoredKeys: string[] = [];
  for (const [k, diskEntry] of Object.entries(disk)) {
    if (!diskEntry) continue;
    if (diskEntry.ignoreSheet) continue;
    const diskCap = diskEntry.capital ?? 0;
    if (!(diskCap > 0)) continue;

    const tk = k.split("|")[0]?.trim().toUpperCase() ?? "";
    if (tk) {
      const soldAt = latestSoldAtForTicker([disk, local], tk);
      if (soldAt && diskEntry.investedAt) {
        const invMs = Date.parse(diskEntry.investedAt);
        const soldMs = Date.parse(soldAt);
        if (Number.isFinite(invMs) && Number.isFinite(soldMs) && invMs <= soldMs) {
          continue;
        }
      }
    }

    const cur = out[k];
    if (!bookCollapsed && cur?.ignoreSheet && cur.soldAt) continue;

    const localCap = cur?.ignoreSheet ? 0 : (cur?.capital ?? 0);
    if (!bookCollapsed && localCap > 0) continue;
    if (bookCollapsed && localCap >= diskCap && !cur?.ignoreSheet) continue;

    out[k] = sanitizeInvestSimEntry({
      buyPrice: diskEntry.buyPrice > 0 ? diskEntry.buyPrice : cur?.buyPrice ?? 0,
      capital: diskCap,
      ignoreSheet: false,
      investedAt: cur?.investedAt || diskEntry.investedAt,
      purchaseDate: cur?.purchaseDate || diskEntry.purchaseDate,
    });
    restoredKeys.push(k);
  }
  // Book-collapse: strip leftover sold aliases so a later reconcile cannot re-kill opens.
  const inputs = bookCollapsed ? purgeSoldAliasesForOpenTickers(out) : out;
  return { inputs, restoredKeys, bookCollapsed };
}
