import { describe, expect, it } from "vitest";
import {
  formatSec8kItemsLine,
  formatTickerEisEventRichContext,
} from "./tickerEisEventRich";
import type { TickerEisEventDetail } from "./tickerEisSummary";

function ev(partial: Partial<TickerEisEventDetail> & Pick<TickerEisEventDetail, "breakdown">): TickerEisEventDetail {
  return {
    eventDate: "2026-02-26",
    title: "Results of operations (earnings)",
    sourceType: "sec_8k",
    sourceLabel: "SEC 8-K",
    nctId: null,
    studyTitle: "",
    studyUrl: null,
    indicators: [],
    impactNote: "+7.2% T+1",
    link: null,
    summary: null,
    ...partial,
  };
}

describe("tickerEisEventRich", () => {
  it("formats 8-K item codes into readable labels", () => {
    expect(formatSec8kItemsLine("2.02, 7.01", "en")).toBe(
      "8-K items: Results of operations (earnings) · Regulation FD disclosure",
    );
    expect(formatSec8kItemsLine("2.02, 8.01", "it")).toBe(
      "Voci 8-K: Risultati operativi (utili) · Altri eventi materiali (comunicato stampa)",
    );
  });

  it("surfaces earnings summary and market reaction", () => {
    const ctx = formatTickerEisEventRichContext(
      ev({
        itemsRaw: "2.02",
        summary: "Q4 2025 EPS $0.42 vs $0.38 est · revenue $1.02B (+4% YoY)",
        breakdown: {
          score: 7.2,
          delta_p_1d: 7.2,
          delta_p_3d: 5.1,
          vol_term: 1.2,
          kpi_score: null,
          sent_term: 0.4,
          weights: { w1: 0.4, w2: 0.25, w3: 0.15, w4: 0.2 },
        },
        indicators: [{ label: "EPS", value: "$0.42", unit: null, kpi_type: "other" }],
      }),
      "en",
    );
    expect(ctx.itemsLine).toContain("Results of operations");
    expect(ctx.summaryLine).toContain("EPS $0.42");
    expect(ctx.reactionLine).toContain("ΔP 1d +7.2%");
    expect(ctx.kpiLine).toContain("EPS: $0.42");
  });

  it("localizes stored Italian clinical labels in English KPI line", () => {
    const ctx = formatTickerEisEventRichContext(
      ev({
        breakdown: {
          score: 1,
          delta_p_1d: null,
          delta_p_3d: null,
          vol_term: 0,
          kpi_score: 0.5,
          sent_term: 0,
          weights: { w1: 0.4, w2: 0.25, w3: 0.15, w4: 0.2 },
        },
        indicators: [{ label: "Esito studio", value: "ongoing", vs_soc: "better" }],
      }),
      "en",
    );
    expect(ctx.kpiLine).toContain("Study outcome: ongoing");
    expect(ctx.kpiLine).toContain("better");
    const itCtx = formatTickerEisEventRichContext(
      ev({
        breakdown: {
          score: 1,
          delta_p_1d: null,
          delta_p_3d: null,
          vol_term: 0,
          kpi_score: 0.5,
          sent_term: 0,
          weights: { w1: 0.4, w2: 0.25, w3: 0.15, w4: 0.2 },
        },
        indicators: [{ label: "Esito studio", value: "ongoing", vs_soc: "better" }],
      }),
      "it",
    );
    expect(itCtx.kpiLine).toContain("Esito studio: in corso");
    expect(itCtx.kpiLine).toContain("migliore");
  });
});
