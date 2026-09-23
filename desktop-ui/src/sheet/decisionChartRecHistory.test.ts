import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearDecisionRecHistoryForTests,
  getDecisionRecTransitions,
  recEpisodesFromHistory,
} from "./decisionChartRecHistory";

describe("decisionChartRecHistory", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    __clearDecisionRecHistoryForTests();
  });

  it("records transitions from review to sell with S marker", () => {
    const key = "LTRN|2026-07-28";
    localStorage.setItem(
      "supernova_decision_rec_history.v1",
      JSON.stringify({
        [key]: [
          { at: "2026-07-01T10:00:00.000Z", rec: "review" },
          { at: "2026-07-05T10:00:00.000Z", rec: "sell" },
        ],
      }),
    );

    const marks = getDecisionRecTransitions(key, true, Date.parse("2026-07-06T00:00:00.000Z"));
    expect(marks).toHaveLength(1);
    expect(marks[0]?.letter).toBe("S");
    expect(marks[0]?.from).toBe("review");
    expect(marks[0]?.to).toBe("sell");
  });

  it("rebuilds every closed BUY/SELL window plus the open one", () => {
    const key = "INBX|2026-10-01";
    localStorage.setItem(
      "supernova_decision_rec_history.v1",
      JSON.stringify({
        [key]: [
          { at: "2026-05-04T10:00:00.000Z", rec: "buy" },
          { at: "2026-05-11T10:00:00.000Z", rec: "buy" },
          { at: "2026-05-19T10:00:00.000Z", rec: "hold" },
          { at: "2026-06-02T10:00:00.000Z", rec: "sell" },
          { at: "2026-06-08T10:00:00.000Z", rec: "review" },
          { at: "2026-08-20T10:00:00.000Z", rec: "buy" },
        ],
      }),
    );

    expect(recEpisodesFromHistory(key)).toEqual([
      { rec: "buy", startIso: "2026-05-04T10:00:00.000Z", endIso: "2026-05-19T10:00:00.000Z" },
      { rec: "sell", startIso: "2026-06-02T10:00:00.000Z", endIso: "2026-06-08T10:00:00.000Z" },
      { rec: "buy", startIso: "2026-08-20T10:00:00.000Z", endIso: null },
    ]);
  });

  it("returns nothing for an unknown key", () => {
    expect(recEpisodesFromHistory("NOPE|2026-01-01")).toEqual([]);
  });
});
