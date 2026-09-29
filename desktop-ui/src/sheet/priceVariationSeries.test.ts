import { describe, expect, it } from "vitest";
import {
  buildIntradayPriceLineSeries,
  buildIntradayVolumeLineSeries,
  cdChartLabelForIso,
  chartFuturePadDays,
  dailyHistoryCoversCutoff,
  detectSixMonthHighBreakout,
  futureChartDayIsos,
  futureChartPadIsos,
  parseCompletionDateIso,
  PRICE_VAR_CHART_RANGE_ORDER,
  priceLineSeriesDelta,
  priceVarRangeLabel,
  rangeToCalendarCutoff,
  rangeToFetchDays,
  resolveCatalystPlotIso,
  collectTickerChartCdIsos,
  cdChartXKey,
  ensureIsoTicksInSeries,
} from "./priceVariationSeries";

describe("buildIntradayPriceLineSeries", () => {
  it("uses last completed session on weekend (no calendar 24h cutoff)", () => {
    const fridayLive = [
      { t: "2026-08-28T09:30:00-04:00", price: 100 },
      { t: "2026-08-28T10:30:00-04:00", price: 101 },
      { t: "2026-08-28T15:30:00-04:00", price: 102 },
    ];
    const thursdayPrior = [
      { t: "2026-08-27T09:30:00-04:00", price: 98 },
      { t: "2026-08-27T15:30:00-04:00", price: 99 },
    ];

    const series = buildIntradayPriceLineSeries({
      tickerPrior: thursdayPrior,
      tickerLive: fridayLive,
      marketPrior: thursdayPrior.map((p) => ({ ...p, price: p.price * 0.5 })),
      marketLive: fridayLive.map((p) => ({ ...p, price: p.price * 0.5 })),
      it: false,
    });

    expect(series.length).toBe(3);
    expect(series[0]?.tickerPrice).toBe(100);
    expect(series[2]?.tickerPrice).toBe(102);
    expect(series[0]?.marketScaled).not.toBeNull();
  });

  it("falls back to prior session when live is empty", () => {
    const prior = [
      { t: "2026-08-27T10:00:00-04:00", price: 50 },
      { t: "2026-08-27T14:00:00-04:00", price: 51 },
    ];
    const series = buildIntradayPriceLineSeries({
      tickerPrior: prior,
      tickerLive: [],
      it: false,
    });
    expect(series.length).toBe(2);
    expect(series[1]?.tickerPrice).toBe(51);
  });
});

describe("buildIntradayVolumeLineSeries", () => {
  it("uses RTH session trading date volume on weekend (not calendar 24h)", () => {
    const fridayLive = [
      { t: "2026-08-28T09:30:00-04:00", price: 100 },
      { t: "2026-08-28T15:30:00-04:00", price: 102 },
    ];
    const series = buildIntradayVolumeLineSeries({
      tickerPrior: [
        { t: "2026-08-27T09:30:00-04:00", price: 98 },
        { t: "2026-08-27T15:30:00-04:00", price: 99 },
      ],
      tickerLive: fridayLive,
      volumeBars: [
        { date: "2026-08-27", volume: 500_000 },
        { date: "2026-08-28", volume: 695_000 },
      ],
      it: false,
    });
    expect(series.length).toBe(2);
    expect(series.every((r) => r.volume === 695_000)).toBe(true);
  });
});

describe("detectSixMonthHighBreakout", () => {
  const nowMs = Date.parse("2026-08-28T16:00:00Z");
  const bars = [
    { date: "2026-03-01", close: 6.5 },
    { date: "2026-07-02", close: 10.89 },
    { date: "2026-08-27", close: 7.95 },
    { date: "2026-08-28", close: 8.01 },
  ];

  it("flags when live price exceeds prior 6M high", () => {
    const hit = detectSixMonthHighBreakout({
      dailyBars: bars,
      livePrice: 10.95,
      asOfDate: "2026-08-28",
      nowMs,
    });
    expect(hit).toEqual({ histMax: 10.89, livePrice: 10.95 });
  });

  it("returns null when live price is at or below prior 6M high", () => {
    expect(
      detectSixMonthHighBreakout({
        dailyBars: bars,
        livePrice: 10.89,
        asOfDate: "2026-08-28",
        nowMs,
      }),
    ).toBeNull();
    expect(
      detectSixMonthHighBreakout({
        dailyBars: bars,
        livePrice: 8.01,
        asOfDate: "2026-08-28",
        nowMs,
      }),
    ).toBeNull();
  });
});

describe("1Y chart range", () => {
  it("includes 1Y after 6M in the horizon pills", () => {
    expect(PRICE_VAR_CHART_RANGE_ORDER).toContain("1Y");
    expect(PRICE_VAR_CHART_RANGE_ORDER.indexOf("1Y")).toBeGreaterThan(
      PRICE_VAR_CHART_RANGE_ORDER.indexOf("6M"),
    );
  });

  it("includes Cal 6M after 1Y in the horizon pills", () => {
    expect(PRICE_VAR_CHART_RANGE_ORDER).toContain("cat6M");
    expect(PRICE_VAR_CHART_RANGE_ORDER.indexOf("cat6M")).toBeGreaterThan(
      PRICE_VAR_CHART_RANGE_ORDER.indexOf("1Y"),
    );
  });

  it("fetches ~1 calendar year of daily bars", () => {
    expect(rangeToFetchDays("1Y")).toBe(370);
    expect(rangeToFetchDays("1Y")).toBeGreaterThan(rangeToFetchDays("6M"));
  });

  it("cuts the visible curve at 365 calendar days", () => {
    const nowMs = Date.parse("2026-09-02T12:00:00Z");
    expect(rangeToCalendarCutoff("1Y", nowMs)).toBe("2025-09-02");
  });

  it("labels 1Y in EN and IT", () => {
    expect(priceVarRangeLabel("1Y", false)).toBe("1Y");
    expect(priceVarRangeLabel("1Y", true)).toBe("1 anno");
  });

  it("priceLineSeriesDelta uses first→last of the visible curve", () => {
    const delta = priceLineSeriesDelta([
      { key: "2025-09-02", label: "2 Sep", tickerPrice: 10, marketScaled: 10 },
      { key: "2026-09-02", label: "2 Sep", tickerPrice: 12.5, marketScaled: 11 },
    ]);
    expect(delta.tickerChange).toBe(25);
    expect(delta.marketChange).toBe(10);
    expect(delta.tickerDeltaUsd).toBe(2.5);
  });

  it("dailyHistoryCoversCutoff requires bars near the requested start", () => {
    const cutoff = "2025-09-02";
    const recentOnly = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    expect(dailyHistoryCoversCutoff(recentOnly, cutoff)).toBe(false);
    const fullYear = Array.from({ length: 40 }, (_, i) => ({
      date: i === 0 ? "2025-09-05" : `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    expect(dailyHistoryCoversCutoff(fullYear, cutoff)).toBe(true);
  });
});

describe("chart future pad + CD", () => {
  it("parses dd/mm/yyyy completion dates", () => {
    expect(parseCompletionDateIso("01/09/2026")).toBe("2026-09-01");
    expect(parseCompletionDateIso("2026-09-08")).toBe("2026-09-08");
  });

  it("adds 7 calendar days after last close", () => {
    expect(futureChartDayIsos("2026-09-02")).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("resolves CD label only when CD falls on the padded range", () => {
    const rows = [
      { key: "2026-09-02", label: "2 Sep" },
      { key: "2026-09-03", label: "3 Sep" },
      { key: "2026-09-09", label: "9 Sep" },
    ];
    expect(cdChartLabelForIso(rows, "2026-09-09", false)).toBe("9 Sep");
    expect(cdChartLabelForIso(rows, "2026-12-01", false)).toBeNull();
  });

  it("snaps weekend CD to the nearest series row so the gold line has an X tick", () => {
    const rows = [
      { key: "2026-07-31", label: "31 Jul" },
      { key: "2026-08-03", label: "3 Aug" },
    ];
    expect(cdChartLabelForIso(rows, "2026-08-01", false)).toBe("31 Jul");
  });

  it("collects Simulation CD and NCT cds, skipping no-match sponsors", () => {
    expect(
      collectTickerChartCdIsos("CHRS", "31/08/2026", [
        { ticker: "CHRS", cd_date: "2026-11-15", sponsor_match: "exact" },
        { ticker: "CHRS", cd_date: "2026-01-01", sponsor_match: "no match" },
        { ticker: "VERA", cd_date: "2026-12-01", sponsor_match: "exact" },
      ]),
    ).toEqual(["2026-08-31", "2026-11-15"]);
  });

  it("always snaps CD to a series key so the gold banner has an X tick", () => {
    const rows = [
      { key: "2026-03-03", label: "3 Mar" },
      { key: "2026-09-03", label: "3 Sep" },
    ];
    expect(cdChartXKey(rows, "2026-08-31")).toBe("2026-09-03");
    expect(cdChartXKey(rows, "2025-01-01")).toBe("2026-03-03");
  });

  it("inserts a weekend CD as its own X tick between trading days", () => {
    const rows = [
      { key: "2026-07-31", label: "31 Jul", tickerPrice: 10 },
      { key: "2026-08-03", label: "3 Aug", tickerPrice: 11 },
    ];
    const next = ensureIsoTicksInSeries(rows, ["2026-08-01"], false);
    expect(next.map((r) => r.key)).toEqual(["2026-07-31", "2026-08-01", "2026-08-03"]);
  });

  it("plots in-range / overlapping / future windows; skips fully-past point CDs", () => {
    const first = "2026-03-03";
    const last = "2027-03-08";
    expect(resolveCatalystPlotIso("2026-08-01", "2026-08-31", first, last)).toBe("2026-08-01");
    expect(resolveCatalystPlotIso("2026-01-01", "2026-12-31", first, last)).toBe("2026-12-31");
    expect(resolveCatalystPlotIso("2026-01-15", "2026-01-20", first, last)).toBeNull();
    expect(resolveCatalystPlotIso("2025-12-01", "2025-12-01", first, last)).toBeNull();
    expect(resolveCatalystPlotIso("2027-06-01", "2027-06-30", first, last)).toBe(last);
  });

  it("catalyst calendar pad is weekly plus event dates", () => {
    expect(chartFuturePadDays("cat6M")).toBe(186);
    expect(priceVarRangeLabel("cat6M", false)).toBe("Cal 6M");
    const pad = futureChartPadIsos("2026-09-02", 186, ["2026-10-15", "2027-09-01"]);
    expect(pad).toContain("2026-09-09");
    expect(pad).toContain("2026-10-15");
    expect(pad).not.toContain("2027-09-01");
    expect(pad.length).toBeLessThan(40);
  });
});
