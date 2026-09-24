import { describe, expect, it } from "vitest";
import {
  coalesceDeskProvenance,
  deskRowIsStaleCarry,
  deskStaleSessionBadge,
  eventVolEmptyLabel,
  resolveEventVolEmptyReason,
  stampDeskRowProvenance,
} from "./deskFieldProvenance";

describe("stampDeskRowProvenance", () => {
  it("attaches _desk with per-field stamps for present signals", () => {
    const stamped = stampDeskRowProvenance(
      { ticker: "ETON", ivr: 1.2, rr10: null },
      "server_hourly",
      {
        asof: "2026-09-18T20:00:00.000Z",
        sessionDay: "2026-09-18",
        signalKeys: ["ivr", "rr10", "em_straddle"],
      },
    );
    expect(stamped._desk?.source).toBe("server_hourly");
    expect(stamped._desk?.session_day).toBe("2026-09-18");
    expect(stamped._desk?.fields?.ivr?.asof).toBe("2026-09-18T20:00:00.000Z");
    expect(stamped._desk?.fields?.rr10).toBeUndefined();
  });
});

describe("coalesceDeskProvenance", () => {
  it("keeps prior _desk when next has no signal", () => {
    const prev = stampDeskRowProvenance(
      { ticker: "ENTA", ivr: 1.1 },
      "server_hourly",
      { sessionDay: "2026-09-18", signalKeys: ["ivr"] },
    );
    const next = { ticker: "ENTA", ivr: null as number | null, empty_reason: "no_options" };
    const merged = coalesceDeskProvenance(prev, next, false);
    expect(merged._desk?.session_day).toBe("2026-09-18");
    expect(merged._desk?.source).toBe("server_hourly");
  });
});

describe("resolveEventVolEmptyReason", () => {
  it("distinguishes loading / not_loaded / no_options", () => {
    expect(resolveEventVolEmptyReason(null, true)).toBe("loading");
    expect(resolveEventVolEmptyReason(null, false)).toBe("not_loaded");
    expect(
      resolveEventVolEmptyReason({ ticker: "FOO", empty_reason: "no_options" }, false),
    ).toBe("no_options");
    expect(
      resolveEventVolEmptyReason({ ticker: "FOO", empty_reason: "not_loaded" }, false),
    ).toBe("not_loaded");
    expect(eventVolEmptyLabel("no_options", true)).toBe("no opt");
    expect(eventVolEmptyLabel("not_loaded", true)).toBe("n/d");
  });
});

describe("deskStaleSessionBadge", () => {
  it("shows weekday badge when session_day is a prior Friday and markets are closed", () => {
    // Sunday 2026-09-20 Rome-ish — last session Friday 2026-09-18
    const sunday = new Date("2026-09-20T15:00:00Z");
    const row = stampDeskRowProvenance(
      { ticker: "XBI", last_close: 100, prev_close: 99 },
      "server_hourly",
      {
        asof: "2026-09-18T20:00:00.000Z",
        sessionDay: "2026-09-18",
        signalKeys: ["last_close", "prev_close"],
      },
    );
    expect(deskRowIsStaleCarry(row, sunday)).toBe(true);
    expect(deskStaleSessionBadge(row, true, sunday)).toBe("ven");
    expect(deskStaleSessionBadge(row, false, sunday)).toBe("Fri");
  });

  it("labels a pre-market print with the last traded session, not today", () => {
    // Thursday 2026-09-24, 08:00 ET — bell has not rung, last print is Wednesday
    const preMarket = new Date("2026-09-24T12:00:00Z");
    const row = stampDeskRowProvenance(
      { ticker: "ADCT", ivr: 1.4, asof: "2026-09-23" },
      "server_hourly",
      { signalKeys: ["ivr"] },
    );
    expect(row._desk?.session_day).toBe("2026-09-23");
    expect(deskRowIsStaleCarry(row, preMarket)).toBe(true);
    expect(deskStaleSessionBadge(row, false, preMarket)).toBe("Wed");
    expect(deskStaleSessionBadge(row, true, preMarket)).toBe("mer");
  });

  it("keeps a live intraday print ungreyed", () => {
    // Thursday 2026-09-24, 11:00 ET — regular hours
    const intraday = new Date("2026-09-24T15:00:00Z");
    const row = stampDeskRowProvenance(
      { ticker: "ADCT", ivr: 1.4, asof: "2026-09-24T14:55:00Z" },
      "server_hourly",
      { signalKeys: ["ivr"] },
    );
    expect(row._desk?.session_day).toBe("2026-09-24");
    expect(deskRowIsStaleCarry(row, intraday)).toBe(false);
    expect(deskStaleSessionBadge(row, false, intraday)).toBeNull();
  });
});
