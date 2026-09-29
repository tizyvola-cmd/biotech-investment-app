import { describe, expect, it } from "vitest";
import { attachEisToVolumeRows, eisVolumeDotColors } from "./TickerVolumeEisChart";
import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import type { EisBreakdown } from "../sheet/eventImpactScore";

function bd(score: number): EisBreakdown {
  return {
    score,
    delta_p_1d: 0,
    delta_p_3d: 0,
    vol_ratio: 1,
    vol_term: 0,
    sentiment: 0,
    sent_term: 0,
    weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
  };
}

function marker(partial: Partial<TickerEisEventDetail> & Pick<TickerEisEventDetail, "eventDate" | "title">): TickerEisEventDetail {
  return {
    sourceType: "clinical",
    sourceLabel: "Clinical",
    nctId: null,
    studyTitle: "",
    studyUrl: null,
    indicators: [],
    impactNote: null,
    link: null,
    summary: null,
    breakdown: bd(0),
    ...partial,
  };
}

describe("eisVolumeDotColors", () => {
  it("maps positive / neutral / negative bands", () => {
    expect(eisVolumeDotColors(12).fill).toBe("#A79AFF");
    expect(eisVolumeDotColors(0).fill).toBe("#94a3b8");
    expect(eisVolumeDotColors(0.2).fill).toBe("#94a3b8");
    expect(eisVolumeDotColors(-3).fill).toBe("#F87185");
    expect(eisVolumeDotColors(null).fill).toBe("#94a3b8");
  });
});

describe("attachEisToVolumeRows", () => {
  it("snaps a Sunday EIS onto the nearest trading day within 3 days", () => {
    const rows = attachEisToVolumeRows(
      [
        { key: "2026-03-02", label: "2 Mar", volume: 100 },
        { key: "2026-03-03", label: "3 Mar", volume: 110 },
      ],
      [marker({ eventDate: "2026-03-01", title: "Potential CHEST abstract", chartOnly: true })],
      null,
    );
    const hit = rows.filter((r) => r.eisPick);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.key).toBe("2026-03-02");
    expect(hit[0]!.eisPick?.chartOnly).toBe(true);
  });

  it("does not drop a scored EIS on the first visible session", () => {
    const rows = attachEisToVolumeRows(
      [{ key: "2026-05-04", label: "4 May", volume: 80 }],
      [marker({ eventDate: "2026-05-04", title: "earnings", breakdown: bd(15.75) })],
      null,
    );
    expect(rows[0]!.eisPick?.title).toBe("earnings");
  });
});
