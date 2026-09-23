import { describe, expect, it } from "vitest";
import {
  clinicalDimensionScoresByTicker,
  mergeDimensionScoreMaps,
  newsDimensionScoresByTicker,
} from "./newsDimensionScores";
import type { ClinicalPreCdRecord, DailyNewsPayload } from "../api/supernova";

describe("dimension score maps (Σ Clin/Fin/Acc, no EIS, 36h)", () => {
  const nowMs = Date.parse("2026-09-20T12:00:00Z");

  it("sums Clin and Fin separately; never sums EIS", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "CRDL",
        clinical_events: [
          {
            event_date: "2026-09-19",
            event_title: "Positive readout",
            confirmation_status: "confirmed",
            eis: { score: 1.5 },
            clinical_score: 1.0,
          },
          {
            event_date: "2026-09-20",
            event_title: "Dilutive offering",
            confirmation_status: "confirmed",
            eis: { score: -0.8 },
            financial_score: -1.5,
          },
        ],
      },
    ];
    const by = clinicalDimensionScoresByTicker(records, "en", { nowMs });
    expect(by.CRDL?.eis).toBeNull();
    expect(by.CRDL?.clinical).toBe(1.0);
    expect(by.CRDL?.financial).toBe(-1.5);
    expect(by.CRDL?.n).toBeGreaterThanOrEqual(2);
    expect(by.CRDL?.source).toBe("deep_dive");
    expect(by.CRDL?.tipTitle).toMatch(/36h/);
  });

  it("skips anticipated / gated hypotheses in the sum", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "XYZ",
        clinical_events: [
          {
            event_date: "2026-09-20",
            event_title: "Confirmed",
            confirmation_status: "confirmed",
            clinical_score: 2.0,
            eis: { score: 9.0 },
          },
          {
            event_date: "2026-09-20",
            event_title: "Guess",
            confirmation_status: "anticipated",
            eis_gated: "unverified_hypothesis",
            clinical_score: 9.0,
            eis: { score: 9.0 },
          },
        ],
      },
    ];
    const by = clinicalDimensionScoresByTicker(records, "en", { nowMs });
    expect(by.XYZ?.eis).toBeNull();
    expect(by.XYZ?.clinical).toBe(2.0);
  });

  it("ignores events older than 36 hours", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "OLD",
        clinical_events: [
          {
            event_date: "2026-09-18",
            confirmation_status: "confirmed",
            clinical_score: 5,
          },
          {
            event_date: "2026-09-20",
            confirmation_status: "confirmed",
            clinical_score: 1.2,
          },
        ],
      },
    ];
    const by = clinicalDimensionScoresByTicker(records, "en", { nowMs });
    expect(by.OLD?.clinical).toBe(1.2);
  });

  it("filters Daily News to the same 36h window", () => {
    const news = newsDimensionScoresByTicker(
      {
        top_news: [
          {
            ticker: "AAA",
            title: "Fresh Fin",
            published_at: "2026-09-20T08:00:00Z",
            financial_score: -2.0,
          },
          {
            ticker: "AAA",
            title: "Stale Fin",
            published_at: "2026-09-18T08:00:00Z",
            financial_score: -9.0,
          },
        ],
      } as DailyNewsPayload,
      { nowMs },
    );
    expect(news.AAA?.financial).toBe(-2.0);
    expect(news.AAA?.n).toBe(1);
  });

  it("does not add Daily News EIS on top of Deep Dive (EIS never in map)", () => {
    const clinical = clinicalDimensionScoresByTicker(
      [
        {
          ticker: "NTHI",
          clinical_events: [
            {
              event_date: "2026-09-20",
              event_title: "Migrated offering",
              confirmation_status: "confirmed",
              eis: { score: -1.5 },
              financial_score: -1.5,
            },
          ],
        },
      ],
      "en",
      { nowMs },
    );
    const news = newsDimensionScoresByTicker(
      {
        top_news: [
          {
            ticker: "NTHI",
            title: "Same offering still in Daily News",
            published_at: "2026-09-20T10:00:00Z",
            eis_score: -1.5,
            financial_score: -1.5,
          },
        ],
      } as DailyNewsPayload,
      { nowMs },
    );
    const merged = mergeDimensionScoreMaps(clinical, news);
    expect(merged.NTHI?.eis).toBeNull();
    expect(merged.NTHI?.financial).toBe(-1.5);
  });

  it("still supports a 90d lookback for Loss Analysis", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "LONG",
        clinical_events: [
          {
            event_date: "2026-08-01",
            confirmation_status: "confirmed",
            clinical_score: 1.5,
          },
        ],
      },
    ];
    const by = clinicalDimensionScoresByTicker(records, "en", {
      nowMs,
      lookbackDays: 90,
    });
    expect(by.LONG?.clinical).toBe(1.5);
  });
});
