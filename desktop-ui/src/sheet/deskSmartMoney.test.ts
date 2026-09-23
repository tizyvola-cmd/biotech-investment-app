import { describe, expect, it } from "vitest";
import type { SdsRow } from "../api/supernova";
import {
  formatSilentMoneyTitle,
  formatSmartMoneyCell,
  formatSmartMoneyDate,
  formatSmartMoneyTooltip,
  resolveDeskSmartMoney,
  parseOfficerWho,
  silentCorporateFromClinical,
  smartMoneyFromSds,
} from "./deskSmartMoney";

describe("formatSmartMoneyDate", () => {
  it("prints DD/MM from ISO", () => {
    expect(formatSmartMoneyDate("2026-07-18")).toBe("18/07");
  });
});

describe("formatSilentMoneyTitle", () => {
  it("uses a plain-language Form 4 headline", () => {
    expect(
      formatSilentMoneyTitle({ kind: "form4", label: "CEO bought shares" }, false),
    ).toBe("CEO bought shares");
    expect(
      formatSilentMoneyTitle({ kind: "form4", label: "CEO bought shares" }, true),
    ).toBe("CEO ha acquistato azioni");
    expect(
      formatSilentMoneyTitle({ kind: "ceo_appointed", label: "New CEO appointed" }, false),
    ).toBe("New CEO appointed");
    expect(formatSilentMoneyTitle({ kind: "cdmo", label: "New CDMO" }, true)).toBe("Nuovo CDMO");
  });
});

describe("smartMoneyFromSds", () => {
  it("prefers 13F with a premium fund and quarter date", () => {
    const ev = smartMoneyFromSds({
      ticker: "INSP",
      sds: 40,
      cluster_b: {
        institutional_delta: {
          delta_pct: 12,
          premium_fund_present: true,
          premium_funds: ["Baker Bros Advisors"],
          latest_quarter: "2026-03-31",
          score: 6,
        },
      },
    } as SdsRow);
    expect(ev?.kind).toBe("13f");
    expect(ev?.label).toContain("Baker");
    expect(ev?.href).toContain("sec.gov");
    expect(formatSmartMoneyCell(ev, false).date).toBe("31/03");
  });

  it("falls back to short cover with FINRA link", () => {
    const ev = smartMoneyFromSds({
      ticker: "X",
      sds: 10,
      cluster_b: { short_interest: { squeeze_setup: true, days_to_cover: 7 } },
    } as SdsRow);
    expect(ev?.kind).toBe("short_cover");
    expect(formatSmartMoneyCell(ev, false).date).toBe("DTC 7g");
    expect(ev?.href_label).toBe("FINRA");
  });
});

describe("resolveDeskSmartMoney", () => {
  it("keeps a Form 4 API event over SDS 13F", () => {
    const ev = resolveDeskSmartMoney(
      {
        ticker: "ETON",
        event: { kind: "form4", label: "CEO bought shares", date: "2026-07-12" },
      },
      {
        ticker: "ETON",
        sds: 20,
        cluster_b: { institutional_delta: { delta_pct: 8, latest_quarter: "2026-03-31" } },
      } as SdsRow,
    );
    expect(ev?.kind).toBe("form4");
    expect(formatSmartMoneyCell(ev, false)).toMatchObject({
      label: "CEO bought shares",
      date: "12/07",
      tone: "up",
    });
    expect(ev?.href).toContain("sec.gov");
  });
});

describe("parseOfficerWho", () => {
  it("reads a named appointment and ignores the generic 5.02 title", () => {
    expect(
      parseOfficerWho("MoonLake appoints Jane Doe as Chief Medical Officer"),
    ).toBe("Jane Doe");
    expect(parseOfficerWho("Officer/director departure or appointment")).toBeNull();
  });
});

describe("silentCorporateFromClinical", () => {
  it("reads a new CEO 8-K with the filing link", () => {
    const ev = silentCorporateFromClinical(
      [
        {
          ticker: "BBNX",
          clinical_events: [
            {
              event_title: "Company appoints new Chief Executive Officer",
              source_type: "sec_8k",
              items_raw: "5.02",
              event_date: "2026-08-12",
              link: "https://www.sec.gov/Archives/edgar/data/1/0001/bbnx-8k.htm",
            },
          ],
        },
      ],
      "BBNX",
      new Date("2026-09-05T12:00:00"),
    );
    expect(ev?.kind).toBe("ceo_appointed");
    expect(ev?.href).toContain("sec.gov");
  });

  it("prefers the 8-K that names the person", () => {
    const ev = silentCorporateFromClinical(
      [
        {
          ticker: "MLTX",
          clinical_events: [
            {
              event_title: "Officer/director departure or appointment",
              items_raw: "5.02",
              event_date: "2026-06-09",
              link: "https://www.sec.gov/mltx-generic",
            },
            {
              event_title: "MoonLake appoints Jane Doe as Chief Medical Officer",
              summary: "Jane Doe joins as CMO effective June 9, 2026.",
              items_raw: "5.02",
              event_date: "2026-06-09",
              link: "https://www.sec.gov/mltx-named",
            },
          ],
        },
      ],
      "MLTX",
      new Date("2026-09-05T12:00:00"),
    );
    expect(ev?.who).toBe("Jane Doe");
    expect(ev?.kind).toBe("cmo_appointed");
    expect(ev?.href).toContain("named");
  });

  it("reads a new CDMO agreement", () => {
    const ev = silentCorporateFromClinical(
      [
        {
          ticker: "CCCC",
          clinical_events: [
            {
              event_title: "Selects Catalent as CDMO for commercial supply",
              source_type: "press_release",
              event_date: "2026-07-01",
              link: "https://example.com/cdmo",
            },
          ],
        },
      ],
      "CCCC",
      new Date("2026-09-05T12:00:00"),
    );
    expect(ev?.kind).toBe("cdmo");
    expect(ev?.href).toBe("https://example.com/cdmo");
  });
});

describe("formatSmartMoneyTooltip", () => {
  it("lists Form 4, 13D and call skew in order", () => {
    const tip = formatSmartMoneyTooltip(
      [
        { kind: "form4", label: "CEO bought shares", date: "2026-07-12" },
        { kind: "13d", label: "New 13D beneficial owner", date: "2026-08-02" },
        { kind: "call_skew", label: "Call skew into event", date: "2026-09-05" },
      ],
      null,
      true,
    );
    expect(tip).toContain("CEO ha acquistato azioni · 12/07");
    expect(tip).toContain("Nuovo 13D");
    expect(tip).toContain("Call in aumento");
  });
});
