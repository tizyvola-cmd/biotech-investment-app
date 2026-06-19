import { describe, expect, it } from "vitest";
import {
  resolveTop2VerdictFields,
  getTop2Label,
} from "./top2DecisionHelpers";
import {
  slopeVerdictDisagreesWithFinalAction,
} from "./slopeVerdictAction";

describe("top2DecisionHelpers P1-A", () => {
  it("splits entry vs exit verdict by hasPosition", () => {
    expect(resolveTop2VerdictFields(false, "yes")).toEqual({
      investVerdict: "yes",
      entryVerdict: "yes",
      exitVerdict: null,
    });
    expect(resolveTop2VerdictFields(true, "yes")).toEqual({
      investVerdict: "yes",
      entryVerdict: null,
      exitVerdict: "yes",
    });
  });

  it("getTop2Label prefixes side", () => {
    expect(getTop2Label(false, "yes", "en")).toBe("Entry: yes");
    expect(getTop2Label(true, "wait", "it")).toBe("Uscita: attendi");
  });
});

describe("slopeVerdictAction P2-B", () => {
  it("flags slope exit vs final hold", () => {
    expect(slopeVerdictDisagreesWithFinalAction("exit", "hold", false)).toBe(true);
    expect(slopeVerdictDisagreesWithFinalAction("exit", "sell", false)).toBe(false);
    expect(slopeVerdictDisagreesWithFinalAction("watch", "hold", false)).toBe(false);
  });
});
