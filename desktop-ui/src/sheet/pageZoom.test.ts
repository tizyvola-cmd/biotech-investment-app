import { describe, expect, it } from "vitest";
import {
  clampPageZoom,
  PAGE_ZOOM_DEFAULT,
  PAGE_ZOOM_MAX,
  PAGE_ZOOM_MIN,
  parsePageZoom,
  stepPageZoom,
} from "./pageZoom";

describe("pageZoom", () => {
  it("clamps and rounds to two decimals", () => {
    expect(clampPageZoom(0.5)).toBe(PAGE_ZOOM_MIN);
    expect(clampPageZoom(2)).toBe(PAGE_ZOOM_MAX);
    expect(clampPageZoom(1.111)).toBe(1.11);
    expect(clampPageZoom(Number.NaN)).toBe(PAGE_ZOOM_DEFAULT);
  });

  it("steps by 10% within bounds", () => {
    expect(stepPageZoom(1, 1)).toBe(1.1);
    expect(stepPageZoom(1, -1)).toBe(0.9);
    expect(stepPageZoom(PAGE_ZOOM_MIN, -1)).toBe(PAGE_ZOOM_MIN);
    expect(stepPageZoom(PAGE_ZOOM_MAX, 1)).toBe(PAGE_ZOOM_MAX);
  });

  it("parses stored strings", () => {
    expect(parsePageZoom("1.2")).toBe(1.2);
    expect(parsePageZoom("")).toBe(PAGE_ZOOM_DEFAULT);
    expect(parsePageZoom("nope")).toBe(PAGE_ZOOM_DEFAULT);
  });
});
