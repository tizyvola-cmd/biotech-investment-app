import { describe, expect, it } from "vitest";
import { applyMedtechStudyOverride } from "../components/StudyTypeTickerIcon";
import {
  CURATED_MEDTECH_SYMBOLS,
  getMedtechSymbolSet,
  isMedtechTicker,
  resetMedtechSymbolCacheForTests,
} from "./medtechSymbols";

describe("medtechSymbols", () => {
  it("includes curated device tickers", () => {
    expect(isMedtechTicker("CERS")).toBe(true);
    expect(isMedtechTicker("INBS")).toBe(true);
    expect(isMedtechTicker("BIIB")).toBe(false);
  });

  it("curated set matches module export", () => {
    resetMedtechSymbolCacheForTests();
    const set = getMedtechSymbolSet();
    for (const tk of CURATED_MEDTECH_SYMBOLS) {
      expect(set.has(tk)).toBe(true);
    }
  });
});

describe("applyMedtechStudyOverride", () => {
  it("forces device icon for medtech ticker even when study text is empty", () => {
    const out = applyMedtechStudyOverride(
      {
        klass: "uncertain",
        confidence: "low",
        drugScore: 0,
        deviceScore: 0,
        matchedDrug: [],
        matchedDevice: [],
      },
      "CERS",
    );
    expect(out.klass).toBe("device");
    expect(out.matchedDevice).toContain("medtech universe");
  });

  it("does not override strong drug classification for non-medtech", () => {
    const drug = {
      klass: "drug" as const,
      confidence: "high" as const,
      drugScore: 14,
      deviceScore: 0,
      matchedDrug: ["clinical phase"],
      matchedDevice: [] as string[],
    };
    expect(applyMedtechStudyOverride(drug, "BIIB")).toEqual(drug);
  });
});
