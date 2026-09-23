import { describe, expect, it } from "vitest";
import {
  SDS_SUPERNOVA_THRESHOLD,
  computeSdsSupernovaProximity,
  formatSdsSupernovaGap,
  sdsSupernovaStars,
} from "./sdsSupernovaProximity";

describe("sdsSupernovaStars", () => {
  it("gives 5★ only at SuperNova threshold", () => {
    expect(sdsSupernovaStars(74.9)).toBe(4);
    expect(sdsSupernovaStars(SDS_SUPERNOVA_THRESHOLD)).toBe(5);
    expect(sdsSupernovaStars(90)).toBe(5);
  });

  it("maps lower bands", () => {
    expect(sdsSupernovaStars(0)).toBe(0);
    expect(sdsSupernovaStars(15)).toBe(1);
    expect(sdsSupernovaStars(30)).toBe(2);
    expect(sdsSupernovaStars(45)).toBe(3);
    expect(sdsSupernovaStars(60)).toBe(4);
  });
});

describe("computeSdsSupernovaProximity", () => {
  it("reports gap to threshold", () => {
    const p = computeSdsSupernovaProximity(63);
    expect(p).not.toBeNull();
    expect(p!.gapPp).toBe(12);
    expect(p!.isSupernova).toBe(false);
    expect(p!.stars).toBe(4);
  });

  it("zero/negative gap when at SuperNova", () => {
    const p = computeSdsSupernovaProximity(80);
    expect(p!.gapPp).toBe(-5);
    expect(p!.isSupernova).toBe(true);
    expect(formatSdsSupernovaGap(p!, true)).toMatch(/SuperNova/i);
  });

  it("returns null for missing score", () => {
    expect(computeSdsSupernovaProximity(null)).toBeNull();
    expect(computeSdsSupernovaProximity(undefined)).toBeNull();
  });
});
