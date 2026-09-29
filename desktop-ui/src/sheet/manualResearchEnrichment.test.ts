import { describe, expect, it } from "vitest";
import {
  enrichManualAttributionFromResearch,
  extractResearchEventDate,
  extractResearchEventTitle,
  parseLegacyDilutionPct,
  refineOutcomeFromResearchProse,
} from "./manualResearchEnrichment";
import {
  parseManualCitedPriceMovePct,
  parseManualFeedFreeText,
  resolveManualEventClassification,
  resolveManualEventEis,
} from "./manualFeedEvents";

const JSPR_RESEARCH = `MANUAL EIS — JSPR  [1 of 2]

TICKER:            JSPR (Jasper Therapeutics, Inc.)
EVENT_DATE:        2026-07-16, after market close (~17:15 ET)
FIRST_TRADABLE:    2026-07-17
VAR_24H:           NOT SUPPLIED — see DATA CONFLICT
XBI SAME DAY:      NOT SUPPLIED

OUTCOME:           neutral
SENTIMENT:         -1
CONFIDENCE:        medium — event fully documented, price reaction unverified

EVENT
  Jasper announced completion of the all-stock acquisition of Kira
  Pharmaceuticals, with a concurrent ~$132M private placement of preferred
  stock (~4.7M shares). Source: press release 2026-07-16 and Form 8-K same
  date. Combined company continues to trade as JSPR.

  This is the material, company-specific, information-bearing event.
  It is a de facto reverse merger, not a financing.

STRUCTURE (fully diluted, per 8-K)
  Pre-deal Jasper holders:    6.68%
  Kira holders:              49.86%
  PIPE investors:            43.46%
  Shares as-converted:       ~653.6M  (from ~28.6M)
  Dilution to legacy common: ~93.3%
  Consideration to legacy:   non-transferable CVR

SENTIMENT RATIONALE
  -1, not -2 or 0. News tone is genuinely two-sided: near-total dilution of
  the legacy equity base against survival. Weighted negative for the existing common
  holder, who retains 6.68% of a different company.

EVENT_NATURE:      information
DATE_SOURCE:       company_guided

TICKER vs SECTOR vs MACRO
  Ticker-specific:   YES — exclusive to JSPR
  Peer/sector:       not assessed, XBI comparator not supplied
  Macro/geo:         no channel identified

DATA CONFLICT — RESOLVE BEFORE SCORING
  Do not import either figure. Pull 07-16 and 07-17 from primary feed.

TO RESOLVE
  Supply 2026-07-17 P_prev_close / P_open / P_close. Prior leans negative_catalyst for legacy common given
  93.3% dilution; revise OUTCOME once direction is verified.
`;

describe("manualResearchEnrichment (JSPR-style)", () => {
  it("parses dilution and upgrades neutral → negative_catalyst", () => {
    expect(parseLegacyDilutionPct(JSPR_RESEARCH)).toBe(93.3);
    expect(
      refineOutcomeFromResearchProse(JSPR_RESEARCH, "neutral", -1),
    ).toBe("negative_catalyst");
  });

  it("infers company_catalyst + mna + partial explain", () => {
    const attr = enrichManualAttributionFromResearch(JSPR_RESEARCH, {
      confidence: "medium",
    });
    expect(attr?.causeClass).toBe("company_catalyst");
    expect(attr?.eventSubtype).toBe("mna");
    expect(attr?.explainsMove).toBe("partial");
    expect(attr?.learningTag).toMatch(/reverse_merger|dilution/);
  });

  it("extracts first tradable date and event title", () => {
    expect(extractResearchEventDate(JSPR_RESEARCH)).toBe("2026-07-17");
    const title = extractResearchEventTitle(JSPR_RESEARCH, "JSPR");
    expect(title).toMatch(/Kira|acquisition|Jasper/i);
  });
});

describe("parseManualFeedFreeText JSPR research → EIS", () => {
  it("ingests Claude free-form block into scorable draft", () => {
    const p = parseManualFeedFreeText(JSPR_RESEARCH);
    expect(p).not.toBeNull();
    expect(p!.ticker).toBe("JSPR");
    expect(p!.eventDate).toBe("2026-07-17");
    expect(p!.priceDropPct).toBeNull();
    expect(p!.sentiment).toBe(-1);
    expect(p!.investigationOutcome).toBe("negative_catalyst");
    expect(p!.attribution?.causeClass).toBe("company_catalyst");
    expect(p!.attribution?.confidence).toBe("medium");
    expect(p!.attribution?.explainsMove).toBe("partial");
    expect(p!.title).toMatch(/Kira|acquisition|Jasper/i);
    expect(p!.parseWarnings).toContain("price_unverified");

    const eis = resolveManualEventEis({
      id: "manual_jspr",
      createdAt: "2026-07-17T12:00:00Z",
      ticker: p!.ticker,
      eventDate: p!.eventDate,
      source: p!.source,
      title: p!.title,
      body: p!.body,
      sentiment: p!.sentiment,
      priceDropPct: p!.priceDropPct,
      investigationOutcome: p!.investigationOutcome,
      attribution: p!.attribution,
    });
    // Soft negative (no verified VAR_24H) — not recovery-leaning positive.
    expect(eis.score).toBeLessThan(0);
    expect(eis.score).toBeGreaterThan(-8);
  });
});

/** Aug-5 distress note: integrity / class action / strategic alternatives — not a closed RM. */
const JSPR_DISTRESS_AUG5 = `Jasper is a clinical-stage biotech developing briquilimab, an anti-CD117 monoclonal antibody targeting mast-cell driven diseases — chronic spontaneous and chronic inducible urticaria, and asthma. The core problem driving the stock isn't a single-day catalyst, it's an unresolved overhang: earlier this year, data anomalies surfaced in the BEACON chronic urticaria study, triggering an internal investigation. That kind of finding — a data-integrity question in a pivotal trial — is about as damaging as it gets for a small biotech's credibility, and the market has priced it that way ever since. TD Cowen downgraded the stock to Hold in May, explicitly calling the company "at a critical juncture." Multiple plaintiffs' firms (Rosen, Bragar Eagel & Squire) have opened securities class-action investigations. On June 1st the board announced a formal review of strategic alternatives. In biotech, that phrase is rarely read as a growth signal — it typically means the company is exploring a sale, a reverse merger, or in the worst case a wind-down, because the standalone path no longer looks viable or credible to the board itself. Financially, the stock reflects all of this: trading around $0.62, 52-week range $0.315–$3.14, market cap roughly $20M — effectively a shell-level valuation. The small moves you're seeing day to day — a -3.76% close on Aug 3, a +2.26% pre-market tick on Aug 4 — are noise on thin, wide-spread trading. This isn't a fresh catalyst; it's a distressed microcap overhang.`;

describe("JSPR Aug-5 distress note → negative EIS", () => {
  it("does not scrape pre-market tick as VAR_24H", () => {
    expect(parseManualCitedPriceMovePct(JSPR_DISTRESS_AUG5)).toBeNull();
  });

  it("tags strategic_review_distress, not reverse_merger", () => {
    const attr = enrichManualAttributionFromResearch(JSPR_DISTRESS_AUG5, {
      causeClass: "company_catalyst",
      eventSubtype: "mna",
      learningTag: "reverse_merger",
    });
    expect(attr?.learningTag).toBe("strategic_review_distress");
    expect(attr?.eventSubtype).toBeNull();
  });

  it("scores negative even with stored sentiment 0 and stale mna tags", () => {
    const draft = {
      id: "manual_jspr_distress",
      createdAt: "2026-08-05T12:00:00Z",
      ticker: "JSPR",
      eventDate: "2026-08-05",
      source: "Manual entry",
      title: "Jasper is a clinical-stage biotech developing briquilimab",
      body: JSPR_DISTRESS_AUG5,
      sentiment: 0,
      priceDropPct: null,
      attribution: {
        causeClass: "company_catalyst" as const,
        eventSubtype: "mna" as const,
        learningTag: "reverse_merger",
      },
    };
    const cls = resolveManualEventClassification(draft);
    expect(cls.investigationOutcome).toBe("negative_catalyst");
    expect(cls.sentiment).toBeLessThan(0);
    const eis = resolveManualEventEis(draft);
    expect(eis.score).toBeLessThan(0);
  });
});
