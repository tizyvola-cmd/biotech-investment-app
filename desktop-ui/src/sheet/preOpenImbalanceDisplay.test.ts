import { describe, expect, it } from "vitest";
import { formatPreOpenImbalanceCell } from "./preOpenImbalanceDisplay";

describe("formatPreOpenImbalanceCell", () => {
  it("renders Buy badge with indicative move and excess shares in tip", () => {
    const cell = formatPreOpenImbalanceCell(
      {
        ticker: "ETON",
        in_window: true,
        venue: "nasdaq",
        dataset: "XNAS.ITCH",
        direction: "Buy",
        indicative_move_pct: 3.2,
        imbalance_shares: 40_000,
        paired_shares: 100_000,
        imbalance_ratio: 0.4,
        imbalance_accelerating: true,
        status: "ok",
      },
      false,
      false,
    );
    expect(cell.label).toBe("▲ Buy +3.2% ind. · accel.");
    expect(cell.tone).toBe("up");
    expect(cell.tip).toContain("Excess shares: 40k");
    expect(cell.tip).toContain("does not replace Recommendation/Signal");
  });

  it("shows em dash outside the transmission window (never stale)", () => {
    const cell = formatPreOpenImbalanceCell(
      {
        ticker: "ETON",
        in_window: false,
        direction: null,
        indicative_move_pct: null,
        imbalance_shares: null,
        status: "outside_window",
      },
      false,
      false,
    );
    expect(cell.label).toBe("—");
    expect(cell.tone).toBe("none");
    expect(cell.tip).toMatch(/Outside the transmission window/i);
  });

  it("omits accelerating when fewer than two snapshots", () => {
    const cell = formatPreOpenImbalanceCell(
      {
        ticker: "ETON",
        in_window: true,
        direction: "Sell",
        indicative_move_pct: -1.5,
        imbalance_shares: 12_000,
        imbalance_accelerating: null,
        status: "ok",
      },
      false,
      false,
    );
    expect(cell.label).toBe("▼ Sell -1.5% ind.");
    expect(cell.tone).toBe("down");
    expect(cell.tip).toMatch(/direction only/i);
  });
});
