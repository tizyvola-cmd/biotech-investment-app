import { describe, expect, it } from "vitest";
import { scoreCompetitionLandscape } from "./competitionLandscapeScore";

const EXAMPLE = `
Current standard of care (no approved disease-specific drug)

For acute myocarditis there is no approved disease-specific drug — not from the FDA, not anywhere. Treatment is essentially supportive: rest, avoiding strenuous exercise, avoiding NSAIDs in the acute phase.

The most relevant direct precedent: ARAMIS / anakinra (Sobi)
Anakinra was tested in the ARAMIS trial: 30 days with anakinra vs. 31 with placebo, no significant difference (p=0.168). Safe, but ineffective.

Other candidates in development
Cantargia (CAN10) — still preclinical: far behind CardiolRx, not a near-term competitive threat.
Bristol-Myers Squibb (abatacept) — Phase 2 (ACHLYS) and Phase 3 (ATRIUM), but specifically for immune checkpoint inhibitor-associated myocarditis — different patient population. Not a direct competitor.

How CardiolRx is positioned
CardiolRx is probably still the most clinically advanced candidate for general (non-ICI) acute myocarditis — but ARCHER itself missed its co-primary endpoints (ECV, GLS), showing benefit only on a surrogate imaging endpoint. No competitor is clearly ahead of CardiolRx right now on the same patient population, but nobody has yet produced clean evidence of clinical efficacy.
`;

describe("scoreCompetitionLandscape", () => {
  it("returns empty band with no text", () => {
    const out = scoreCompetitionLandscape("");
    expect(out.score).toBeNull();
    expect(out.band).toBe("empty");
  });

  it("scores the myocarditis / CardiolRx example as mixed-to-favorable", () => {
    const out = scoreCompetitionLandscape(EXAMPLE);
    expect(out.score).not.toBeNull();
    expect(out.score!).toBeGreaterThan(0);
    expect(["favorable", "mixed"]).toContain(out.band);
    expect(out.namedPeers.some((p) => /anakinra/i.test(p))).toBe(true);
    expect(out.namedPeers.some((p) => /cantargia|abatacept/i.test(p))).toBe(true);
    expect(out.reasons.length).toBeGreaterThan(2);
  });

  it("penalizes crowded Phase 3 same-indication language", () => {
    const out = scoreCompetitionLandscape(
      "Highly competitive crowded field with two Phase 3 direct competitors on the same patient population.",
    );
    expect(out.score!).toBeLessThan(0);
    expect(["crowded", "hostile"]).toContain(out.band);
  });
});
