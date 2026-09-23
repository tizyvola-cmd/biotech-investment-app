import { describe, expect, it } from "vitest";
import {
  applyAdviceOutcomeHysteresis,
  resetAdviceErrorYDomainForTests,
  stabilizeAdviceErrorYDomain,
  stabilizeAdviceMovePct,
} from "./adviceCalibrationStability";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";

function point(
  id: string,
  action: "buy" | "sell",
  move: number,
): AdviceCalibrationPoint {
  return {
    id,
    ticker: "TST",
    suggestedAction: action,
    outcome: "pending",
    probPct: 60,
    expectedReturnPct: 5,
    priceChangePct: move,
    source: "live",
    labelIt: "",
    labelEn: "",
    forecastErrorPct: null,
  };
}

describe("adviceCalibrationStability", () => {
  it("quantizes moves to 0.25pp", () => {
    expect(stabilizeAdviceMovePct(0.48)).toBe(0.5);
    expect(stabilizeAdviceMovePct(-0.52)).toBe(-0.5);
  });

  it("keeps BUY good when move dips slightly below +0.5%", () => {
    const first = applyAdviceOutcomeHysteresis([point("a", "buy", 0.6)]);
    expect(first[0]!.outcome).toBe("good");

    const second = applyAdviceOutcomeHysteresis([point("a", "buy", 0.35)]);
    expect(second[0]!.outcome).toBe("good");
  });

  it("flips BUY good to pending only after a deeper drop", () => {
    applyAdviceOutcomeHysteresis([point("b", "buy", 0.6)]);
    const shallow = applyAdviceOutcomeHysteresis([point("b", "buy", 0.35)]);
    expect(shallow[0]!.outcome).toBe("good");

    const deep = applyAdviceOutcomeHysteresis([point("b", "buy", 0.1)]);
    expect(deep[0]!.outcome).toBe("pending");
  });

  it("keeps Y domain stable until pad moves by ≥2pp", () => {
    resetAdviceErrorYDomainForTests();
    expect(stabilizeAdviceErrorYDomain([{ y: 1 }])).toEqual([-4, 4]);
    expect(stabilizeAdviceErrorYDomain([{ y: 1.2 }])).toEqual([-4, 4]);
    expect(stabilizeAdviceErrorYDomain([{ y: 5 }])).toEqual([-6, 6]);
  });
});
