import { describe, expect, it } from "vitest";
import {
  buildMigSlopeTooltip,
  migDeltaDivergesFrom24h,
  resolveMigDeltaSourceId,
} from "./marketInterestTooltips";
import type { MIGResult } from "./marketInterestGate";

const tr = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("marketInterestTooltips", () => {
  it("detects 1M vs 24h sign divergence", () => {
    expect(
      migDeltaDivergesFrom24h(
        { deltaPricePct: -5.6, deltaSource: "Var.1M→5d" },
        2.07,
      ),
    ).toBe(true);
    expect(
      migDeltaDivergesFrom24h(
        { deltaPricePct: -5.6, deltaSource: "Var.giorn×5" },
        2.07,
      ),
    ).toBe(false);
  });

  it("buildMigSlopeTooltip includes delta source", () => {
    const row = {
      detail: "ΔP -5.6% · Vol 1.2×",
      deltaPricePct: -5.6,
      deltaSource: "Var.1M→5d",
      slopeAngleDeg: -27,
      lowVolumePenalty: false,
    } as MIGResult;
    const tip = buildMigSlopeTooltip(row, 2.07, tr);
    expect(tip).toContain("signals.mig.deltaSource.var1m");
    expect(tip).toContain("signals.mig.deltaSource.divergence");
  });

  it("resolveMigDeltaSourceId normalizes unknown", () => {
    expect(resolveMigDeltaSourceId("Var.1M→5d")).toBe("Var.1M→5d");
    expect(resolveMigDeltaSourceId(undefined)).toBe("missing");
  });
});
