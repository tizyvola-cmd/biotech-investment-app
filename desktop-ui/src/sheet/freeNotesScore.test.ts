import { describe, expect, it } from "vitest";
import { freeNotesBandLabel, scoreFreeNotes } from "./freeNotesScore";

describe("scoreFreeNotes", () => {
  it("returns empty when no text", () => {
    const s = scoreFreeNotes("");
    expect(s.score).toBeNull();
    expect(s.band).toBe("empty");
  });

  it("scores mixed ARCHER-style notes as mixed/cautious with reasons", () => {
    const text = `
Cardiol ARCHER Phase II mixed readout. Co-primary endpoints ECV and GLS missed
(p=0.0538 borderline). Directionally encouraging LV mass, but statistically fragile
and clinically unproven. Net: nobody else has passed the test either.
`;
    const s = scoreFreeNotes(text, false);
    expect(s.score).not.toBeNull();
    expect(s.score!).toBeLessThan(20);
    expect(s.reasons.length).toBeGreaterThan(1);
    expect(freeNotesBandLabel(s.band)).toMatch(/Mixed|Cautious|Bearish/i);
  });

  it("scores clear positive efficacy higher", () => {
    const s = scoreFreeNotes(
      "Primary endpoint met, statistically significant (p=0.01), clinically meaningful ORR, well tolerated.",
      false,
    );
    expect(s.score!).toBeGreaterThan(30);
    expect(["bullish", "constructive"]).toContain(s.band);
  });
});
