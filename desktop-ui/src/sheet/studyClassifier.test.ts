import { describe, expect, it } from "vitest";
import { auditStudyTypes, formatAuditReport } from "./auditStudyTypes";
import { classifyStudy } from "./studyClassifier";

const FIXTURES = [
  {
    ticker: "INBS",
    clinicalStudy:
      "FDA 510(k) submission for the Intelligent Fingerprinting Drug Screening System; multi-site Method Comparison Study vs predicate device; LC-MS/MS confirmation",
    expectedClass: "device" as const,
  },
  {
    ticker: "CMPX",
    clinicalStudy:
      "Phase 2/3 COMPANION-002 of tovecimig in biliary tract cancer; planned BLA submission; FDA feedback expected",
    expectedClass: "drug" as const,
  },
  {
    ticker: "MLTX",
    clinicalStudy:
      "Phase 3 VELA study of sonelokimab in hidradenitis suppurativa; BLA filing planned end-Q3",
    expectedClass: "drug" as const,
  },
  {
    ticker: "BIIB",
    clinicalStudy: "Phase 2 CELIA study of diranersen; LEQEMBI analyses",
    expectedClass: "drug" as const,
  },
  {
    ticker: "VIR",
    clinicalStudy: "Phase 1 dual-masked T-cell engager, dose escalation",
    expectedClass: "drug" as const,
  },
  {
    ticker: "XXXX",
    clinicalStudy: "clinical platform, multi-site enrollment",
    expectedClass: "uncertain" as const,
  },
];

describe("classifyStudy", () => {
  for (const f of FIXTURES) {
    it(`classifies ${f.ticker} as ${f.expectedClass}`, () => {
      const r = classifyStudy(f.clinicalStudy);
      expect(r.klass).toBe(f.expectedClass);
    });
  }

  it("classifies INBS device with high confidence", () => {
    const r = classifyStudy(FIXTURES[0]!.clinicalStudy);
    expect(r.klass).toBe("device");
    expect(r.confidence).toBe("high");
    expect(r.deviceScore).toBeGreaterThan(r.drugScore);
  });

  it("classifies Galleri / HIFU / Quelimmune product text as device", () => {
    expect(classifyStudy("Galleri multi-cancer early detection").klass).toBe("device");
    expect(classifyStudy("Sonalleve MR-HIFU ablation").klass).toBe("device");
    expect(classifyStudy("Quelimmune selective cytopheretic device").klass).toBe("device");
  });
});

describe("auditStudyTypes", () => {
  it("detects mixed drug + device portfolio", () => {
    const report = auditStudyTypes(
      FIXTURES,
      (p) => p.ticker,
      (p) => p.clinicalStudy,
    );
    expect(report.total).toBe(6);
    expect(report.summary.drug).toBeGreaterThan(0);
    expect(report.summary.device).toBe(1);
    expect(report.hasMixedPortfolio).toBe(true);
    expect(report.byClass.device.some((r) => r.ticker === "INBS")).toBe(true);
    expect(report.needsReview.some((r) => r.ticker === "XXXX")).toBe(true);
  });

  it("formats audit report", () => {
    const report = auditStudyTypes(
      FIXTURES,
      (p) => p.ticker,
      (p) => p.clinicalStudy,
    );
    const text = formatAuditReport(report, "en");
    expect(text).toMatch(/Mixed drug \+ device portfolio/);
    expect(text).toMatch(/XXXX/);
  });
});
