import { describe, expect, it } from "vitest";
import {
  applySearchBuzzConfirm,
  formatPreMktConvictionCell,
} from "./preMktConvictionDisplay";

describe("formatPreMktConvictionCell", () => {
  it("renders together-up badge and confirmed flag", () => {
    const cell = formatPreMktConvictionCell(
      {
        ticker: "ETON",
        is_proxy: true,
        conviction: "together_up",
        pre_mkt_price_change_pct: 2.1,
        pre_mkt_vol_ratio: 2.3,
        conviction_confirmed: true,
        status: "ok",
      },
      false,
      false,
    );
    expect(cell.label).toBe("▲ +2.1% (vol 2.3x)");
    expect(cell.tone).toBe("up");
    expect(cell.confirmed).toBe(true);
    expect(cell.tip).toMatch(/NOT the official order imbalance/i);
    expect(cell.tip).not.toMatch(/\bNOII badge\b/i);
  });

  it("shows em dash when no pre-market trades", () => {
    const cell = formatPreMktConvictionCell(
      {
        ticker: "ETON",
        is_proxy: true,
        conviction: null,
        status: "no_premarket_trades",
      },
      false,
      false,
    );
    expect(cell.label).toBe("—");
    expect(cell.confirmed).toBe(false);
  });

  it("omits confirmed when Search Buzz missing", () => {
    const cell = formatPreMktConvictionCell(
      {
        ticker: "ETON",
        is_proxy: true,
        conviction: "together_down",
        pre_mkt_price_change_pct: -1.2,
        pre_mkt_vol_ratio: 1.8,
        conviction_confirmed: null,
        status: "ok",
      },
      false,
      false,
    );
    expect(cell.label).toBe("▼ -1.2% (vol 1.8x)");
    expect(cell.confirmed).toBe(false);
    expect(cell.tip).toMatch(/base badge only/i);
  });

  it("renders diverge without vol ratio", () => {
    const cell = formatPreMktConvictionCell(
      {
        ticker: "AAPL",
        is_proxy: true,
        conviction: "diverge",
        pre_mkt_price_change_pct: 0.4,
        pre_mkt_vol_ratio: null,
        status: "prior_session",
        session_date: "2026-09-04",
      },
      false,
      false,
    );
    expect(cell.label).toBe("▲ +0.4%");
    expect(cell.tone).toBe("up");
    expect(cell.sub).toMatch(/prior/i);
    expect(cell.tip).toMatch(/volume unavailable/i);
  });

  it("colors diverge down when pre-mkt price is negative", () => {
    const cell = formatPreMktConvictionCell(
      {
        ticker: "XYZ",
        is_proxy: true,
        conviction: "diverge",
        pre_mkt_price_change_pct: -1.5,
        pre_mkt_vol_ratio: null,
        status: "ok",
      },
      false,
      false,
    );
    expect(cell.tone).toBe("down");
    expect(cell.label).toBe("▼ -1.5%");
  });
});

describe("applySearchBuzzConfirm", () => {
  it("sets confirmed when G-Trends aligns with together-up", () => {
    const row = applySearchBuzzConfirm(
      {
        ticker: "ETON",
        conviction: "together_up",
        pre_mkt_price_change_pct: 2.1,
        pre_mkt_vol_ratio: 2.3,
        conviction_confirmed: null,
      },
      12,
    );
    expect(row?.conviction_confirmed).toBe(true);
  });
});
