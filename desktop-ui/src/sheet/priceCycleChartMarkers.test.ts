import { describe, expect, it } from "vitest";
import type { CatalystTickerCycleAlert } from "../api/catalystPatterns";
import { attachCycleMarkersToPriceSeries } from "./priceCycleChartMarkers";
import type { PriceLinePoint } from "./priceVariationSeries";

const series: PriceLinePoint[] = [
  { key: "2026-03-02", label: "Mar 2", tickerPrice: 10, marketScaled: null },
  { key: "2026-04-01", label: "Apr 1", tickerPrice: 8, marketScaled: null },
  { key: "2026-05-01", label: "May 1", tickerPrice: 12, marketScaled: null },
  { key: "2026-06-01", label: "Jun 1", tickerPrice: 20, marketScaled: null },
];

describe("attachCycleMarkersToPriceSeries", () => {
  it("marks Drop trough, Rise mid-recovery, Catalyst on volume spike", () => {
    const alert: CatalystTickerCycleAlert = {
      ticker: "KZIA",
      row_key: "KZIA|2026-08-30",
      completion_date: "2026-08-30",
      primary: null,
      matches: [],
      live_features: {},
    };

    const rows = attachCycleMarkersToPriceSeries(series, alert, null, {
      volumeBars: [
        { date: "2026-03-02", volume: 200_000 },
        { date: "2026-04-01", volume: 180_000 },
        { date: "2026-05-01", volume: 220_000 },
        { date: "2026-06-01", volume: 1_200_000 },
      ],
      dailyCloses: series.map((p) => ({
        date: p.key.slice(0, 10),
        close: p.tickerPrice,
      })),
      livePrice: 20,
      asOfDate: "2026-06-01",
    });

    expect(rows[1]?.cycleMarker).toBe("dump_entry");
    expect(rows.find((r) => r.cycleMarker === "rise")).toBeTruthy();
    expect(rows[3]?.cycleMarker).toBe("exhaustion_exit");
    expect(rows[3]?.buyPeakTier).toBeGreaterThan(0);
  });

  it("Catalyst only when volume spikes without multi-horizon Buy tier", () => {
    const extended: PriceLinePoint[] = [
      { key: "2026-01-02", label: "Jan", tickerPrice: 14, marketScaled: null },
      { key: "2026-02-02", label: "Feb", tickerPrice: 13, marketScaled: null },
      { key: "2026-03-02", label: "Mar", tickerPrice: 12, marketScaled: null },
      { key: "2026-04-01", label: "Apr", tickerPrice: 11, marketScaled: null },
      { key: "2026-05-01", label: "May", tickerPrice: 10, marketScaled: null },
      { key: "2026-06-01", label: "Jun", tickerPrice: 8, marketScaled: null },
    ];
    const volumeBars = [
      { date: "2026-01-02", volume: 400_000 },
      { date: "2026-02-02", volume: 380_000 },
      { date: "2026-03-02", volume: 390_000 },
      { date: "2026-04-01", volume: 410_000 },
      { date: "2026-05-01", volume: 395_000 },
      { date: "2026-06-01", volume: 2_000_000 },
    ];
    const rows = attachCycleMarkersToPriceSeries(extended, null, null, {
      volumeBars,
      dailyCloses: extended.map((p) => ({ date: p.key.slice(0, 10), close: p.tickerPrice })),
      livePrice: 8,
      asOfDate: "2026-06-01",
    });
    expect(rows.find((r) => r.cycleMarker === "pre_volume_watch")).toBeTruthy();
    expect(rows.every((r) => r.cycleMarker !== "exhaustion_exit")).toBe(true);
  });
});
