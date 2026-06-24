import { describe, expect, it, afterEach } from "vitest";
import {
  SDS_HOT_ENTRY_MIN,
  SDS_WATCH_EARLY_MIN,
  SDS_WATCH_LATE_MIN,
  SDS_WATCH_ENTRY_MIN,
  setCachedSdsForTopOpps,
  sdsStrictPickFailures,
  sdsWatchEntryMinForDays,
} from "./sdsTopOppGate";
import { passesStrictTopPick } from "./topOppsStrictPick";
import type { Top2PickSignal } from "./top2PortfolioPick";

const basePick = {
  ticker: "ABC",
  cd: "01/06/2026",
  hasPosition: false,
  days: 30,
  pred5: 2,
  planReturnPct: 3,
  precatKind: "enter",
  stabilityVerdict: "persistent",
  affid: 0.7,
  r2: 0.86,
} as Top2PickSignal;

function sdsMap(sds: number, extra?: Partial<{ veto: string; missing_data_pct: number }>) {
  return new Map([
    [
      "ABC",
      {
        sds,
        veto: extra?.veto ?? null,
        missing_data_pct: extra?.missing_data_pct ?? 10,
      },
    ],
  ]);
}

describe("sdsTopOppGate", () => {
  afterEach(() => {
    setCachedSdsForTopOpps(null);
  });

  it("fail-open when SDS map is empty", () => {
    expect(sdsStrictPickFailures("ABC", "hot", null)).toEqual([]);
    expect(sdsStrictPickFailures("ABC", "hot", new Map())).toEqual([]);
    expect(
      passesStrictTopPick(basePick, { upsideThresholdPct: 1, minScoreReliability: 0 }),
    ).toBe(true);
  });

  it("rejects hot zone when SDS below 55", () => {
    const map = sdsMap(53);
    const fails = sdsStrictPickFailures("ABC", "hot", map);
    expect(fails).toHaveLength(1);
    expect(fails[0].code).toBe("sds_below_hot");
    expect(
      passesStrictTopPick(basePick, {
        upsideThresholdPct: 1,
        minScoreReliability: 0,
        sdsByTicker: map,
      }),
    ).toBe(false);
  });

  it("accepts hot zone at SDS threshold", () => {
    const map = sdsMap(SDS_HOT_ENTRY_MIN);
    expect(sdsStrictPickFailures("ABC", "hot", map)).toEqual([]);
  });

  it("watch zone uses graduated minimum by days to CD", () => {
    const map = sdsMap(26);
    expect(sdsStrictPickFailures("ABC", "watch", map, 82)).toEqual([]);
    expect(sdsStrictPickFailures("ABC", "watch", sdsMap(18), 105)[0].code).toBe("sds_below_watch");
    const passLate = sdsMap(21);
    expect(sdsStrictPickFailures("ABC", "watch", passLate, 110)).toEqual([]);
    expect(sdsWatchEntryMinForDays(82)).toBe(SDS_WATCH_EARLY_MIN);
    expect(sdsWatchEntryMinForDays(110)).toBe(SDS_WATCH_LATE_MIN);
    expect(sdsWatchEntryMinForDays(null)).toBe(SDS_WATCH_ENTRY_MIN);
  });

  it("watch zone legacy threshold at 35 still passes at 90d", () => {
    const map = sdsMap(35);
    expect(sdsStrictPickFailures("ABC", "watch", map, 75)).toEqual([]);
    const low = sdsMap(SDS_WATCH_EARLY_MIN - 1);
    expect(sdsStrictPickFailures("ABC", "watch", low, 75)[0].code).toBe("sds_below_watch");
  });

  it("fail-closed when ticker missing from cohort", () => {
    const map = sdsMap(80);
    const fails = sdsStrictPickFailures("ZZZZ", "hot", map);
    expect(fails[0].code).toBe("sds_unavailable");
  });

  it("blocks on veto and high missing data", () => {
    expect(sdsStrictPickFailures("ABC", "hot", sdsMap(70, { veto: "liquidity" }))[0].code).toBe(
      "sds_veto",
    );
    expect(
      sdsStrictPickFailures("ABC", "hot", sdsMap(70, { missing_data_pct: 45 }))[0].code,
    ).toBe("sds_low_confidence");
  });
});
