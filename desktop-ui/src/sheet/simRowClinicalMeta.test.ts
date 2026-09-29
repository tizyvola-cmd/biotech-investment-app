import { describe, expect, it } from "vitest";
import {
  clinicalDrugFromSimRow,
  clinicalPhaseFromSimRow,
  clinicalStudyTitleFromSimRow,
  formatRegulatoryMilestoneLabel,
  isRegulatoryMilestoneLabel,
  looksLikeStudyTitle,
  usableProductName,
} from "./simRowClinicalMeta";

describe("isRegulatoryMilestoneLabel", () => {
  it("flags PDUFA / NDA / BLA as catalyst types, not trial names", () => {
    expect(isRegulatoryMilestoneLabel("PDUFA")).toBe(true);
    expect(isRegulatoryMilestoneLabel("pdufa date")).toBe(true);
    expect(isRegulatoryMilestoneLabel("NDA")).toBe(true);
    expect(isRegulatoryMilestoneLabel("BLA")).toBe(true);
    expect(formatRegulatoryMilestoneLabel("pdufa")).toBe("PDUFA");
  });

  it("does not flag a real study or drug", () => {
    expect(isRegulatoryMilestoneLabel("NILE IMFINZI NSCLC")).toBe(false);
    expect(isRegulatoryMilestoneLabel("IMFINZI")).toBe(false);
    // Phase 3 is a trial phase (Studio Phase), not a PDUFA-style catalyst type —
    // but usableProductName still rejects it as a product name.
    expect(isRegulatoryMilestoneLabel("Phase 3")).toBe(false);
  });
});

describe("looksLikeStudyTitle / usableProductName", () => {
  it("rejects CT.gov brief titles as products", () => {
    expect(
      looksLikeStudyTitle(
        "A Study of the Safety and Efficacy of Drug X in Patients With Y",
      ),
    ).toBe(true);
    expect(usableProductName("A Study of the Safety")).toBe("");
    expect(usableProductName("NCT02194738")).toBe("");
    expect(usableProductName("Study NCT02194738")).toBe("");
    expect(usableProductName("CD study")).toBe("");
    expect(usableProductName("Studio CD")).toBe("");
    expect(usableProductName("CardiolRx")).toBe("CardiolRx");
    expect(usableProductName("cemsidomide")).toBe("cemsidomide");
  });

  it("rejects SHAREHOLDER ALERT and bare Phase 3 as product names", () => {
    expect(usableProductName("SHAREHOLDER")).toBe("");
    expect(usableProductName("Phase 3")).toBe("");
    expect(usableProductName("PHASE3")).toBe("");
    expect(usableProductName("BBNX — Daily News EIS")).toBe("");
    expect(usableProductName("—")).toBe("");
    expect(usableProductName("iLet")).toBe("iLet");
  });

  it("does not treat a study title parked in the Drug column as product", () => {
    expect(
      clinicalDrugFromSimRow({
        Drug: "A Study of the Safety and Efficacy of Compound Z",
      }),
    ).toBe("");
  });
});

describe("clinicalStudyTitleFromSimRow", () => {
  it("reads Clinical Study and skips a PDUFA-only cell", () => {
    expect(
      clinicalStudyTitleFromSimRow({
        "Clinical Study": "PDUFA",
        Drug: "IMFINZI",
      }),
    ).toBe("");
    expect(
      clinicalStudyTitleFromSimRow({
        "Clinical Study": "NILE: durvalumab in resectable NSCLC",
      }),
    ).toMatch(/NILE/i);
  });

  it("does not treat PDUFA as the drug name", () => {
    expect(clinicalDrugFromSimRow({ Drug: "PDUFA" })).toBe("");
    expect(clinicalDrugFromSimRow({ Drug: "IMFINZI" })).toBe("IMFINZI");
  });

  it("reads guidance-calendar sidecar drug / phase / indication", () => {
    expect(
      clinicalDrugFromSimRow({
        "Studio Phase": "PDUFA",
        guidance_asset_name: "SofPulse",
        guidance_event_type: "pdufa",
      }),
    ).toBe("SofPulse");
    expect(
      clinicalPhaseFromSimRow({
        "Studio Phase": "PDUFA",
        guidance_trial_phase: "3",
      }),
    ).toMatch(/Phase 3/i);
  });
});
