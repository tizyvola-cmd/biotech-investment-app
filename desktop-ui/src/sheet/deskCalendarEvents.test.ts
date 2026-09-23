import { describe, expect, it } from "vitest";
import { nextCongressSlot } from "./conferenceCalendar";
import {
  DESK_CALENDAR_HORIZON_DAYS,
  DESK_POST_CD_RETENTION_DAYS,
  DESK_NEAR_HORIZON_DAYS,
  DESK_G_TRENDS_SPIKE_PCT,
  buildDeskCalendarEvents,
  deskEventObjectLabel,
  deskEventTypeShort,
  isTrendAttention,
  mergeHighTrendDeskEvents,
  deskRowStarPinRank,
  mergePinnedDeskEvents,
  mergeSoftBuyDeskEvents,
  type DeskCalendarTicker,
} from "./deskCalendarEvents";

const TODAY = new Date("2026-09-05T12:00:00");

const NEAR: DeskCalendarTicker = {
  ticker: "ETON",
  cd: "2026-09-12",
  daysToCd: 7,
  drug: "ET-400",
  rowKey: "ETON|2026-09-12",
};

const FAR: DeskCalendarTicker = {
  ticker: "NRIX",
  cd: "2026-12-01",
  daysToCd: 87,
  drug: "ziftomenib",
  indication: "AML",
  rowKey: "NRIX|2026-12-01",
  hasPosition: true,
};

describe("buildDeskCalendarEvents", () => {
  it("keeps a 20-day horizon with a 7-day near band", () => {
    expect(DESK_CALENDAR_HORIZON_DAYS).toBe(20);
    expect(DESK_NEAR_HORIZON_DAYS).toBe(7);
  });

  it("emits one row per dated catalyst inside 20 days", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [NEAR],
      guidanceEvents: [
        {
          ticker: "ETON",
          company: "Eton",
          event_type: "pdufa",
          asset_name: "ET-400",
          window_start: "2026-09-14",
          estimation_method: "explicit_pdufa",
        },
        {
          ticker: "ETON",
          company: "Eton",
          event_type: "readout",
          asset_name: "ET-400",
          window_start: "2026-12-01",
        },
      ],
      today: TODAY,
    });
    const types = rows.map((r) => r.eventType);
    expect(types).toContain("trial_primary_completion");
    expect(types).toContain("pdufa");
    expect(types).not.toContain("readout");
    expect(rows.every((r) => r.daysUntil <= DESK_CALENDAR_HORIZON_DAYS)).toBe(true);
    expect(rows[0]?.eventType).toBe("trial_primary_completion");
  });

  it("collapses same-date CD + readout for the same product into one CD row", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "IRD",
          cd: "2026-09-16",
          daysToCd: 11,
          drug: "OPGx-BEST1",
          rowKey: "IRD|2026-09-16",
        },
      ],
      guidanceEvents: [
        {
          ticker: "IRD",
          company: "Opus Genetics",
          event_type: "readout",
          asset_name: "OPGx-BEST1",
          window_start: "2026-09-16",
        },
      ],
      today: TODAY,
    });
    const ird = rows.filter((r) => r.ticker === "IRD");
    expect(ird).toHaveLength(1);
    expect(ird[0]?.eventType).toBe("trial_primary_completion");
    expect(ird[0]?.product).toMatch(/OPGx-BEST1/i);
  });

  it("collapses CD + abstract + readout on the same date for the same study", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "SKYE",
          cd: "2026-09-16",
          daysToCd: 11,
          drug: "nimacimab",
          rowKey: "SKYE|2026-09-16",
        },
      ],
      guidanceEvents: [
        {
          ticker: "SKYE",
          company: "Skye",
          event_type: "readout",
          asset_name: "nimacimab",
          window_start: "2026-09-16",
        },
        {
          ticker: "SKYE",
          company: "Skye",
          event_type: "conference_abstract",
          asset_name: "nimacimab",
          window_start: "2026-09-16",
          timing_quote: "EASD 2026 abstract",
        },
      ],
      today: TODAY,
    });
    const skye = rows.filter((r) => r.ticker === "SKYE");
    expect(skye).toHaveLength(1);
    expect(skye[0]?.eventType).toBe("trial_primary_completion");
  });

  it("keeps CD + PDUFA on the same date (different catalyst kinds)", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "ETON",
          cd: "2026-09-16",
          daysToCd: 11,
          drug: "ET-400",
          rowKey: "ETON|2026-09-16",
        },
      ],
      guidanceEvents: [
        {
          ticker: "ETON",
          company: "Eton",
          event_type: "pdufa",
          asset_name: "ET-400",
          window_start: "2026-09-16",
          estimation_method: "explicit_pdufa",
        },
      ],
      today: TODAY,
    });
    const eton = rows.filter((r) => r.ticker === "ETON");
    expect(eton.map((r) => r.eventType).sort()).toEqual([
      "pdufa",
      "trial_primary_completion",
    ]);
  });

  it("keeps two products on the same ticker/date as separate catalysts", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "MULTI",
          cd: "2026-09-16",
          daysToCd: 11,
          drug: "Drug-A",
          rowKey: "MULTI|2026-09-16",
        },
      ],
      guidanceEvents: [
        {
          ticker: "MULTI",
          company: "MultiCo",
          event_type: "readout",
          asset_name: "Drug-B",
          window_start: "2026-09-16",
        },
      ],
      today: TODAY,
    });
    const multi = rows.filter((r) => r.ticker === "MULTI");
    expect(multi).toHaveLength(2);
  });

  it("collapses bare CD + readout when both lack a product name", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "MTVA",
          cd: "2026-09-16",
          daysToCd: 11,
          rowKey: "MTVA|2026-09-16",
        },
      ],
      guidanceEvents: [
        {
          ticker: "MTVA",
          company: "MetaVia",
          event_type: "readout",
          window_start: "2026-09-16",
        },
      ],
      today: TODAY,
    });
    const mtva = rows.filter((r) => r.ticker === "MTVA");
    expect(mtva).toHaveLength(1);
    expect(mtva[0]?.eventType).toBe("trial_primary_completion");
  });

  it("keeps a mid-horizon catalyst inside 20 days (~15d)", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "MID",
          cd: "2026-09-20",
          daysToCd: 15,
          drug: "mid-asset",
          rowKey: "MID|2026-09-20",
        },
      ],
      today: TODAY,
    });
    expect(rows.some((r) => r.ticker === "MID" && r.daysUntil === 15)).toBe(true);
  });

  it("drops a catalyst beyond the 20-day horizon (~25d)", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "FARISH",
          cd: "2026-09-30",
          daysToCd: 25,
          drug: "far-asset",
          rowKey: "FARISH|2026-09-30",
        },
      ],
      today: TODAY,
    });
    expect(rows.some((r) => r.ticker === "FARISH")).toBe(false);
  });

  it("keeps clinicaltrials.gov CD rows on their window date (not congress re-route)", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [],
      guidanceEvents: [
        {
          ticker: "CRDL",
          company: "Cardiol",
          event_type: "cd",
          timing_quote: "Primary completion 2026-09-21 — possible ASH mention",
          window_start: "2026-09-21",
          window_end: "2026-09-21",
          source_type: "clinicaltrials.gov",
        },
      ],
      today: TODAY,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe("cd");
    expect(rows[0]?.daysUntil).toBe(16); // Sep 5 → Sep 21
  });

  it("includes FDA AdCom rows even when the ticker is not on the Simulation sheet", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [],
      guidanceEvents: [
        {
          ticker: "GRAL",
          company: "GRAIL, Inc.",
          event_type: "fda_vote",
          asset_name: "Galleri",
          window_start: "2026-09-12",
          source_type: "fda_adcom",
        },
      ],
      today: TODAY,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ticker).toBe("GRAL");
    expect(rows[0]?.typeLabel).toMatch(/FDA/i);
  });

  it("keeps completed CDs for 7 days then drops older past events", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        { ticker: "JSPRW", cd: "2026-09-12", daysToCd: 7, rowKey: "JSPRW|2026-09-12" },
        { ticker: "OLD", cd: "2026-08-01", daysToCd: -35, rowKey: "OLD|2026-08-01" },
        {
          ticker: "DONE",
          cd: "2026-09-03",
          daysToCd: -2,
          rowKey: "DONE|2026-09-03",
        },
        FAR,
        NEAR,
      ],
      today: TODAY,
    });
    expect(rows.some((r) => r.ticker === "DONE" && r.daysUntil === -2)).toBe(true);
    expect(rows.some((r) => r.ticker === "OLD")).toBe(false);
    expect(rows.every((r) => r.daysUntil >= -DESK_POST_CD_RETENTION_DAYS)).toBe(true);
    expect(rows.every((r) => r.daysUntil <= DESK_CALENDAR_HORIZON_DAYS)).toBe(true);
  });

  it("drops ESMO ~37 days out and SABCS beyond 20-day horizon", () => {
    expect(nextCongressSlot("Potential ESMO 2026 presentation", "2026-09-05")?.id).toBe(
      "esmo-2026-abs",
    );
    const esmoRows = buildDeskCalendarEvents({
      tickers: [FAR],
      hypotheses: [
        {
          id: "h1",
          ticker: "NRIX",
          title: "Potential ESMO 2026 presentation",
          venue: "ESMO",
          source_type: "congress",
          drug: "ziftomenib",
          status: "pending",
        },
      ],
      today: TODAY,
    });
    expect(esmoRows.filter((r) => r.eventType === "conference_abstract")).toHaveLength(0);

    const sabcsRows = buildDeskCalendarEvents({
      tickers: [FAR],
      hypotheses: [
        {
          id: "h2",
          ticker: "NRIX",
          title: "Potential SABCS 2026 presentation",
          venue: "SABCS",
          source_type: "congress",
          drug: "ziftomenib",
          status: "pending",
        },
      ],
      today: TODAY,
    });
    expect(sabcsRows.filter((r) => r.eventType === "conference_abstract")).toHaveLength(0);
  });

  it("keeps a dated clinical congress inside 30 days", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [NEAR],
      clinicalRecords: [
        {
          ticker: "ETON",
          clinical_events: [
            {
              event_title: "IDWeek 2026 oral",
              source_type: "congress",
              drug: "ET-400",
              expected_window_start: "2026-09-14",
              link: "https://www.idsociety.org/",
              link_label: "IDWeek",
            },
          ],
        },
      ],
      today: TODAY,
    });
    const congress = rows.filter((r) => r.eventType === "conference_abstract");
    const hit = congress.find((r) => r.eventDate === "2026-09-14");
    expect(hit?.eventTitle).toMatch(/IDWeek|ET-400/);
    expect(hit?.referenceHref).toContain("idsociety");
  });

  it("does not attach a congress to a ticker with no mention", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    expect(rows.some((r) => r.eventType === "conference_abstract")).toBe(false);
  });

  it("dedups Simulation CD vs guidance CD on the same date", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [NEAR],
      guidanceEvents: [
        {
          ticker: "ETON",
          company: "Eton",
          event_type: "cd",
          window_start: "2026-09-12",
        },
      ],
      today: TODAY,
    });
    const cds = rows.filter(
      (r) => r.eventType === "trial_primary_completion" || r.eventType === "cd",
    );
    expect(cds.length).toBeLessThanOrEqual(2);
    expect(rows.filter((r) => r.eventDate === "2026-09-12").length).toBeGreaterThanOrEqual(1);
  });
});

describe("isTrendAttention", () => {
  it("flags spike or z ≥ 1.5", () => {
    expect(isTrendAttention(0.4, true)).toBe(true);
    expect(isTrendAttention(1.6, false)).toBe(true);
    expect(isTrendAttention(0.8, false)).toBe(false);
    expect(isTrendAttention(null, false)).toBe(false);
  });
});

describe("deskEventTypeShort", () => {
  it("maps FDA vote and PDUFA to short chips with object subtitle", () => {
    expect(
      deskEventTypeShort(
        {
          eventType: "other",
          typeLabel: "FDA vote",
          sourceKind: "fda_vote",
          eventName: "Drug X AdCom",
          eventTitle: "Drug X",
        },
        false,
      ),
    ).toBe("AdCom");
    expect(
      deskEventTypeShort(
        {
          eventType: "pdufa",
          typeLabel: "PDUFA",
          eventName: "ET-400 · PDUFA",
          eventTitle: "ET-400",
        },
        false,
      ),
    ).toBe("PDUFA");
    expect(
      deskEventObjectLabel(
        { eventTitle: "ET-400", eventName: "ET-400 · PDUFA", typeLabel: "PDUFA" },
        "PDUFA",
      ),
    ).toBe("ET-400");
    expect(
      deskEventTypeShort(
        {
          eventType: "conference_abstract",
          typeLabel: "ASCO abstract",
          congressName: "ASCO",
          eventName: "Phase 2 poster",
          eventTitle: "Drug Y",
        },
        false,
      ),
    ).toBe("ASCO");
    expect(
      deskEventTypeShort(
        {
          eventType: "trial_primary_completion",
          typeLabel: "CD",
          sourceKind: "soft_buy",
          eventName: "CD · ziftomenib · 2026-12-01",
          eventTitle: "ziftomenib",
        },
        false,
      ),
    ).toBe("CD");
    expect(
      deskEventTypeShort(
        {
          eventType: "trial_primary_completion",
          typeLabel: "CD",
          eventName:
            "A Study of the Safety and Efficacy of Compound Z in Adults",
          eventTitle: "A Study of the Safety",
        },
        false,
      ),
    ).toBe("CD");
  });

  it("labels a licensing deal as Partnership", () => {
    expect(
      deskEventTypeShort(
        {
          eventType: "partnership",
          typeLabel: "",
          sourceKind: "partnership",
          eventName: "Novartis Pharma AG · closing expected",
          eventTitle: "Novartis Pharma AG",
        },
        false,
      ),
    ).toBe("Partnership");
  });

  it("does not put a study title into product when drug is missing", () => {
    const rows = buildDeskCalendarEvents({
      tickers: [
        {
          ticker: "XXXX",
          cd: "2026-09-20",
          daysToCd: 15,
          study: "A Study of the Safety and Efficacy of Compound Z",
          rowKey: "XXXX|2026-09-20",
        },
      ],
      today: TODAY,
      it: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.product).toBeFalsy();
    expect(rows[0]?.studyTitle).toMatch(/Study of the Safety/i);
    expect(deskEventTypeShort(rows[0]!, false)).toBe("CD");
  });
});

describe("mergeSoftBuyDeskEvents", () => {
  it("adds Soft BUY tickers missing from the calendar and pins them first", () => {
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    const merged = mergeSoftBuyDeskEvents(
      catalyst,
      [
        { key: "NRIX|2026-12-01", ticker: "NRIX" },
        { key: "ETON|2026-09-12", ticker: "ETON" },
      ],
      [NEAR, FAR],
      { today: TODAY },
    );
    expect(merged[0]?.ticker).toBe("NRIX");
    expect(merged[0]?.source).toBe("soft_buy");
    expect(deskEventTypeShort(merged[0]!, false)).toBe("CD");
    expect(merged[0]?.daysUntil).toBe(87);
    expect(merged[0]?.eventDate).toBe("2026-12-01");
    expect(merged.some((r) => r.ticker === "ETON" && r.source !== "soft_buy")).toBe(true);
    expect(merged.filter((r) => r.ticker === "ETON")).toHaveLength(
      catalyst.filter((r) => r.ticker === "ETON").length,
    );
  });

  it("sorts existing Soft BUY catalyst rows ahead of non-BUY names", () => {
    const other: DeskCalendarTicker = {
      ticker: "AAAA",
      cd: "2026-09-08",
      daysToCd: 3,
      rowKey: "AAAA|2026-09-08",
    };
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR, other],
      today: TODAY,
    });
    const merged = mergeSoftBuyDeskEvents(
      catalyst,
      [{ key: "ETON|2026-09-12", ticker: "ETON" }],
      [NEAR, other],
      { today: TODAY },
    );
    const etonIdx = merged.findIndex((r) => r.ticker === "ETON");
    const otherIdx = merged.findIndex((r) => r.ticker === "AAAA");
    expect(etonIdx).toBeGreaterThanOrEqual(0);
    expect(otherIdx).toBeGreaterThanOrEqual(0);
    expect(etonIdx).toBeLessThan(otherIdx);
  });
});

describe("mergeHighTrendDeskEvents", () => {
  it("adds Simulation tickers with G-Trends spike above threshold as CD rows", () => {
    expect(DESK_G_TRENDS_SPIKE_PCT).toBe(80);
    const hot: DeskCalendarTicker = {
      ticker: "HOTT",
      cd: "2026-11-01",
      daysToCd: 57,
      drug: "hot-asset",
      rowKey: "HOTT|2026-11-01",
    };
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    const withSoft = mergeSoftBuyDeskEvents(
      catalyst,
      [{ key: "NRIX|2026-12-01", ticker: "NRIX" }],
      [NEAR, FAR, hot],
      { today: TODAY },
    );
    const merged = mergeHighTrendDeskEvents(withSoft, ["HOTT", "ZZZZ"], [NEAR, FAR, hot], {
      today: TODAY,
    });
    expect(merged[0]?.ticker).toBe("NRIX");
    expect(merged[0]?.source).toBe("soft_buy");
    const spike = merged.find((r) => r.source === "g_trends");
    expect(spike?.ticker).toBe("HOTT");
    expect(deskEventTypeShort(spike!, false)).toBe("CD");
    expect(spike?.daysUntil).toBe(57);
    expect(merged.some((r) => r.ticker === "ZZZZ")).toBe(false);
    expect(merged.findIndex((r) => r.source === "g_trends")).toBeGreaterThan(0);
  });

  it("does not duplicate tickers already on the desk", () => {
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    const merged = mergeHighTrendDeskEvents(catalyst, ["ETON"], [NEAR], { today: TODAY });
    expect(merged.filter((r) => r.ticker === "ETON")).toHaveLength(1);
    expect(merged.some((r) => r.source === "g_trends")).toBe(false);
  });
});

describe("mergePinnedDeskEvents", () => {
  it("adds interest tickers without a CD as Watch rows", () => {
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    const merged = mergePinnedDeskEvents(catalyst, ["REGN"], [NEAR], { today: TODAY });
    const pin = merged.find((r) => r.ticker === "REGN");
    expect(pin).toBeTruthy();
    expect(pin?.source).toBe("interest");
    expect(deskEventTypeShort(pin!, false)).toBe("Watch");
    expect(pin?.daysUntil).toBe(-1);
  });

  it("does not duplicate tickers already on the desk", () => {
    const catalyst = buildDeskCalendarEvents({
      tickers: [NEAR],
      today: TODAY,
    });
    const merged = mergePinnedDeskEvents(catalyst, ["ETON"], [NEAR], { today: TODAY });
    expect(merged.filter((r) => r.ticker === "ETON")).toHaveLength(1);
    expect(merged.some((r) => r.source === "interest")).toBe(false);
  });
});

describe("deskRowStarPinRank", () => {
  it("puts red and yellow stars above momentum and the rest", () => {
    expect(deskRowStarPinRank({ enrolled: true })).toBe(0);
    expect(deskRowStarPinRank({ starred: true })).toBe(1);
    expect(deskRowStarPinRank({ enrolled: true, starred: true })).toBe(0);
    expect(deskRowStarPinRank({ momentumUp: true })).toBe(2);
    expect(deskRowStarPinRank({ starred: true, momentumUp: true })).toBe(1);
    expect(deskRowStarPinRank({})).toBe(3);
  });

  it("sorts a mixed list with all stars first", () => {
    const rows = [
      { ticker: "AAA", pin: deskRowStarPinRank({}) },
      { ticker: "BBB", pin: deskRowStarPinRank({ momentumUp: true }) },
      { ticker: "CCC", pin: deskRowStarPinRank({ starred: true }) },
      { ticker: "DDD", pin: deskRowStarPinRank({ enrolled: true }) },
    ];
    rows.sort((a, b) => a.pin - b.pin);
    expect(rows.map((r) => r.ticker)).toEqual(["DDD", "CCC", "BBB", "AAA"]);
  });
});
