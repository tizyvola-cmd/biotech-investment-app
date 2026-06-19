const STORAGE_KEY = "supernova_dashboard_visit_snapshot_v1";

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
