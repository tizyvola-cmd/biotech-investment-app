import { describe, expect, it } from "vitest";
import {
  formatSearchInterest1dCell,
  formatSearchInterestCell,
  formatSearchInterestLegCells,
  searchInterest1dDeltaPct,
  searchInterestDeltaPct,
  searchInterestLegsTooltip,
  searchInterestTooltip,
  trendArrowFat,
} from "./searchInterestDisplay";

describe("searchInterestDeltaPct", () => {
  it("uses interest_delta_pct when present", () => {
    expect(searchInterestDeltaPct({ ticker: "X", interest_delta_pct: 27.4 })).toBeCloseTo(27.4);
  });

  it("falls back to last vs previous score", () => {
    expect(
      searchInterestDeltaPct({ ticker: "X", interest_score: 40, prev_interest_score: 10 }),
    ).toBeCloseTo(300);
  });

  it("falls back to 20d baseline when no previous print", () => {
    expect(
      searchInterestDeltaPct({ ticker: "X", interest_score: 22, rolling_baseline_20d: 20 }),
    ).toBeCloseTo(10);
  });

  it("is zero when both prints are zero", () => {
    expect(
      searchInterestDeltaPct({ ticker: "X", interest_score: 0, prev_interest_score: 0 }),
    ).toBe(0);
  });
});

describe("formatSearchInterestCell", () => {
  it("prints +% with an up tone", () => {
    const cell = formatSearchInterestCell(
      { ticker: "INSP", interest_delta_pct: 27.2 },
      false,
    );
    expect(cell).toMatchObject({ label: "+27%", tone: "up", deltaPct: 27 });
    expect(cell.arrowFat).toBeGreaterThan(0);
    expect(cell.arrowFat).toBeLessThan(1);
  });

  it("prints −% with a down tone", () => {
    const cell = formatSearchInterestCell(
      { ticker: "INSP", interest_delta_pct: -30 },
      false,
    );
    expect(cell).toMatchObject({ label: "-30%", tone: "down", deltaPct: -30 });
  });

  it("prints = when the print is flat", () => {
    expect(
      formatSearchInterestCell({ ticker: "X", interest_delta_pct: 0.2 }, false),
    ).toMatchObject({ label: "=", tone: "flat", arrowFat: 0 });
  });

  it("shows the absolute score when only interest_score is present", () => {
    expect(
      formatSearchInterestCell({ ticker: "ETON", interest_score: 19 }, false),
    ).toMatchObject({ label: "19", tone: "flat", deltaPct: 0 });
  });

  it("uses baseline % when score+baseline exist without delta", () => {
    expect(
      formatSearchInterestCell(
        { ticker: "ETON", interest_score: 22, rolling_baseline_20d: 20 },
        false,
      ),
    ).toMatchObject({ label: "+10%", tone: "up" });
  });

  it("fattens the arrow as |%| grows", () => {
    const small = formatSearchInterestCell({ ticker: "A", interest_delta_pct: 8 }, false);
    const big = formatSearchInterestCell({ ticker: "B", interest_delta_pct: -70 }, false);
    expect(big.arrowFat).toBeGreaterThan(small.arrowFat);
    expect(trendArrowFat(80)).toBe(1);
    expect(trendArrowFat(0)).toBe(0);
  });

  it("mentions the last NASDAQ session on weekend deltas", () => {
    expect(
      searchInterestTooltip(
        {
          ticker: "INSP",
          interest_score: 16,
          prev_interest_score: 10,
          interest_delta_pct: 60,
          delta_basis: "weekend_vs_last_nasdaq",
        },
        { label: "+60%", tone: "up", deltaPct: 60, arrowFat: 0.75 },
        "INSP",
        false,
        false,
      ),
    ).toContain("NASDAQ-session");
  });

  it("shows a dash while empty and an ellipsis while loading", () => {
    expect(formatSearchInterestCell(null, false).label).toBe("—");
    expect(formatSearchInterestCell(null, true).label).toBe("…");
  });
});

describe("formatSearchInterestLegCells", () => {
  it("stacks ticker, company and product when aliases exist", () => {
    const lines = formatSearchInterestLegCells(
      {
        ticker: "INSP",
        interest_delta_pct: 20,
        legs: [
          { kind: "ticker", term: "INSP", interest_delta_pct: 20 },
          { kind: "company", term: "Inspire Medical Systems", interest_delta_pct: 50 },
          { kind: "product", term: "SofPulse", interest_delta_pct: -10 },
        ],
      },
      false,
      { ticker: "INSP", company: "Inspire Medical Systems, Inc.", product: "SofPulse" },
      true,
    );
    expect(lines.map((l) => [l.kind, l.shortLabel, l.cell.label])).toEqual([
      ["ticker", "T", "+20%"],
      ["company", "Nome", "+50%"],
      ["product", "Prod", "-10%"],
    ]);
  });

  it("lists all three terms in the tooltip", () => {
    const row = {
      ticker: "INSP",
      interest_delta_pct: 20,
      legs: [
        { kind: "ticker", term: "INSP", interest_delta_pct: 20 },
        { kind: "product", term: "SofPulse", interest_delta_pct: 40 },
      ],
    };
    const lines = formatSearchInterestLegCells(
      row,
      false,
      { ticker: "INSP", product: "SofPulse" },
      false,
    );
    expect(searchInterestLegsTooltip(row, lines, "INSP", false, false)).toContain("Prod SofPulse: +40%");
  });

  it("does not reserve empty Nome/Prod rows when there is no print", () => {
    const lines = formatSearchInterestLegCells(
      null,
      false,
      { ticker: "AMGN", company: "Amgen Inc.", product: "Aranesp" },
      true,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("ticker");
    expect(lines[0]?.cell.label).toBe("—");
  });
});

describe("searchInterest1dDeltaPct", () => {
  it("uses interest_1d_delta_pct when present", () => {
    expect(
      searchInterest1dDeltaPct({ ticker: "X", interest_1d_delta_pct: 12.5 }),
    ).toBeCloseTo(12.5);
  });

  it("falls back to last vs previous 1d score", () => {
    expect(
      searchInterest1dDeltaPct({
        ticker: "X",
        interest_1d_score: 50,
        interest_1d_prev: 40,
      }),
    ).toBeCloseTo(25);
  });
});

describe("formatSearchInterest1dCell", () => {
  it("prints 24h +% with an up tone", () => {
    const cell = formatSearchInterest1dCell(
      { ticker: "INSP", interest_1d_delta_pct: 18.4 },
      false,
    );
    expect(cell.label).toBe("+18%");
    expect(cell.tone).toBe("up");
  });

  it("shows dash when missing", () => {
    expect(formatSearchInterest1dCell({ ticker: "X" }, false).label).toBe("—");
  });
});
