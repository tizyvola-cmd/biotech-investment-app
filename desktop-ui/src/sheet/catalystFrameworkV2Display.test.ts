import { describe, expect, it } from "vitest";
import { computeBiasScore, formatBiasCell, priceVolKindFromLabel } from "./catalystBiasDisplay";
import { formatSilentMoneyCell, formatGovFlagCell } from "./catalystAccumulationDisplay";
import { formatVsXbiCell } from "./catalystVsXbiDisplay";
import { formatUoaCell } from "./catalystUoaDisplay";
import { formatIvrCell, ivrSparklinePath } from "./eventVolIndexDisplay";

describe("catalystBiasDisplay", () => {
  it("maps diverge labels and scores bullish build", () => {
    expect(priceVolKindFromLabel("together ↑")).toBe("together_up");
    const { score, label } = computeBiasScore({
      rr10: 0.08,
      priceVolKind: "together_up",
      insiderNetBuy30d: 5000,
      relativeMove: 0.02,
    });
    expect(score).toBeGreaterThan(0.3);
    expect(label).toBe("bullish_build");
    expect(formatBiasCell({ rr10: 0.08, priceVolKind: "together_up" }, false).tone).toBe("up");
  });

  it("returns em dash when no signs", () => {
    expect(formatBiasCell({}, false).label).toBe("—");
  });
});

describe("accumulation / gov display", () => {
  it("formats Form 4 silent-money headline", () => {
    const accum = formatSilentMoneyCell(
      {
        ticker: "GRAL",
        silent_kind: "form4",
        silent_label: "CEO bought shares",
        silent_date: "2026-09-01",
        insider_net_buy_30d: 12500,
        buy_count_30d: 2,
        cluster_buy: true,
        lead_role: "CEO",
      },
      false,
      false,
    );
    expect(accum.label).toMatch(/CEO/);
    expect(accum.tone).toBe("up");
    expect(accum.sub).toMatch(/\$/);
  });

  it("abbreviates 13D/13G desk labels", () => {
    expect(
      formatSilentMoneyCell(
        {
          ticker: "X",
          silent_kind: "13d",
          silent_label: "New 13D/A beneficial owner",
          form_13d: "13D/A",
          silent_date: "2026-08-14",
        },
        false,
        false,
      ).label,
    ).toBe("Activist >5%");
    expect(
      formatSilentMoneyCell(
        {
          ticker: "Y",
          silent_kind: "13g",
          silent_label: "New 13G/A stake",
          form_13d: "13G/A",
          silent_date: "2026-08-14",
        },
        false,
        false,
      ).label,
    ).toBe("Inst. >5%");
  });

  it("formats gov badge for officer left with role", () => {
    const gov = formatGovFlagCell(
      {
        ticker: "GRAL",
        governance_flag: true,
        gov_date: "2026-08-20",
        gov_label: "Jane Roe left (CMO)",
        officer_departure: true,
      },
      false,
      false,
    );
    expect(gov.label).toMatch(/CMO Left/);
    expect(gov.label).toMatch(/20\/08/);
    expect(gov.tone).toBe("down");
  });

  it("translates officer left in Italian", () => {
    const gov = formatGovFlagCell(
      {
        ticker: "GRAL",
        governance_flag: true,
        gov_date: "2026-08-20",
        gov_label: "Jane Roe left (CMO)",
        officer_departure: true,
      },
      true,
      false,
    );
    expect(gov.label).toMatch(/CMO uscito/);
  });

  it("shows generic Executive Left when no role available", () => {
    const gov = formatGovFlagCell(
      {
        ticker: "GRAL",
        governance_flag: true,
        gov_date: "2026-07-24",
        gov_label: "",
        officer_departure: true,
      },
      false,
      false,
    );
    expect(gov.label).toMatch(/Executive Left/);
    expect(gov.label).toMatch(/24\/07/);
  });

  it("shows appointment as New + role", () => {
    const gov = formatGovFlagCell(
      {
        ticker: "GRAL",
        governance_flag: true,
        gov_date: "2026-08-15",
        gov_label: "John Smith appointed (CEO)",
        officer_departure: false,
      },
      false,
      false,
    );
    expect(gov.label).toMatch(/New CEO/);
    expect(gov.label).toMatch(/15\/08/);
    expect(gov.tone).toBe("warn");
  });
});

describe("vs XBI / UOA display", () => {
  it("colors relative move", () => {
    const cell = formatVsXbiCell(
      { ticker: "GRAL", relative_move: 0.042, stock_return: 0.06, xbi_return: 0.018, horizon_days: 5 },
      false,
      false,
    );
    expect(cell.label).toBe("+4.2%");
    expect(cell.tone).toBe("up");
  });

  it("shows em dash while volume history is building", () => {
    const cell = formatUoaCell(
      {
        ticker: "GRAL",
        uoa_flag: null,
        status: "building_history",
        history_days: 3,
        history_needed: 20,
      },
      false,
      false,
    );
    expect(cell.label).toBe("—");
    expect(cell.tip).toMatch(/3\/20|Building volume history/i);
  });

  it("shows em dash when UOA avg feed is missing", () => {
    const cell = formatUoaCell({ ticker: "GRAL", uoa_flag: null, status: "no_avg_vol_feed" }, false, false);
    expect(cell.label).toBe("—");
    expect(cell.tip).toMatch(/AvgVolume|20d/);
  });
});

describe("IVR slope sparkline", () => {
  it("exposes series and path when history exists", () => {
    const cell = formatIvrCell(
      {
        ticker: "GRAL",
        ivr: 1.5,
        ivr_slope_5d: 0.04,
        ivr_accelerating: true,
        ivr_series: [1.1, 1.2, 1.3, 1.4, 1.5],
        em_straddle: 0.1,
      },
      false,
      false,
    );
    expect(cell.label).toContain("↑");
    expect(cell.accelerating).toBe(true);
    expect(ivrSparklinePath(cell.series ?? [])).toMatch(/^M/);
  });
});
