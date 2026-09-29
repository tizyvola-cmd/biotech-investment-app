import { describe, expect, it } from "vitest";
import type { CatalystCyclePrimary } from "../api/catalystPatterns";
import { filterCyclePrimaryForOperationalContext } from "./catalystCycleState";

const buyPrimary: CatalystCyclePrimary = {
  phase: "dump_entry",
  confidence: "low",
  primary_pattern_id: null,
  label_en: "Buy?",
  label_it: "Buy?",
  reason_en: "drawdown",
  reason_it: "drawdown",
};

const sellPrimary: CatalystCyclePrimary = {
  phase: "exhaustion_exit",
  confidence: "medium",
  primary_pattern_id: "p1",
  label_en: "Best sell",
  label_it: "Best sell",
  reason_en: "exhaustion",
  reason_it: "esaurimento",
};

const setupPrimary: CatalystCyclePrimary = {
  phase: "pre_volume_watch",
  confidence: "medium",
  primary_pattern_id: "p2",
  label_en: "Setup",
  label_it: "Setup",
  reason_en: "accumulation",
  reason_it: "accumulo",
};

describe("filterCyclePrimaryForOperationalContext", () => {
  it("hides Buy? when in portfolio with operational SELL (IBRX case)", () => {
    expect(
      filterCyclePrimaryForOperationalContext(buyPrimary, {
        operationalRec: "sell",
        hasPosition: true,
      }),
    ).toBeNull();
  });

  it("hides Buy? when in portfolio even if rec is hold", () => {
    expect(
      filterCyclePrimaryForOperationalContext(buyPrimary, {
        operationalRec: "hold",
        hasPosition: true,
      }),
    ).toBeNull();
  });

  it("shows Buy? off-book with operational buy", () => {
    expect(
      filterCyclePrimaryForOperationalContext(buyPrimary, {
        operationalRec: "buy",
        hasPosition: false,
      }),
    ).toEqual(buyPrimary);
  });

  it("shows Buy peak cycle with operational buy in portfolio", () => {
    expect(
      filterCyclePrimaryForOperationalContext(sellPrimary, {
        operationalRec: "buy",
        hasPosition: true,
      }),
    ).toEqual(sellPrimary);
  });

  it("shows Buy peak cycle when flat", () => {
    expect(
      filterCyclePrimaryForOperationalContext(sellPrimary, {
        operationalRec: "hold",
        hasPosition: false,
      }),
    ).toEqual(sellPrimary);
  });

  it("hides Catalyst when operational sell", () => {
    expect(
      filterCyclePrimaryForOperationalContext(setupPrimary, {
        operationalRec: "sell",
        hasPosition: false,
      }),
    ).toBeNull();
  });

  it("allows Setup in portfolio with hold", () => {
    expect(
      filterCyclePrimaryForOperationalContext(setupPrimary, {
        operationalRec: "hold",
        hasPosition: true,
      }),
    ).toEqual(setupPrimary);
  });
});
