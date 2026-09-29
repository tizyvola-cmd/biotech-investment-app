import { describe, expect, it } from "vitest";
import {
  coalesceDeskProvenance,
  deskLastReadingBadge,
  deskLatestReadingAsof,
  deskRowIsStaleCarry,
  deskStaleSessionBadge,
  formatDeskReadingStamp,
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
});

describe("last reading stamps", () => {
  const row = stampDeskRowProvenance({ ticker: "XBI", last_close: 100 }, "server_hourly", {
    asof: "2026-09-18T20:00:00.000Z",
    sessionDay: "2026-09-18",
    signalKeys: ["last_close"],
  });
  const sunday = new Date("2026-09-20T15:00:00Z");

  it("adds the clock of the print to the weekday badge", () => {
    expect(deskLastReadingBadge(row, true, sunday)).toMatch(/^ven \d{1,2}:\d{2}/);
  });

  it("picks the most recent asof and formats it", () => {
    const older = stampDeskRowProvenance({ ticker: "ETON" }, "cache", {
      asof: "2026-09-17T20:00:00.000Z",
      sessionDay: "2026-09-17",
    });
    const latest = deskLatestReadingAsof([older, row]);
    expect(latest).toBe("2026-09-18T20:00:00.000Z");
    expect(formatDeskReadingStamp(latest, true)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatDeskReadingStamp(null, true)).toBeNull();
  });
});
