import { describe, expect, it } from "vitest";
import { buildModelStretchView } from "./modelStretchView";
import type { CurveImpactCumulative } from "../data/signalCalibrationData";
import type { MonitorEntry } from "./accuracyMetrics";

/**
 * Build a `CurveImpactCumulative` fixture that produces the requested
 * price-accuracy and sign-hit deltas. `fromCurveImpact` derives price accuracy
 * from `(100 - mae_pp)`, so we invert that mapping to hit the targets.
 */
function stretchImpactFixture(opts: {
  priceBeforePct: number;
  priceAfterPct: number;
  signBeforePct: number;
  signAfterPct: number;
}): CurveImpactCumulative {
  return {
    summary: {
      mae_base_pp: 100 - opts.priceBeforePct,
      mae_daily_pp: 100 - opts.priceAfterPct,
      hit_base_pct: opts.signBeforePct,
      hit_daily_pct: opts.signAfterPct,
    },
  } as unknown as CurveImpactCumulative;
}

describe("buildModelStretchView monitor merge", () => {
  it("includes monitor checkpoints after last recalibration", () => {
    const calibState = {
      current: {
        timestamp: "2026-06-27T08:37:43",
        cal_factor: { v4_options: 1.0434 },
        n_retro_total: 100,
      },
      history: [
        {
          timestamp: "2026-05-25T06:39:43",
          cal_factor: { v4_options: 1.0804 },
          n_retro_total: 90,
        },
      ],
    };
    const monitor: MonitorEntry[] = [
      {
        runIso: "2026-07-05T12:57:47",
        accV4Pct: 64,
        accV4SimPct: null,
        nEval: 400,
        nEvalSim: null,
        nSimPending: null,
        m2Mae7: 9.3,
        m2HitD5: null,
        m2Bias7: null,
        affMisurata: null,
        gapAff: null,
        calFactorV4: 1.0434,
        recalibrated: false,
      },
      {
        runIso: "2026-07-11T10:07:53",
        accV4Pct: 64,
        accV4SimPct: null,
        nEval: 431,
        nEvalSim: null,
        nSimPending: null,
        m2Mae7: 9.27,
        m2HitD5: null,
        m2Bias7: null,
        affMisurata: null,
        gapAff: null,
        calFactorV4: 1.0434,
        recalibrated: false,
      },
    ];

    const view = buildModelStretchView(calibState, null, null, null, monitor);
    const labels = view.history.map((h) => h.label);
    expect(labels).toContain("2026-06-27");
    expect(labels).toContain("2026-07-05");
    expect(labels).toContain("2026-07-11");
    expect(view.lastStretchIso).toBe("2026-07-11T10:07:53");
    expect(view.history.find((h) => h.label === "2026-07-11")?.source).toBe("monitor");
  });
});

describe("buildModelStretchView verdict", () => {
  // Regression test for the screenshot the user flagged: PRICE ACC. went
  // 85.9% → 94.3% (+8.4 pp) but SIGN HIT went 64.5% → 59.3% (−5.2 pp).
  // The old `sum >= 1` verdict returned "improved" — a well-fit curve on the
  // wrong side of zero still loses money, so this must not be "improved".
  it("does not claim improvement when sign hit regresses materially, even if price accuracy jumps", () => {
    const impact = stretchImpactFixture({
      priceBeforePct: 85.9,
      priceAfterPct: 94.3,
      signBeforePct: 64.5,
      signAfterPct: 59.3,
    });
    const view = buildModelStretchView(null, null, null, impact);
    expect(view.priceAccDeltaPp).toBeCloseTo(8.4, 1);
    expect(view.signHitDeltaPp).toBeCloseTo(-5.2, 1);
    expect(view.verdict).not.toBe("improved");
    expect(view.verdict).toBe("neutral");
  });

  it("classifies as 'worse' when both metrics regress materially", () => {
    const impact = stretchImpactFixture({
      priceBeforePct: 90,
      priceAfterPct: 85,
      signBeforePct: 70,
      signAfterPct: 63,
    });
    const view = buildModelStretchView(null, null, null, impact);
    expect(view.verdict).toBe("worse");
  });

  it("classifies as 'improved' only when both metrics move up", () => {
    const impact = stretchImpactFixture({
      priceBeforePct: 80,
      priceAfterPct: 84,
      signBeforePct: 60,
      signAfterPct: 63,
    });
    const view = buildModelStretchView(null, null, null, impact);
    expect(view.verdict).toBe("improved");
  });

  it("classifies as 'worse' when sign hit crashes without any price gain to offset it", () => {
    const impact = stretchImpactFixture({
      priceBeforePct: 85,
      priceAfterPct: 84.5,
      signBeforePct: 65,
      signAfterPct: 58,
    });
    const view = buildModelStretchView(null, null, null, impact);
    expect(view.verdict).toBe("worse");
  });
});
