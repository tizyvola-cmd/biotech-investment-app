import { describe, expect, it } from "vitest";
import {
  fdaRowsFromMorningBrief,
  hourlyDeskCacheHasData,
  isHourlyDeskCacheUsable,
  isMorningAccumulationUsable,
  isMorningDeskCacheFreshForToday,
  mergeCatalystDeskCachePayload,
  mergeTickerMaps,
  mergeTickerMapsPreferSignal,
  assignTickerMapsPreserving,
  DESK_SIGNAL_KEYS,
  coalesceDeskTickerRow,
} from "./catalystDeskColumnCache";
import { deskProvenanceOf, stampDeskRowProvenance } from "./deskFieldProvenance";

describe("catalystDeskColumnCache", () => {
  it("builds FDA rows from morning brief map", () => {
    const rows = fdaRowsFromMorningBrief({
      ETON: {
        ticker: "ETON",
        date: "2026-09-20",
        company: "Eton",
        product: "ET-400",
        eventEn: "AdCom",
        eventIt: "AdCom",
        href: "https://fda.gov",
        briefing: { status: "ready", score: 1.2 },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ticker).toBe("ETON");
    expect(rows[0]?.briefing?.status).toBe("ready");
  });

  it("treats same Rome day as fresh morning cache", () => {
    expect(
      isMorningDeskCacheFreshForToday(
        { rome_date: "2026-09-11", updated_at: "2026-09-11T05:10:00+02:00" },
        "2026-09-11",
        new Date("2026-09-11T12:00:00+02:00"),
      ),
    ).toBe(true);
    expect(
      isMorningDeskCacheFreshForToday(
        { rome_date: "2026-09-10", updated_at: "2026-09-10T05:10:00+02:00" },
        "2026-09-11",
        new Date("2026-09-11T12:00:00+02:00"),
      ),
    ).toBe(false);
  });

  it("keeps Friday morning pack through the weekend for G-Trends", () => {
    // Saturday Rome — Friday morning cache still usable
    expect(
      isMorningDeskCacheFreshForToday(
        { rome_date: "2026-09-18", updated_at: "2026-09-18T05:10:00+02:00" },
        "2026-09-19",
        new Date("2026-09-19T14:00:00+02:00"),
      ),
    ).toBe(true);
    // Sunday still OK within 72h
    expect(
      isMorningDeskCacheFreshForToday(
        { rome_date: "2026-09-18", updated_at: "2026-09-18T05:10:00+02:00" },
        "2026-09-20",
        new Date("2026-09-20T12:00:00+02:00"),
      ),
    ).toBe(true);
  });

  it("merges ticker maps without dropping prior keys", () => {
    expect(mergeTickerMaps({ A: 1, B: 2 }, { B: 9, C: 3 })).toEqual({
      A: 1,
      B: 9,
      C: 3,
    });
  });

  it("prefer-signal merge keeps warm cells when live reprint is empty", () => {
    const prev = {
      ETON: { ticker: "ETON", relative_move: 0.036, stock_return: 0.05 },
    };
    const next = mergeTickerMapsPreferSignal(
      prev,
      { ETON: { ticker: "ETON", relative_move: null, stock_return: null, status: "empty" } },
      DESK_SIGNAL_KEYS.vsXbi,
    );
    expect(next.ETON?.relative_move).toBe(0.036);
    expect(next.ETON?.stock_return).toBe(0.05);
  });

  it("does not plant empty Yahoo shells for tickers absent from the pack", () => {
    const prev: Record<string, { ticker: string; relative_move: number | null }> = {
      ETON: { ticker: "ETON", relative_move: 0.01 },
    };
    const next = mergeTickerMapsPreferSignal(
      prev,
      {
        ENTA: { ticker: "ENTA", relative_move: null },
        EWTX: { ticker: "EWTX", relative_move: null, stock_return: null },
      },
      DESK_SIGNAL_KEYS.vsXbi,
    );
    expect(next.ETON?.relative_move).toBe(0.01);
    expect(next.ENTA).toBeUndefined();
    expect(next.EWTX).toBeUndefined();
  });

  it("rejects dash/NaN strings as signal and restores from prior", () => {
    const prev = {
      HAE: { ticker: "HAE", ivr: 1.2, em_straddle: 0.1 },
    };
    const next = mergeTickerMapsPreferSignal(
      prev,
      { HAE: { ticker: "HAE", ivr: "—", em_straddle: "nan" } as never },
      DESK_SIGNAL_KEYS.eventVol,
    );
    expect(next.HAE?.ivr).toBe(1.2);
    expect(next.HAE?.em_straddle).toBe(0.1);
  });

  it("prefer-signal merge fills null fields from prior when both have signal", () => {
    const prev = {
      ETON: { ticker: "ETON", ivr: 0.4, em_straddle: 0.12, rr10: -0.05 },
    };
    const next = mergeTickerMapsPreferSignal(
      prev,
      { ETON: { ticker: "ETON", ivr: 0.5, em_straddle: null, rr10: null } },
      DESK_SIGNAL_KEYS.eventVol,
    );
    expect(next.ETON?.ivr).toBe(0.5);
    expect(next.ETON?.em_straddle).toBe(0.12);
    expect(next.ETON?.rr10).toBe(-0.05);
  });

  it("marks hourly cache usable only when fresh and non-empty", () => {
    const now = Date.parse("2026-09-11T15:00:00Z");
    expect(
      isHourlyDeskCacheUsable(
        {
          updated_at: "2026-09-11T14:30:00Z",
          vol: { ETON: { ticker: "ETON" } as never },
        },
        now,
      ),
    ).toBe(true);
    expect(
      isHourlyDeskCacheUsable(
        { updated_at: "2026-09-11T14:30:00Z", vol: {} },
        now,
      ),
    ).toBe(false);
    expect(
      isHourlyDeskCacheUsable(
        {
          updated_at: "2026-09-11T12:00:00Z",
          vol: { ETON: { ticker: "ETON" } as never },
        },
        now,
      ),
    ).toBe(false);
    expect(
      isHourlyDeskCacheUsable(
        {
          updated_at: "2026-09-11T12:00:00Z",
          rome_date: "2026-09-11",
          vol: { ETON: { ticker: "ETON" } as never },
        },
        now,
        { sameRomeDayOk: true, nowRomeDay: "2026-09-11" },
      ),
    ).toBe(true);
    expect(
      isHourlyDeskCacheUsable(
        { vol: { ETON: { ticker: "ETON" } as never } },
        now,
        { sameRomeDayOk: true },
      ),
    ).toBe(true);
  });

  it("keeps Friday hourly pack through the weekend (vol / vs XBI)", () => {
    const sunday = Date.parse("2026-09-20T12:00:00+02:00");
    expect(
      isHourlyDeskCacheUsable(
        {
          updated_at: "2026-09-18T19:31:53.771549+00:00",
          rome_date: "2026-09-18",
          vol: { DXCM: { ticker: "DXCM" } as never },
          vs_xbi: { DXCM: { ticker: "DXCM" } as never },
        },
        sunday,
        { sameRomeDayOk: true, weekendCarryOk: true },
      ),
    ).toBe(true);
    // Without weekend carry, Friday→Sunday (~40h) is too old for the 18h same-day window
    expect(
      isHourlyDeskCacheUsable(
        {
          updated_at: "2026-09-18T19:31:53.771549+00:00",
          rome_date: "2026-09-18",
          vol: { DXCM: { ticker: "DXCM" } as never },
        },
        sunday,
        { sameRomeDayOk: true, weekendCarryOk: false },
      ),
    ).toBe(false);
  });

  it("does not let empty server hourly wipe a warm local peek", () => {
    const merged = mergeCatalystDeskCachePayload(
      {
        hourly: {
          updated_at: "2026-09-11T14:00:00Z",
          vol: { ETON: { ticker: "ETON" } as never },
        },
      },
      {
        hourly: { updated_at: null, vol: {}, pre_mkt: {} },
        morning: { updated_at: null, accumulation: {} },
      },
    );
    expect(hourlyDeskCacheHasData(merged.hourly)).toBe(true);
    expect(merged.hourly?.vol?.ETON).toBeTruthy();
  });

  it("deep-merges hourly maps so sparse server vs_xbi cannot wipe Friday", () => {
    const merged = mergeCatalystDeskCachePayload(
      {
        hourly: {
          updated_at: "2026-09-18T20:00:00Z",
          rome_date: "2026-09-18",
          vol: {
            ETON: {
              date: "2026-09-18",
              volume: 1,
              prev_date: "x",
              prev_volume: 1,
              pct_of_prev: 100,
              last_close: 10,
              prev_close: 9,
            },
          },
          vs_xbi: {
            ETON: { ticker: "ETON", relative_move: 0.036, stock_return: 0.05 },
          },
          event_vol: {
            "ETON|2026-10-01": { ticker: "ETON", ivr: 0.4, rr10: -0.02 },
          },
        },
      },
      {
        hourly: {
          updated_at: "2026-09-20T12:00:00Z",
          rome_date: "2026-09-20",
          vol: {
            ETON: {
              date: "2026-09-18",
              volume: 2,
              prev_date: "x",
              prev_volume: 1,
              pct_of_prev: 200,
            },
          },
          vs_xbi: {
            ETON: { ticker: "ETON", relative_move: null, stock_return: null },
          },
          event_vol: {
            "ETON|2026-10-01": { ticker: "ETON", ivr: null, rr10: null },
          },
        },
      },
    );
    expect(merged.hourly?.vol?.ETON?.last_close).toBe(10);
    expect(merged.hourly?.vol?.ETON?.pct_of_prev).toBe(200);
    expect(merged.hourly?.vs_xbi?.ETON?.relative_move).toBe(0.036);
    expect(merged.hourly?.event_vol?.["ETON|2026-10-01"]?.ivr).toBe(0.4);
  });

  it("uses morning accumulation when today and ticker present", () => {
    // Pin to same Rome day as freshness check (defaults to wall-clock today).
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(
      isMorningAccumulationUsable(
        {
          rome_date: today,
          accumulation: { ETON: { ticker: "ETON" } as never },
        },
        ["ETON", "MRNA"],
      ),
    ).toBe(true);
    expect(
      isMorningAccumulationUsable(
        {
          rome_date: today,
          accumulation: { MRNA: { ticker: "MRNA" } as never },
        },
        ["ETON"],
      ),
    ).toBe(false);
  });

  it("mergeTickerMaps preserves map + entry identity when values are unchanged", () => {
    const eton = { ticker: "ETON", pct: 12 };
    const prev = { ETON: eton };
    const same = mergeTickerMaps(prev, { ETON: { ticker: "ETON", pct: 12 } });
    expect(same).toBe(prev);
    expect(same.ETON).toBe(eton);

    const mrna = { ticker: "MRNA", pct: 5 };
    const next = mergeTickerMaps(prev, { MRNA: mrna });
    expect(next).not.toBe(prev);
    expect(next.ETON).toBe(eton);
    expect(next.MRNA).toBe(mrna);
  });

  it("assignTickerMapsPreserving keeps unchanged ticker object refs", () => {
    const eton = { ticker: "ETON", pct: 12 };
    const mrna = { ticker: "MRNA", pct: 5 };
    const prev = { ETON: eton, MRNA: mrna };
    const assigned = assignTickerMapsPreserving(prev, {
      ETON: { ticker: "ETON", pct: 12 },
      MRNA: { ticker: "MRNA", pct: 9 },
    });
    expect(assigned).not.toBe(prev);
    expect(assigned.ETON).toBe(eton);
    expect(assigned.MRNA).not.toBe(mrna);
    expect(assigned.MRNA?.pct).toBe(9);
  });
});

describe("coalesceDeskTickerRow provenance", () => {
  it("keeps the asof/source of the print when re-storing or merging a row", () => {
    const next = stampDeskRowProvenance(
      { ticker: "TPOS", pct_of_prev: 1.4, hour_chg_pct: -0.8 },
      "server_hourly",
      {
        asof: "2026-09-28T20:00:00.000Z",
        sessionDay: "2026-09-28",
        signalKeys: ["pct_of_prev", "hour_chg_pct"],
      },
    );
    const fresh = coalesceDeskTickerRow({ ticker: "TPOS" }, next, DESK_SIGNAL_KEYS.vol, "merge");
    expect(deskProvenanceOf(fresh)?.asof).toBe("2026-09-28T20:00:00.000Z");
    expect(deskProvenanceOf(fresh)?.source).toBe("server_hourly");

    const merged = coalesceDeskTickerRow(
      { ticker: "TPOS", pct_of_prev: 1.1, hour_chg_pct: -0.2 },
      next,
      DESK_SIGNAL_KEYS.vol,
      "merge",
    );
    expect(deskProvenanceOf(merged)?.asof).toBe("2026-09-28T20:00:00.000Z");
    expect(deskProvenanceOf(merged)?.session_day).toBe("2026-09-28");
  });
});
