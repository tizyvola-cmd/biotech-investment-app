import { describe, expect, it } from "vitest";
import {
  assignOverlapLanesByX,
  catalystBadgeBox,
  catalystPhaseShort,
} from "./catalystChartLanes";

describe("catalystPhaseShort", () => {
  it("normalizes CT.gov PHASE2 glue and Phase 2", () => {
    expect(catalystPhaseShort("PHASE2")).toBe("2");
    expect(catalystPhaseShort("Phase 2")).toBe("2");
    expect(catalystPhaseShort("PHASE 2 / PHASE 3")).toBe("2/3");
    expect(catalystPhaseShort(null)).toBeNull();
  });

  it("badge label is CD Ph2 not CD PhPHASE2", () => {
    expect(catalystBadgeBox("cd", "PHASE2", "30 Sept").label).toBe("CD Ph2");
  });
});

describe("assignOverlapLanesByX", () => {
  it("keeps far-apart markers on lane 0", () => {
    const lanes = assignOverlapLanesByX(
      [
        { xIndex: 0, widthPx: 70 },
        { xIndex: 40, widthPx: 70 },
      ],
      41,
    );
    expect(lanes).toEqual([0, 0]);
  });

  it("drops the middle banner to lane 1 when two neighbors overlap it", () => {
    const pdufa = catalystBadgeBox("pdufa", null, "29 Nov");
    const readout = catalystBadgeBox("readout", null, "1 Jan");
    const lanes = assignOverlapLanesByX(
      [
        { xIndex: 18, widthPx: pdufa.w },
        { xIndex: 20, widthPx: readout.w },
        { xIndex: 22, widthPx: pdufa.w },
      ],
      24,
    );
    expect(lanes[0]).toBe(0);
    expect(lanes[1]).toBeGreaterThan(0);
    expect(lanes[2]).toBe(0);
    expect(new Set(lanes).size).toBeGreaterThan(1);
  });

  it("stacks same-x markers on successive lanes", () => {
    const lanes = assignOverlapLanesByX(
      [
        { xIndex: 10, widthPx: 80 },
        { xIndex: 10, widthPx: 80 },
      ],
      20,
    );
    expect([...lanes].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("caps same-x stacks at two lanes and hides the rest so banners cannot eat the plot", () => {
    const lanes = assignOverlapLanesByX(
      [
        { xIndex: 0, widthPx: 80 },
        { xIndex: 0, widthPx: 80 },
        { xIndex: 0, widthPx: 80 },
        { xIndex: 0, widthPx: 80 },
        { xIndex: 0, widthPx: 80 },
      ],
      20,
    );
    const visible = lanes.filter((l) => l >= 0);
    expect(visible).toEqual([0, 1]);
    expect(lanes.filter((l) => l < 0)).toHaveLength(3);
  });
});
