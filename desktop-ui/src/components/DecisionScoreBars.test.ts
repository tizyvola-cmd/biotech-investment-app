import { describe, expect, it } from "vitest";
import {
  polarityBarFillStyle,
  polarityScoreBarColor,
  polarityScoreLabelColor,
} from "./DecisionScoreBars";

describe("polarityScoreBarColor", () => {
  it("Setup: low = red family, high = green family", () => {
    const low = polarityScoreBarColor(10, true);
    const high = polarityScoreBarColor(90, true);
    const [lr, lg] = low.match(/\d+/g)!.map(Number);
    const [hr, hg] = high.match(/\d+/g)!.map(Number);
    expect(lr!).toBeGreaterThan(lg!);
    expect(hg!).toBeGreaterThan(hr!);
  });

  it("Risk: low = green family, high = red family (inverted)", () => {
    const low = polarityScoreBarColor(10, false);
    const high = polarityScoreBarColor(90, false);
    const [lr, lg] = low.match(/\d+/g)!.map(Number);
    const [hr, hg] = high.match(/\d+/g)!.map(Number);
    expect(lg!).toBeGreaterThan(lr!);
    expect(hr!).toBeGreaterThan(hg!);
  });
});

describe("polarityScoreLabelColor", () => {
  it("mid score stays dark enough to read (not near-white)", () => {
    const mid = polarityScoreLabelColor(50, true);
    const [r, g, b] = mid.match(/\d+/g)!.map(Number);
    // slate-ish mid — all channels well below pastel wash
    expect(Math.max(r!, g!, b!)).toBeLessThan(160);
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(80);
  });
});

describe("polarityBarFillStyle", () => {
  it("Setup uses red→white→green gradient sized to full track", () => {
    const s = polarityBarFillStyle(61, true);
    expect(s.backgroundImage).toContain("linear-gradient");
    expect(s.backgroundImage.indexOf("214, 108, 128")).toBeLessThan(
      s.backgroundImage.indexOf("92, 168, 132"),
    );
    expect(s.width).toBe("61%");
    expect(s.backgroundSize).toBe(`${(100 / 61) * 100}% 100%`);
  });

  it("Risk uses green→white→red gradient", () => {
    const s = polarityBarFillStyle(46, false);
    const goodAt = s.backgroundImage.indexOf("92, 168, 132");
    const badAt = s.backgroundImage.indexOf("214, 108, 128");
    expect(goodAt).toBeGreaterThanOrEqual(0);
    expect(badAt).toBeGreaterThan(goodAt);
  });
});
