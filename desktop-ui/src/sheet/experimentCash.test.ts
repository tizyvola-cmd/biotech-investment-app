import { describe, it, expect } from "vitest";
import {
  computeExperimentCash,
  planCapitalDraw,
} from "./experimentCash";
import type { InvestSimInputs } from "./investSimStorage";

const STARTING = 50_000;

function inputs(entries: InvestSimInputs): InvestSimInputs {
  return entries;
}

describe("computeExperimentCash", () => {
  it("full starting capital when nothing invested", () => {
    const cash = computeExperimentCash({}, "portfolio", STARTING);
    expect(cash.availableCash).toBe(STARTING);
    expect(cash.openCapital).toBe(0);
    expect(cash.realizedPnl).toBe(0);
    expect(cash.budgetFree).toBe(STARTING);
    expect(cash.gainsFree).toBe(0);
  });

  it("portfolio: open position reduces available cash", () => {
    const inv = inputs({
      RYTM: { buyPrice: 10, capital: 12_500, universe: "real" },
    });
    const cash = computeExperimentCash(inv, "portfolio", STARTING);
    expect(cash.openCapital).toBe(12_500);
    expect(cash.availableCash).toBe(37_500);
    expect(cash.budgetFree).toBe(37_500);
    expect(cash.gainsLocked).toBe(0);
  });

  it("simloop: legacy entry (no universe) counted in simloop", () => {
    const inv = inputs({
      VKTX: { buyPrice: 5, capital: 8_000 },
    });
    const portfolioCash = computeExperimentCash(inv, "portfolio", STARTING);
    const simloopCash = computeExperimentCash(inv, "simloop", STARTING);
    expect(portfolioCash.openCapital).toBe(0);
    expect(simloopCash.openCapital).toBe(8_000);
  });

  it("closed position with gain adds to realized P&L", () => {
    const inv = inputs({
      RYTM: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        closedPnlEur: 2_500,
        universe: "real",
      },
    });
    const cash = computeExperimentCash(inv, "portfolio", STARTING);
    expect(cash.realizedPnl).toBe(2_500);
    expect(cash.availableCash).toBe(52_500);
    expect(cash.budgetFree).toBe(STARTING);
    expect(cash.gainsFree).toBe(2_500);
  });

  it("open beyond starting locks gains after budget", () => {
    const inv = inputs({
      A: { buyPrice: 10, capital: 40_000, universe: "real" },
      B: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        closedPnlEur: 8_000,
        universe: "real",
      },
    });
    // open 40k on 50k start → budget free 10k; gains free 8k
    const cash = computeExperimentCash(inv, "portfolio", STARTING);
    expect(cash.budgetFree).toBe(10_000);
    expect(cash.gainsFree).toBe(8_000);
    const overBudget = inputs({
      A: { buyPrice: 10, capital: 55_000, universe: "real" },
      B: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        closedPnlEur: 8_000,
        universe: "real",
      },
    });
    const cash2 = computeExperimentCash(overBudget, "portfolio", STARTING);
    expect(cash2.budgetFree).toBe(0);
    expect(cash2.gainsLocked).toBe(5_000);
    expect(cash2.gainsFree).toBe(3_000);
  });

  it("closed position with loss reduces available cash", () => {
    const inv = inputs({
      CRSP: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        closedPnlEur: -3_000,
        universe: "real",
      },
    });
    const cash = computeExperimentCash(inv, "portfolio", STARTING);
    expect(cash.realizedPnl).toBe(-3_000);
    expect(cash.availableCash).toBe(47_000);
  });

  it("experiments are independent — portfolio position does not affect simloop cash", () => {
    const inv = inputs({
      RYTM: { buyPrice: 10, capital: 12_500, universe: "real" },
    });
    const portfolio = computeExperimentCash(inv, "portfolio", STARTING);
    const simloop = computeExperimentCash(inv, "simloop", STARTING);
    expect(portfolio.openCapital).toBe(12_500);
    expect(simloop.openCapital).toBe(0);
    expect(simloop.availableCash).toBe(STARTING);
  });

  it("synth experiment uses universe:synth entries only", () => {
    const inv = inputs({
      MRNA: { buyPrice: 8, capital: 5_000, universe: "synth" },
      VKTX: { buyPrice: 5, capital: 8_000, universe: "simloop" },
      RYTM: { buyPrice: 10, capital: 12_500, universe: "real" },
    });
    const synth = computeExperimentCash(inv, "synth", STARTING);
    expect(synth.openCapital).toBe(5_000);
    expect(synth.availableCash).toBe(45_000);
  });

  it("each experiment has its own independent starting capital", () => {
    const inv = inputs({});
    const p = computeExperimentCash(inv, "portfolio", 50_000);
    const s = computeExperimentCash(inv, "simloop", 30_000);
    const y = computeExperimentCash(inv, "synth", 20_000);
    expect(p.availableCash).toBe(50_000);
    expect(s.availableCash).toBe(30_000);
    expect(y.availableCash).toBe(20_000);
  });
});

describe("planCapitalDraw", () => {
  it("uses budget first without gains confirm", () => {
    const cash = computeExperimentCash(
      { A: { buyPrice: 1, capital: 10_000, universe: "real" } },
      "portfolio",
      STARTING,
    );
    const plan = planCapitalDraw(cash, 5_000);
    expect(plan.fromBudget).toBe(5_000);
    expect(plan.fromGains).toBe(0);
    expect(plan.needsGainsConfirm).toBe(false);
    expect(plan.affordable).toBe(true);
  });

  it("requires gains confirm when budget is short", () => {
    const cash = computeExperimentCash(
      {
        A: { buyPrice: 1, capital: 48_000, universe: "real" },
        B: {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          closedPnlEur: 10_000,
          universe: "real",
        },
      },
      "portfolio",
      STARTING,
    );
    // budget free 2k, gains free 10k
    const plan = planCapitalDraw(cash, 5_000);
    expect(plan.fromBudget).toBe(2_000);
    expect(plan.fromGains).toBe(3_000);
    expect(plan.needsGainsConfirm).toBe(true);
    expect(plan.affordable).toBe(true);
  });

  it("rejects when budget + gains cannot cover", () => {
    const cash = computeExperimentCash(
      {
        A: { buyPrice: 1, capital: 48_000, universe: "real" },
        B: {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          closedPnlEur: 1_000,
          universe: "real",
        },
      },
      "portfolio",
      STARTING,
    );
    const plan = planCapitalDraw(cash, 5_000);
    expect(plan.affordable).toBe(false);
    expect(plan.needsGainsConfirm).toBe(true);
  });
});
