import { describe, expect, it } from "vitest";
import { formatNextCatalystChip, resolveNextCatalystEvent } from "./nextCatalystEvent";

const TODAY = new Date("2026-09-05T12:00:00");

describe("resolveNextCatalystEvent", () => {
  it("uses sim Completion Date when no guidance", () => {
    const ev = resolveNextCatalystEvent({
      ticker: "BDSX",
      completionDate: "2026-10-01",
      daysToCd: 26,
      today: TODAY,
    });
    expect(ev?.eventType).toBe("trial_primary_completion");
    expect(ev?.daysUntil).toBe(26);
    expect(ev?.source).toBe("sim_cd");
  });

  it("picks the sooner of CD vs PDUFA", () => {
    const ev = resolveNextCatalystEvent({
      ticker: "ETON",
      completionDate: "2026-12-01",
      daysToCd: 87,
      guidanceEvent: {
        ticker: "ETON",
        company: "Eton",
        event_type: "pdufa",
        window_start: "2026-09-20",
        estimation_method: "explicit_pdufa",
      },
      today: TODAY,
    });
    expect(ev?.eventType).toBe("pdufa");
    expect(ev?.daysUntil).toBe(15);
    expect(ev?.dateType).toBe("actual");
    expect(ev?.source).toBe("guidance");
  });

  it("accepts Simulation DD/MM/YYYY completion dates", () => {
    const ev = resolveNextCatalystEvent({
      ticker: "INSP",
      completionDate: "12/10/2026",
      daysToCd: 37,
      today: TODAY,
    });
    expect(ev?.eventDate).toBe("2026-10-12");
    expect(ev?.daysUntil).toBe(37);
    expect(formatNextCatalystChip(ev!, true)).toBe("CD primaria tra 37g");
  });

  it("formats the chip without touching recommendation language", () => {
    const ev = resolveNextCatalystEvent({
      ticker: "GRCE",
      completionDate: "2026-09-05",
      daysToCd: 0,
      today: TODAY,
    });
    expect(formatNextCatalystChip(ev!, false)).toBe("Primary CD today");
  });
});
