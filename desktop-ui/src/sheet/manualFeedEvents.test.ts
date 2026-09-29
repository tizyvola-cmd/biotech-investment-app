import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  dismissManualFeedFromLossPanel,
  estimateManualNewsSentiment,
  inferManualInvestigationOutcome,
  filterManualEventsForLossPanel,
  loadManualFeedEvents,
  mergeManualEventsIntoRecords,
  parseManualFeedBatch,
  parseManualFeedFreeText,
  parseManualFeedEventId,
  resolveManualEventEis,
  resolveMergedFeedEventEis,
  saveManualFeedEvents,
  scoreManualLossInvestigationEis,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import { previewManualFeedEis } from "./manualFeedSubmit";
import type { ClinicalPreCdRecord } from "../api/supernova";
import { buildTickerEisDetail } from "./tickerEisSummary";

describe("parseManualFeedFreeText", () => {
  it("parses labeled IT block", () => {
    const raw = `TICKER: PMVP
DATA: 01/03/2026
FONTE: BioSpace
NEWS: Phase 2 topline positive
---
Dettaglio aggiuntivo`;
    const p = parseManualFeedFreeText(raw);
    expect(p).not.toBeNull();
    expect(p!.ticker).toBe("PMVP");
    expect(p!.eventDate).toBe("2026-03-01");
    expect(p!.source).toBe("BioSpace");
    expect(p!.body).toContain("Dettaglio");
  });

  it("returns null without ticker and date", () => {
    expect(parseManualFeedFreeText("just some text")).toBeNull();
  });

  it("parses pipe row with English month date", () => {
    const raw =
      "INBS | May 13, 2026 | FDA orphan drug designation | GlobeNewswire | Positive regulatory update";
    const rows = parseManualFeedBatch(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe("INBS");
    expect(rows[0]!.eventDate).toBe("2026-05-13");
    expect(rows[0]!.source).toBe("GlobeNewswire");
    expect(rows[0]!.title).toContain("orphan");
  });

  it("parses multiple pipe rows", () => {
    const raw = `INBS | May 13, 2026 | News A | GlobeNewswire | body A
INBS | May 28, 2026 | News B | GlobeNewswire | body B`;
    const rows = parseManualFeedBatch(raw);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.eventDate)).toEqual(["2026-05-13", "2026-05-28"]);
  });

  it("prefers labeled block when body lines contain pipe characters", () => {
    const raw = `TICKER: BNTX
DATE: 2026-07-04
SOURCE: Reuters
NEWS: FDA update | partnership | details in body`;
    const rows = parseManualFeedBatch(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe("BNTX");
    expect(rows[0]!.body).toContain("partnership");
  });

  it("falls back to free text when only some lines match pipe format", () => {
    const raw = `Why did BNTX drop on Jul 4, 2026?
BNTX | Jul 4, 2026 | headline | Reuters | extra prose line that is not a pipe row`;
    const rows = parseManualFeedBatch(raw);
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows[0]) expect(rows[0].ticker).toBe("BNTX");
  });

  it("parses comma-led paste with day-month-year (KZIA-style)", () => {
    const raw = `KZIA,
KAZIA, 28 August 2026 , Phase 1b readout for paxalisib in recurrent glioblastoma showed encouraging signs of activity with manageable safety.`;
    const p = parseManualFeedFreeText(raw);
    expect(p).not.toBeNull();
    expect(p!.ticker).toBe("KZIA");
    expect(p!.eventDate).toBe("2026-08-28");
    expect(p!.body).toMatch(/Phase 1b/i);
    expect(parseManualFeedBatch(raw)).toHaveLength(1);
  });
});

describe("parseManualFeedEventId", () => {
  it("reads manual id from impact_note on merged feed rows", () => {
    expect(
      parseManualFeedEventId({
        source_type: "manual",
        impact_note: "Manual feed · id:manual_1783236415298_0_wn1klu · BioSpace",
      }),
    ).toBe("manual_1783236415298_0_wn1klu");
  });

  it("returns null for non-manual events", () => {
    expect(
      parseManualFeedEventId({
        source_type: "press_release",
        impact_note: "Manual feed · id:manual_x · x",
      }),
    ).toBeNull();
  });
});

describe("estimateManualNewsSentiment", () => {
  it("scores positive news higher", () => {
    const pos = estimateManualNewsSentiment("Phase 2 success met primary endpoint approval");
    const neg = estimateManualNewsSentiment("Trial failed adverse halt delayed");
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeLessThan(0);
  });
});

describe("scoreManualLossInvestigationEis", () => {
  it("scores mild positive EIS when drop has no catalyst", () => {
    const eis = scoreManualLossInvestigationEis({
      priceChangePct: -6,
      sentiment: 0,
      investigationOutcome: "no_catalyst",
    });
    expect(eis.score).toBeGreaterThan(0);
  });

  it("scores negative EIS when drop matches negative catalyst", () => {
    const eis = scoreManualLossInvestigationEis({
      priceChangePct: -6,
      sentiment: -1,
      investigationOutcome: "negative_catalyst",
    });
    expect(eis.score).toBeLessThan(0);
  });
});

describe("parseManualFeedFreeText no_catalyst", () => {
  it("parses OUTCOME no_catalyst block without empty NEWS", () => {
    const raw = `TICKER: VIR
DATE: 2026-07-03
OUTCOME: no_catalyst
VAR_24H: -6%
NEWS: No material news found — market oscillation.`;
    const p = parseManualFeedFreeText(raw);
    expect(p).not.toBeNull();
    expect(p!.investigationOutcome).toBe("no_catalyst");
    expect(p!.priceDropPct).toBe(-6);
  });

  it("rejects bare template without news or outcome", () => {
    const raw = `TICKER: VIR
DATE: 2026-07-03
SOURCE:
NEWS:`;
    expect(parseManualFeedFreeText(raw)).toBeNull();
  });
});

describe("mergeManualEventsIntoRecords", () => {
  const draft: ManualFeedEventDraft = {
    id: "manual_test_1",
    createdAt: "2026-03-02T10:00:00Z",
    ticker: "PMVP",
    eventDate: "2026-03-01",
    source: "BioSpace",
    title: "Topline positive",
    body: "Met primary endpoint",
    sentiment: 1,
  };

  it("appends manual event to existing ticker record", () => {
    const base: ClinicalPreCdRecord[] = [
      {
        ticker: "PMVP",
        nct_id: "NCT123",
        sponsor_match: "Exact",
        clinical_events: [],
      },
    ];
    const merged = mergeManualEventsIntoRecords(base, [draft]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.clinical_events).toHaveLength(1);
    expect(merged[0]!.clinical_events![0]!.source_type).toBe("manual");
    expect(merged[0]!.clinical_events![0]!.eis?.score).toBeDefined();
  });

  it("creates synthetic record for unknown ticker", () => {
    const merged = mergeManualEventsIntoRecords([], [draft]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.nct_id).toBe("MANUAL-PMVP");
    expect(merged[0]!.clinical_events).toHaveLength(1);
  });

  it("dedupes same draft id on re-merge", () => {
    const base: ClinicalPreCdRecord[] = [
      { ticker: "PMVP", nct_id: "NCT123", sponsor_match: "Exact", clinical_events: [] },
    ];
    const once = mergeManualEventsIntoRecords(base, [draft]);
    const twice = mergeManualEventsIntoRecords(once, [draft]);
    expect(twice[0]!.clinical_events).toHaveLength(1);
  });
});

describe("BIIB neutral decline research", () => {
  const text =
    "Biogen's stock decline is not caused by negative news.\nThe only major event is headquarters relocation, short-term uncertainty and market volatility. All other news items are neutral or positive.";

  it("treats 'not caused by negative news' as no_catalyst with mild positive EIS on drop", () => {
    const sent = estimateManualNewsSentiment(text);
    const outcome = inferManualInvestigationOutcome(text, sent);
    const eis = scoreManualLossInvestigationEis({
      priceChangePct: -2.4,
      sentiment: sent,
      investigationOutcome: outcome,
    });
    expect(outcome).toBe("no_catalyst");
    expect(eis.score).toBeGreaterThan(0);
  });

  it("reclassifies saved draft with stale negative_catalyst on resolve", () => {
    const draft: ManualFeedEventDraft = {
      id: "manual_biib_stale",
      createdAt: "2026-07-03T10:00:00Z",
      ticker: "BIIB",
      eventDate: "2026-07-03",
      source: "Manual",
      title: "Biogen's stock decline is not caused by negative news.",
      body: "The only major event is headquarters relocation, short-term uncertainty and market volatility. All other news items are neutral or positive.",
      sentiment: -0.6,
      investigationOutcome: "negative_catalyst",
      priceDropPct: -2.4,
    };
    const eis = resolveManualEventEis(draft);
    expect(eis.score).toBeGreaterThan(0);
  });
});

describe("manual loss research classification (VIR/LTRN/MLTX/CMPX)", () => {
  it("VIR market-driven title → no_catalyst, positive EIS", () => {
    const text = "So why did VIR fall? (Market-driven reasons)\nSector selloff and broad market weakness; no company-specific news.";
    const sent = estimateManualNewsSentiment(text);
    const outcome = inferManualInvestigationOutcome(text, sent);
    const eis = resolveManualEventEis({
      id: "x",
      createdAt: "",
      ticker: "VIR",
      eventDate: "2026-07-03",
      source: "Manual",
      title: "So why did VIR fall? (Market-driven reasons)",
      body: "Sector selloff and broad market weakness; no company-specific news.",
      priceDropPct: -5,
    });
    expect(outcome).toBe("no_catalyst");
    expect(eis.score).toBeGreaterThan(0);
  });

  it("LTRN going concern body stays negative_catalyst", () => {
    const text =
      "Why LTRN Stock Dropped (Latest Verified Reasons)\nCompany disclosed going concern warning and trial enrollment delays.";
    const sent = estimateManualNewsSentiment(text);
    const outcome = inferManualInvestigationOutcome(text, sent);
    const eis = resolveManualEventEis({
      id: "x",
      createdAt: "",
      ticker: "LTRN",
      eventDate: "2026-07-03",
      source: "Manual",
      title: "Why LTRN Stock Dropped (Latest Verified Reasons)",
      body: "Company disclosed going concern warning and trial enrollment delays.",
      sentiment: 0,
      investigationOutcome: "no_catalyst",
      priceDropPct: -8,
    });
    expect(outcome).toBe("negative_catalyst");
    expect(eis.score).toBeLessThan(0);
  });

  it("MLTX why-dropped title without structural body → no_catalyst", () => {
    const text =
      "Why MLTX (MoonLake Immunotherapeutics) dropped — concise, dis...\nNo material company news; typical market volatility.";
    const outcome = inferManualInvestigationOutcome(text, 0);
    const eis = resolveManualEventEis({
      id: "x",
      createdAt: "",
      ticker: "MLTX",
      eventDate: "2026-07-03",
      source: "Manual",
      title: "Why MLTX (MoonLake Immunotherapeutics) dropped — concise, dis...",
      body: "No material company news; typical market volatility.",
      priceDropPct: -4,
    });
    expect(outcome).toBe("no_catalyst");
    expect(eis.score).toBeGreaterThan(0);
  });

  it("CMPX what-happened title with short neutral body → no_catalyst", () => {
    const text = "What happened to CMPX (last 48 hours)\nNo catalyst found — sector rotation.";
    const outcome = inferManualInvestigationOutcome(text, 0);
    expect(outcome).toBe("no_catalyst");
  });
});

describe("KZIA capital raise — mild structured financing", () => {
  const raiseBody =
    "Kazia announced a $120 million capital raise on August 27, 2026. Only $40 million is guaranteed upfront. " +
    "The remaining $80 million is contingent on investors exercising two classes of warrants. " +
    "2.58 million ADS priced at $15.50. Series A Warrants strike $17.825 (~15% above offering price). " +
    "Series B Warrants strike $19.375 (~25% above offering price). Proceeds for paxalisib clinical development. " +
    "Market treated this as a milder dilution event than a straight raise. Precise dilution percentage is not stated.";

  it("neutral catalyst with near-zero EIS (not heavy dilution)", () => {
    const parsed = parseManualFeedFreeText(`KZIA\n2026-08-27\n${raiseBody}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.investigationOutcome).toBe("neutral");
    expect(parsed!.sentiment).toBeGreaterThanOrEqual(-0.15);
    const eis = previewManualFeedEis(parsed!);
    expect(Math.abs(eis.score)).toBeLessThan(1);
  });
});

describe("KZIA Phase 1b manual EIS", () => {
  const kziaBody =
    "Phase 1b readout for paxalisib in combination with pembrolizumab and chemotherapy showed encouraging signs of activity. " +
    "Across the six evaluable patients treated, every one of them has benefited. " +
    "Median 51% reduction in terminally exhausted CD8+ T cells and median 83% reduction in circulating tumor cell clusters. " +
    "No treatment-related serious adverse events were reported. The market reaction is a positive signal.";

  it("scores positive EIS without VAR_24H (publication-only)", () => {
    const parsed = parseManualFeedFreeText(
      `KZIA,\nKAZIA, 28 August 2026 , ${kziaBody}`,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.eventDate).toBe("2026-08-28");
    expect(parsed!.investigationOutcome).toBe("positive_catalyst");
    expect(parsed!.sentiment).toBeGreaterThanOrEqual(0.55);
    const eis = previewManualFeedEis(parsed!);
    expect(eis.score).toBeGreaterThan(2);
  });
});

describe("clinical publication manual EIS (GPCR-style)", () => {
  const gpcrBody =
    "On March 16, 2026, the company reported results from the 44-week Phase 2 ACCESS II trial of aleniglipron. The study showed mean weight loss of 16.3% and 16.0% at the highest two doses, with no drug-induced liver injury and a discontinuation rate of about 10.4%. The full results were published in Nature Medicine, with an ADA presentation scheduled for June 5, 2026.";
  const gpcrTitle =
    "GPCR is Structure Therapeutics — the oral GLP-1 obesity name. Its lead asset is aleniglipron (GSBR-1290), a once-daily oral small-molecule GLP-1 receptor agonist";

  it("scores positive EIS without a stock price move field", () => {
    const eis = resolveManualEventEis({
      id: "manual_gpcr",
      createdAt: "2026-07-07T10:00:00Z",
      ticker: "GPCR",
      eventDate: "2026-03-16",
      source: "Manual entry",
      title: gpcrTitle,
      body: gpcrBody,
    });
    expect(eis.score).toBeGreaterThan(0.5);
  });

  it("feed EIS matches checklist when merged into a study with clinical KPIs", () => {
    const draft: ManualFeedEventDraft = {
      id: "manual_gpcr_feed",
      createdAt: "2026-07-07T10:00:00Z",
      ticker: "GPCR",
      eventDate: "2026-03-16",
      source: "Manual entry",
      title: gpcrTitle,
      body: gpcrBody,
    };
    const checklistScore = resolveManualEventEis(draft).score;
    const base: ClinicalPreCdRecord = {
      ticker: "GPCR",
      company: "Structure Therapeutics",
      nct_id: "NCT123",
      sponsor_match: "Exact",
      clinical_indicators: [
        {
          label: "Mean weight loss",
          kpi_type: "efficacy",
          numeric_value: 16.3,
          direction: "improved",
        } as never,
      ],
      clinical_events: [],
      meta: { brief_title: "ACCESS II", phase: "Phase 2", overall_status: "Active" },
    };
    const merged = mergeManualEventsIntoRecords([base], [draft]);
    const manualEv = merged[0]!.clinical_events![0]!;
    const viaResolver = resolveMergedFeedEventEis(manualEv, base.clinical_indicators)?.score;
    expect(viaResolver).toBe(checklistScore);
    const detail = buildTickerEisDetail("GPCR", "en", null, merged);
    const feedManual = detail.events.find((ev) => ev.sourceType === "manual");
    expect(feedManual?.breakdown.score).toBe(checklistScore);
    expect(checklistScore).toBeGreaterThan(0.5);
  });
});

describe("loss panel dismiss (hide-local)", () => {
  const draft: ManualFeedEventDraft = {
    id: "manual_test_dismiss",
    createdAt: "2026-03-02T10:00:00Z",
    ticker: "CMPX",
    eventDate: "2026-03-01",
    source: "Manual",
    title: "CMPX drop research",
    body: "No catalyst",
    sentiment: 0,
  };

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      dispatchEvent: () => true,
    });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    saveManualFeedEvents([draft]);
    localStorage.removeItem("biotech.manual_feed_loss_panel_dismissed.v1");
  });

  it("hides from loss panel list without removing feed merge", () => {
    dismissManualFeedFromLossPanel(draft.id);
    expect(filterManualEventsForLossPanel()).toHaveLength(0);
    expect(loadManualFeedEvents()).toHaveLength(1);
    const merged = mergeManualEventsIntoRecords([], [draft]);
    expect(merged[0]!.clinical_events).toHaveLength(1);
  });
});
