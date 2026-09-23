import { describe, expect, it } from "vitest";
import { cycleAlertForKey, resolveCycleDisplayPrimary } from "./catalystPatterns";
import type { CatalystTickerCycleAlert } from "./catalystPatterns";

const dumpAlert = (ticker: string, key: string): CatalystTickerCycleAlert => ({
  ticker,
  row_key: key,
  completion_date: key.split("|")[1] ?? null,
  primary: {
    phase: "dump_entry",
    confidence: "low",
    primary_pattern_id: "dump_entry_capitalation",
    label_en: "Best buy",
    label_it: "Best buy",
    reason_en: "Post-dump",
    reason_it: "Post-dump",
  },
  matches: [],
  live_features: {},
});

describe("cycleAlertForKey", () => {
  it("finds alert by ISO row key", () => {
    const alert = dumpAlert("BDSX", "BDSX|2026-07-31");
    expect(cycleAlertForKey({ "BDSX|2026-07-31": alert }, "BDSX|2026-07-31", "BDSX")).toBe(alert);
  });

  it("falls back to bare ticker key", () => {
    const alert = dumpAlert("VERA", "VERA|2026-08-01");
    expect(cycleAlertForKey({ VERA: alert }, "VERA|2026-08-01", "vera")).toBe(alert);
  });
});

describe("resolveCycleDisplayPrimary", () => {
  it("returns dump_entry primary so KPI can show a cycle without Rec filter", () => {
    const alert = dumpAlert("BDSX", "BDSX|2026-07-31");
    expect(resolveCycleDisplayPrimary(alert)?.phase).toBe("dump_entry");
  });
});
