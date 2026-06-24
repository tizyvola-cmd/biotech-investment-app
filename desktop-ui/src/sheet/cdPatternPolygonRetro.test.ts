import { describe, expect, it } from "vitest";
import {
  matchPctFromScoreProxy,
  parseBacktestPolygonMatchDoc,
  resolveBacktestPolygonMatchPct,
} from "./cdPatternPolygonRetro";

describe("cdPatternPolygonRetro", () => {
  it("prefers exported polygon match over score proxy", () => {
    const map = {
      "AAAA|2024-01-15": { match_m60: 62.3, match_m30: 55, match_m10: 48 },
    };
    const hit = resolveBacktestPolygonMatchPct("AAAA", "2024-01-15", "T-90", map, 90);
    expect(hit.source).toBe("polygon");
    expect(hit.matchPct).toBe(62.3);
  });

  it("falls back to dampened score_v4", () => {
    const hit = resolveBacktestPolygonMatchPct("BBBB", "2024-02-01", "T-30", {}, 80);
    expect(hit.source).toBe("proxy");
    expect(hit.matchPct).toBe(matchPctFromScoreProxy(80));
  });

  it("parses export doc rows", () => {
    const map = parseBacktestPolygonMatchDoc({
      rows: { "X|2024-03-01": { match_m10: 51 } },
    });
    expect(map["X|2024-03-01"]?.match_m10).toBe(51);
  });
});
