import { describe, expect, it } from "vitest";
import { eisSignSplitLift, eisSignSplitWorks, fmtSignSplitLift } from "./eisSignSplitVisual";

describe("eisSignSplitVisual", () => {
  it("computes lift as EIS+ minus EIS−", () => {
    expect(eisSignSplitLift(4.47, -3.12)).toBe(7.59);
    expect(eisSignSplitLift(-7.56, -13.66)).toBe(6.1);
  });

  it("detects aligned split", () => {
    expect(eisSignSplitWorks(4.47, -3.12)).toBe(true);
    expect(eisSignSplitWorks(-7.56, -13.66)).toBe(true);
    expect(eisSignSplitWorks(-2, 1)).toBe(false);
  });

  it("formats lift with sign", () => {
    expect(fmtSignSplitLift(7.59)).toBe("+7.59 pp");
    expect(fmtSignSplitLift(-1.2)).toBe("-1.20 pp");
  });
});
