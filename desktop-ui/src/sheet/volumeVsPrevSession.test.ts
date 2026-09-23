import { describe, expect, it, beforeEach } from "vitest";
import {
  VOLUME_SURGE_PCT,
  VOLUME_VS_PREV_CLIENT_FRESH_MS,
  coalesceVolumeVsPrevRow,
  fillDeskSessionPriceFromSim,
  formatKpiVolumePlain,
  volumeDeltaLabel,
  formatDeskSessionPriceCell,
  formatDeskVolumeCombo,
  formatDeskVolumeQtyOnly,
  formatVolumePctOfPrev,
  isVolumeSurge,
  lastDailyBarVolumeSurge,
  mergeVolumeVsPrevMaps,
  peekVolumeVsPrevCache,
  rememberVolumeVsPrevRows,
  resetStickyDeskDelta24h,
  resetVolumeVsPrevClientCache,
  resolveDeskDelta24hPct,
  volumePlotCeiling,
  volumeVsPrevTooltip,
} from "./volumeVsPrevSession";

const row = {
  date: "2026-09-01",
  volume: 2_400_000,
  prev_date: "2026-08-31",
  prev_volume: 800_000,
  pct_of_prev: 300,
};

describe("isVolumeSurge", () => {
  it("fires at the threshold, not below it", () => {
    expect(isVolumeSurge(VOLUME_SURGE_PCT)).toBe(true);
    expect(isVolumeSurge(VOLUME_SURGE_PCT - 0.1)).toBe(false);
  });

  it("stays false without data", () => {
    expect(isVolumeSurge(null)).toBe(false);
    expect(isVolumeSurge(Number.NaN)).toBe(false);
  });
});

describe("formatVolumePctOfPrev", () => {
  it("rounds to whole percent and falls back to an em dash", () => {
    expect(formatVolumePctOfPrev(102.6)).toBe("103%");
    expect(formatVolumePctOfPrev(null)).toBe("—");
  });
});

describe("volumeVsPrevTooltip", () => {
  it("names both sessions and flags a surge", () => {
    const tip = volumeVsPrevTooltip(row, false);
    expect(tip).toContain("2026-09-01");
    expect(tip).toContain("2026-08-31");
    expect(tip).toContain("300%");
    expect(tip).toContain("last market close");
    expect(tip).toContain("Significant surge");
  });

  it("does not flag a normal session", () => {
    const tip = volumeVsPrevTooltip({ ...row, pct_of_prev: 90 }, true);
    expect(tip).toContain("90%");
    expect(tip).not.toContain("Incremento significativo");
  });
});

describe("lastDailyBarVolumeSurge", () => {
  const now = new Date("2026-09-02T15:00:00-04:00");

  it("flags a recent last-bar spike vs the previous session", () => {
    const r = lastDailyBarVolumeSurge(
      [
        { date: "2026-08-31", volume: 400_000 },
        { date: "2026-09-01", volume: 7_500_000 },
      ],
      { now },
    );
    expect(r.surge).toBe(true);
    expect(r.date).toBe("2026-09-01");
    expect(r.pctOfPrev).toBeCloseTo(1875);
  });

  it("does not flag a normal last bar", () => {
    const r = lastDailyBarVolumeSurge(
      [
        { date: "2026-08-31", volume: 400_000 },
        { date: "2026-09-01", volume: 420_000 },
      ],
      { now },
    );
    expect(r.surge).toBe(false);
  });

  it("ignores a last-bar relative bump that is tiny vs the window peak", () => {
    const r = lastDailyBarVolumeSurge(
      [
        { date: "2026-05-07", volume: 54_700_000 },
        { date: "2026-08-31", volume: 20_000 },
        { date: "2026-09-01", volume: 46_000 },
      ],
      { now },
    );
    expect(r.surge).toBe(false);
    expect(r.pctOfPrev).toBeCloseTo(230);
  });
});

describe("volumePlotCeiling", () => {
  it("clips a 54.7M outlier so a 46K last bar can use the axis", () => {
    const volumes = [
      ...Array.from({ length: 40 }, () => 40_000),
      54_700_000,
      46_000,
    ];
    const s = volumePlotCeiling(volumes);
    expect(s.clipped).toBe(true);
    expect(s.peak).toBe(54_700_000);
    expect(s.ceiling).toBeLessThan(200_000);
    expect(s.ceiling).toBeGreaterThan(40_000);
  });

  it("keeps the full peak when the series is even", () => {
    const s = volumePlotCeiling([800_000, 1_200_000, 950_000, 1_100_000]);
    expect(s.clipped).toBe(false);
    expect(s.ceiling).toBe(1_200_000);
  });
});

describe("formatKpiVolumePlain", () => {
  it("says volume went with the rise or the drop, not Accum/Distrib", () => {
    expect(volumeDeltaLabel(100, true)).toBe("volume sul rialzo");
    expect(volumeDeltaLabel(-100, true)).toBe("volume sul calo");
    expect(volumeDeltaLabel(100, false)).toBe("volume on the rise");
    expect(volumeDeltaLabel(-100, false)).toBe("volume on the drop");
  });

  it("explains a disagreement without OBV jargon", () => {
    const plain = formatKpiVolumePlain(-50_000, true, true);
    expect(plain?.label).toBe("volume sul calo");
    expect(plain?.extra).toBe("prezzo e volume discordi");
    expect(plain?.tip).toMatch(/sceso/);
    expect(plain?.tip).not.toMatch(/OBV|Distrib|Accum/i);
  });
});

describe("formatDeskVolumeQtyOnly", () => {
  it("shows only quantity delta, not price", () => {
    expect(formatDeskVolumeQtyOnly(127).label).toBe("+27%");
    expect(formatDeskVolumeQtyOnly(127).tone).toBe("up");
    expect(formatDeskVolumeQtyOnly(70).label).toBe("-30%");
    expect(formatDeskVolumeQtyOnly(70).tone).toBe("down");
    expect(formatDeskVolumeQtyOnly(100).label).toBe("=");
    expect(formatDeskVolumeQtyOnly(100).tone).toBe("flat");
  });
});

describe("fillDeskSessionPriceFromSim", () => {
  it("fills prior close from last price and daily % without inventing volume", () => {
    const filled = fillDeskSessionPriceFromSim(row, {
      lastPrice: 10.3,
      dailyChangePct: 3,
    });
    expect(filled?.last_close).toBe(10.3);
    expect(filled?.prev_close).toBeCloseTo(10);
    expect(filled?.pct_of_prev).toBe(300);
  });

  it("keeps Yahoo closes when both are already on the row", () => {
    const filled = fillDeskSessionPriceFromSim(
      { ...row, last_close: 12.4, prev_close: 12.22 },
      { lastPrice: 99, dailyChangePct: 50 },
    );
    expect(filled?.last_close).toBe(12.4);
    expect(filled?.prev_close).toBe(12.22);
  });

  it("builds a price-only row when the vol API missed the ticker", () => {
    const filled = fillDeskSessionPriceFromSim(null, {
      lastPrice: 19.42,
      dailyChangePct: 6.2,
    });
    expect(filled?.last_close).toBe(19.42);
    expect(formatDeskSessionPriceCell(filled)?.closeLabel).toBe("$19.42");
    expect(formatDeskVolumeQtyOnly(filled?.pct_of_prev).label).toBe("—");
  });
});

describe("formatDeskSessionPriceCell", () => {
  it("prints last close in $ and the move vs prior close", () => {
    const cell = formatDeskSessionPriceCell({
      ...row,
      last_close: 12.4,
      prev_close: 12.22,
    });
    expect(cell?.closeLabel).toBe("$12.40");
    expect(cell?.deltaLabel).toContain("+$0.18");
    expect(cell?.deltaLabel).toContain("+1.5%");
    expect(cell?.tone).toBe("up");
  });

  it("marks a down close in red terms", () => {
    const cell = formatDeskSessionPriceCell({
      ...row,
      last_close: 9.5,
      prev_close: 10,
    });
    expect(cell?.closeLabel).toBe("$9.50");
    expect(cell?.deltaLabel).toContain("−$0.50");
    expect(cell?.tone).toBe("down");
  });
});

describe("formatDeskVolumeCombo", () => {
  it("explains high volume on a down day", () => {
    const r = { ...row, pct_of_prev: 127, volume_delta_signed: -1_000_000 };
    expect(formatDeskVolumeCombo(r, true)).toBe(
      "più scambi di ieri, ma il prezzo scende",
    );
    expect(formatDeskVolumeCombo(r, false)).toContain("price is down");
  });

  it("keeps high volume + up day as the same direction", () => {
    const r = { ...row, pct_of_prev: 107, volume_delta_signed: 500_000 };
    expect(formatDeskVolumeCombo(r, true)).toBe(
      "più scambi di ieri, e il prezzo sale",
    );
  });

  it("names a flat quantity day with a down close", () => {
    const r = { ...row, pct_of_prev: 100, volume_delta_signed: -200_000 };
    expect(formatDeskVolumeCombo(r, false)).toBe(
      "same volume as prior day, price is down",
    );
  });
});

describe("volume vs prev client cache", () => {
  beforeEach(() => {
    resetVolumeVsPrevClientCache();
  });

  it("reuses a fresh ticker and marks the rest stale", () => {
    rememberVolumeVsPrevRows({ ZNTL: row }, { now: 1_000 });
    const peeked = peekVolumeVsPrevCache(["ZNTL", "NRIX"], { now: 1_000 + 60_000 });
    expect(peeked.rows.ZNTL?.pct_of_prev).toBe(300);
    expect(peeked.stale).toEqual(["NRIX"]);
  });

  it("keeps a stale row on screen after the fresh TTL", () => {
    rememberVolumeVsPrevRows({ ZNTL: row }, { now: 1_000 });
    const peeked = peekVolumeVsPrevCache(["ZNTL"], {
      now: 1_000 + VOLUME_VS_PREV_CLIENT_FRESH_MS + 1,
    });
    expect(peeked.rows.ZNTL).toBeTruthy();
    expect(peeked.stale).toEqual(["ZNTL"]);
  });
});

describe("resolveDeskDelta24hPct", () => {
  beforeEach(() => {
    resetStickyDeskDelta24h();
  });

  it("prefers sheet daily % over vol last/prev", () => {
    expect(
      resolveDeskDelta24hPct({
        simDailyPct: -4.2,
        priorSessionPct: 1.5,
        volRow: {
          ...row,
          last_close: 11,
          prev_close: 10,
        },
      }),
    ).toBe(-4.2);
  });

  it("falls back to prior session when sheet is blank", () => {
    expect(
      resolveDeskDelta24hPct({
        simDailyPct: null,
        priorSessionPct: 0.9,
        volRow: null,
      }),
    ).toBe(0.9);
  });

  it("weekend: uses last recorded close vs prior trading-day close", () => {
    // Friday close 10.58 vs Thursday close 11.05 → ~-4.25%
    expect(
      resolveDeskDelta24hPct({
        simDailyPct: null,
        priorSessionPct: null,
        volRow: {
          ...row,
          last_close: 10.58,
          prev_close: 11.05,
        },
      }),
    ).toBeCloseTo(-4.25, 1);
  });

  it("stays empty when no sheet, prior, or closes", () => {
    expect(
      resolveDeskDelta24hPct({
        simDailyPct: null,
        priorSessionPct: null,
        volRow: row,
      }),
    ).toBeNull();
  });

  it("keeps last good % when a later refresh blanks sources", () => {
    expect(
      resolveDeskDelta24hPct({
        ticker: "ETON",
        simDailyPct: null,
        priorSessionPct: null,
        volRow: { ...row, last_close: 10, prev_close: 8 },
      }),
    ).toBeCloseTo(25, 0);
    expect(
      resolveDeskDelta24hPct({
        ticker: "ETON",
        simDailyPct: null,
        priorSessionPct: null,
        volRow: row,
      }),
    ).toBeCloseTo(25, 0);
  });
});

describe("coalesceVolumeVsPrevRow / mergeVolumeVsPrevMaps", () => {
  it("keeps closes when live Yahoo omits them", () => {
    const prev = { ...row, last_close: 10.5, prev_close: 11 };
    const next = { ...row, volume: 3_000_000, pct_of_prev: 200 };
    const merged = coalesceVolumeVsPrevRow(prev, next);
    expect(merged.last_close).toBe(10.5);
    expect(merged.prev_close).toBe(11);
    expect(merged.pct_of_prev).toBe(200);
  });

  it("mergeVolumeVsPrevMaps does not wipe closes on incomplete reprint", () => {
    const prev = {
      ETON: { ...row, last_close: 10.5, prev_close: 11 },
    };
    const next = mergeVolumeVsPrevMaps(prev, {
      ETON: { ...row, volume: 9, pct_of_prev: 50 },
    });
    expect(next.ETON?.last_close).toBe(10.5);
    expect(next.ETON?.prev_close).toBe(11);
    expect(next.ETON?.pct_of_prev).toBe(50);
  });
});
