import { describe, expect, it } from "vitest";
import {
  anchorReachable,
  daysToCdAtAnchor,
} from "./rascoreAnchorSolidity";

describe("rascoreAnchorSolidity", () => {
  it("computes days to CD at historical anchor", () => {
    expect(daysToCdAtAnchor(20, -20, -60)).toBe(60);
    expect(daysToCdAtAnchor(20, -20, -30)).toBe(30);
    expect(daysToCdAtAnchor(20, -20, -10)).toBeNull();
  });

  it("marks unreachable future anchors", () => {
    expect(anchorReachable(-20, -60)).toBe(true);
    expect(anchorReachable(-20, -10)).toBe(false);
  });
});
