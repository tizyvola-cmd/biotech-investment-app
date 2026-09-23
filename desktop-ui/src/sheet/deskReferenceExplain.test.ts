import { describe, expect, it } from "vitest";
import {
  applyCtgovStudyToReferenceDoc,
  eventReferenceDoc,
  silentMoneyReferenceDoc,
  silentTopicId,
} from "./deskReferenceExplain";
import type { DeskCalendarEvent } from "./deskCalendarEvents";
import type { FdaAdcomRow } from "./fdaAdcomCalendar";

describe("silentTopicId", () => {
  it("maps Form 4 / 13F / options / short to the matching chapter", () => {
    expect(silentTopicId("form4")).toBe("form4");
    expect(silentTopicId("13f")).toBe("ownership");
    expect(silentTopicId("13d")).toBe("ownership");
    expect(silentTopicId("call_skew")).toBe("options");
    expect(silentTopicId("short_cover")).toBe("short");
    expect(silentTopicId("ceo_appointed")).toBe("officer");
  });
});

describe("silentMoneyReferenceDoc", () => {
  it("says who bought and when, without Form 4 jargon", () => {
    const doc = silentMoneyReferenceDoc(
      {
        kind: "form4",
        label: "CEO bought shares",
        date: "2026-07-18",
        href: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=INSP&type=4",
        href_label: "SEC",
      },
      "INSP",
      true,
    );
    const text = doc.sections.flatMap((s) => s.body).join(" ");
    expect(text).toMatch(/18 luglio 2026/);
    expect(text).toMatch(/CEO/);
    expect(text).toContain("INSP");
    expect(text).not.toMatch(/5\.02|governance|Soft BUY|Form 4 SEC/);
  });

  it("names the person on an 8-K appointment", () => {
    const doc = silentMoneyReferenceDoc(
      {
        kind: "cmo_appointed",
        label: "Jane Doe appointed",
        date: "2026-06-09",
        who: "Jane Doe",
      },
      "MLTX",
      true,
    );
    const text = doc.sections.flatMap((s) => s.body).join(" ");
    expect(text).toContain("Jane Doe");
    expect(text).toMatch(/9 giugno 2026/);
    expect(text).toContain("MLTX");
    expect(text).toMatch(/CMO|nominato/);
    expect(doc.sections).toHaveLength(1);
  });

  it("says the name is missing when the 8-K title is only the SEC item", () => {
    const doc = silentMoneyReferenceDoc(
      {
        kind: "officer_appointed",
        label: "New officer appointed",
        date: "2026-06-09",
        detail: "Officer/director departure or appointment",
      },
      "MLTX",
      true,
    );
    const text = doc.sections.flatMap((s) => s.body).join(" ");
    expect(text).toMatch(/nome non è/);
    expect(text).not.toMatch(/Officer\/director|item 5/);
  });

  it("names the fund on a 13F", () => {
    const doc = silentMoneyReferenceDoc(
      { kind: "13f", label: "Baker Bros accumulated", detail: "+12%", date: "2026-03-31" },
      "BBNX",
      false,
    );
    expect(doc.sections[0]?.body.join(" ")).toContain("Baker Bros");
    expect(doc.sections[0]?.body.join(" ")).toContain("+12%");
    expect(doc.href).toContain("13F");
  });
});

describe("eventReferenceDoc", () => {
  it("prints the full event, type, date, and source without ellipsis", () => {
    const row: DeskCalendarEvent = {
      key: "X|readout",
      ticker: "SVA",
      rowKey: "SVA|cd",
      eventDate: "2026-09-08",
      daysUntil: 3,
      eventType: "readout",
      typeLabel: "Readout",
      dateType: "estimated",
      source: "guidance",
      eventName:
        "IPV (poliovirus vaccine) · readout · poliovirus vaccination in infants",
      eventTitle: "IPV (poliovirus vaccine) · readout · poliovirus…",
      sourceQuote:
        "Company guides a Q3 readout for the IPV poliovirus vaccine program",
      referenceHref: "https://clinicaltrials.gov/study/NCT01234567",
      referenceLabel: "CT.gov",
      inBook: false,
      product: "IPV (poliovirus vaccine)",
      studyTitle: "IPV poliovirus vaccination in infants",
      studyPhase: "Phase 3",
    };
    const doc = eventReferenceDoc(row, true, {
      Ticker: "SVA",
      Drug: "IPV",
      "Clinical Study": "IPV poliovirus vaccination in infants",
      Phase: "Phase 3",
      NCT: "NCT01234567",
    });
    const text = `${doc.title} ${doc.sections.flatMap((s) => s.body).join(" ")}`;
    expect(text).toContain("poliovirus vaccination in infants");
    expect(text).not.toContain("…");
    expect(text).toContain("08/09/2026");
    expect(text).toMatch(/Readout|pubblicazione/);
    expect(text).toMatch(/guidance|CT\.gov|clinicaltrials/);
    expect(text).toContain("Company guides a Q3 readout");
    expect(doc.href).toContain("clinicaltrials.gov");
    const byId = Object.fromEntries((doc.fields ?? []).map((f) => [f.id, f]));
    expect(byId.type?.value).toMatch(/Readout/i);
    expect(byId.product?.value).toContain("IPV");
    expect(byId.study?.value).toContain("poliovirus");
    expect(byId.phase?.value).toMatch(/Phase\s*3/i);
    expect(byId.link?.href).toContain("clinicaltrials.gov");
  });

  it("expands CD to Completion Day and fills Deep Dive study/link", () => {
    const row: DeskCalendarEvent = {
      key: "CRDL|cd",
      ticker: "CRDL",
      rowKey: "CRDL|2026-09-21",
      eventDate: "2026-09-21",
      daysUntil: 9,
      eventType: "trial_primary_completion",
      typeLabel: "CD",
      dateType: "estimated",
      source: "guidance",
      eventName: "cd",
      eventTitle: "cd",
      sourceQuote: "Primary completion 2026-09-21",
      inBook: false,
    };
    const doc = eventReferenceDoc(row, false, {
      Ticker: "CRDL",
      Drug: "CardiolRx",
      "Clinical Study": "ARCHER-CMF",
      Phase: "PHASE3",
      NCT: "NCT05180240",
    });
    const byId = Object.fromEntries((doc.fields ?? []).map((f) => [f.id, f]));
    expect(byId.type?.value).toBe("Completion Day");
    expect(byId.product?.value).toBe("CardiolRx");
    expect(byId.study?.value).toMatch(/ARCHER-CMF/);
    expect(byId.study?.value).toMatch(/NCT05180240/);
    expect(byId.phase?.value).toMatch(/Phase\s*3/i);
    expect(byId.link?.href).toContain("NCT05180240");
    expect(doc.title).toMatch(/Completion Day/);
    expect(doc.title).not.toMatch(/· cd$/i);
  });

  it("fills study/phase/link from clinical pre-CD when Simulation is empty", () => {
    const row: DeskCalendarEvent = {
      key: "INVA|cd",
      ticker: "INVA",
      rowKey: "INVA|2026-09-16",
      eventDate: "2026-09-16",
      daysUntil: 1,
      eventType: "trial_primary_completion",
      typeLabel: "CD",
      dateType: "estimated",
      source: "sim",
      sourceKind: "sim_cd",
      eventName: "Completion Day · Zevtera (ceftobiprole)",
      eventTitle: "Zevtera (ceftobiprole)",
      product: "Zevtera (ceftobiprole)",
      inBook: false,
    };
    const doc = eventReferenceDoc(
      row,
      false,
      { Ticker: "INVA", Drug: "Zevtera (ceftobiprole)" },
      [
        {
          ticker: "INVA",
          nct_id: "NCT03137173",
          cd_date: "2026-09-16",
          meta: {
            brief_title: "Ceftobiprole in ABSSSI",
            phase: "Phase 3",
          },
        },
      ],
    );
    const byId = Object.fromEntries((doc.fields ?? []).map((f) => [f.id, f]));
    expect(byId.study?.value).toMatch(/Ceftobiprole|NCT03137173/i);
    expect(byId.phase?.value).toMatch(/Phase\s*3/i);
    expect(byId.link?.href).toContain("NCT03137173");
  });

  it("rejects Primary CD as product and applies CT.gov study title", () => {
    const row: DeskCalendarEvent = {
      key: "KYNB|cd",
      ticker: "KYNB",
      rowKey: "KYNB|2026-10-01",
      eventDate: "2026-10-01",
      daysUntil: 16,
      eventType: "trial_primary_completion",
      typeLabel: "CD",
      dateType: "estimated",
      source: "sim",
      eventName: "Primary CD",
      eventTitle: "Primary CD",
      product: "Primary CD",
      inBook: false,
    };
    const doc = eventReferenceDoc(row, false, null, null, "Kyntra Bio, Inc.");
    const byId = Object.fromEntries((doc.fields ?? []).map((f) => [f.id, f]));
    expect(byId.product?.value).toBe("—");
    expect(doc.ctgovEnrich?.ticker).toBe("KYNB");
    expect(doc.ctgovEnrich?.company).toMatch(/Kyntra/i);

    const filled = applyCtgovStudyToReferenceDoc(
      doc,
      {
        nctId: "NCT07722988",
        briefTitle:
          "A Study to Investigate the Efficacy and Safety of Roxadustat (FG-4592) for Treating Anemia in Participants With Myelodysplastic Syndromes (MDS)",
        phase: "Phase 3",
        href: "https://clinicaltrials.gov/study/NCT07722988",
        approximate: true,
      },
      false,
    );
    const filledById = Object.fromEntries((filled.fields ?? []).map((f) => [f.id, f]));
    expect(filledById.study?.value).toMatch(/Roxadustat|MDS/i);
    expect(filledById.study?.value).toMatch(/NCT07722988/);
    expect(filledById.phase?.value).toMatch(/Phase\s*3/i);
    expect(filledById.link?.href).toContain("NCT07722988");
  });

  it("puts FDA briefing link and summary in the Event doc (not the column)", () => {
    const row: DeskCalendarEvent = {
      key: "ABCD|fda",
      ticker: "ABCD",
      rowKey: "ABCD|2026-09-23",
      eventDate: "2026-09-23",
      daysUntil: 2,
      eventType: "fda_adcom",
      typeLabel: "AdCom",
      dateType: "confirmed",
      source: "fda",
      sourceKind: "fda_adcom",
      eventName: "AdCom",
      eventTitle: "Drug X",
      product: "Drug X",
      inBook: false,
    };
    const fdaHit: FdaAdcomRow = {
      id: "abcd-adcom",
      ticker: "ABCD",
      date: "2026-09-23",
      company: "ABCD Inc",
      product: "Drug X",
      eventEn: "AdCom",
      eventIt: "AdCom",
      committee: "ODAC",
      kind: "vote",
      href: "https://www.fda.gov/advisory-committees/meeting",
      briefing: {
        status: "ready",
        score: 6.2,
        pdfUrl: "https://www.fda.gov/files/briefing.pdf",
        materialsUrl: "https://www.fda.gov/materials",
        summaryIt: "Il briefing evidenzia rischi di sicurezza.",
        summaryEn: "The briefing highlights safety risks.",
        bulletsIt: ["Rischio epatico"],
        bulletsEn: ["Hepatic risk"],
        matchOk: true,
      },
    };
    const doc = eventReferenceDoc(row, true, null, null, null, fdaHit);
    const byId = Object.fromEntries((doc.fields ?? []).map((f) => [f.id, f]));
    expect(byId.fda_briefing?.href).toContain("briefing.pdf");
    expect(byId.fda_briefing?.value).toMatch(/6\.2|File/i);
    const fdaSec = doc.sections.find((s) => s.id === "fda_briefing");
    expect(fdaSec?.body.some((b) => /sicurezza|ODAC/i.test(b))).toBe(true);
  });
});
