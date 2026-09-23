import { describe, expect, it } from "vitest";
import {
  contentMatchesNewsTitle,
  extractIndicationFromNewsTitle,
  extractProductFromNewsTitle,
  isShareholderAlertTitle,
  resolveNewsProductHints,
} from "./newsBriefProductHints";

const BIIB_TITLE =
  "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment - simplywall.st";

describe("newsBriefProductHints", () => {
  it("extracts Alzheimer's indication from the China-approval headline", () => {
    expect(extractIndicationFromNewsTitle(BIIB_TITLE)).toBe("Alzheimer's disease");
  });

  it("does not treat BIIB ticker as a product brand", () => {
    expect(extractProductFromNewsTitle(BIIB_TITLE)).toBeNull();
  });

  it("rejects zorevunersen / Dravet when the headline is Alzheimer's", () => {
    const hints = resolveNewsProductHints({
      title: BIIB_TITLE,
      briefProduct: "zorevunersen",
      briefIndication: "Dravet syndrome",
      simProduct: "zorevunersen",
      simIndication: "Dravet syndrome",
    });
    expect(hints.product).toBeNull();
    expect(hints.indication).toBe("Alzheimer's disease");
  });

  it("keeps LEQEMBI when the brief already matches the headline franchise", () => {
    const hints = resolveNewsProductHints({
      title: BIIB_TITLE,
      briefProduct: "LEQEMBI",
      briefIndication: "Alzheimer's disease",
      simProduct: "zorevunersen",
      simIndication: "Dravet syndrome",
    });
    expect(hints.product).toBe("LEQEMBI");
    expect(hints.indication).toBe("Alzheimer's disease");
  });

  it("does not fall back to a conflicting sim pipeline drug", () => {
    const hints = resolveNewsProductHints({
      title: BIIB_TITLE,
      briefProduct: null,
      briefIndication: null,
      simProduct: "zorevunersen",
      simIndication: "Dravet syndrome",
    });
    expect(hints.product).toBeNull();
    expect(hints.indication).toBe("Alzheimer's disease");
  });

  it("does not treat SHAREHOLDER ALERT as a product name", () => {
    const title =
      "BBNX SHAREHOLDER ALERT: Bronstein, Gewirtz and Grossman, LLC Anno - The National Law Review";
    expect(extractProductFromNewsTitle(title)).toBeNull();
    expect(isShareholderAlertTitle(title)).toBe(true);
    const hints = resolveNewsProductHints({
      title,
      briefProduct: "SHAREHOLDER",
      simProduct: "iLet",
      simIndication: "type 1 diabetes",
    });
    expect(hints.product).toBe("iLet");
    expect(hints.indication).toBe("type 1 diabetes");
  });

  it("contentMatchesNewsTitle requires shared topic tokens", () => {
    expect(
      contentMatchesNewsTitle("zorevunersen Phase 3 EMPEROR Dravet seizures", BIIB_TITLE),
    ).toBe(false);
    expect(
      contentMatchesNewsTitle(
        "China NMPA approved weekly Alzheimer's at-home treatment",
        BIIB_TITLE,
      ),
    ).toBe(true);
  });
});
