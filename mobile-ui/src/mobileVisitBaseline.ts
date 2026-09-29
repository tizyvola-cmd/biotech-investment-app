/**
 * Mobile «Δ ultima visita» — freeze open MTM at companion enter.
 * Desktop snapshot often publishes Δ=0 (baseline poisoned / Home not open);
 * the phone computes its own visit delta from live sheet marks.
 */

const LEAVE_KEY = "supernova_mobile_visit_leave_v1";
const SESSION_KEY = "supernova_mobile_visit_baseline_session_v1";

export type MobileVisitTickerSnap = { pnlEur: number };
export type MobileVisitBaseline = {
  savedAt: string;
  portfolioPnlEur: number;
  tickers: Record<string, MobileVisitTickerSnap>;
};

export type MobileVisitLiveRow = {
  key: string;
  pnlEur: number | null;
};

function sumLivePnl(rows: MobileVisitLiveRow[]): number {
  let s = 0;
  for (const r of rows) {
    if (r.pnlEur != null && Number.isFinite(r.pnlEur)) s += r.pnlEur;
  }
  return Math.round(s * 100) / 100;
}

export function loadMobileVisitLeaveSnapshot(): MobileVisitBaseline | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileVisitBaseline;
    if (!parsed?.savedAt || typeof parsed.portfolioPnlEur !== "number") return null;
    if (!parsed.tickers || typeof parsed.tickers !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMobileVisitLeaveSnapshot(snap: MobileVisitBaseline): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEAVE_KEY, JSON.stringify(snap));
  } catch {
    /* quota */
  }
}

export function loadMobileVisitSessionBaseline(): MobileVisitBaseline | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileVisitBaseline;
    if (!parsed?.savedAt || !parsed.tickers) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMobileVisitSessionBaseline(snap: MobileVisitBaseline): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch {
    /* quota */
  }
}

/** Leave snapshot written moments ago with MTM ≈ live — Strict Mode / reload poison. */
export function isMobileVisitBaselinePoisoned(
  prior: MobileVisitBaseline,
  live: MobileVisitLiveRow[],
  nowMs = Date.now(),
): boolean {
  const savedMs = Date.parse(prior.savedAt);
  if (!Number.isFinite(savedMs)) return true;
  const ageSec = (nowMs - savedMs) / 1000;
  if (ageSec < 0 || ageSec > 120) return false;
  const livePnl = sumLivePnl(live);
  if (Math.abs(livePnl - prior.portfolioPnlEur) > 8) return false;
  let compared = 0;
  let close = 0;
  for (const r of live) {
    if (r.pnlEur == null || !Number.isFinite(r.pnlEur)) continue;
    const p = prior.tickers[r.key];
    if (!p || !Number.isFinite(p.pnlEur)) continue;
    compared += 1;
    if (Math.abs(r.pnlEur - p.pnlEur) <= 1.5) close += 1;
  }
  return compared >= 2 && close / compared >= 0.85;
}

export function buildMobileVisitBaselineFromLive(
  rows: MobileVisitLiveRow[],
  at = new Date().toISOString(),
): MobileVisitBaseline {
  const tickers: Record<string, MobileVisitTickerSnap> = {};
  for (const r of rows) {
    if (r.pnlEur == null || !Number.isFinite(r.pnlEur)) continue;
    tickers[r.key] = { pnlEur: Math.round(r.pnlEur * 100) / 100 };
  }
  return {
    savedAt: at,
    portfolioPnlEur: sumLivePnl(rows),
    tickers,
  };
}

/**
 * Prefer session freeze; else last-leave snapshot (unless same-session poison).
 * If nothing usable, freeze live MTM now so Δ can move as marks refresh
 * (avoids a permanent €0 from a poisoned desktop snapshot).
 */
export function captureMobileVisitBaseline(
  live: MobileVisitLiveRow[],
): MobileVisitBaseline | null {
  const session = loadMobileVisitSessionBaseline();
  if (session) return session;
  const leave = loadMobileVisitLeaveSnapshot();
  if (leave && !isMobileVisitBaselinePoisoned(leave, live)) {
    saveMobileVisitSessionBaseline(leave);
    return leave;
  }
  if (live.some((r) => r.pnlEur != null && Number.isFinite(r.pnlEur))) {
    const seeded = buildMobileVisitBaselineFromLive(live);
    saveMobileVisitSessionBaseline(seeded);
    return seeded;
  }
  return null;
}

export function deltaPnlEurSinceMobileVisit(
  key: string,
  livePnlEur: number | null | undefined,
  baseline: MobileVisitBaseline | null | undefined,
): number | null {
  if (livePnlEur == null || !Number.isFinite(livePnlEur) || !baseline) return null;
  const prior = baseline.tickers[key];
  if (!prior || !Number.isFinite(prior.pnlEur)) return null;
  return Math.round((livePnlEur - prior.pnlEur) * 100) / 100;
}

export function applyMobileVisitDeltas<T extends MobileVisitLiveRow & { deltaPnlEurSinceVisit?: number | null }>(
  rows: T[],
  baseline: MobileVisitBaseline | null,
): T[] {
  if (!baseline) {
    return rows.map((r) => ({ ...r, deltaPnlEurSinceVisit: null }));
  }
  return rows.map((r) => ({
    ...r,
    deltaPnlEurSinceVisit: deltaPnlEurSinceMobileVisit(r.key, r.pnlEur, baseline),
  }));
}
