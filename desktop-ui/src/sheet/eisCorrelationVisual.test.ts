import { describe, expect, it } from "vitest";
import {
  classifyPearsonR,
  pearsonVarianceExplainedPct,
} from "./eisCorrelationVisual";

describe("eisCorrelationVisual", () => {
  it("classifies pearson tiers", () => {
    expect(classifyPearsonR(0.85)).toBe("strong");
    expect(classifyPearsonR(-0.72)).toBe("strong");
    expect(classifyPearsonR(0.55)).toBe("moderate");
    expect(classifyPearsonR(0.2)).toBe("weak");
    expect(classifyPearsonR(null)).toBe("none");
  });

  it("computes variance explained from r", () => {
    expect(pearsonVarianceExplainedPct(0.852)).toBe(72.6);
    expect(pearsonVarianceExplainedPct(-0.5)).toBe(25);
  });
});
