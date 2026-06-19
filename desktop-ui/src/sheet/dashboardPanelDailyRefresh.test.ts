import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PANEL_DAILY_MS,
  isDashboardPanelStale,
  latestDashboardPanelIso,
} from "./dashboardPanelDailyRefresh";

describe("dashboardPanelDailyRefresh", () => {
  it("marks missing or old timestamps as stale", () => {
    expect(isDashboardPanelStale(null)).toBe(true);
    const old = new Date(Date.now() - DASHBOARD_PANEL_DAILY_MS - 1000).toISOString();
    expect(isDashboardPanelStale(old)).toBe(true);
    const fresh = new Date().toISOString();
    expect(isDashboardPanelStale(fresh)).toBe(false);
  });

  it("picks the newest ISO candidate", () => {
    const a = "2026-06-10T08:00:00.000Z";
    const b = "2026-06-12T10:00:00.000Z";
    expect(latestDashboardPanelIso(a, b)).toBe(b);
  });
});
