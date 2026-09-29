import { describe, expect, it } from "vitest";
import type { ClinicalPreCdRecord } from "../api/supernova";
import { daysToCdFromIso, resolveTickerCdDate } from "./tickerEisSummary";

function rec(
  partial: Partial<ClinicalPreCdRecord> & { ticker: string; nct_id: string; cd_date: string },
): ClinicalPreCdRecord {
  return {
    sponsor_match: "Exact",
    ...partial,
  };
}

describe("resolveTickerCdDate", () => {
  const records = [
    rec({ ticker: "CHRS", nct_id: "NCT04336098", cd_date: "2023-08-25" }),
    rec({ ticker: "CHRS", nct_id: "NCT05635643", cd_date: "2026-09-30" }),
  ];

  it("prefers the CD of the primary NCT", () => {
    expect(resolveTickerCdDate("CHRS", "NCT05635643", records)).toBe("2026-09-30");
  });

  it("falls back to nearest future CD when NCT unknown", () => {
    expect(resolveTickerCdDate("CHRS", null, records)).toBe("2026-09-30");
  });

  it("falls back to Simulation Completion Date", () => {
    expect(resolveTickerCdDate("ZZZZ", null, [], "15/08/2026")).toBe("2026-08-15");
  });
});

describe("daysToCdFromIso", () => {
  it("returns positive days when CD is ahead", () => {
    const days = daysToCdFromIso("2099-01-01");
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(0);
  });
});
