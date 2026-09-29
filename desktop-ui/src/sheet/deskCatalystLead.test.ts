import { describe, expect, it } from "vitest";
import type { SdsRow } from "../api/supernova";
import {
  buildDeskCatalystLead,
  calendarHorizonScore,
  formatDeskLeadWhy,
  silentMoneyFromSds,
} from "./deskCatalystLead";
import type { NextCatalystEvent } from "./nextCatalystEvent";

const TODAY = new Date("2026-09-05T12:00:00");

function ev(over: Partial<NextCatalystEvent>): NextCatalystEvent {
  return {
    ticker: "X",
    eventType: "trial_primary_completion",
    eventDate: "2026-10-10",
    dateType: "estimated",
    daysUntil: 35,
    source: "sim_cd",
    ...over,
  };
}

describe("calendarHorizonScore", () => {
  it("peaks in the 2–8 week lead window", () => {
    const sweet = calendarHorizonScore(ev({ daysUntil: 35 }));
    const late = calendarHorizonScore(ev({ daysUntil: 3 }));
    const far = calendarHorizonScore(ev({ daysUntil: 150 }));
    expect(sweet).toBeGreaterThan(late);
    expect(sweet).toBeGreaterThan(far);
  });

  it("boosts a dated PDUFA over an estimated CD at the same horizon", () => {
    const cd = calendarHorizonScore(ev({ daysUntil: 28, eventType: "trial_primary_completion" }));
    const pdufa = calendarHorizonScore(
      ev({ daysUntil: 28, eventType: "pdufa", dateType: "actual", source: "guidance" }),
    );
    expect(pdufa).toBeGreaterThan(cd);
  });
});

describe("silentMoneyFromSds", () => {
  it("flags 13F accumulation and squeeze", () => {
    const row = {
      ticker: "INSP",
      sds: 40,
      cluster_b: {
        institutional_delta: { delta_pct: 12, premium_fund_present: true, score: 6 },
        short_interest: { squeeze_setup: true, days_to_cover: 7, score: 4 },
      },
      cluster_d: { cash_runway: { runway_months: 4 } },
    } as SdsRow;
    const silent = silentMoneyFromSds(row);
    expect(silent.instAccum).toBe(true);
    expect(silent.premiumFund).toBe(true);
    expect(silent.squeeze).toBe(true);
    expect(silent.runwayMonths).toBe(4);
  });
});

describe("buildDeskCatalystLead", () => {
  it("crosses a near PDUFA with 13F+", () => {
    const lead = buildDeskCatalystLead({
      ticker: "ETON",
      completionDate: "2026-12-01",
      daysToCd: 87,
      guidanceEvent: {
        ticker: "ETON",
        company: "Eton",
        event_type: "pdufa",
        window_start: "2026-10-03",
        estimation_method: "explicit_pdufa",
      },
      sdsRow: {
        ticker: "ETON",
        sds: 33,
        cluster_b: { institutional_delta: { delta_pct: 8, score: 5 } },
      } as SdsRow,
      today: TODAY,
    });
    expect(lead?.event.eventType).toBe("pdufa");
    expect(lead?.event.daysUntil).toBe(28);
    expect(lead?.silent.instAccum).toBe(true);
    expect(lead?.silentScore).toBeGreaterThan(0);
    expect(formatDeskLeadWhy(lead!, true)).toMatch(/PDUFA/);
    expect(formatDeskLeadWhy(lead!, true)).not.toContain("13F+");
  });

  it("drops events beyond 180 days", () => {
    const lead = buildDeskCatalystLead({
      ticker: "FAR",
      completionDate: "2027-09-01",
      daysToCd: 361,
      today: TODAY,
    });
    expect(lead).toBeNull();
  });
});
