import { describe, expect, it } from "vitest";
import {
  slopeExitOverriddenByFinalAction,
  slopeVerdictDisagreesWithFinalAction,
} from "./slopeVerdictAction";

describe("slopeExitOverriddenByFinalAction", () => {
  it("treats exit+HOLD as overridden (not a sell order)", () => {
    expect(slopeExitOverriddenByFinalAction("exit", "hold")).toBe(true);
    expect(slopeVerdictDisagreesWithFinalAction("exit", "hold")).toBe(true);
  });

  it("treats avoid+HOLD and exit+REVIEW as overridden", () => {
    expect(slopeExitOverriddenByFinalAction("avoid", "hold")).toBe(true);
    expect(slopeExitOverriddenByFinalAction("exit", "review")).toBe(true);
  });

  it("does not override when final action is sell", () => {
    expect(slopeExitOverriddenByFinalAction("exit", "sell")).toBe(false);
  });

  it("does not override entry/persistent against hold", () => {
    expect(slopeExitOverriddenByFinalAction("persistent", "hold")).toBe(false);
    expect(slopeExitOverriddenByFinalAction("entry", "buy")).toBe(false);
  });
});
