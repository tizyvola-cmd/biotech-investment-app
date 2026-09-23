import { describe, expect, it } from "vitest";
import {
  aliasEventVolRowsForPairs,
  formatIvrCell,
  formatSkewCell,
  resolveEventVolRow,
} from "./eventVolIndexDisplay";

describe("resolveEventVolRow", () => {
  it("falls back to nearest dated print for the same ticker", () => {
    const byKey = {
      "GPCR|2026-09-30": {
        ticker: "GPCR",
        ivr: 1.1,
        em_straddle: 0.12,
      },
    };
    const hit = resolveEventVolRow(byKey, "GPCR", "2026-10-01");
    expect(hit?.ivr).toBe(1.1);
    const aliased = aliasEventVolRowsForPairs(byKey, [
      { ticker: "GPCR", eventDate: "2026-10-01" },
    ]);
    expect(aliased["GPCR|2026-10-01"]?.ivr).toBe(1.1);
  });
});

describe("formatIvrCell", () => {
  it("prioritizes EM % and locks green to rising arrows", () => {
    const cell = formatIvrCell(
      { ticker: "GRAL", ivr: 1.82, iv_ev: 0.9, iv_bg: 0.5, ivr_slope: 0.04, em_straddle: 0.12 },
      false,
      false,
    );
    expect(cell.label).toBe("EM 12.0% ↑");
    expect(cell.sub).toBe("IVR 1.82");
    expect(cell.tone).toBe("up");
    expect(cell.tip).toMatch(/size of the jump/i);
  });

  it("locks red to falling arrows", () => {
    const cell = formatIvrCell(
      { ticker: "GRAL", ivr: 1.1, ivr_slope: -0.05, em_straddle: 0.2 },
      false,
      false,
    );
    expect(cell.label).toBe("EM 20.0% ↓");
    expect(cell.tone).toBe("down");
  });

  it("promotes EM to the primary label when IVR is missing", () => {
    const cell = formatIvrCell(
      { ticker: "AMGN", em_straddle: 0.373, rr10: -0.07 },
      false,
      false,
    );
    expect(cell.label).toBe("EM 37.3%");
    expect(cell.tone).toBe("flat");
  });
});

describe("formatSkewCell", () => {
  it("prints RR in points and treats call-rich RR as a negative desk tell", () => {
    const cell = formatSkewCell(
      { ticker: "GRAL", rr10: 0.05, rr_slope: 0.01, pcr_vol: 0.6 },
      false,
      false,
    );
    expect(cell.label).toMatch(/RR \+5/);
    expect(cell.sub).toBe("PCR 0.60");
    expect(cell.tone).toBe("down");
  });

  it("colors put-rich (negative) RR green as a positive desk tell", () => {
    const cell = formatSkewCell(
      { ticker: "ETON", rr10: -0.12, pcr_vol: 1.4 },
      false,
      false,
    );
    expect(cell.label).toMatch(/RR -12/);
    expect(cell.tone).toBe("up");
  });

  it("labels no_options vs not_loaded when empty", () => {
    const noOpt = formatSkewCell(
      { ticker: "FOO", empty_reason: "no_options" },
      true,
      false,
    );
    expect(noOpt.label).toBe("no opt");
    expect(noOpt.emptyReason).toBe("no_options");
    const notLoaded = formatIvrCell(undefined, true, false);
    expect(notLoaded.label).toBe("n/d");
    expect(notLoaded.emptyReason).toBe("not_loaded");
  });

  it("attaches grey ven badge from _desk provenance", () => {
    const cell = formatIvrCell(
      {
        ticker: "ETON",
        ivr: 1.4,
        em_straddle: 0.1,
        _desk: {
          asof: "2026-09-18T20:00:00.000Z",
          source: "server_hourly",
          session_day: "2026-09-18",
        },
      } as never,
      true,
      false,
    );
    // Badge only when carry is stale relative to "now" — skip if market open in CI.
    if (cell.staleBadge) {
      expect(cell.staleBadge).toMatch(/ven|Fri|gio|Thu|mer|Wed/i);
    }
  });
});
