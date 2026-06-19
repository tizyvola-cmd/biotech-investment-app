import { describe, expect, it } from "vitest";
import { resolveBuyExitDecision } from "./portfolioLossAnalysis";

describe("resolveBuyExitDecision", () => {
  it("precat avoid + strong P(plan) and match → hold when prob says hold", () => {
    expect(
      resolveBuyExitDecision("no", "hold", false, {
        precatKind: "avoid",
        probPct: 73,
        matchPct: 96,
      }),
    ).toBe("hold");
  });

  it("precat avoid + weak prob → still exit", () => {
    expect(
      resolveBuyExitDecision("no", "hold", false, {
        precatKind: "avoid",
        probPct: 50,
        matchPct: 79,
      }),
    ).toBe("exit");
  });

  it("precat late is not softened by override", () => {
    expect(
      resolveBuyExitDecision("no", "hold", false, {
        precatKind: "late",
        probPct: 73,
        matchPct: 96,
      }),
    ).toBe("exit");
  });

  it("SDS veto hard-blocks avoid/no", () => {
    expect(
      resolveBuyExitDecision("no", "hold", true, {
        precatKind: "avoid",
        probPct: 80,
        matchPct: 90,
      }),
    ).toBe("exit");
  });

  it("SDS veto softens to review when Top2 yes + precat enter", () => {
    expect(
      resolveBuyExitDecision("yes", "exit", true, {
        precatKind: "enter",
        probPct: 46,
        matchPct: 20,
      }),
    ).toBe("review");
  });

  it("prob exit softens to review when Top2 yes + precat enter", () => {
    expect(
      resolveBuyExitDecision("yes", "exit", false, {
        precatKind: "enter",
        probPct: 46,
        matchPct: 20,
      }),
    ).toBe("review");
  });

  it("watch zone precat override + prob hold → hold", () => {
    expect(
      resolveBuyExitDecision("wait", "hold", false, {
        precatKind: "accumulate",
        probPct: 63,
        matchPct: 78,
        forwardPct: 1.9,
        daysToCd: 110,
        targetProvisional: true,
        dailyPct24h: 2.4,
      }),
    ).toBe("hold");
  });
});
