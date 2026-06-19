import { describe, expect, it } from "vitest";
import {
  eisCdDistanceFactor,
  resolveCdPatternWindow,
  CD_PATTERN_WINDOWS,
} from "./cdPatternHorizons";

describe("resolveCdPatternWindow", () => {
  it("maps offsets to the correct arc window", () => {
    expect(resolveCdPatternWindow(-45)?.id).toBe("w1");
    expect(resolveCdPatternWindow(-20)?.id).toBe("w2");
    expect(resolveCdPatternWindow(-8)?.id).toBe("w3");
    expect(resolveCdPatternWindow(-5)?.id).toBe("w4");
    expect(resolveCdPatternWindow(-1)?.id).toBe("w5");
    expect(resolveCdPatternWindow(3)?.id).toBe("w5");
  });

  it("derives offset from daysToCd when nowOffset missing", () => {
    expect(resolveCdPatternWindow(null, 25)?.id).toBe("w2");
    expect(resolveCdPatternWindow(null, 5)?.id).toBe("w4");
  });

  it("falls back to first window when very early", () => {
    expect(resolveCdPatternWindow(-90)?.id).toBe("w1");
  });

  it("returns null beyond w5 upper bound", () => {
    expect(resolveCdPatternWindow(10)).toBeNull();
  });
});

describe("eisCdDistanceFactor", () => {
  it("applies stronger factor closer to CD", () => {
    expect(eisCdDistanceFactor(15).factor).toBe(1);
    expect(eisCdDistanceFactor(45).factor).toBe(0.85);
    expect(eisCdDistanceFactor(200).factor).toBe(0.4);
  });

  it("moderates post-CD events", () => {
    expect(eisCdDistanceFactor(-3).factor).toBe(0.5);
  });
});

describe("CD_PATTERN_WINDOWS", () => {
  it("covers contiguous pre-CD arcs through T+4", () => {
    expect(CD_PATTERN_WINDOWS[0]!.startOffset).toBe(-60);
    expect(CD_PATTERN_WINDOWS.at(-1)!.endOffset).toBe(4);
  });
});
