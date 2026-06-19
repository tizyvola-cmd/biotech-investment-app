import { describe, expect, it } from "vitest";
import {
  buildRaInversePatternAnalysis,
  buildRaInversePatternCsv,
  listRaInverseAnchorEligibility,
  resolveRaInverseAnchorSelection,
  type RaInverseTickerRow,
} from "./rascoreInversePattern";
import type { RaCalibrationSignal } from "./rascoreCalibrationCompute";

function inverseRow(
  ticker: string,
  raScore: number,
  reliabilityPts: number,
): RaInverseTickerRow {
  return {
    ticker,
    raScore,
    components: {
      reliability: { points: reliabilityPts, maxPoints: 25 },
      timing: { points: 5, maxPoints: 18 },
      align: { points: 8, maxPoints: 13 },
      roi_target: { points: 10, maxPoints: 13 },
      sds: { points: 7, maxPoints: 9 },
      precat: { points: 4, maxPoints: 8 },
      mii: { points: 2, maxPoints: 8 },
      calib: { points: 3, maxPoints: 6 },
    },
  };
}

function signal(
  ticker: string,
  longByOffset: Record<number, number>,
): RaCalibrationSignal {
  const priceUpLongByOffset: Partial<Record<number, boolean>> = {};
  for (const [off, chg] of Object.entries(longByOffset)) {
    priceUpLongByOffset[Number(off)] = chg > 0;
  }
  return {
    ticker,
    raScore: 40,
    priceUp7d: Object.values(longByOffset).some((c) => c > 0),
    priceUp24h: Object.values(longByOffset).some((c) => c > 0),
    priceChgLongByOffset: longByOffset,
    priceChgShortByOffset: {},
    priceUpLongByOffset,
    priceUpShortByOffset: {},
  };
}

describe("buildRaInversePatternAnalysis", () => {
  it("splits by price up vs down and compares component fills", () => {
    const rows = [
      inverseRow("A", 50, 20),
      inverseRow("B", 48, 18),
      inverseRow("C", 45, 8),
      inverseRow("D", 42, 6),
    ];
    const signals = [
      signal("A", { [-30]: 12, [-10]: 5 }),
      signal("B", { [-30]: 8, [-10]: -3 }),
      signal("C", { [-30]: -10 }),
      signal("D", { [-30]: -6 }),
    ];
    const result = buildRaInversePatternAnalysis(rows, signals, { offset: -30 });
    expect(result).not.toBeNull();
    expect(result!.upN).toBe(2);
    expect(result!.downN).toBe(2);
    const rel = result!.components.find((c) => c.id === "reliability")!;
    expect(rel.upMeanPct).toBeGreaterThan(rel.downMeanPct!);
    expect(rel.deltaPct).toBeGreaterThan(0);
    expect(rel.pValue).not.toBeNull();
    expect(result!.members).toHaveLength(4);
    const csv = buildRaInversePatternCsv(result!);
    expect(csv).toContain("ticker");
    expect(csv).toContain("A");
    expect(csv).toContain("component_summary");
    expect(result!.scoreMode).toBe("curve_only");
    expect(result!.activeComponentIds).not.toContain("sds");
  });

  it("curve-only excludes snapshot components from RA total and comparison", () => {
    const rows = [
      inverseRow("A", 50, 20),
      inverseRow("B", 48, 18),
      inverseRow("C", 45, 8),
      inverseRow("D", 42, 6),
    ];
    rows[0]!.components.sds = { points: 20, maxPoints: 12 };
    rows[1]!.components.sds = { points: 18, maxPoints: 12 };
    rows[2]!.components.sds = { points: 2, maxPoints: 12 };
    rows[3]!.components.sds = { points: 1, maxPoints: 12 };
    const signals = [
      signal("A", { [-30]: 12 }),
      signal("B", { [-30]: 8 }),
      signal("C", { [-30]: -10 }),
      signal("D", { [-30]: -6 }),
    ];
    const curve = buildRaInversePatternAnalysis(rows, signals, {
      offset: -30,
      scoreMode: "curve_only",
    });
    const full = buildRaInversePatternAnalysis(rows, signals, {
      offset: -30,
      scoreMode: "full",
    });
    expect(curve!.upMeanRa).toBeLessThan(full!.upMeanRa!);
    expect(curve!.components.some((c) => c.id === "sds")).toBe(false);
    expect(curve!.fullRaDelta).toBe(full!.raDelta);
  });

  it("full mode includes all eight components", () => {
    const rows = [
      inverseRow("A", 50, 20),
      inverseRow("B", 48, 18),
      inverseRow("C", 45, 8),
      inverseRow("D", 42, 6),
    ];
    const signals = [
      signal("A", { [-30]: 12 }),
      signal("B", { [-30]: 8 }),
      signal("C", { [-30]: -10 }),
      signal("D", { [-30]: -6 }),
    ];
    const result = buildRaInversePatternAnalysis(rows, signals, {
      offset: -30,
      scoreMode: "full",
    });
    expect(result!.components).toHaveLength(8);
    expect(result!.fullRaDelta).toBeUndefined();
  });

  it("returns null when too few classified rows", () => {
    const rows = [inverseRow("A", 50, 20)];
    const signals = [signal("A", { [-30]: 12 })];
    expect(buildRaInversePatternAnalysis(rows, signals, { offset: -30 })).toBeNull();
  });

  it("marks near-CD anchors sparse when only few tickers have paths", () => {
    const rows = [
      inverseRow("A", 50, 20),
      inverseRow("B", 48, 18),
      inverseRow("C", 45, 8),
      inverseRow("D", 42, 6),
    ];
    const signals = [
      signal("A", { [-30]: 12, [-10]: 5 }),
      signal("B", { [-30]: 8, [-10]: -3 }),
      signal("C", { [-30]: -10 }),
      signal("D", { [-30]: -6 }),
    ];
    const elig = listRaInverseAnchorEligibility(rows, signals);
    const t30 = elig.find((r) => r.offset === -30)!;
    const t10 = elig.find((r) => r.offset === -10)!;
    expect(t30.tableReady).toBe(true);
    expect(t10.total).toBe(2);
    expect(t10.tableReady).toBe(false);
  });
});

describe("resolveRaInverseAnchorSelection", () => {
  it("preserves user anchor when still present in eligibility", () => {
    const elig = listRaInverseAnchorEligibility(
      [
        inverseRow("A", 50, 20),
        inverseRow("B", 48, 18),
        inverseRow("C", 45, 8),
        inverseRow("D", 42, 6),
      ],
      [
        signal("A", { [-60]: 12, [-30]: 5 }),
        signal("B", { [-60]: 8, [-30]: -3 }),
        signal("C", { [-60]: -10, [-30]: -2 }),
        signal("D", { [-60]: -6, [-30]: 1 }),
      ],
    );
    expect(resolveRaInverseAnchorSelection(-30, elig)).toBe(-30);
  });

  it("falls back to table-ready anchor when previous is missing", () => {
    const elig = listRaInverseAnchorEligibility(
      [
        inverseRow("A", 50, 20),
        inverseRow("B", 48, 18),
        inverseRow("C", 45, 8),
        inverseRow("D", 42, 6),
      ],
      [
        signal("A", { [-60]: 12 }),
        signal("B", { [-60]: 8 }),
        signal("C", { [-60]: -10 }),
        signal("D", { [-60]: -6 }),
      ],
    );
    expect(resolveRaInverseAnchorSelection(-30, elig)).toBe(-60);
  });
});
