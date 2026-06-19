import { describe, expect, it } from "vitest";
import { entryRaHarmonizationTooltipLines } from "./entryRaHarmonization";

describe("entryRaHarmonization", () => {
  it("states higher score = stronger buy in live tooltip", () => {
    const lines = entryRaHarmonizationTooltipLines("it", 55);
    expect(lines[0]).toContain("55/100");
    expect(lines[0]).toMatch(/più alto|BUY più forte/i);
    expect(lines.some((l) => /grezzo|inversamente/i.test(l))).toBe(true);
  });
});
