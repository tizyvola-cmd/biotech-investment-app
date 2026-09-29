import { describe, expect, it } from "vitest";
import {
  applyMedtechStudyOverride,
  resolveStudyClassification,
} from "./StudyTypeTickerIcon";
import { resetMedtechSymbolCacheForTests } from "../sheet/medtechSymbols";

describe("applyMedtechStudyOverride", () => {
  const uncertain = {
    klass: "uncertain" as const,
    confidence: "low" as const,
    drugScore: 0,
    deviceScore: 0,
    matchedDrug: [] as string[],
    matchedDevice: [] as string[],
  };

  it("promotes INBS from uncertain to device", () => {
    const r = applyMedtechStudyOverride(uncertain, "INBS");
    expect(r.klass).toBe("device");
    expect(r.confidence).toBe("high");
  });

  it("promotes LCTX from uncertain to device", () => {
    const r = applyMedtechStudyOverride(uncertain, "LCTX");
    expect(r.klass).toBe("device");
  });

  it("promotes ICU / PROF / GRAL from uncertain to device", () => {
    expect(applyMedtechStudyOverride(uncertain, "ICU").klass).toBe("device");
    expect(applyMedtechStudyOverride(uncertain, "PROF").klass).toBe("device");
    expect(applyMedtechStudyOverride(uncertain, "GRAL").klass).toBe("device");
  });

  it("forces device for medtech even with strong drug keywords", () => {
    const drug = {
      klass: "drug" as const,
      confidence: "high" as const,
      drugScore: 12,
      deviceScore: 0,
      matchedDrug: ["phase"],
      matchedDevice: [] as string[],
    };
    expect(applyMedtechStudyOverride(drug, "LCTX").klass).toBe("device");
  });

  it("keeps strong drug classification for non-medtech tickers", () => {
    const drug = {
      klass: "drug" as const,
      confidence: "high" as const,
      drugScore: 12,
      deviceScore: 0,
      matchedDrug: ["phase"],
      matchedDevice: [] as string[],
    };
    expect(applyMedtechStudyOverride(drug, "MLTX").klass).toBe("drug");
  });
});

describe("resolveStudyClassification", () => {
  it("uses simRow Ticker when ticker arg omitted", () => {
    resetMedtechSymbolCacheForTests();
    const r = resolveStudyClassification({
      simRow: { Ticker: "INBS", "Clinical Study": "platform enrollment" },
    });
    expect(r.klass).toBe("device");
  });
});
