import { describe, expect, it } from "vitest";
import {
  buildSimLoopScoreUsageRows,
  classifyRDownStrength,
} from "./simLoopScoreUsageGuide";

describe("simLoopScoreUsageGuide", () => {
  it("classifies strong positive r↓ for normal scales", () => {
    expect(classifyRDownStrength(0.81, 4, false)).toBe("strong");
  });

  it("classifies weak r↓", () => {
    expect(classifyRDownStrength(0.15, 10, false)).toBe("weak");
  });

  it("requires negative r↓ for inverted regulatory scale", () => {
    expect(classifyRDownStrength(-0.2, 12, true)).toBe("weak");
    expect(classifyRDownStrength(0.2, 12, true)).toBe("wrong_sign");
  });

  it("marks rescue unmeasured when forced", () => {
    const rows = buildSimLoopScoreUsageRows([
      {
        id: "rescue",
        rDown: 0.5,
        nDown: 4,
        buyWinPct: null,
        buyWinThreshold: null,
        buyWinN: null,
        unmeasured: true,
      },
    ]);
    expect(rows[0]?.strength).toBe("unmeasured");
    expect(rows[0]?.trimActionable).toBe(false);
  });

  it("flags SDS as trim-actionable when r↓ strong", () => {
    const rows = buildSimLoopScoreUsageRows([
      {
        id: "sds",
        rDown: 0.81,
        nDown: 4,
        buyWinPct: 55,
        buyWinThreshold: 75,
        buyWinN: 3,
      },
    ]);
    expect(rows[0]?.trimActionable).toBe(true);
  });
});
