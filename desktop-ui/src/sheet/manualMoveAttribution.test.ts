import { describe, expect, it } from "vitest";
import { computeEis } from "./eventImpactScore";
import {
  applyManualAttributionToEis,
  investigationOutcomeFromCauseClass,
  manualAttributionMarketBoostShare,
  manualAttributionScoreMultiplier,
  parseManualMoveAttribution,
} from "./manualMoveAttribution";
import {
  buildManualAttributionMemory,
  memoryEisMultiplier,
} from "./manualAttributionMemory";
import { parseManualFeedFreeText, scoreManualLossInvestigationEis } from "./manualFeedEvents";

describe("parseManualMoveAttribution", () => {
  it("parses Claude research tags", () => {
    const attr = parseManualMoveAttribution(`
CAUSE_CLASS: macro_geopolitical
CONFIDENCE: high
EXPLAINS_MOVE: full
EVENT_SUBTYPE: macro_geo
PEER_XBI_SAME_DAY: -1.8%
LEARNING_TAG: geo_riskoff_no_company_news
GEOPOLITICAL_OR_MACRO: risk-off biotech
`);
    expect(attr?.causeClass).toBe("macro_geopolitical");
    expect(attr?.confidence).toBe("high");
    expect(attr?.explainsMove).toBe("full");
    expect(attr?.eventSubtype).toBe("macro_geo");
    expect(attr?.peerXbiSameDayPct).toBe(-1.8);
    expect(attr?.learningTag).toBe("geo_riskoff_no_company_news");
  });

  it("maps cause class to investigation outcome", () => {
    expect(investigationOutcomeFromCauseClass("market_noise", -6, 0)).toBe("no_catalyst");
    expect(investigationOutcomeFromCauseClass("company_catalyst", -8, -0.5)).toBe(
      "negative_catalyst",
    );
    expect(investigationOutcomeFromCauseClass("company_catalyst", 9, 0.6)).toBe(
      "positive_catalyst",
    );
    // Negative research tone wins over a scraped micro-tick up-move.
    expect(investigationOutcomeFromCauseClass("company_catalyst", 2.26, -0.85)).toBe(
      "negative_catalyst",
    );
  });
});

describe("attribution → EIS", () => {
  it("damps score when EXPLAINS_MOVE is none", () => {
    const base = computeEis(-8, -5, 1.15, -0.8);
    const damped = applyManualAttributionToEis(base, {
      causeClass: "company_catalyst",
      explainsMove: "none",
      confidence: "medium",
    });
    expect(Math.abs(damped.score)).toBeLessThan(Math.abs(base.score));
  });

  it("amplifies company catalyst when explains full + high confidence", () => {
    const m = manualAttributionScoreMultiplier({
      causeClass: "company_catalyst",
      explainsMove: "full",
      confidence: "high",
    });
    expect(m).toBeGreaterThan(1);
  });

  it("parses research block into draft attribution and scores no_catalyst geo", () => {
    const raw = `TICKER: VIR
DATE: 2026-07-21
OUTCOME: no_catalyst
VAR_24H: -6.4%
SOURCE: Manual research
NEWS: Nessuna news materiale — risk-off
---
CAUSE_CLASS: macro_geopolitical
CONFIDENCE: high
EXPLAINS_MOVE: full
PEER_XBI_SAME_DAY: -2.1%
LEARNING_TAG: geo_riskoff
`;
    const p = parseManualFeedFreeText(raw);
    expect(p).not.toBeNull();
    expect(p!.attribution?.causeClass).toBe("macro_geopolitical");
    expect(p!.investigationOutcome).toBe("no_catalyst");
    const eis = scoreManualLossInvestigationEis({
      priceChangePct: p!.priceDropPct,
      sentiment: p!.sentiment ?? 0,
      investigationOutcome: p!.investigationOutcome!,
      attribution: p!.attribution,
    });
    expect(eis.score).toBeGreaterThan(0);
  });
});

describe("manualAttributionMarketBoostShare", () => {
  it("boosts market channel for noise/geo with full explain", () => {
    const share = manualAttributionMarketBoostShare({
      causeClass: "market_noise",
      explainsMove: "full",
      confidence: "high",
      peerXbiSameDayPct: -2,
    });
    expect(share).toBeGreaterThan(0.2);
  });

  it("is zero for company catalyst", () => {
    expect(
      manualAttributionMarketBoostShare({
        causeClass: "company_catalyst",
        explainsMove: "full",
        confidence: "high",
      }),
    ).toBe(0);
  });
});

describe("manualAttributionMemory", () => {
  it("builds buckets and applies mild prior after min N", () => {
    const sources = Array.from({ length: 4 }, (_, i) => ({
      ticker: `T${i}`,
      priceDropPct: -6,
      attribution: {
        causeClass: "market_noise" as const,
        explainsMove: "full" as const,
        confidence: "high" as const,
        learningTag: "no_news_sector_selloff",
      },
      eisScore: 2.5,
    }));
    const mem = buildManualAttributionMemory(sources);
    expect(mem.totalAttributed).toBe(4);
    expect(mem.byCause.market_noise?.n).toBe(4);
    const mul = memoryEisMultiplier(
      mem,
      { causeClass: "market_noise", learningTag: "no_news_sector_selloff" },
      4,
    );
    expect(mul).toBeGreaterThanOrEqual(0.85);
    expect(mul).toBeLessThanOrEqual(1.15);
  });
});
