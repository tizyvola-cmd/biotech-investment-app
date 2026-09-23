import { describe, expect, it } from "vitest";
import {
  eisEventsNearCatalystDate,
  parseFdaOutcomeKind,
  resolveRegulatoryCatalystOutcome,
} from "./regulatoryCatalystOutcome";
import type { TickerEisEventDetail } from "./tickerEisSummary";

describe("parseFdaOutcomeKind", () => {
  it("reads structured fda_outcome first", () => {
    expect(parseFdaOutcomeKind({ event_type: "pdufa", fda_outcome: "crl" })).toBe("crl");
  });

  it("parses Drugs@FDA approval quotes (LOQTORZI)", () => {
    expect(
      parseFdaOutcomeKind({
        event_type: "pdufa",
        timing_quote: "COHERUS BIOSCIENCES INC — LOQTORZI — FDA approval 2026-08-31",
        window_start: "2026-08-31",
      }),
    ).toBe("approved");
  });

  it("marks future PDUFA as pending", () => {
    expect(
      parseFdaOutcomeKind(
        { event_type: "pdufa", timing_quote: "PDUFA date set", window_start: "2026-11-01" },
        { now: new Date("2026-09-03T12:00:00") },
      ),
    ).toBe("pending");
  });

  it("labels past PDUFA without quote as unknown", () => {
    expect(
      parseFdaOutcomeKind(
        { event_type: "pdufa", timing_quote: "Estimated PDUFA window", window_start: "2026-08-01" },
        { now: new Date("2026-09-03T12:00:00") },
      ),
    ).toBe("unknown");
  });
});

describe("resolveRegulatoryCatalystOutcome", () => {
  it("returns Italian/English labels", () => {
    const r = resolveRegulatoryCatalystOutcome({
      event_type: "pdufa",
      timing_quote: "FDA approval 2026-08-31",
    });
    expect(r.labelIt).toMatch(/Approvato/);
    expect(r.labelEn).toMatch(/approved/i);
  });
});

describe("eisEventsNearCatalystDate", () => {
  const ev = (partial: Partial<TickerEisEventDetail>): TickerEisEventDetail =>
    ({
      eventDate: null,
      title: "",
      sourceType: "press",
      sourceLabel: "Press",
      nctId: null,
      studyTitle: "",
      studyUrl: null,
      breakdown: {
        score: 0,
        eis_intrinsic: 0,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_ratio: 1,
        vol_term: 0,
        sentiment: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
      indicators: [],
      impactNote: null,
      link: null,
      summary: null,
      ...partial,
    }) as TickerEisEventDetail;

  it("keeps FDA approval headlines and dates near the PDUFA", () => {
    const hits = eisEventsNearCatalystDate(
      [
        ev({ title: "FDA approves Loqtorzi", eventDate: "2026-08-31" }),
        ev({ title: "Quarterly earnings", eventDate: "2026-06-01" }),
      ],
      "2026-08-31",
      ["LOQTORZI"],
    );
    expect(hits.map((e) => e.title)).toEqual(["FDA approves Loqtorzi"]);
  });
});
