import { describe, expect, it } from "vitest";
import {
  evaluateSoftBuyGrade1,
  evaluateSoftBuyGrade1c,
  evaluateSoftBuyHighVol,
  evaluateSoftBuyDay1Catalyst,
  evaluateSoftSellGrade1,
  evaluateSoftSellGiveback,
  evaluateUrgentSellGrade2Book,
  peakPnlEurFromHistory,
  softSellG1HoldMature,
  softSellG1IsDeepFloor,
  URGENT_SELL_G2_MAX_LOSS_OF_WINS,
} from "./softSignalGrades";

describe("soft BUY grade 1", () => {
  it("hits SDS≥20 and P≥50 off-book", () => {
    expect(
      evaluateSoftBuyGrade1({ hasPosition: false, sdsScore: 20, pplan: 50 }).hit,
    ).toBe(true);
    expect(
      evaluateSoftBuyGrade1({ hasPosition: true, sdsScore: 40, pplan: 70 }).hit,
    ).toBe(false);
  });
});

describe("soft BUY High Vol", () => {
  it("hits only off-book when volume accel is flagged", () => {
    expect(evaluateSoftBuyHighVol({ hasPosition: false, flagged: true }).hit).toBe(true);
    expect(evaluateSoftBuyHighVol({ hasPosition: true, flagged: true }).hit).toBe(false);
    expect(evaluateSoftBuyHighVol({ hasPosition: false, flagged: false }).hit).toBe(false);
  });
});

describe("soft BUY day-1 catalyst", () => {
  it("hits SDS/P + vol surge + news bullish off-book", () => {
    expect(
      evaluateSoftBuyDay1Catalyst({
        hasPosition: false,
        sdsScore: 22,
        pplan: 55,
        volSurge: true,
        newsBullish: true,
      }).hit,
    ).toBe(true);
    expect(
      evaluateSoftBuyDay1Catalyst({
        hasPosition: false,
        sdsScore: 22,
        pplan: 55,
        volSurge: true,
        newsBullish: false,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftBuyDay1Catalyst({
        hasPosition: false,
        sdsScore: 10,
        pplan: 55,
        volSurge: true,
        newsBullish: true,
      }).hit,
    ).toBe(false);
  });
});

describe("soft BUY grade 1c", () => {
  it("hits SDS≥40 and P≥55", () => {
    expect(
      evaluateSoftBuyGrade1c({ hasPosition: false, sdsScore: 40, pplan: 55 }).hit,
    ).toBe(true);
    expect(
      evaluateSoftBuyGrade1c({ hasPosition: false, sdsScore: 39, pplan: 70 }).hit,
    ).toBe(false);
  });
});

describe("soft SELL grade 1", () => {
  it("hits deep open loss with elevated risk (CERS/BDSX pattern)", () => {
    const r = evaluateSoftSellGrade1({
      hasPosition: true,
      pnlPct: -9.2,
      pplan: 64,
      riskV2: 56,
      regRisk: 34,
    });
    expect(r.hit).toBe(true);
    expect(r.reason).toContain("riskV2");
  });

  it("skips mild losers and flat names", () => {
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -1.5,
        pplan: 62,
        riskV2: 48,
        regRisk: 37,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftSellGrade1({
        hasPosition: false,
        pnlPct: -9,
        pplan: 40,
        riskV2: 60,
        regRisk: 50,
      }).hit,
    ).toBe(false);
  });

  it("hits deep loss even with strong P(plan) and low risk (JSPR pattern)", () => {
    const r = evaluateSoftSellGrade1({
      hasPosition: true,
      pnlPct: -47.1,
      pplan: 70,
      riskV2: 25,
      regRisk: 30,
    });
    expect(r.hit).toBe(true);
    expect(r.reason).toContain("deep loss");
    expect(softSellG1IsDeepFloor(r)).toBe(true);
  });

  it("deep floor at ≤−12% even with strong recovery thesis", () => {
    const r = evaluateSoftSellGrade1({
      hasPosition: true,
      pnlPct: -12.1,
      pplan: 70,
      riskV2: 20,
      regRisk: 20,
    });
    expect(r.hit).toBe(true);
    expect(softSellG1IsDeepFloor(r)).toBe(true);
  });

  it("hits orphan enhance at ≤−6% when risk/reg/P all missing", () => {
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -6.5,
        pplan: null,
        riskV2: null,
        regRisk: null,
      }).hit,
    ).toBe(true);
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -5,
        pplan: 70,
        riskV2: 20,
        regRisk: 20,
      }).hit,
    ).toBe(false);
  });

  it("hits mild losers when g10 declining even if risk/reg/P look fine", () => {
    const r = evaluateSoftSellGrade1({
      hasPosition: true,
      pnlPct: -3,
      pplan: 70,
      riskV2: 20,
      regRisk: 20,
      simRow: { cont_g10: -6 },
    });
    expect(r.hit).toBe(true);
    expect(r.reason).toContain("g10 declining");
  });

  it("does not boost still-running in-regime names without edge", () => {
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -3,
        pplan: 70,
        riskV2: 20,
        regRisk: 20,
        simRow: { cont_g10: 12, cont_sell_edge: -4 },
      }).hit,
    ).toBe(false);
  });

  it("skips mild G1 on a 2-session hold; deep floor stays immediate", () => {
    const buyMon = "2026-08-10T18:00:00.000Z";
    const twoSessions = new Date("2026-08-12T20:00:00.000Z");
    const threeSessions = new Date("2026-08-13T20:00:00.000Z");
    expect(softSellG1HoldMature(buyMon, twoSessions)).toBe(false);
    expect(softSellG1HoldMature(buyMon, threeSessions)).toBe(true);
    expect(softSellG1HoldMature(null, twoSessions)).toBe(true);

    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -3,
        pplan: 40,
        riskV2: 50,
        regRisk: 50,
        investedAt: buyMon,
        now: twoSessions,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -3,
        pplan: 40,
        riskV2: 50,
        regRisk: 50,
        investedAt: buyMon,
        now: threeSessions,
      }).hit,
    ).toBe(true);
    expect(
      evaluateSoftSellGrade1({
        hasPosition: true,
        pnlPct: -12.1,
        pplan: 70,
        riskV2: 20,
        regRisk: 20,
        investedAt: buyMon,
        now: twoSessions,
      }).hit,
    ).toBe(true);
  });
});

describe("soft SELL giveback 20% of purchased+gains", () => {
  it("does not hit while open MTM € is still green", () => {
    const r = evaluateSoftSellGiveback({
      hasPosition: true,
      peakPnlEur: 400,
      pnlEur: 300,
      capitalEur: 1000,
      investedAt: "2026-08-11T15:00:00.000Z",
    });
    expect(r.hit).toBe(false);
    expect(r.givebackEur).toBe(100);
  });

  it("hits when drop ≥20% of (capital + peak gains) and MTM underwater", () => {
    // base = 1000+400=1400 → thresh 280; drop 410 → hit
    const r = evaluateSoftSellGiveback({
      hasPosition: true,
      peakPnlEur: 400,
      pnlEur: -10,
      capitalEur: 1000,
      investedAt: "2026-08-11T15:00:00.000Z",
    });
    expect(r.hit).toBe(true);
    expect(r.givebackEur).toBe(410);
    expect(r.reason).toContain("20%");
    expect(r.reason).toContain("purchased+gains");
  });

  it("does not hit at flat €0 MTM (fresh buy / back to cost)", () => {
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: 400,
        pnlEur: 0,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
  });

  it("skips at peak and when never green / peak below min", () => {
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: 400,
        pnlEur: 400,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: -50,
        pnlEur: -80,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: 40,
        pnlEur: -5,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
  });

  it("uses current as peak when history missing", () => {
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: null,
        pnlEur: 200,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
    expect(
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: null,
        pnlEur: 140,
        capitalEur: 1000,
      }).hit,
    ).toBe(false);
  });

  it("reads peak from history byTicker", () => {
    expect(
      peakPnlEurFromHistory(
        [
          { ts: "2026-07-01T10:00:00.000Z", byTicker: { "AAA|cd": { pnl: 100 } } },
          { ts: "2026-07-10T10:00:00.000Z", byTicker: { "AAA|cd": { pnl: 420 } } },
          { ts: "2026-07-15T10:00:00.000Z", byTicker: { "AAA|cd": { pnl: 310 } } },
        ],
        "AAA|cd",
      ),
    ).toBe(420);
  });

  it("scopes peak to current open (since investedAt) — no stale prior-hold peak", () => {
    expect(
      peakPnlEurFromHistory(
        [
          { ts: "2026-07-01T10:00:00.000Z", byTicker: { "AAA|cd": { pnl: 500 } } },
          { ts: "2026-08-10T08:00:00.000Z", byTicker: { "AAA|cd": { pnl: 0 } } },
          { ts: "2026-08-10T09:00:00.000Z", byTicker: { "AAA|cd": { pnl: 12 } } },
        ],
        "AAA|cd",
        "2026-08-10T08:00:00.000Z",
      ),
    ).toBe(12);
  });

  it("clips peak at sell gap even when investedAt was wrongly rewound", () => {
    expect(
      peakPnlEurFromHistory(
        [
          { ts: "2026-07-01T10:00:00.000Z", byTicker: { "BBNX|cd": { pnl: 800 } } },
          { ts: "2026-08-09T16:00:00.000Z", byTicker: { "BBNX|cd": { pnl: 200 } } },
          // Sold — absent from open book
          { ts: "2026-08-10T08:00:00.000Z", byTicker: {} },
          // Soft BUY rebuy
          { ts: "2026-08-10T09:00:00.000Z", byTicker: { "BBNX|cd": { pnl: 0 } } },
        ],
        "BBNX|cd",
        "2026-07-01T10:00:00.000Z", // poisoned / rewound investedAt
      ),
    ).toBe(0);
  });
});

describe("urgent SELL grade 2 book budget (20% purchased+gains)", () => {
  it("book-wide 20%: sells worst day losers until aggregate losses fit budget", () => {
    // purchased+gains = 100 → budget 20; day losses -150 → cut until rem ≤ 20
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "W1",
        ticker: "WIN",
        dayPnlEur: 100,
        dayPnlPct: 2,
        totalPnlPct: 5,
        capitalEur: 80,
        pnlEur: 20,
      },
      {
        key: "L1",
        ticker: "CERS",
        dayPnlEur: -80,
        dayPnlPct: -3.5,
        totalPnlPct: -9,
        capitalEur: 0,
        pnlEur: -80,
      },
      {
        key: "L2",
        ticker: "BDSX",
        dayPnlEur: -40,
        dayPnlPct: -2.1,
        totalPnlPct: -9,
        capitalEur: 0,
        pnlEur: -40,
      },
      {
        key: "L3",
        ticker: "BIIB",
        dayPnlEur: -30,
        dayPnlPct: -1.5,
        totalPnlPct: -0.5,
        capitalEur: 0,
        pnlEur: -30,
      },
    ]);
    expect(book.urgentKeys.has("L1")).toBe(true);
    expect(book.urgentKeys.has("L2")).toBe(true);
    expect(book.urgentKeys.has("L3")).toBe(true);
    expect(book.purchasedPlusGainsEur).toBe(100);
    expect(book.budgetEur).toBe(20);
    expect(book.lossSumEur).toBe(-150);
  });

  it("cuts fastest day % first; never cuts green MTM (BNTX)", () => {
    // base = 200+31 = 231 → budget ~46.2; JSPR day -980 restores alone
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "W1",
        ticker: "MSLE",
        dayPnlEur: 86,
        dayPnlPct: 1.6,
        totalPnlPct: 1.9,
        capitalEur: 200,
        pnlEur: 31,
      },
      {
        key: "JSPR",
        ticker: "JSPR",
        dayPnlEur: -980,
        dayPnlPct: -47.1,
        totalPnlPct: -2.3,
        capitalEur: 0,
        pnlEur: -50,
      },
      {
        key: "BNTX",
        ticker: "BNTX",
        dayPnlEur: -112,
        dayPnlPct: -2.8,
        totalPnlPct: 0.4, // MTM>0 — never auto-sell
        capitalEur: 0,
        pnlEur: 0, // green via totalPnlPct; no gains in equity base
      },
    ]);
    expect(book.urgentKeys.has("JSPR")).toBe(true);
    expect(book.urgentKeys.has("BNTX")).toBe(false);
    expect(book.budgetEur).toBeCloseTo(231 * URGENT_SELL_G2_MAX_LOSS_OF_WINS, 5);
  });

  it("does not fire when aggregate day losses stay within 20% of purchased+gains", () => {
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "W1",
        ticker: "WIN",
        dayPnlEur: 200,
        dayPnlPct: 2,
        totalPnlPct: 5,
        capitalEur: 180,
        pnlEur: 20,
      },
      {
        key: "L1",
        ticker: "LOSE",
        dayPnlEur: -40,
        dayPnlPct: -5,
        totalPnlPct: -8,
        capitalEur: 0,
        pnlEur: -40,
      },
    ]);
    // base 200 → budget 40; |loss| 40 ≤ 40 → no cuts
    expect(book.hits).toHaveLength(0);
    expect(book.budgetEur).toBe(40);
  });

  it("prioritizes fastest day % loss over larger € day loss", () => {
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "W1",
        ticker: "WIN",
        dayPnlEur: 200,
        dayPnlPct: 2,
        totalPnlPct: 5,
        capitalEur: 180,
        pnlEur: 20,
      },
      {
        key: "SLOW",
        ticker: "SLOW",
        dayPnlEur: -90,
        dayPnlPct: -2.2,
        totalPnlPct: -8,
        capitalEur: 0,
        pnlEur: -90,
      },
      {
        key: "FAST",
        ticker: "FAST",
        dayPnlEur: -40,
        dayPnlPct: -9.5,
        totalPnlPct: -6,
        capitalEur: 0,
        pnlEur: -40,
      },
    ]);
    // base 200 → budget 40; losses -130 → cut FAST then SLOW
    expect(book.hits.map((h) => h.key)).toEqual(["FAST", "SLOW"]);
  });

  it("on equal day %, cuts declining / out-of-regime before still-running", () => {
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "W1",
        ticker: "WIN",
        dayPnlEur: 300,
        dayPnlPct: 2,
        totalPnlPct: 5,
        capitalEur: 250,
        pnlEur: 50,
      },
      {
        key: "RUN",
        ticker: "RUN",
        dayPnlEur: -50,
        dayPnlPct: -4,
        totalPnlPct: -6,
        capitalEur: 0,
        pnlEur: -50,
        contCutPriority: 0,
      },
      {
        key: "DEC",
        ticker: "DEC",
        dayPnlEur: -50,
        dayPnlPct: -4,
        totalPnlPct: -6,
        capitalEur: 0,
        pnlEur: -50,
        contCutPriority: 300,
      },
    ]);
    // wins 300 → budget 60; losses −100 → one cut (−50) restores; prefer DEC
    expect(book.hits.map((h) => h.key)).toEqual(["DEC"]);
    expect(book.urgentKeys.has("RUN")).toBe(false);
  });

  it("fail-closed: missing capitalEur must not mass-sell red-MTM day losers", () => {
    // Regression SRPT/SYRE 2026-08-13: legs without capital → budget 0 →
    // every MTM≤0 day loser was marked urgent while green CRDL stayed open.
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "CRDL",
        ticker: "CRDL",
        dayPnlEur: -69,
        dayPnlPct: -2.8,
        totalPnlPct: 6.0,
        // capital omitted on purpose
      },
      {
        key: "SRPT",
        ticker: "SRPT",
        dayPnlEur: -30,
        dayPnlPct: -1.2,
        totalPnlPct: -1.2,
      },
      {
        key: "SYRE",
        ticker: "SYRE",
        dayPnlEur: -2,
        dayPnlPct: null,
        totalPnlPct: 0,
      },
    ]);
    expect(book.purchasedPlusGainsEur).toBe(0);
    expect(book.budgetEur).toBe(0);
    expect(book.hits).toHaveLength(0);
    expect(book.urgentKeys.size).toBe(0);
  });

  it("with real book capital, small red SRPT is not cut when day losses fit 20% budget", () => {
    const book = evaluateUrgentSellGrade2Book([
      {
        key: "CRDL",
        ticker: "CRDL",
        dayPnlEur: -69,
        dayPnlPct: -2.76,
        totalPnlPct: 6.05,
        capitalEur: 2300,
        pnlEur: 139,
      },
      {
        key: "BBNX",
        ticker: "BBNX",
        dayPnlEur: -69,
        dayPnlPct: -2.62,
        totalPnlPct: 5.85,
        capitalEur: 2428,
        pnlEur: 142,
      },
      {
        key: "SRPT",
        ticker: "SRPT",
        dayPnlEur: -30,
        dayPnlPct: -1.21,
        totalPnlPct: -1.21,
        capitalEur: 2500,
        pnlEur: -30,
      },
      {
        key: "INBX",
        ticker: "INBX",
        dayPnlEur: 14,
        dayPnlPct: 0.43,
        totalPnlPct: 8.15,
        capitalEur: 3000,
        pnlEur: 244,
      },
    ]);
    // base ≈ 2300+139+2428+142+2500+3000+244 ≈ 10.7k → budget ~2.1k; losses ~168
    expect(book.hits).toHaveLength(0);
    expect(book.urgentKeys.has("SRPT")).toBe(false);
    expect(book.urgentKeys.has("CRDL")).toBe(false);
  });
});
