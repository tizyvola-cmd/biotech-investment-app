import { describe, expect, it } from "vitest";
import {
  isoToManualSimCd,
  parseManualCatalystInsert,
} from "./parseManualCatalystInsert";

describe("parseManualCatalystInsert", () => {
  it("parses labeled block", () => {
    const p = parseManualCatalystInsert(`
TICKER: CCCC
COMPANY: C4 Therapeutics, Inc.
NCT: NCT04756726
CD: 2026-09-30
DRUG: CFT7455
`);
    expect(p).toMatchObject({
      ticker: "CCCC",
      company: "C4 Therapeutics, Inc.",
      nctId: "NCT04756726",
      cdIso: "2026-09-30",
      drug: "CFT7455",
    });
  });

  it("parses pipe free text", () => {
    const p = parseManualCatalystInsert(
      "NRIX | Nurix Therapeutics | NCT05107674 | 30/09/2026",
    );
    expect(p?.ticker).toBe("NRIX");
    expect(p?.company).toContain("Nurix");
    expect(p?.nctId).toBe("NCT05107674");
    expect(p?.cdIso).toBe("2026-09-30");
  });

  it("extracts NCT and ISO from prose", () => {
    const p = parseManualCatalystInsert(
      "Add $VRTX Vertex Pharmaceuticals primary completion 2026-09-17 NCT06832410",
    );
    expect(p?.ticker).toBe("VRTX");
    expect(p?.nctId).toBe("NCT06832410");
    expect(p?.cdIso).toBe("2026-09-17");
  });

  it("returns null without ticker or CD", () => {
    expect(parseManualCatalystInsert("just some notes")).toBeNull();
    expect(parseManualCatalystInsert("TICKER: AAA")).toBeNull();
  });

  it("formats sim CD as DD/MM/YYYY", () => {
    expect(isoToManualSimCd("2026-09-30")).toBe("30/09/2026");
  });
});
