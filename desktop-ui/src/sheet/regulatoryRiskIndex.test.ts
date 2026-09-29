import { describe, expect, it } from "vitest";
import {
  parseEstimatedWindowDate,
  computeRegulatoryImminence,
  computeRegulatorySeverity,
  computeRegulatoryRiskDiagnostic,
  computeRegulatoryRiskScore,
  clinicalPhaseRegulatoryBonus,
  resolveRegulatoryRiskBundle,
  buildRegulatoryScoreBreakdown,
  formatRegulatoryImpactDisplay,
  regulatoryScoreColorClass,
  type RegulatoryRiskIndex,
} from "./regulatoryRiskIndex";

// ── parseEstimatedWindowDate ─────────────────────────────────────────────────

describe("parseEstimatedWindowDate", () => {
  it("parses precise ISO date", () => {
    const d = parseEstimatedWindowDate("2026-09-15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8); // September = 8
    expect(d!.getDate()).toBe(15);
  });

  it("parses quarter Q3 2026", () => {
    const d = parseEstimatedWindowDate("Q3 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    // Q3 midpoint = month 7 (Aug), day 15
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(15);
  });

  it("parses quarter Q1 2026", () => {
    const d = parseEstimatedWindowDate("Q1 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(1); // Feb
  });

  it("parses half-year H2 2026", () => {
    const d = parseEstimatedWindowDate("H2 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8); // Sep
  });

  it("parses broad 'mid 2026'", () => {
    const d = parseEstimatedWindowDate("mid 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5); // Jun
  });

  it("parses broad 'early 2026'", () => {
    const d = parseEstimatedWindowDate("early 2026");
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(2); // Mar
  });

  it("parses broad 'late 2026'", () => {
    const d = parseEstimatedWindowDate("late 2026");
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(9); // Oct
  });

  it("parses bare year '2026'", () => {
    const d = parseEstimatedWindowDate("2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
  });

  it("returns null for garbage input", () => {
    expect(parseEstimatedWindowDate("")).toBeNull();
    expect(parseEstimatedWindowDate("auto-detected")).toBeNull();
    expect(parseEstimatedWindowDate("TBD")).toBeNull();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function neutralIndex(): RegulatoryRiskIndex {
  return {
    pdufaSignal: { present: false },
    cmcSignal: { present: false, hits: [] },
    crlSignal: { hasActive: false, entries: [] },
    approvedSignal: { present: false, hits: [] },
    positiveSignal: { present: false, hits: [] },
    hasAnySignal: false,
  };
}

function withCrl(desc: string): RegulatoryRiskIndex {
  return {
    ...neutralIndex(),
    crlSignal: {
      hasActive: true,
      entries: [{ description: desc, source: "test", flaggedAt: "2026-01-01", resolved: false }],
    },
    hasAnySignal: true,
  };
}

function withPdufa(window: string, granularity: "precise" | "quarter" | "broad" = "precise"): RegulatoryRiskIndex {
  return {
    ...neutralIndex(),
    pdufaSignal: { present: true, kind: "pdufa_nda", estimatedWindow: window, granularity, catalystId: "test", status: "upcoming" },
    hasAnySignal: true,
  };
}

function withCmc(hitText: string): RegulatoryRiskIndex {
  return {
    ...neutralIndex(),
    cmcSignal: { present: true, hits: [{ source: "risk_flag", text: hitText }] },
    hasAnySignal: true,
  };
}

// ── computeRegulatoryImminence ───────────────────────────────────────────────

describe("computeRegulatoryImminence", () => {
  it("CRL active → score 100", () => {
    const result = computeRegulatoryImminence(withCrl("CRL for manufacturing"));
    expect(result.score).toBe(100);
    expect(result.reason).toBe("crl_active");
  });

  it("PDUFA 10 days away → high score (80-100 range)", () => {
    const now = Date.now();
    const in10days = new Date(now + 10 * 86_400_000).toISOString().slice(0, 10);
    const result = computeRegulatoryImminence(withPdufa(in10days), now);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reason).toBe("pdufa_imminent");
    expect(result.daysToPdufa).toBeCloseTo(10, 0);
  });

  it("PDUFA 60 days away → mid score (40-80 range)", () => {
    const now = Date.now();
    const in60days = new Date(now + 60 * 86_400_000).toISOString().slice(0, 10);
    const result = computeRegulatoryImminence(withPdufa(in60days), now);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThanOrEqual(80);
    expect(result.reason).toBe("pdufa_upcoming");
  });

  it("PDUFA 200 days away → low score (10-40 range)", () => {
    const now = Date.now();
    const in200days = new Date(now + 200 * 86_400_000).toISOString().slice(0, 10);
    const result = computeRegulatoryImminence(withPdufa(in200days), now);
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.reason).toBe("pdufa_distant");
  });

  it("no events → score 0", () => {
    const result = computeRegulatoryImminence(neutralIndex());
    expect(result.score).toBe(0);
    expect(result.reason).toBe("none");
  });

  it("PDUFA with unparseable date → moderate default", () => {
    const result = computeRegulatoryImminence(withPdufa("auto-detected (8-K)", "broad"));
    expect(result.score).toBe(30);
    expect(result.reason).toBe("pdufa_upcoming");
  });
});

// ── computeRegulatorySeverity ────────────────────────────────────────────────

describe("computeRegulatorySeverity", () => {
  it("CRL with CMC keywords → low severity (cmc_manufacturing)", () => {
    const result = computeRegulatorySeverity(withCrl("CRL due to manufacturing facility GMP deficiency"));
    expect(result.reason).toBe("crl_cmc");
    expect(result.crlReasonBucket).toBe("cmc_manufacturing");
    expect(result.score).toBe(30);
    expect(result.crlReasonSource).toBe("auto");
  });

  it("CRL with efficacy keywords → high severity (efficacy_safety)", () => {
    const result = computeRegulatorySeverity(withCrl("CRL due to lack of efficacy, additional trial required"));
    expect(result.reason).toBe("crl_efficacy_safety");
    expect(result.crlReasonBucket).toBe("efficacy_safety");
    expect(result.score).toBe(80);
    expect(result.crlReasonSource).toBe("auto");
  });

  it("CRL with mixed keywords → null score, manual review needed", () => {
    const result = computeRegulatorySeverity(
      withCrl("CRL citing manufacturing issues and adverse event concerns"),
    );
    expect(result.reason).toBe("crl_mixed");
    expect(result.score).toBeNull();
    expect(result.crlReasonSource).toBe("manual_review_needed");
  });

  it("CRL with no matching keywords → unclassified, manual review needed", () => {
    const result = computeRegulatorySeverity(withCrl("Complete response letter received"));
    expect(result.reason).toBe("crl_unclassified");
    expect(result.score).toBeNull();
    expect(result.crlReasonSource).toBe("manual_review_needed");
  });

  it("CMC only (no CRL) → low severity", () => {
    const result = computeRegulatorySeverity(withCmc("manufacturing deficiency"));
    expect(result.reason).toBe("cmc_only");
    expect(result.score).toBe(15);
  });

  it("no events → score 0", () => {
    const result = computeRegulatorySeverity(neutralIndex());
    expect(result.score).toBe(0);
    expect(result.reason).toBe("no_event");
  });
});

// ── computeRegulatoryRiskDiagnostic (combined) ───────────────────────────────

describe("computeRegulatoryRiskDiagnostic", () => {
  it("returns all three scores together", () => {
    const diag = computeRegulatoryRiskDiagnostic(withCrl("CRL due to manufacturing"));
    expect(diag.imminence.score).toBe(100);
    expect(diag.severity.reason).toBe("crl_cmc");
    expect(diag.legacyScore).toBe(50); // CRL = +50
  });

  it("legacy score matches existing formula", () => {
    const idx: RegulatoryRiskIndex = {
      pdufaSignal: { present: true, kind: "pdufa_nda", estimatedWindow: "Q3 2026", granularity: "quarter", catalystId: "t", status: "upcoming" },
      cmcSignal: { present: true, hits: [{ source: "risk_flag", text: "manufacturing" }] },
      crlSignal: { hasActive: true, entries: [{ description: "CRL", source: "t", flaggedAt: "2026-01-01", resolved: false }] },
      approvedSignal: { present: false, hits: [] },
      positiveSignal: { present: false, hits: [] },
      hasAnySignal: true,
    };
    const diag = computeRegulatoryRiskDiagnostic(idx);
    expect(diag.legacyScore).toBe(100); // 50 + 35 + 15
  });
});

describe("computeRegulatoryRiskScore favorability", () => {
  it("clean scan with no evidence → -5", () => {
    expect(computeRegulatoryRiskScore(neutralIndex(), { cleanScan: true })).toBe(-5);
  });

  it("Phase 3 clinical phase → -18", () => {
    expect(
      computeRegulatoryRiskScore(neutralIndex(), { clinicalPhase: "Phase 3", cleanScan: true }),
    ).toBe(-18);
  });

  it("proportional positive keyword hits", () => {
    const idx: RegulatoryRiskIndex = {
      ...neutralIndex(),
      positiveSignal: {
        present: true,
        hits: ["orphan drug designation", "breakthrough therapy designation"],
      },
      hasAnySignal: true,
    };
    expect(computeRegulatoryRiskScore(idx)).toBe(-16);
  });

  it("active risk skips favorability bonuses", () => {
    const idx: RegulatoryRiskIndex = {
      ...neutralIndex(),
      pdufaSignal: {
        present: true,
        kind: "pdufa_nda",
        estimatedWindow: "2026-09-15",
        granularity: "precise",
        catalystId: "t",
        status: "upcoming",
      },
      positiveSignal: { present: true, hits: ["fda approved"] },
      hasAnySignal: true,
    };
    expect(computeRegulatoryRiskScore(idx, { clinicalPhase: "Phase 3" })).toBe(35);
  });

  it("clinicalPhaseRegulatoryBonus ranks phases", () => {
    expect(clinicalPhaseRegulatoryBonus("Phase 1")).toBe(-4);
    expect(clinicalPhaseRegulatoryBonus("Phase 2")).toBe(-8);
    expect(clinicalPhaseRegulatoryBonus("Phase 3")).toBe(-18);
    expect(clinicalPhaseRegulatoryBonus("Approved")).toBe(-35);
  });

  it("resolveRegulatoryRiskBundle applies clean scan and phase", () => {
    const bundle = resolveRegulatoryRiskBundle({
      manualIdx: null,
      autoSig: {
        ticker: "TEST",
        crl: { detected: false, hits: [], sources: [] },
        pdufa: { detected: false, hits: [], sources: [] },
        cmc: { detected: false, hits: [], sources: [] },
        approved: { detected: false, hits: [], sources: [] },
        positive: { detected: false, hits: [], sources: [] },
        score: 0,
        no_signals: true,
      },
      clinicalPhase: "Phase 2",
    });
    expect(bundle.score).toBe(-8);
  });

  it("buildRegulatoryScoreBreakdown lists phase contribution", () => {
    const bundle = resolveRegulatoryRiskBundle({
      manualIdx: null,
      autoSig: {
        ticker: "TEST",
        crl: { detected: false, hits: [], sources: [] },
        pdufa: { detected: false, hits: [], sources: [] },
        cmc: { detected: false, hits: [], sources: [] },
        approved: { detected: false, hits: [], sources: [] },
        positive: { detected: false, hits: [], sources: [] },
        score: 0,
        no_signals: true,
      },
      clinicalPhase: "Phase 2",
    });
    const breakdown = buildRegulatoryScoreBreakdown(bundle.index!, {
      clinicalPhase: "Phase 2",
      cleanScan: true,
    });
    expect(breakdown.riskScore).toBe(-8);
    expect(breakdown.impactScore).toBe(8);
    expect(breakdown.items).toHaveLength(1);
    expect(breakdown.items[0]?.id).toBe("clinical_phase");
    expect(breakdown.items[0]?.contribution).toBe(-8);
  });
});

describe("regulatory impact display & colors", () => {
  it("flips risk score to impact (+ favorable, − headwind)", () => {
    expect(formatRegulatoryImpactDisplay(-8)).toBe("+8");
    expect(formatRegulatoryImpactDisplay(35)).toBe("-35");
  });

  it("colors follow impact sign", () => {
    expect(regulatoryScoreColorClass(-8)).toContain("signal-up");
    expect(regulatoryScoreColorClass(35)).toContain("signal-down");
  });
});
