import { describe, expect, it } from "vitest";
import { detectAutoFeedSemanticFlags } from "./autoFeedSemanticAudit";

describe("detectAutoFeedSemanticFlags", () => {
  it("flags positive clinical text with negative EIS", () => {
    const flags = detectAutoFeedSemanticFlags({
      text: "Phase 1b readout met primary endpoint with statistically significant benefit",
      eisScore: -2.1,
      kpiScore: 0.8,
      deltaP1d: null,
    });
    expect(flags).toContain("text_positive_eis_negative");
    expect(flags).toContain("kpi_positive_eis_negative");
  });

  it("does not flag positive text when price drop explains negative EIS", () => {
    const flags = detectAutoFeedSemanticFlags({
      text: "FDA orphan drug designation maintained",
      eisScore: -2.1,
      kpiScore: 1.1,
      deltaP1d: -4,
    });
    expect(flags).not.toContain("text_positive_eis_negative");
    expect(flags).not.toContain("kpi_positive_eis_negative");
  });

  it("flags mild financing strong negative without price excuse", () => {
    const text =
      "Capital raise with warrants 15% above offering; milder dilution than straight raise; dilution percentage not stated";
    const flags = detectAutoFeedSemanticFlags({
      text,
      eisScore: -2,
      kpiScore: null,
      deltaP1d: null,
    });
    expect(flags).toContain("financing_mild_strong_negative");
    expect(flags).not.toContain("text_negative_eis_positive");
  });
});
