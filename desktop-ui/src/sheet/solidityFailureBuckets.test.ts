import { describe, expect, it } from "vitest";
import { bucketSolidityFailure, groupSolidityFailures } from "./solidityFailureBuckets";

describe("solidityFailureBuckets", () => {
  it("timing_beyond_hot is expected in watch zone", () => {
    expect(
      bucketSolidityFailure({ code: "timing_beyond_hot", detail: "84" }, 84),
    ).toBe("expected");
  });

  it("align_contrarian is block", () => {
    expect(bucketSolidityFailure({ code: "align_contrarian" }, 30)).toBe("block");
  });

  it("low_score_reliability is monitor", () => {
    const g = groupSolidityFailures(
      [
        { code: "timing_beyond_hot", detail: "82" },
        { code: "low_score_reliability", detail: "40 < 35" },
        { code: "align_contrarian" },
      ],
      82,
    );
    expect(g.expected).toHaveLength(1);
    expect(g.monitor).toHaveLength(1);
    expect(g.block).toHaveLength(1);
  });
});
