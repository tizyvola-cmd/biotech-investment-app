import { describe, expect, it } from "vitest";
import { peakRoiWithOffset, formatOverlayPeakLabel } from "./sdsCompareOverlay";
import { SUPERNova_OFFSETS } from "./sdsHistoryCurve";

/** LTRN-like: anchor 0 @ T-60, then steady decline toward CD. */
const LTRN_DECLINE = [0, -3, -8, -10, -12, -14, -15, -16];

describe("peakRoiWithOffset", () => {
  it("uses forward CD outlook instead of anchor peak at T-60", () => {
    const r = peakRoiWithOffset(LTRN_DECLINE, SUPERNova_OFFSETS, -51);
    expect(r.kind).toBe("cd_outlook");
    expect(r.peakRoi).toBeLessThan(-0.08);
    expect(r.peakOffset).toBe(7);
  });

  it("finds forward peak when curve rises after today", () => {
    const rise = [0, -2, -1, 0, 2, 5, 8, 6];
    const r = peakRoiWithOffset(rise, SUPERNova_OFFSETS, -30);
    expect(r.kind).toBe("peak");
    expect(r.peakRoi).toBeGreaterThan(0.08);
  });

  it("falls back to last knot when no now offset", () => {
    const r = peakRoiWithOffset(LTRN_DECLINE, SUPERNova_OFFSETS, null);
    expect(r.kind).toBe("cd_outlook");
    expect(r.peakRoi).toBe(-16);
  });

  it("peak chip label clarifies forward CD outlook vs absolute", () => {
    const r = peakRoiWithOffset(LTRN_DECLINE, SUPERNova_OFFSETS, -51);
    const label = formatOverlayPeakLabel(r.peakRoi, r.peakOffset, r.kind, "it");
    expect(label).toContain("Outlook CD");
    expect(label).toContain("da oggi");
    expect(label).not.toMatch(/Picco/i);
  });
});
