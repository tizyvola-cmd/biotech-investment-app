import { describe, expect, it } from "vitest";
import {
  formatSuggestedActionUpper,
  isPortfolioHoldDisplay,
  suggestedActionLabel,
  uiSuggestedAction,
} from "./suggestionMonitor";

describe("portfolio hold display", () => {
  it("maps buy + hasPosition to hold in UI", () => {
    expect(isPortfolioHoldDisplay("buy", true)).toBe(true);
    expect(uiSuggestedAction("buy", true)).toBe("hold");
    expect(suggestedActionLabel("buy", "it", true)).toBe("MANTIENI");
    expect(suggestedActionLabel("buy", "en", true)).toBe("HOLD");
  });

  it("keeps buy for opportunities", () => {
    expect(uiSuggestedAction("buy", false)).toBe("buy");
    expect(suggestedActionLabel("buy", "it", false)).toBe("BUY");
  });

  it("formatSuggestedActionUpper tolerates missing action", () => {
    expect(formatSuggestedActionUpper(undefined)).toBe("NONE");
    expect(formatSuggestedActionUpper("buy")).toBe("BUY");
  });
});
