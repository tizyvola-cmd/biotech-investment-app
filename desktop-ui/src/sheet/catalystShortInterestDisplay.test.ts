import { describe, expect, it } from "vitest";
import { formatShortInterestCell } from "./catalystShortInterestDisplay";

describe("formatShortInterestCell", () => {
  it("shows em dash when coverage is missing", () => {
    const cell = formatShortInterestCell(undefined, false, false);
    expect(cell.label).toBe("—");
    expect(cell.tone).toBe("none");
  });

  it("shows em dash when ΔSI is missing even if DTC exists", () => {
    const cell = formatShortInterestCell(
      { ticker: "AMGN", days_to_cover: 4.2, si_delta_pct: null, squeeze_risk: null },
      false,
      false,
    );
    expect(cell.label).toBe("—");
    expect(cell.sub).toBe("DTC 4.2d");
    expect(cell.tone).toBe("none");
  });

  it("shows rising ΔSI as down tone (bears adding)", () => {
    const cell = formatShortInterestCell(
      { ticker: "AMGN", days_to_cover: 4.2, si_delta_pct: 12.5, squeeze_risk: null },
      false,
      false,
    );
    expect(cell.label).toBe("ΔSI +12.5%");
    expect(cell.sub).toBe("DTC 4.2d");
    expect(cell.tone).toBe("down");
    expect(cell.tip).toMatch(/Rising|crescita|conviction|convinzione/i);
  });

  it("shows falling ΔSI as up tone (covering)", () => {
    const cell = formatShortInterestCell(
      { ticker: "GILD", days_to_cover: 3.1, si_delta_pct: -8.2, squeeze_risk: null },
      true,
      false,
    );
    expect(cell.label).toBe("ΔSI -8.2%");
    expect(cell.tone).toBe("up");
    expect(cell.tip).toMatch(/calo|assottiglia/);
  });

  it("adds fee badge only when squeeze flag is true", () => {
    const cell = formatShortInterestCell(
      {
        ticker: "GILD",
        days_to_cover: 6.1,
        si_delta_pct: 12,
        borrow_fee_delta_5d: 0.018,
        squeeze_risk: true,
        borrow_feed: true,
      },
      false,
      false,
    );
    expect(cell.label).toBe("ΔSI +12.0%");
    expect(cell.sub).toContain("Fee +180bps");
    expect(cell.tone).toBe("warn");
  });
});
