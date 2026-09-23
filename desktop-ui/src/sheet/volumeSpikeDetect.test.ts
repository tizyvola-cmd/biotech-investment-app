import { describe, expect, it } from "vitest";
import { detectVolumeSpike } from "./volumeSpikeDetect";

describe("detectVolumeSpike", () => {
  it("detects sharp spike vs flat baseline (chart-style)", () => {
    const bars = [
      ...Array.from({ length: 20 }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, "0")}`,
        volume: 1_500_000 + (i % 3) * 100_000,
      })),
      { date: "2026-06-01", volume: 7_800_000 },
    ];
    const hit = detectVolumeSpike(bars);
    expect(hit).not.toBeNull();
    expect(hit!.spikeVolume).toBe(7_800_000);
    expect(hit!.ratio).toBeGreaterThan(3);
  });

  it("returns null when latest day is normal", () => {
    const bars = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-05-${String((i % 28) + 1).padStart(2, "0")}`,
      volume: 1_200_000,
    }));
    expect(detectVolumeSpike(bars)).toBeNull();
  });
});
