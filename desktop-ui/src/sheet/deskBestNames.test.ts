import { describe, expect, it } from "vitest";
import type { SdsRow } from "../api/supernova";
import type { Top2PickSignal } from "./top2PortfolioPick";
import { DESK_BEST_CAP, selectDeskBestNames } from "./deskBestNames";

const TODAY = new Date("2026-09-05T12:00:00");

function sig(over: Partial<Top2PickSignal> & { ticker: string; days?: number; cd?: string }): Top2PickSignal {
  const days = over.days ?? 26;
  const cd = over.cd ?? "01/10/2026";
  return {
    cd,
    days,
    pred5: 2,
    affid: 0.62,
    r2: 0.55,
    slope20d: 0.08,
    precatExpectedReturn: 10,
    precatKind: "enter",
    upsideScore: 0,
    planReturnPct: 14,
    hasPosition: false,
    stabilityVerdict: "persistent",
    simRow: {
      Ticker: over.ticker,
      "Completion Date": cd,
      "Var. Giorn. %": 1.2,
    },
    ...over,
  };
}

describe("selectDeskBestNames", () => {
  it("ranks a dated PDUFA with 13F above a far estimated CD", () => {
    const out = selectDeskBestNames({
      today: TODAY,
      signals: [
        sig({ ticker: "FAR", days: 160, cd: "12/02/2027" }),
        sig({ ticker: "ETON", days: 87, cd: "01/12/2026" }),
        sig({ ticker: "JSPRW", days: 20, cd: "25/09/2026" }),
      ],
      guidanceByTicker: new Map([
        [
          "ETON",
          {
            ticker: "ETON",
            company: "Eton",
            event_type: "pdufa",
            window_start: "2026-10-03",
            estimation_method: "explicit_pdufa",
          },
        ],
      ]),
      sdsRows: [
        {
          ticker: "ETON",
          sds: 22,
          cluster_b: { institutional_delta: { delta_pct: 9, score: 5 } },
        } as SdsRow,
      ],
    });
    expect(out[0]?.ticker).toBe("ETON");
    expect(out[0]?.source).toBe("catalyst_lead");
    expect(out[0]?.leadEventType).toBe("pdufa");
    expect(out[0]?.silent.instAccum).toBe(true);
    expect(out.map((r) => r.ticker)).not.toContain("JSPRW");
  });

  it("does not use SDS / P(plan) as the rank key", () => {
    const out = selectDeskBestNames({
      today: TODAY,
      signals: [
        sig({ ticker: "WEAKSDS", days: 28, cd: "03/10/2026", affid: 0.4 }),
        sig({ ticker: "FAR", days: 170, cd: "22/02/2027", affid: 0.9 }),
      ],
      sdsRows: [
        { ticker: "WEAKSDS", sds: 12 } as SdsRow,
        { ticker: "FAR", sds: 80 } as SdsRow,
      ],
    });
    expect(out[0]?.ticker).toBe("WEAKSDS");
  });

  it("caps the list", () => {
    const signals = Array.from({ length: 14 }, (_, i) =>
      sig({
        ticker: `T${String(i).padStart(2, "0")}`,
        days: 20 + i,
        cd: "01/10/2026",
      }),
    );
    const out = selectDeskBestNames({ signals, today: TODAY });
    expect(out.length).toBeLessThanOrEqual(DESK_BEST_CAP);
  });
});
