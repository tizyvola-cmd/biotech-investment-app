const STORAGE_KEY = "supernova_dashboard_visit_snapshot_v1";
/** Tab-scoped freeze — survives Strict Mode remount; localStorage leave save must not replace it. */
const SESSION_BASELINE_KEY = "supernova_dashboard_visit_baseline_session_v2";

export type DashboardVisitTickerSnap = {
  pnlEur: number;
  pnlPct: number;
  pnlEur24h: number | null;
  price: number | null;
  miiAngle: number | null;
};

export type DashboardVisitSnapshot = {
  savedAt: string;
  portfolioPnlEur: number;
  tickers: Record<string, DashboardVisitTickerSnap>;
};

export function loadDashboardVisitSnapshot(): DashboardVisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardVisitSnapshot;
    if (!parsed?.savedAt || typeof parsed.portfolioPnlEur !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDashboardVisitSnapshot(snapshot: DashboardVisitSnapshot): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearDashboardVisitSnapshot(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function clearDashboardVisitBaselineSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_BASELINE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSessionVisitBaseline(): DashboardVisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardVisitSnapshot;
    if (!parsed?.savedAt || typeof parsed.portfolioPnlEur !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionVisitBaseline(snapshot: DashboardVisitSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_BASELINE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
}

/**
 * Leave snapshot written seconds ago with portfolio MTM ≈ live — typical
 * Strict Mode unmount / alt-tab poison that would zero Δ visit for the remount.
 */
export function visitSnapshotLooksLikeSameSessionPoison(
  prior: DashboardVisitSnapshot,
  livePortfolioPnlEur: number,
  nowMs = Date.now(),
): boolean {
  const savedMs = Date.parse(prior.savedAt);
  if (!Number.isFinite(savedMs)) return true;
  const ageSec = (nowMs - savedMs) / 1000;
  if (ageSec < 0 || ageSec > 120) return false;
  return Math.abs(livePortfolioPnlEur - prior.portfolioPnlEur) <= 8;
}
