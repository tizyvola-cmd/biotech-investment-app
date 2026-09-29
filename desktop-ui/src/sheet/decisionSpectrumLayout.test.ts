import { describe, expect, it } from "vitest";
import {
  nearestThresholdGap,
  scorePositionZone,
  spectrumPct,
} from "./decisionSpectrumLayout";

describe("decisionSpectrumLayout", () => {
  it("maps score to track percent", () => {
    expect(spectrumPct(61)).toBe(61);
    expect(spectrumPct(44)).toBe(44);
  });

  it("VIR hold: nearest gap is +4 to buy", () => {
    expect(nearestThresholdGap(61, 40, 65)).toEqual({ target: "buy", points: 4 });
    expect(scorePositionZone(61, 40, 65)).toBe("hold");
  });

  it("BNTX sell call: score 44 nearest is sell boundary at 4 pts", () => {
    expect(nearestThresholdGap(44, 40, 65)).toEqual({ target: "sell", points: 4 });
    expect(scorePositionZone(44, 40, 65)).toBe("hold");
  });

  it("SXTPW: score 33 in sell zone, nearest boundary is hold at +7", () => {
    expect(nearestThresholdGap(33, 40, 65)).toEqual({ target: "hold", points: 7 });
    expect(scorePositionZone(33, 40, 65)).toBe("sell");
  });
});
