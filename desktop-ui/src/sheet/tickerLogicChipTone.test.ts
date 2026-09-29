import { describe, expect, it } from "vitest";
import { tickerLogicChipTone } from "./tickerLogicChipTone";

describe("tickerLogicChipTone", () => {
  it("marks Soft BUY + positive equity as aligned", () => {
    const tone = tickerLogicChipTone(
      {
        key: "X|cd",
        ticker: "X",
        capital: 1000,
        pplan: 70,
        sds: 45,
        pcont: 60,
        pnlPct: 5,
        riskV2: 20,
        regRisk: 20,
      },
      120,
    );
    expect(tone?.dominant).toBe("buy");
    expect(tone?.align).toBe("aligned");
    expect(tone?.className).toContain("emerald");
  });
});
