import { describe, expect, it } from "vitest";
import { eisToDecisionDisplayScale } from "./decisionChartBuild";

describe("decisionChartBuild", () => {
  it("maps signed EIS to 0-100 display scale", () => {
    expect(eisToDecisionDisplayScale(0)).toBe(50);
    expect(eisToDecisionDisplayScale(10)).toBe(60);
    expect(eisToDecisionDisplayScale(-10)).toBe(40);
    expect(eisToDecisionDisplayScale(50)).toBe(100);
    expect(eisToDecisionDisplayScale(-50)).toBe(0);
  });
});
