import { describe, expect, it } from "vitest";
import { resolveEventEis } from "./eventImpactScore";
import { virtualRegulatoryIndicator } from "./regulatoryVirtualKpi";

describe("virtualRegulatoryIndicator", () => {
  it("detects FDA approval", () => {
    const v = virtualRegulatoryIndicator({
      event_title: "FDA approves NDA for paxalisib",
    });
    expect(v?.kpi_type).toBe("regulatory");
    expect(v?.endpoint_met).toBe(true);
    expect(v?.source).toBe("virtual");
  });

  it("detects CRL and clinical hold as negative", () => {
    expect(
      virtualRegulatoryIndicator({ event_title: "FDA issues complete response letter" })
        ?.endpoint_met,
    ).toBe(false);
    expect(
      virtualRegulatoryIndicator({ event_title: "FDA places program on clinical hold" })
        ?.endpoint_met,
    ).toBe(false);
  });

  it("treats clinical hold lifted as positive", () => {
    expect(
      virtualRegulatoryIndicator({ event_title: "FDA clinical hold lifted for XYZ-101" })
        ?.endpoint_met,
    ).toBe(true);
  });

  it("does not treat oncology complete response rate as a CRL", () => {
    expect(
      virtualRegulatoryIndicator({
        event_title: "Phase 2: complete response rate 40% in TNBC",
      }),
    ).toBeNull();
  });

  it("skips pending / seeking approval language", () => {
    expect(
      virtualRegulatoryIndicator({ event_title: "Company seeking FDA approval in 2027" }),
    ).toBeNull();
    expect(
      virtualRegulatoryIndicator({ event_title: "NDA filing pending FDA acceptance" }),
    ).toBeNull();
  });

  it("skips earnings 8-K item 2.02", () => {
    expect(
      virtualRegulatoryIndicator({
        event_title: "Results of operations",
        source_type: "sec_8k",
        items_raw: "2.02",
      }),
    ).toBeNull();
  });

  it("skips when quantitative efficacy KPIs already exist", () => {
    expect(
      virtualRegulatoryIndicator(
        { event_title: "FDA approves NDA" },
        [{ label: "ORR", value: "38%", kpi_type: "efficacy", endpoint_met: true }],
      ),
    ).toBeNull();
  });
});

describe("resolveEventEis + virtual regulatory KPI", () => {
  it("fills eis_intrinsic from an approval title with no quantitative KPIs", () => {
    const b = resolveEventEis(
      {
        event_title: "FDA approved the NDA for asset X",
        source_type: "press_release",
        sentiment: 0,
        price: { delta_p_1d: 4, delta_p_3d: 3 },
      },
      [],
    );
    expect(b).not.toBeNull();
    expect(b!.kpi_score).toBeGreaterThan(0.4);
    expect(b!.eis_intrinsic).toBeGreaterThan(4);
  });
});
