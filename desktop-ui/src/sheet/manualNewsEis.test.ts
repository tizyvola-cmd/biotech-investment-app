import { describe, expect, it } from "vitest";
import {
  classifyManualNewsEisKind,
  formatManualNewsEisShort,
  scoreManualNewsIntrinsic,
  scoreManualNewsKpi,
} from "./manualNewsEis";
import {
  resolveManualEventClassification,
  resolveManualEventEis,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";

function draft(partial: Partial<ManualFeedEventDraft> & Pick<ManualFeedEventDraft, "id" | "ticker" | "title">): ManualFeedEventDraft {
  return {
    createdAt: "2026-09-02T07:00:00Z",
    eventDate: "2026-08-13",
    source: "Manual entry",
    body: partial.body ?? partial.title,
    sentiment: partial.sentiment ?? 0.85,
    ...partial,
  };
}

describe("manualNewsEis", () => {
  it("classifies clinical vs financial paste", () => {
    expect(
      classifyManualNewsEisKind(
        "Cellectar reported Phase 2b CLOVER WaM clinical data for iopofosine",
      ),
    ).toBe("clinical");
    expect(
      classifyManualNewsEisKind(
        "CLRB (Nasdaq) | Company: Cellectar | Q2 2026 financial results. Cash and equivalents $34.0 million",
      ),
    ).toBe("financial");
  });

  it("dampens neutral news vs positive catalyst", () => {
    const pos = scoreManualNewsKpi({
      sentiment: 0.85,
      investigationOutcome: "positive_catalyst",
      kind: "clinical",
    });
    const neu = scoreManualNewsKpi({
      sentiment: 0.85,
      investigationOutcome: "neutral",
      kind: "financial",
    });
    expect(pos).toBeGreaterThan(neu);
    expect(scoreManualNewsIntrinsic({
      sentiment: 0.85,
      investigationOutcome: "positive_catalyst",
      kind: "clinical",
    }).eis_intrinsic).toBeGreaterThan(5);
  });

  it("formats short news labels", () => {
    expect(formatManualNewsEisShort(8.5, "clinical")).toBe("clin +8.5");
    expect(formatManualNewsEisShort(3.2, "financial")).toBe("fin +3.2");
    expect(formatManualNewsEisShort(0, "corporate")).toBeNull();
  });
});

describe("resolveManualEventEis market vs news", () => {
  it("keeps market flat without price and fills news intrinsic", () => {
    const clinical = draft({
      id: "manual_clin",
      ticker: "CLRB",
      title: "Updated clinical data from Phase 2b CLOVER WaM study of iopofosine",
      body: "Phase 2b clinical efficacy update in Waldenström patients",
      investigationOutcome: "positive_catalyst",
      sentiment: 0.85,
    });
    const finance = draft({
      id: "manual_fin",
      ticker: "CLRB",
      title: "CLRB (Nasdaq) | Company: Cellectar | Q2 2026 financial results. Cash $34M",
      body: "Cash and equivalents stood at $34.0 million as of June 30, 2026",
      investigationOutcome: "neutral",
      sentiment: 0.85,
    });

    const a = resolveManualEventEis(clinical);
    const b = resolveManualEventEis(finance);

    expect(Math.abs(a.score)).toBeLessThan(0.05);
    expect(Math.abs(b.score)).toBeLessThan(0.05);
    expect(a.eis_intrinsic).not.toBeNull();
    expect(b.eis_intrinsic).not.toBeNull();
    expect(a.eis_intrinsic!).toBeGreaterThan(b.eis_intrinsic!);

    expect(resolveManualEventClassification(finance).investigationOutcome).toBe("neutral");
  });
});
