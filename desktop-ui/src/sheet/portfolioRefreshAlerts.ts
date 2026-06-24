/**
 * Portfolio snapshot + diff after a full data refresh.
 * Captures state before refresh, compares after reload, drives the alerts modal.
 */

import type { OrchestratorRunSummary } from "../api/refresh";
import type { TranslationKey } from "../shared/i18n";
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { normalizedRowKey } from "./investSimKeys";
import { extractCurveInputs } from "./precatCurve";
import { shouldHoldForForwardModelRecovery } from "./portfolioDeclineSell";
import {
  appendHistoryPoint,
  loadInvestSimHistory,
  loadInvestSimInputs,
  persistInvestSimHistoryNow,
  type InvestSimInputs,
} from "./investSimStorage";
import { reconcileInvestSimInputs } from "./investSimKeys";
import {
  buildPositions,
  computeSimulationPosition,
  resolvePortfolioHistory,
} from "./simulationPosition";

const BEFORE_KEY = "supernova_portfolio_refresh_before_v1";

export type PortfolioDirection = "long" | "short" | "neutral";
export type CurveTrend = "up" | "down" | "flat";

export type UrgencyKind =
  | "buy_now"
  | "buy_watch"
  | "sell_now"
  | "sell_exit"
  | "sell_stop"
  | null;

export type PortfolioPositionSnap = {
  key: string;
  ticker: string;
  cd: string;
  inPortfolio: boolean;
  capital: number;
  buyPrice: number;
  valueNow: number;
  pnlPct: number;
  pnlEur: number;
  pred5: number | null;
  slope5d: number | null;
  slope20d: number | null;
  slopeDelta: number | null;
  direction: PortfolioDirection;
  curveTrend: CurveTrend;
  daysToCd: number | null;
  urgency: UrgencyKind;
};

export type PortfolioSnapshot = {
  capturedAt: string;
  positions: PortfolioPositionSnap[];
  totals: { capital: number; value: number; pnlEur: number; pnlPct: number; n: number };
};

export type PortfolioAlertCategory =
  | "direction"
  | "curve_direction"
  | "acceleration"
  | "deceleration"
  | "reversal"
  | "buy_urgent"
  | "buy_opportunity"
  | "sell_urgent"
  | "sell_exit"
  | "pnl"
  | "new_position"
  | "closed_position"
  | "new_simulation_row"
  | "cd_changed"
  | "new_biotech_ticker"
  | "clinical_feed"
  | "cd_imminent"
  | "sustained_decline";

/** Categories worth surfacing in the post-refresh modal (actionable or material news). */
const ACTIONABLE_CATEGORIES = new Set<PortfolioAlertCategory>([
  "direction",
  "curve_direction",
  "acceleration",
  "deceleration",
  "reversal",
  "buy_urgent",
  "buy_opportunity",
  "sell_urgent",
  "sell_exit",
  "new_position",
  "closed_position",
  "new_simulation_row",
  "cd_changed",
  "new_biotech_ticker",
  "clinical_feed",
  "cd_imminent",
  "sustained_decline",
]);

export type PortfolioSummaryTotals = {
  value: number;
  capital: number;
  pnlPct: number;
  n: number;
};

export type PortfolioRefreshAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  category: PortfolioAlertCategory;
  ticker: string;
  cd: string;
  titleKey: TranslationKey;
  titleVars?: Record<string, string | number>;
  detailKey: TranslationKey;
  detailVars?: Record<string, string | number>;
  /** Link esterno (es. sito web società per alert IPO, fonte evento feed). */
  linkUrl?: string;
  linkLabel?: string;
  /** Riga summary feed (headline AI o titolo evento top EIS). */
  feedSummary?: string;
  /** Apri Clinical feed in-app filtrato su questo ticker. */
  clinicalFeedTicker?: string;
};

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function predDirection(pred5: number | null): PortfolioDirection {
  if (pred5 == null) return "neutral";
  if (pred5 >= 0.5) return "long";
  if (pred5 <= -0.5) return "short";
  return "neutral";
}

function curveTrendFromSlope(slope5d: number | null): CurveTrend {
  if (slope5d == null) return "flat";
  if (slope5d > 0.05) return "up";
  if (slope5d < -0.05) return "down";
  return "flat";
}

function extractPred5(row: Record<string, unknown>): number | null {
  const cols = Object.keys(row);
  const colPred = findCol(cols, "Pred empirica") ?? findCol(cols, "Pred") ?? "";
  let pred5 = toNum(row[colPred]);
  if (pred5 != null && Math.abs(pred5) <= 1.5 && !String(row[colPred] ?? "").includes("%")) {
    pred5 *= 100;
  }
  return pred5;
}

function computeScore(
  affid: number | null,
  r2: number | null,
  pred5: number | null,
  days: number | null,
): number {
  const a = affid != null ? Math.min(1, affid) * 35 : 0;
  const r = r2 != null ? Math.min(1, Math.max(0, r2)) * 20 : 0;
  let d = 0;
  if (pred5 != null) {
    const abs = Math.abs(pred5);
    if (abs >= 10) d = 25;
    else if (abs >= 5) d = 18;
    else if (abs >= 2) d = 10;
    else d = 3;
  }
  let t = 0;
  if (days != null && days >= 0) {
    if (days <= 7) t = 20;
    else if (days <= 14) t = 17;
    else if (days <= 30) t = 12;
    else if (days <= 60) t = 6;
    else t = 2;
  }
  return Math.round(a + r + d + t);
}

function computeUrgency(
  row: Record<string, unknown>,
  inPortfolio: boolean,
  pnlPct: number | null,
): UrgencyKind {
  const cols = Object.keys(row);
  const colCD = findCol(cols, "Completion Date") ?? "Completion Date";
  const colAffid = findCol(cols, "Affidabilit") ?? "";
  const colR2 = findCol(cols, "R²") ?? findCol(cols, "R2") ?? "";
  const cd = String(row[colCD] ?? "").trim();
  const days = daysFromToday(cd);

  let affid = toNum(row[colAffid]);
  if (affid != null && affid > 1) affid /= 100;
  const r2 = toNum(row[colR2]);
  const pred5 = extractPred5(row);

  const score = computeScore(affid, r2, pred5, days);
  const isLong = pred5 != null && pred5 >= 0.5;
  const isShort = pred5 != null && pred5 <= -0.5;

  if (inPortfolio) {
    if (pnlPct != null && pnlPct < -8) return "sell_stop";
    if ((days != null && days <= 3) || (pnlPct != null && pnlPct > 8)) return "sell_exit";
    const { slope5d, slope20d } = extractCurveInputs(row);
    if (slope5d != null && slope20d != null && slope5d < 0 && slope20d > 0) {
      return "sell_now";
    }
    return null;
  }

  if (score >= 60 && isLong && days != null && days >= 0 && days <= 14) return "buy_now";
  if (score >= 48 && isShort && days != null && days >= 0 && days <= 14) return "buy_watch";
  if (score >= 40 && isLong && days != null && days >= 0 && days <= 30) return "buy_watch";
  return null;
}

function snapFromRow(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
): PortfolioPositionSnap | null {
  const pos = computeSimulationPosition(row, inputs, {
    history: resolvePortfolioHistory(),
  });
  if (!pos) return null;

  const inPortfolio = pos.capital > 0 && pos.buyPrice > 0;
  const { slope5d, slope20d } = extractCurveInputs(row);
  const slopeDelta =
    slope5d != null && slope20d != null ? Math.round((slope5d - slope20d) * 100) / 100 : null;
  const pred5 = extractPred5(row);
  const days = daysFromToday(pos.completionDate);

  return {
    key: pos.key,
    ticker: pos.ticker,
    cd: pos.completionDate,
    inPortfolio,
    capital: pos.capital,
    buyPrice: pos.buyPrice,
    valueNow: pos.valueNow,
    pnlPct: Math.round(pos.pnlPct * 100) / 100,
    pnlEur: Math.round(pos.pnlEur * 100) / 100,
    pred5,
    slope5d,
    slope20d,
    slopeDelta,
    direction: predDirection(pred5),
    curveTrend: curveTrendFromSlope(slope5d),
    daysToCd: days,
    urgency: computeUrgency(row, inPortfolio, pos.pnlPct),
  };
}

export function buildPortfolioSnapshot(
  simTable: SheetTable | null,
  inputs?: InvestSimInputs,
): PortfolioSnapshot | null {
  if (!simTable?.rows?.length) return null;
  const merged = reconcileInvestSimInputs(inputs ?? loadInvestSimInputs(), simTable.rows);
  const positions: PortfolioPositionSnap[] = [];
  for (const row of simTable.rows) {
    const s = snapFromRow(row, merged);
    if (s) positions.push(s);
  }
  const active = positions.filter((p) => p.inPortfolio);
  const cap = active.reduce((a, p) => a + p.capital, 0);
  const val = active.reduce((a, p) => a + p.valueNow, 0);
  const pnlEur = val - cap;
  const pnlPct = cap > 0 ? (pnlEur / cap) * 100 : 0;
  return {
    capturedAt: new Date().toISOString(),
    positions,
    totals: {
      capital: cap,
      value: val,
      pnlEur: Math.round(pnlEur * 100) / 100,
      pnlPct: Math.round(pnlPct * 100) / 100,
      n: active.length,
    },
  };
}

export function savePortfolioSnapshotBeforeRefresh(snapshot: PortfolioSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BEFORE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
}

export function loadPortfolioSnapshotBeforeRefresh(): PortfolioSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BEFORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortfolioSnapshot;
  } catch {
    return null;
  }
}

export function clearPortfolioSnapshotBeforeRefresh(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(BEFORE_KEY);
}

/** Force a portfolio history point after refresh (mark-to-market). */
export function recordPortfolioHistoryAfterRefresh(simTable: SheetTable | null): void {
  if (!simTable) return;
  const inputs = reconcileInvestSimInputs(loadInvestSimInputs(), simTable.rows);
  const positions = buildPositions(simTable, inputs, resolvePortfolioHistory()).filter(
    (p) => p.capital > 0 && p.buyPrice > 0,
  );
  if (!positions.length) return;

  const cap = positions.reduce((a, p) => a + p.capital, 0);
  const val = positions.reduce((a, p) => a + p.valueNow, 0);
  const pnl = val - cap;
  const pct = cap > 0 ? (pnl / cap) * 100 : 0;
  const byTicker: Record<string, { value: number; pnl: number; pnlPct: number }> = {};
  for (const p of positions) {
    byTicker[p.key] = { value: p.valueNow, pnl: p.pnlEur, pnlPct: p.pnlPct };
  }

  const history = loadInvestSimHistory();
  const next = appendHistoryPoint(
    history,
    { capital: cap, value: val, pnl, pnlPct: pct, byTicker },
    { force: "hourly" },
  );
  persistInvestSimHistoryNow(next);
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPp(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} pp`;
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

export function diffPortfolioSnapshots(
  before: PortfolioSnapshot,
  after: PortfolioSnapshot,
): PortfolioRefreshAlert[] {
  const out: PortfolioRefreshAlert[] = [];
  const seen = new Set<string>();
  const beforeMap = new Map(before.positions.map((p) => [p.key, p]));
  const afterMap = new Map(after.positions.map((p) => [p.key, p]));

  for (const [key, b] of beforeMap) {
    const a = afterMap.get(key);
    if (b.inPortfolio && (!a || !a.inPortfolio)) {
      pushAlert(out, seen, {
        severity: "warning",
        category: "closed_position",
        ticker: b.ticker,
        cd: b.cd,
        titleKey: "portfolioRefresh.alert.closed.title",
        detailKey: "portfolioRefresh.alert.closed.detail",
        detailVars: { ticker: b.ticker, pnl: fmtPct(b.pnlPct) },
      });
    }
  }

  const beforeByTicker = new Map<string, PortfolioPositionSnap>();
  for (const p of before.positions) {
    if (!beforeByTicker.has(p.ticker)) beforeByTicker.set(p.ticker, p);
  }

  for (const [key, a] of afterMap) {
    if (beforeMap.has(key)) continue;
    const prevTicker = beforeByTicker.get(a.ticker);
    if (prevTicker && prevTicker.cd !== a.cd) {
      pushAlert(out, seen, {
        severity: "info",
        category: "cd_changed",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.cdChanged.title",
        detailKey: "portfolioRefresh.alert.cdChanged.detail",
        detailVars: { before: prevTicker.cd, after: a.cd },
      });
    } else if (!prevTicker) {
      pushAlert(out, seen, {
        severity: "info",
        category: "new_simulation_row",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.newSimRow.title",
        detailKey: "portfolioRefresh.alert.newSimRow.detail",
        detailVars: { pred: fmtPp(a.pred5) },
      });
    }
  }

  for (const [key, a] of afterMap) {
    const b = beforeMap.get(key);
    if (!b) continue;

    if (!b.inPortfolio && a.inPortfolio) {
      pushAlert(out, seen, {
        severity: "info",
        category: "new_position",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.newPos.title",
        detailKey: "portfolioRefresh.alert.newPos.detail",
        detailVars: {
          capital: a.capital.toLocaleString("en-US"),
          price: a.buyPrice.toFixed(2),
        },
      });
      continue;
    }

    const watchOnly = !a.inPortfolio;

    if (
      b.direction !== "neutral" &&
      a.direction !== "neutral" &&
      b.direction !== a.direction
    ) {
      pushAlert(out, seen, {
        severity: "critical",
        category: "direction",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.dir.title",
        detailKey: "portfolioRefresh.alert.dir.detail",
        detailVars: {
          before: b.direction,
          after: a.direction,
          predBefore: fmtPp(b.pred5),
          predAfter: fmtPp(a.pred5),
        },
      });
    }

    if (
      !watchOnly &&
      b.curveTrend !== "flat" &&
      a.curveTrend !== "flat" &&
      b.curveTrend !== a.curveTrend
    ) {
      pushAlert(out, seen, {
        severity: "warning",
        category: "curve_direction",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.curve.title",
        detailKey: "portfolioRefresh.alert.curve.detail",
        detailVars: {
          before: b.curveTrend,
          after: a.curveTrend,
          slopeBefore: fmtPp(b.slope5d),
          slopeAfter: fmtPp(a.slope5d),
        },
      });
    }

    const revBefore =
      b.slope5d != null && b.slope20d != null && b.slope5d < 0 && b.slope20d > 0;
    const revAfter =
      a.slope5d != null && a.slope20d != null && a.slope5d < 0 && a.slope20d > 0;
    if (!revBefore && revAfter) {
      pushAlert(out, seen, {
        severity: "critical",
        category: "reversal",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.reversal.title",
        detailKey: "portfolioRefresh.alert.reversal.detail",
        detailVars: { t5: fmtPp(a.slope5d), t20: fmtPp(a.slope20d) },
      });
    }

    if (b.slopeDelta != null && a.slopeDelta != null) {
      const deltaChange = a.slopeDelta - b.slopeDelta;
      if (deltaChange <= -0.5 && a.slopeDelta <= -0.5) {
        pushAlert(out, seen, {
          severity: watchOnly ? "critical" : "warning",
          category: "deceleration",
          ticker: a.ticker,
          cd: a.cd,
          titleKey: "portfolioRefresh.alert.decel.title",
          detailKey: "portfolioRefresh.alert.decel.detail",
          detailVars: {
            before: fmtPp(b.slopeDelta),
            after: fmtPp(a.slopeDelta),
            delta: `${deltaChange >= 0 ? "+" : ""}${deltaChange.toFixed(2)}`,
          },
        });
      }
      if (
        !watchOnly &&
        deltaChange >= 0.5 &&
        a.slope5d != null &&
        a.slope5d > 0
      ) {
        pushAlert(out, seen, {
          severity: "info",
          category: "acceleration",
          ticker: a.ticker,
          cd: a.cd,
          titleKey: "portfolioRefresh.alert.accel.title",
          detailKey: "portfolioRefresh.alert.accel.detail",
          detailVars: {
            before: fmtPp(b.slopeDelta),
            after: fmtPp(a.slopeDelta),
            delta: deltaChange.toFixed(2),
          },
        });
      }
    }

    if (watchOnly) continue;

    if (b.urgency !== "sell_stop" && a.urgency === "sell_stop") {
      pushAlert(out, seen, {
        severity: "critical",
        category: "sell_urgent",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.stop.title",
        detailKey: "portfolioRefresh.alert.stop.detail",
        detailVars: { pnl: fmtPct(a.pnlPct) },
      });
    } else if (b.urgency !== "sell_now" && a.urgency === "sell_now") {
      pushAlert(out, seen, {
        severity: "critical",
        category: "sell_urgent",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.sellUrgent.title",
        detailKey: "portfolioRefresh.alert.sellUrgent.detail",
      });
    } else if (
      (b.urgency !== "sell_exit" && a.urgency === "sell_exit") ||
      (b.pnlPct <= 8 && a.pnlPct > 8)
    ) {
      pushAlert(out, seen, {
        severity: "warning",
        category: "sell_exit",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.takeProfit.title",
        detailKey: "portfolioRefresh.alert.takeProfit.detail",
        detailVars: {
          pnl: fmtPct(a.pnlPct),
          cdSuffix: "",
          ...(a.daysToCd != null && a.daysToCd <= 3 ? { cdDays: a.daysToCd } : {}),
        },
      });
    }

    if (b.urgency !== "buy_now" && a.urgency === "buy_now") {
      pushAlert(out, seen, {
        severity: "critical",
        category: "buy_urgent",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.buyNow.title",
        detailKey: "portfolioRefresh.alert.buyNow.detail",
        detailVars: {
          pred: fmtPp(a.pred5),
          cdSuffix: "",
          ...(a.daysToCd != null ? { cdDays: a.daysToCd } : {}),
        },
      });
    }

    if (Math.abs(a.pnlPct - b.pnlPct) >= 2.5) {
      pushAlert(out, seen, {
        severity: Math.abs(a.pnlPct - b.pnlPct) >= 5 ? "warning" : "info",
        category: "pnl",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.pnl.title",
        detailKey: "portfolioRefresh.alert.pnl.detail",
        detailVars: {
          pnlBefore: fmtPct(b.pnlPct),
          pnlAfter: fmtPct(a.pnlPct),
          eurBefore: b.pnlEur.toFixed(0),
          eurAfter: a.pnlEur.toFixed(0),
        },
      });
    }
  }

  for (const [, a] of afterMap) {
    if (a.inPortfolio) continue;
    if (a.urgency === "buy_now") {
      pushAlert(out, seen, {
        severity: "critical",
        category: "buy_urgent",
        ticker: a.ticker,
        cd: a.cd,
        titleKey: "portfolioRefresh.alert.buyNotHeld.title",
        detailKey: "portfolioRefresh.alert.buyNotHeld.detail",
        detailVars: {
          pred: fmtPp(a.pred5),
          cdSuffix: "",
          ...(a.daysToCd != null ? { cdDays: a.daysToCd } : {}),
        },
      });
    }
  }

  const order: Record<PortfolioRefreshAlert["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  out.sort((x, y) => order[x.severity] - order[y.severity]);
  return out;
}

/** CD entered the ≤3 day window since the pre-refresh snapshot. */
function appendImminentCdAlerts(
  before: PortfolioSnapshot | null,
  after: PortfolioSnapshot,
  out: PortfolioRefreshAlert[],
  seen: Set<string>,
): void {
  const beforeMap = new Map((before?.positions ?? []).map((p) => [p.key, p]));
  for (const a of after.positions) {
    if (a.daysToCd == null || a.daysToCd > 3 || a.daysToCd < 0) continue;
    const b = beforeMap.get(a.key);
    if (b?.daysToCd != null && b.daysToCd <= 3) continue;
    pushAlert(out, seen, {
      severity: a.daysToCd <= 1 ? "critical" : "warning",
      category: "cd_imminent",
      ticker: a.ticker,
      cd: a.cd,
      titleKey: "portfolioRefresh.alert.cdImminent.title",
      detailKey: a.inPortfolio
        ? "portfolioRefresh.alert.cdImminent.detailHeld"
        : "portfolioRefresh.alert.cdImminent.detailWatch",
      detailVars: { days: a.daysToCd },
    });
  }
}

/** Both slopes negative and decline worsened vs pre-refresh (sustained drawdown). */
function appendSustainedDeclineAlerts(
  before: PortfolioSnapshot | null,
  after: PortfolioSnapshot,
  simTable: SheetTable | null,
  chartPtsByKey: Map<string, ChartPoint[]>,
  out: PortfolioRefreshAlert[],
  seen: Set<string>,
): void {
  const simRowByKey = new Map<string, Record<string, unknown>>();
  for (const row of simTable?.rows ?? []) {
    const ticker = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    const cd = String(row["Completion Date"] ?? "").trim();
    if (!ticker || !cd) continue;
    simRowByKey.set(normalizedRowKey(ticker, cd), row);
  }

  const beforeMap = new Map((before?.positions ?? []).map((p) => [p.key, p]));
  for (const a of after.positions) {
    if (a.slope5d == null || a.slope20d == null) continue;
    if (a.slope5d >= -0.05 || a.slope20d >= -0.05) continue;
    const simRow = simRowByKey.get(a.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? chartPtsByKey.get(sk) ?? null : null;
    if (shouldHoldForForwardModelRecovery(simRow, chartPts, null)) continue;
    const b = beforeMap.get(a.key);
    const wasDeclining =
      b != null &&
      b.slope5d != null &&
      b.slope20d != null &&
      b.slope5d < -0.05 &&
      b.slope20d < -0.05;
    const worsened =
      !wasDeclining ||
      (b != null &&
        (a.slope5d < b.slope5d! - 0.25 || a.slope20d < b.slope20d! - 0.25));
    if (!worsened) continue;
    pushAlert(out, seen, {
      severity: a.inPortfolio ? "critical" : "warning",
      category: "sustained_decline",
      ticker: a.ticker,
      cd: a.cd,
      titleKey: "portfolioRefresh.alert.sustainedDecline.title",
      detailKey: a.inPortfolio
        ? "portfolioRefresh.alert.sustainedDecline.detailHeld"
        : "portfolioRefresh.alert.sustainedDecline.detailWatch",
      detailVars: {
        t5: fmtPp(a.slope5d),
        t20: fmtPp(a.slope20d),
      },
    });
  }
}

/** Keep urgent/actionable alerts; drop low-signal P&L noise. */
export function filterActionablePortfolioAlerts(
  alerts: PortfolioRefreshAlert[],
): PortfolioRefreshAlert[] {
  return alerts.filter((a) => {
    if (ACTIONABLE_CATEGORIES.has(a.category)) return true;
    if (a.category === "pnl") return a.severity !== "info";
    return a.severity !== "info";
  });
}

/** Popup apertura: solo vendite urgenti su portafoglio in perdita (stop / sell now). */
export function filterOpeningPortfolioAlerts(
  alerts: PortfolioRefreshAlert[],
): PortfolioRefreshAlert[] {
  return filterActionablePortfolioAlerts(alerts).filter((a) => a.category === "sell_urgent");
}

export function hasOpeningPortfolioAlertsToShow(alerts: PortfolioRefreshAlert[]): boolean {
  return filterOpeningPortfolioAlerts(alerts).length > 0;
}

export function hasPortfolioAlertsToShow(alerts: PortfolioRefreshAlert[]): boolean {
  return filterActionablePortfolioAlerts(alerts).length > 0;
}

/** Capture snapshot for all Simulation rows (used when refresh starts). */
export function capturePortfolioBeforeRefresh(simTable: SheetTable | null): void {
  const snap = buildPortfolioSnapshot(simTable);
  if (snap) savePortfolioSnapshotBeforeRefresh(snap);
}

function orchestratorTickerList(summary: OrchestratorRunSummary): string[] {
  const d = summary.new_tickers_discovery ?? [];
  const e = summary.new_tickers_extra ?? [];
  const i = summary.new_tickers_ipo ?? [];
  return [...new Set([...d, ...e, ...i])].sort();
}

/** Novità orchestrator (nuove biotech / CD) da unire al diff portfolio. */
export function mergeOrchestratorSummaryAlerts(
  alerts: PortfolioRefreshAlert[],
  summary: OrchestratorRunSummary | null | undefined,
): PortfolioRefreshAlert[] {
  if (!summary) return alerts;
  const out = [...alerts];
  const seen = new Set(out.map((a) => a.id));

  for (const ticker of orchestratorTickerList(summary)) {
    pushAlert(out, seen, {
      severity: "info",
      category: "new_biotech_ticker",
      ticker,
      cd: "—",
      titleKey: "portfolioRefresh.alert.newBiotech.title",
      detailKey: "portfolioRefresh.alert.newBiotech.detail",
      detailVars: { ticker },
    });
  }

  for (const row of summary.new_catalyst_rows ?? []) {
    pushAlert(out, seen, {
      severity: "info",
      category: "new_simulation_row",
      ticker: row.ticker,
      cd: row.completion_date,
      titleKey: "portfolioRefresh.alert.newCdOrchestrator.title",
      detailKey: "portfolioRefresh.alert.newCdOrchestrator.detail",
      detailVars: {
        match: row.sponsor_match,
        relation: row.nct_relation_type,
      },
    });
  }

  const order: Record<PortfolioRefreshAlert["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  out.sort((x, y) => order[x.severity] - order[y.severity]);
  return out;
}

/** Diff post-refresh con dati Simulation già aggiornati. */
export async function buildPostRefreshPortfolioAlerts(
  simTable: SheetTable | null,
): Promise<{
  alerts: PortfolioRefreshAlert[];
  summaryTotals: PortfolioSummaryTotals | null;
}> {
  recordPortfolioHistoryAfterRefresh(simTable);
  const before = loadPortfolioSnapshotBeforeRefresh();
  const after = buildPortfolioSnapshot(simTable);
  clearPortfolioSnapshotBeforeRefresh();

  let alerts: PortfolioRefreshAlert[] = [];
  if (before && after) {
    alerts = diffPortfolioSnapshots(before, after);
  }

  if (after) {
    const seen = new Set(alerts.map((a) => a.id));
    let chartPtsByKey = new Map<string, ChartPoint[]>();
    try {
      const { loadSimulationChartsBundle } = await import("../data/simulationCharts");
      const { bundle } = await loadSimulationChartsBundle();
      const series = bundle?.series;
      if (series) {
        for (const [k, s] of Object.entries(series)) {
          if (!k.startsWith("co:")) continue;
          if (Array.isArray(s?.points) && s.points.length > 0) {
            chartPtsByKey.set(k, s.points);
          }
        }
      }
    } catch {
      /* optional */
    }
    appendImminentCdAlerts(before, after, alerts, seen);
    appendSustainedDeclineAlerts(before, after, simTable, chartPtsByKey, alerts, seen);
  }

  try {
    const { fetchOrchestratorSummary } = await import("../api/refresh");
    const summary = await fetchOrchestratorSummary();
    alerts = mergeOrchestratorSummaryAlerts(alerts, summary);
  } catch {
    /* optional */
  }

  alerts = filterActionablePortfolioAlerts(alerts);

  return {
    alerts,
    summaryTotals: after?.totals ?? null,
  };
}
