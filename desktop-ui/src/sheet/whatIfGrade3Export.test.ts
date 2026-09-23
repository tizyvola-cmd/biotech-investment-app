import { describe, expect, it } from "vitest";
import {
  buildWhatIfGrade3Export,
  buildWhatIfGrade3SpreadsheetXml,
} from "./whatIfGrade3Export";
import type { WhatIfCrownHitEvent } from "./whatIfCrownHitStore";

const sampleCrown: WhatIfCrownHitEvent[] = [
  {
    sessionDate: "2026-08-28",
    ticker: "VRTX",
    simKey: "VRTX|2026-01-01",
    endPnl: 120,
    pathMax: 400,
    pathMin: -50,
    oscillating: false,
    capturedAt: "2026-08-28T15:00:00.000Z",
    updatedAt: "2026-08-28T15:00:00.000Z",
    readout: {
      sds: 55,
      eis: 12,
      pPlan: 58,
      precatKind: "mid",
      pCont: 64,
      contG10: null,
      exhaustEdge: null,
      dailyPct24h: 3.2,
      miiAngleDeg: null,
      frozenAt: "2026-08-28T15:00:00.000Z",
      source: "capture",
    },
  },
];

describe("whatIfGrade3Export", () => {
  it("builds spreadsheet with crown summary and data rows", () => {
    const exp = buildWhatIfGrade3Export({
      lang: "en",
      crownEvents: sampleCrown,
    });
    expect(exp.rows).toHaveLength(1);
    expect(exp.crownAnalysis.totalHits).toBe(1);
    expect(exp.crownAnalysis.medians.sds).toBe(55);

    const xml = buildWhatIfGrade3SpreadsheetXml(exp);
    expect(xml).toContain("<Worksheet ss:Name=\"Summary\">");
    expect(xml).toContain("<Worksheet ss:Name=\"Crown\">");
    expect(xml).toContain("<Worksheet ss:Name=\"Control\">");
  });
});
