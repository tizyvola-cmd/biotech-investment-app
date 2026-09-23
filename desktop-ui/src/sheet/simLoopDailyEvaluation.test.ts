import { describe, expect, it } from "vitest";
import type { TickerSimEvaluation } from "./investDecisionSimLoop";
import {
  buildDailySimLoopExecution,
  computeEntryRiskScore,
  filterEvaluationsForSolidDailyBuys,
  passesSolidDailyBuyGate,
  SOLID_DAILY_BUY_DEFAULTS,
  synthCapitalFromSafety,
} from "./simLoopDailyEvaluation";

function ev(partial: Partial<TickerSimEvaluation> & Pick<TickerSimEvaluation, "key" | "ticker">): TickerSimEvaluation {
  return {
    hasPosition: false,
    inPaperPortfolio: false,
    daysToCd: 30,
    readings: {
      supernovaPeakPct: null,
      planTargetPct: null,
      planCdPct: null,
      precatKind: "enter",
      slope5d: null,
      slope20d: null,
      pred5Pp: null,
      curveGapPct: null,
      harmonyMaxGapPp: null,
      harmonyAligned: null,
      stabilityVerdict: "hold",
    },
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: "hold",
    investVerdict: "yes",
    entryVerdict: "yes",
    exitVerdict: null,
    probPct: 60,
    suggestedAction: "buy",
    planReturnPct: 8,
    pnlPct24h: 1.2,
    pnlPct: null,
    precatVerdictAgree: true,
    exitReason: "",
    compositeScore: 65,
    scoringZone: "hot",
    scoreBreakdown: {} as TickerSimEvaluation["scoreBreakdown"],
    compositeDampened: false,
    ...partial,
  };
}

describe("simLoopDailyEvaluation", () => {
  it("accepts Top2 yes with P(plan) and SDS above gate", () => {
    expect(
      passesSolidDailyBuyGate(ev({}), 50, false),
    ).toBe(true);
  });

  it("rejects low P(plan) without strong composite", () => {
    expect(
      passesSolidDailyBuyGate(
        ev({ probPct: 48, investVerdict: "wait", compositeScore: 55, suggestedAction: "buy" }),
        50,
        false,
      ),
    ).toBe(false);
  });

  it("accepts high composite when Top2 is wait", () => {
    expect(
      passesSolidDailyBuyGate(
        ev({ investVerdict: "wait", compositeScore: 62, probPct: 56 }),
        48,
        false,
      ),
    ).toBe(true);
  });

  it("demotes weak BUYs in filter", () => {
    const out = filterEvaluationsForSolidDailyBuys(
      [
        ev({ key: "a|cd", ticker: "AAA" }),
        ev({
          key: "b|cd",
          ticker: "BBB",
          probPct: 42,
          compositeScore: 50,
          investVerdict: "wait",
        }),
      ],
      {
        sdsRows: [
          { ticker: "AAA", sds: 50, zone_label: "watch", zone_color: "", zone_action: "" },
          { ticker: "BBB", sds: 50, zone_label: "watch", zone_color: "", zone_action: "" },
        ],
      },
    );
    expect(out[0]!.suggestedAction).toBe("buy");
    expect(out[1]!.suggestedAction).toBe("hold");
  });

  it("scales synth capital down for volatile low-SDS entries", () => {
    const risky = computeEntryRiskScore({ sds: 25, pplanPct: 55, pnlPct24h: 6 });
    const safe = computeEntryRiskScore({ sds: 70, pplanPct: 65, pnlPct24h: 0.5 });
    expect(risky.riskScore).toBeGreaterThan(safe.riskScore);
    expect(synthCapitalFromSafety(5000, safe.safetyScore)).toBeGreaterThan(
      synthCapitalFromSafety(5000, risky.safetyScore),
    );
    expect(synthCapitalFromSafety(5000, risky.safetyScore)).toBeGreaterThanOrEqual(1750);
  });

  it("raises fragility when EIS feed is negative (off-book)", () => {
    const base = computeEntryRiskScore({
      sds: 55,
      pplanPct: 60,
      pnlPct24h: 1,
      eisWindowScore: 8,
      eisSuperScore: 5,
    });
    const stressed = computeEntryRiskScore({
      sds: 55,
      pplanPct: 60,
      pnlPct24h: 1,
      eisWindowScore: -18,
      eisSuperScore: -6,
    });
    expect(stressed.riskScore).toBeGreaterThan(base.riskScore);
    expect(stressed.breakdown.eisFragPt).toBeGreaterThan(base.breakdown.eisFragPt);
    expect(stressed.breakdown.feedFragPt).toBeGreaterThan(base.breakdown.feedFragPt);
  });

  it("uses documented solid defaults (legacy helper)", () => {
    expect(SOLID_DAILY_BUY_DEFAULTS.minPplanPct).toBe(55);
    expect(SOLID_DAILY_BUY_DEFAULTS.minSds).toBe(45);
  });

  it("auto execution keeps Soft BUY suggestedAction (no solid demotion)", () => {
    const softBuy = ev({
      key: "soft|cd",
      ticker: "SOFT",
      probPct: 52,
      compositeScore: 40,
      investVerdict: "wait",
      suggestedAction: "buy",
    });
    const opts = buildDailySimLoopExecution(5000, {
      probOptions: {
        sdsRows: [
          { ticker: "SOFT", sds: 25, zone_label: "watch", zone_color: "", zone_action: "" },
        ],
      },
      simTable: null,
      inputs: {},
      pointsBySeriesKey: new Map(),
      lang: "en",
    });
    const out = opts.filterEvaluations([softBuy]);
    expect(out[0]!.suggestedAction).toBe("buy");
    expect(opts.resolveBuyCapital(softBuy)).toBeGreaterThan(0);
  });

  it("Grade 3 gate tier further reduces synth capital vs safety-only", () => {
    const top2No = ev({
      key: "WEAK|cd",
      ticker: "WEAK",
      probPct: 55,
      investVerdict: "no",
      suggestedAction: "buy",
      pnlPct24h: 1,
    });
    const top2Yes = ev({
      key: "STRONG|cd",
      ticker: "STRONG",
      probPct: 62,
      investVerdict: "yes",
      suggestedAction: "buy",
      pnlPct24h: 1.5,
    });
    const opts = buildDailySimLoopExecution(5000, {
      probOptions: {
        sdsRows: [
          { ticker: "WEAK", sds: 30, zone_label: "watch", zone_color: "", zone_action: "" },
          { ticker: "STRONG", sds: 35, zone_label: "watch", zone_color: "", zone_action: "" },
        ],
      },
      simTable: {
        columns: [],
        rows: [
          {
            Ticker: "WEAK",
            cont_g10: 15,
            cont_sell_edge: -1,
            p_continuation: 44,
            "Var. Giorn. %": 1,
          },
          {
            Ticker: "STRONG",
            cont_g10: 12,
            cont_sell_edge: -2,
            p_continuation: 40,
            "Var. Giorn. %": 1.5,
            "Var. 7d %": 3,
            "Var. 3M %": 5,
            "Var. 6M %": 8,
          },
        ],
      } as never,
      inputs: {},
      pointsBySeriesKey: new Map(),
      lang: "en",
    });
    const weakCap = opts.resolveBuyCapital(top2No);
    const strongCap = opts.resolveBuyCapital(top2Yes);
    expect(strongCap).toBeGreaterThan(weakCap);
    expect(weakCap).toBeLessThanOrEqual(3500);
  });
});
