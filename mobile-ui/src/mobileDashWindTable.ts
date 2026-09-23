/**
 * Dashboard “market + wind” table — 24h move, path bars, P(continuation).
 * Built from Simulation sheet rows (same fields as desktop what-if / P(cont)).
 */
import { daysFromCompletionDate } from "./opportunityLogic";
import {
  computeSimulationPosition,
  normalizedRowKey,
  parseNum,
  rowHasActivePortfolio,
} from "./simLogic";
import { RECENT_MOBILE_BUY_MS } from "./mobileTradeBook";
import type { InvestSimInputs, SheetTable } from "./types";

export type MobileDashWindRow = {
  key: string;
  ticker: string;
  inPortfolio: boolean;
  d1: number | null;
  d7: number | null;
  m1: number | null;
  g10: number | null;
  pCont: number | null;
  contBand: string | null;
  /** UI wind label: declining | early_run | pct */
  windKind: "declining" | "early_run" | "pct" | "none";
};

function varFromRow(r: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = parseNum(r[k]);
    if (v != null) return v;
  }
  const cols = Object.keys(r);
  for (const kw of keys) {
    const lo = kw.toLowerCase();
    const col = cols.find((c) => c.toLowerCase().includes(lo));
    if (!col) continue;
    const v = parseNum(r[col]);
    if (v != null) return v;
  }
  return null;
}

function resolveContBand(r: Record<string, unknown>): string | null {
  const raw = r["cont_band"] ?? r["contBand"];
  if (raw == null || raw === "") return null;
  return String(raw).trim().toLowerCase();
}

function resolvePCont(r: Record<string, unknown>): number | null {
  const p =
    parseNum(r["p_continuation"]) ??
    parseNum(r["p_cont"]) ??
    parseNum(r["cont_p_pop"]);
  if (p == null) return null;
  return Math.abs(p) <= 1.5 ? p * 100 : p;
}

function resolveG10(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["cont_g10"]) ??
    varFromRow(r, "Var. 10d %", "Var. 10g %", "10d %", "10g %")
  );
}

function windKindFor(
  band: string | null,
  g10: number | null,
  pCont: number | null,
): MobileDashWindRow["windKind"] {
  if (band === "declining" || (g10 != null && g10 < 0)) return "declining";
  if (band === "not_run" || (g10 != null && g10 >= 0 && g10 < 5 && pCont == null)) {
    return "early_run";
  }
  if (pCont != null && Number.isFinite(pCont)) return "pct";
  if (band === "not_run") return "early_run";
  return "none";
}

/**
 * Universe rows with a usable 24h or continuation signal, sorted by |Δ24h| then P(cont).
 * Caps length for mobile scroll.
 */
export function buildMobileDashWindRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  limit = 24,
): MobileDashWindRow[] {
  const out: MobileDashWindRow[] = [];
  for (const r of sheet?.rows ?? []) {
    const tk = String(r.Ticker ?? r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE") || tk.includes("METRICHE")) continue;
    const cd = r["Completion Date"] ?? r.cd ?? "—";
    const key = normalizedRowKey(tk, cd);
    const d1 =
      varFromRow(r, "Var. Giorn. %", "Var. Giorn %", "Var. Giornaliera %") ??
      parseNum(r["Var. 1d %"]);
    const d7 = varFromRow(r, "Var. 7d %", "Var. 1w %", "Var. Settimanale %");
    const m1 = varFromRow(r, "Var. 1M %", "Var. 1m %", "Var. Mensile %");
    const g10 = resolveG10(r);
    const pCont = resolvePCont(r);
    const contBand = resolveContBand(r);
    if (d1 == null && g10 == null && pCont == null && !contBand) continue;
    out.push({
      key,
      ticker: tk,
      inPortfolio: rowHasActivePortfolio(r, inputs),
      d1,
      d7,
      m1,
      g10,
      pCont,
      contBand,
      windKind: windKindFor(contBand, g10, pCont),
    });
  }
  out.sort((a, b) => {
    // Prefer wind pct ≥50, then stronger |Δ24h|
    const aw = a.windKind === "pct" && (a.pCont ?? 0) >= 50 ? 1 : 0;
    const bw = b.windKind === "pct" && (b.pCont ?? 0) >= 50 ? 1 : 0;
    if (bw !== aw) return bw - aw;
    return Math.abs(b.d1 ?? 0) - Math.abs(a.d1 ?? 0);
  });
  return out.slice(0, limit);
}

/** Same deep Soft SELL floor as desktop (`SOFT_SELL_G1_DEEP_PNL_PCT`). */
export const MOBILE_SOFT_SELL_DEEP_PNL_PCT = -12;

export type MobileDashOpenPosRow = {
  key: string;
  ticker: string;
  daysHeldLabel: string | null;
  daysToCd: number | null;
  recAction: string | null;
  d1: number | null;
  /** € move over ~24h when available from Pulse chip. */
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  /** € Δ since last desktop Home visit (Pulse). */
  deltaPnlEurSinceVisit: number | null;
  pnlEur: number | null;
  pnlPct: number | null;
  invested: number;
  /** Share of open-book capital — same % as allocation pie slice. */
  weightPct: number | null;
  /** P(continuation) % when available. */
  pCont: number | null;
  windKind: MobileDashWindRow["windKind"];
  /** Peak open MTM € this hold — red giveback bell (desktop Pulse parity). */
  peakPnlEur: number | null;
  /** Soft BUY / register time — suppress giveback bell off-session. */
  investedAt: string | null;
  /** @deprecated kept for older callers — prefer windKind / pCont */
  trend: "up" | "down" | "flat";
};

function daysHeldFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const s = iso.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T12:00:00`)
    : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

function windKindFromSnap(
  band: string | null | undefined,
  g10: number | null | undefined,
  pCont: number | null | undefined,
): MobileDashWindRow["windKind"] {
  return windKindFor(
    band ? String(band).trim().toLowerCase() : null,
    g10 ?? null,
    pCont ?? null,
  );
}

function isOpenPositionStillLive(
  p: NonNullable<import("./dashboardTypes").MobileDashboardSnapshot["openPositions"]>[number],
  inputs?: InvestSimInputs | null,
): boolean {
  if (!p || !(p.capitalEur > 0)) return false;
  if (!inputs) return true;
  const entry = inputs[p.key];
  if (!entry) return true;
  if (!entry.ignoreSheet && (entry.capital ?? 0) > 0 && (entry.buyPrice ?? 0) > 0) {
    return true;
  }
  // Closed in local/VPS book — only hide when Soft SELL is still racing Pulse republish.
  const sold = entry.soldAt ? Date.parse(entry.soldAt) : NaN;
  const now = Date.now();
  if (
    entry.ignoreSheet &&
    Number.isFinite(sold) &&
    sold <= now &&
    now - sold < RECENT_MOBILE_BUY_MS
  ) {
    return false;
  }
  // Stale empty sim-inputs vs live Pulse openPositions — keep the Pulse row.
  return true;
}

function openRowsFromDesktopSnapshot(
  openPositions: NonNullable<import("./dashboardTypes").MobileDashboardSnapshot["openPositions"]>,
  recActionByKey: Map<string, string> | undefined,
  lang: "it" | "en",
  inputs?: InvestSimInputs | null,
  sheet?: SheetTable | null,
): MobileDashOpenPosRow[] {
  const live = openPositions.filter((p) => isOpenPositionStillLive(p, inputs));
  const totalCap = live.reduce((s, p) => s + (p.capitalEur > 0 ? p.capitalEur : 0), 0);
  const rows: MobileDashOpenPosRow[] = live
    .map((p) => {
      // Prefer live Simulation MTM so Δ visit can move without a desktop republish.
      let livePnlEur: number | null =
        Number.isFinite(p.pnlEur) ? p.pnlEur : null;
      let livePnlPct: number | null =
        Number.isFinite(p.pnlPct) ? p.pnlPct : null;
      let liveD1 = p.d1 ?? null;
      let invested = p.capitalEur;
      if (sheet && inputs) {
        for (const r of sheet.rows ?? []) {
          if (!rowHasActivePortfolio(r, inputs)) continue;
          const pos = computeSimulationPosition(r, inputs);
          if (!pos || pos.key !== p.key) continue;
          invested = pos.capital > 0 ? pos.capital : invested;
          if (!pos.pnlUnavailable) {
            livePnlEur = pos.pnlEur;
            livePnlPct = pos.pnlPct;
          }
          liveD1 =
            varFromRow(r, "Var. Giorn. %", "Var. Giorn %", "Var. Giornaliera %") ??
            liveD1;
          break;
        }
      }
      const held = daysHeldFromIso(p.investedAt);
      let daysHeldLabel: string | null = null;
      if (p.investedAt) {
        const short =
          lang === "it"
            ? new Date(
                /^\d{4}-\d{2}-\d{2}$/.test(p.investedAt.trim())
                  ? `${p.investedAt.trim()}T12:00:00`
                  : p.investedAt,
              ).toLocaleDateString("it-IT", {
                day: "numeric",
                month: "short",
                year: "2-digit",
              })
            : new Date(
                /^\d{4}-\d{2}-\d{2}$/.test(p.investedAt.trim())
                  ? `${p.investedAt.trim()}T12:00:00`
                  : p.investedAt,
              ).toLocaleDateString("en-US", {
                day: "numeric",
                month: "short",
                year: "2-digit",
              });
        daysHeldLabel =
          held != null
            ? lang === "it"
              ? `dal ${short} · ${held}g`
              : `since ${short} · ${held}d`
            : short;
      }
      const opRec = (p.recAction ?? "").toLowerCase();
      const recFromSnap =
        opRec === "sell"
          ? "SELL"
          : opRec === "buy"
            ? "BUY"
            : opRec === "hold"
              ? "HOLD"
              : opRec === "review"
                ? "UNCERTAIN"
                : null;
      const d1 = liveD1;
      const trend: MobileDashOpenPosRow["trend"] =
        d1 != null && d1 > 0.15 ? "up" : d1 != null && d1 < -0.15 ? "down" : "flat";
      // Prefer Pulse Rec on the open row — Soft BUY chips are off-book opportunities
      // and must not paint ghost/open rows as BUY with empty MTM.
      const overlayRec = recActionByKey?.get(p.key) ?? null;
      const recAction =
        recFromSnap ??
        (overlayRec === "SELL" || overlayRec === "HOLD" ? overlayRec : null) ??
        overlayRec;
      return {
        key: p.key,
        ticker: String(p.ticker).trim().toUpperCase(),
        daysHeldLabel,
        daysToCd: p.daysToCd ?? null,
        recAction,
        d1,
        pnlEur24h:
          p.pnlEur24h != null && Number.isFinite(p.pnlEur24h) ? p.pnlEur24h : null,
        pnlPct24h:
          p.pnlPct24h != null && Number.isFinite(p.pnlPct24h)
            ? p.pnlPct24h
            : d1,
        // Snapshot Δ is often stuck at €0 — DashboardView overlays mobile visit Δ.
        deltaPnlEurSinceVisit:
          p.deltaPnlEurSinceVisit != null && Number.isFinite(p.deltaPnlEurSinceVisit)
            ? p.deltaPnlEurSinceVisit
            : null,
        pnlEur: livePnlEur,
        pnlPct: livePnlPct,
        invested,
        weightPct:
          totalCap > 0 ? Math.round((invested / totalCap) * 1000) / 10 : null,
        pCont: p.pCont ?? null,
        windKind: windKindFromSnap(p.contBand, p.g10, p.pCont),
        peakPnlEur:
          p.peakPnlEur != null && Number.isFinite(p.peakPnlEur)
            ? p.peakPnlEur
            : null,
        investedAt: p.investedAt ?? null,
        trend,
      };
    });
  return rows.sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
}

function openRowsFromLiveInputs(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  recActionByKey: Map<string, string> | undefined,
  lang: "it" | "en",
  allowDeepSoftSellOverlay: boolean,
): MobileDashOpenPosRow[] {
  const staged: Omit<MobileDashOpenPosRow, "weightPct">[] = [];
  let totalCap = 0;
  for (const r of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(r, inputs)) continue;
    const pos = computeSimulationPosition(r, inputs);
    if (!pos || pos.capital <= 0) continue;
    totalCap += pos.capital;
    const entry = inputs[pos.key];
    const investedAt = entry?.purchaseDate || entry?.investedAt || null;
    const held = daysHeldFromIso(investedAt);
    const d1 =
      varFromRow(r, "Var. Giorn. %", "Var. Giorn %", "Var. Giornaliera %");
    const daysToCd = daysFromCompletionDate(pos.completionDate);
    let daysHeldLabel: string | null = null;
    if (investedAt) {
      const short =
        lang === "it"
          ? new Date(
              /^\d{4}-\d{2}-\d{2}$/.test(investedAt.trim())
                ? `${investedAt.trim()}T12:00:00`
                : investedAt,
            ).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "2-digit" })
          : new Date(
              /^\d{4}-\d{2}-\d{2}$/.test(investedAt.trim())
                ? `${investedAt.trim()}T12:00:00`
                : investedAt,
            ).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" });
      daysHeldLabel =
        held != null
          ? lang === "it"
            ? `dal ${short} · ${held}g`
            : `since ${short} · ${held}d`
          : short;
    }
    const pnlPct = pos.pnlUnavailable ? null : pos.pnlPct;
    const g10 = resolveG10(r);
    const pCont = resolvePCont(r);
    const contBand = resolveContBand(r);
    const windKind = windKindFor(contBand, g10, pCont);
    const trend: MobileDashOpenPosRow["trend"] =
      d1 != null && d1 > 0.15 ? "up" : d1 != null && d1 < -0.15 ? "down" : "flat";
    const fromSnap = recActionByKey?.get(pos.key) ?? null;
    const deepSell =
      allowDeepSoftSellOverlay &&
      pnlPct != null &&
      Number.isFinite(pnlPct) &&
      pnlPct <= MOBILE_SOFT_SELL_DEEP_PNL_PCT;
    const recAction = deepSell ? "SELL" : fromSnap;
    staged.push({
      key: pos.key,
      ticker: pos.ticker,
      daysHeldLabel,
      daysToCd,
      recAction,
      d1,
      pnlEur24h: null,
      pnlPct24h: d1,
      deltaPnlEurSinceVisit: null,
      pnlEur: pos.pnlUnavailable ? null : pos.pnlEur,
      pnlPct,
      invested: pos.capital,
      pCont,
      windKind,
      peakPnlEur: null,
      investedAt,
      trend,
    });
  }
  // Soft BUY saved under a key that still matches a sheet ticker via alias —
  // already covered above. Also surface opens whose sheet row is briefly
  // missing so the portfolio updates immediately after a mobile confirm.
  const stagedKeys = new Set(staged.map((r) => r.key));
  const stagedTickers = new Set(staged.map((r) => r.ticker));
  for (const [key, entry] of Object.entries(inputs)) {
    if (!entry || entry.ignoreSheet || !(entry.capital > 0) || !(entry.buyPrice > 0)) continue;
    if (stagedKeys.has(key)) continue;
    const ticker = String(key.split("|")[0] ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || stagedTickers.has(ticker)) continue;
    let matchedRow: Record<string, unknown> | null = null;
    for (const r of sheet?.rows ?? []) {
      const tk = String(r.Ticker ?? "")
        .trim()
        .toUpperCase();
      if (tk === ticker) {
        matchedRow = r;
        break;
      }
    }
    if (matchedRow && rowHasActivePortfolio(matchedRow, inputs)) {
      // Already represented under the canonical sheet key.
      continue;
    }
    const investedAt = entry.purchaseDate || entry.investedAt || null;
    const held = daysHeldFromIso(investedAt);
    const d1 = matchedRow
      ? varFromRow(matchedRow, "Var. Giorn. %", "Var. Giorn %", "Var. Giornaliera %")
      : null;
    totalCap += entry.capital;
    staged.push({
      key,
      ticker,
      daysHeldLabel:
        held != null
          ? lang === "it"
            ? `${held}g`
            : `${held}d`
          : null,
      daysToCd: matchedRow ? daysFromCompletionDate(String(matchedRow["Completion Date"] ?? "")) : null,
      recAction: recActionByKey?.get(key) ?? "BUY",
      d1,
      pnlEur24h: null,
      pnlPct24h: d1,
      deltaPnlEurSinceVisit: null,
      pnlEur: null,
      pnlPct: null,
      invested: entry.capital,
      pCont: matchedRow ? resolvePCont(matchedRow) : null,
      windKind: "none",
      peakPnlEur: null,
      investedAt,
      trend: d1 != null && d1 > 0.15 ? "up" : d1 != null && d1 < -0.15 ? "down" : "flat",
    });
    stagedKeys.add(key);
    stagedTickers.add(ticker);
  }

  return staged.map((row) => ({
    ...row,
    weightPct:
      totalCap > 0 ? Math.round((row.invested / totalCap) * 1000) / 10 : null,
  }));
}

function reweightOpenRows(rows: MobileDashOpenPosRow[]): MobileDashOpenPosRow[] {
  const totalCap = rows.reduce((s, r) => s + (r.invested > 0 ? r.invested : 0), 0);
  return rows
    .map((row) => ({
      ...row,
      weightPct:
        totalCap > 0 ? Math.round((row.invested / totalCap) * 1000) / 10 : null,
    }))
    .sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
}

export function buildMobileDashOpenPositions(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  recActionByKey?: Map<string, string>,
  lang: "it" | "en" = "en",
  /** When false, trust desktop Soft lists (no local −12% deep SELL overlay). */
  allowDeepSoftSellOverlay = true,
  /** Desktop Pulse open rows — preferred when present. */
  desktopOpenPositions?: import("./dashboardTypes").MobileDashboardSnapshot["openPositions"] | null,
  /** Pulse allocation pie — fallback authority when openPositions is missing. */
  desktopAllocation?: import("./dashboardTypes").MobileDashboardSnapshot["allocation"] | null,
): MobileDashOpenPosRow[] {
  const fromInputs = openRowsFromLiveInputs(
    sheet,
    inputs,
    recActionByKey,
    lang,
    allowDeepSoftSellOverlay,
  );

  if (Array.isArray(desktopOpenPositions) && desktopOpenPositions.length > 0) {
    const fromDesktop = openRowsFromDesktopSnapshot(
      desktopOpenPositions,
      recActionByKey,
      lang,
      inputs,
      sheet,
    );
    // Keep desktop MTM for names still open; append only a just-saved mobile buy
    // (not stale VPS ghosts that Pulse already closed).
    const desktopKeys = new Set(fromDesktop.map((r) => r.key));
    const now = Date.now();
    const extras = fromInputs.filter((r) => {
      if (desktopKeys.has(r.key)) return false;
      const e = inputs[r.key];
      const inv = e?.investedAt ? Date.parse(e.investedAt) : NaN;
      return Number.isFinite(inv) && now - inv >= 0 && now - inv < RECENT_MOBILE_BUY_MS;
    });
    return reweightOpenRows([...fromDesktop, ...extras]);
  }

  // Snapshot openPositions missing/stale — still hide VPS ghosts using the pie.
  if (Array.isArray(desktopAllocation) && desktopAllocation.length > 0) {
    const allocKeys = new Set(
      desktopAllocation.map((a) => String(a.key ?? "").trim()).filter(Boolean),
    );
    const now = Date.now();
    const filtered = fromInputs.filter((r) => {
      if (allocKeys.has(r.key)) return true;
      const e = inputs[r.key];
      const inv = e?.investedAt ? Date.parse(e.investedAt) : NaN;
      return Number.isFinite(inv) && now - inv >= 0 && now - inv < RECENT_MOBILE_BUY_MS;
    });
    return reweightOpenRows(filtered);
  }

  return fromInputs.sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
}
