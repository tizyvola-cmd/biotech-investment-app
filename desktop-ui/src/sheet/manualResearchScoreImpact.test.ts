import { describe, expect, it } from "vitest";
import { parseManualFeedFreeText } from "./manualFeedEvents";
import { previewManualFeedEis } from "./manualFeedSubmit";
import {
  buildManualCatalystPreviewCard,
  buildManualResearchScoreImpact,
  parseScoreTargetsBlock,
} from "./manualResearchScoreImpact";

const JSPR = `TICKER: JSPR (Jasper Therapeutics, Inc.)
EVENT_DATE: 2026-07-16
FIRST_TRADABLE: 2026-07-17
VAR_24H: NOT SUPPLIED — see DATA CONFLICT
OUTCOME: neutral
SENTIMENT: -1
CONFIDENCE: medium — price reaction unverified
HOLDER_LENS: legacy_common
DILUTION_PCT: 93.3
PRICE_VERIFIED: no
NEWS: All-stock acquisition of Kira; de facto reverse merger.
---
CAUSE_CLASS: company_catalyst
EVENT_SUBTYPE: mna
EXPLAINS_MOVE: partial
LEARNING_TAG: reverse_merger_heavy_dilution
Dilution to legacy common: ~93.3%. Prior leans negative_catalyst.
DATA CONFLICT — RESOLVE BEFORE SCORING. Do not import either figure.
`;

describe("buildManualResearchScoreImpact", () => {
  it("maps JSPR research onto multiple score rows", () => {
    const parsed = parseManualFeedFreeText(JSPR);
    expect(parsed).not.toBeNull();
    const eis = previewManualFeedEis(parsed!);
    const impact = buildManualResearchScoreImpact({ parsed: parsed!, eis });
    expect(impact.dilutionPct).toBe(93.3);
    expect(impact.priceUnverified).toBe(true);
    expect(impact.chips.join(" ")).toMatch(/dilution/i);
    const ids = impact.rows.map((r) => r.id);
    expect(ids).toContain("eis");
    expect(ids).toContain("residual");
    expect(ids).toContain("nearest_eis_pplan");
    expect(ids).toContain("decision_chart");
    const residual = impact.rows.find((r) => r.id === "residual");
    expect(residual?.strength).toBe("direct");
    expect(residual?.noteEn).toMatch(/dilution/i);
    const rescue = impact.rows.find((r) => r.id === "rescue_context");
    expect(rescue?.strength).toBe("context");
  });

  it("builds compact catalyst card with score effects (no prose dump)", () => {
    const raw = `MANUAL EIS — JSPR
TICKER: JSPR
EVENT_DATE: 2026-07-16, after market close
FIRST_TRADABLE: 2026-07-17
VAR_24H: NOT SUPPLIED — see DATA CONFLICT
OUTCOME: negative_catalyst
SENTIMENT: -1
CONFIDENCE: medium — event fully documented in 8-K, price reaction unverified
NEWS: Jasper closes all-stock Kira acquisition plus ~$132M PIPE; legacy holders cut to 6.68% fully diluted
CAUSE_CLASS: company_catalyst
EXPLAINS_MOVE: partial
HOLDER_LENS: legacy_common
DILUTION_PCT: 93.3
PRICE_VERIFIED: no
EVENT_SUBTYPE: mna
DRUG_OR_ASSET: KP-104, briquilimab, KP-701
NCT_OR_FILING: 8-K 2026-07-16; PR 2026-07-16
LEARNING_TAG: reverse_merger_heavy_dilution
SCORE_TARGETS:
EIS: negative, high magnitude — structural ownership event
RESIDUAL: company
P_PLAN_VIA_EIS: down
DECISION_CHART: legacy thesis void; re-anchor to newco
GAIN_STAR: no
NOTE: Resilience/SDS scores are NOT overwritten
DATA CONFLICT — RESOLVE BEFORE SCORING
Do not import either figure.
`;
    const parsed = parseManualFeedFreeText(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toMatch(/Kira|PIPE|legacy/i);
    expect(parsed!.attribution?.dilutionPct).toBe(93.3);
    const targets = parseScoreTargetsBlock(`${parsed!.title}\n${parsed!.body}\n${raw}`);
    expect(targets.RESIDUAL).toBe("company");
    expect(targets.P_PLAN_VIA_EIS).toBe("down");
    const card = buildManualCatalystPreviewCard({
      parsed: parsed!,
      eis: previewManualFeedEis(parsed!),
      lang: "en",
    });
    expect(card.headline).toMatch(/Kira|PIPE/i);
    expect(card.subtype).toBe("mna");
    expect(card.dilutionPct).toBe(93.3);
    expect(card.facts.some((f) => /dilution/i.test(f))).toBe(true);
    expect(card.effects.some((e) => e.label === "EIS")).toBe(true);
    expect(card.effects.some((e) => e.label === "P(plan)" && /down/i.test(e.value))).toBe(true);
    expect(card.headline).not.toMatch(/WHAT_HAPPENED|COUNTER_EVIDENCE|SOURCES_CHECKED/i);
  });
});
