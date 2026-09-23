/**
 * Heuristic score for EIS deep-dive free notes (analyst thesis tone).
 * Not Soft BUY/SELL — context only. Score ∈ [-100, +100].
 */

export type FreeNotesBand =
  | "bullish"
  | "constructive"
  | "mixed"
  | "cautious"
  | "bearish"
  | "empty";

export type FreeNotesScore = {
  score: number | null;
  band: FreeNotesBand;
  reasons: string[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pushReason(reasons: string[], hit: boolean, text: string): boolean {
  if (hit) reasons.push(text);
  return hit;
}

export function freeNotesBandLabel(band: FreeNotesBand, it = false): string {
  switch (band) {
    case "bullish":
      return it ? "Bullish" : "Bullish";
    case "constructive":
      return it ? "Costruttivo" : "Constructive";
    case "mixed":
      return it ? "Misto" : "Mixed";
    case "cautious":
      return it ? "Cauto" : "Cautious";
    case "bearish":
      return it ? "Bearish" : "Bearish";
    default:
      return it ? "—" : "—";
  }
}

function bandFromScore(score: number): FreeNotesBand {
  if (score >= 45) return "bullish";
  if (score >= 18) return "constructive";
  if (score > -18) return "mixed";
  if (score > -45) return "cautious";
  return "bearish";
}

/**
 * Score free-note prose for how constructive vs fragile the thesis reads.
 */
export function scoreFreeNotes(
  text: string | null | undefined,
  it = false,
): FreeNotesScore {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return {
      score: null,
      band: "empty",
      reasons: [
        it
          ? "Nessuna nota — inserisci testo e Commit per uno score euristico."
          : "No notes — commit text for a heuristic score.",
      ],
    };
  }

  const t = raw.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  if (
    pushReason(
      reasons,
      /endpoint\s+met|statistically significant|p\s*[<=]\s*0\.0[0-4]|highly significant|clear(?:ly)? positive|strong efficacy/i.test(
        t,
      ),
      it
        ? "Segnali di efficacia / significatività statistica nel testo."
        : "Efficacy / statistical-significance signals in the text.",
    )
  ) {
    score += 28;
  }

  if (
    pushReason(
      reasons,
      /first[- ]in[- ]class|directionally encouraging|encouraging|favorable remodeling|clinically meaningful|well tolerated|clean safety/i.test(
        t,
      ),
      it
        ? "Tono costruttivo (first-in-class / encouraging / safety pulita)."
        : "Constructive tone (first-in-class / encouraging / clean safety).",
    )
  ) {
    score += 16;
  }

  if (
    pushReason(
      reasons,
      /mixed readout|mixed|nuance|framed more positively|company framing|spin/i.test(t),
      it
        ? "Readout misto / framing aziendale più positivo dei dati."
        : "Mixed readout / company framing ahead of the data.",
    )
  ) {
    score -= 10;
  }

  if (
    pushReason(
      reasons,
      /endpoint (not )?missed|co-primary.{0,40}miss|failed|not met|no significant|non[- ]significant|p\s*=\s*0\.0[5-9]|p\s*>\s*0\.05|borderline/i.test(
        t,
      ),
      it
        ? "Endpoint mancati / p borderline o non significativi."
        : "Missed endpoints / borderline or non-significant p-values.",
    )
  ) {
    score -= 26;
  }

  if (
    pushReason(
      reasons,
      /statistically fragile|clinically unproven|underpowered|fragile|not proven|unproven|surrogate/i.test(
        t,
      ),
      it
        ? "Evidenza fragile / surrogate / clinicamente non provata."
        : "Fragile / surrogate / clinically unproven evidence.",
    )
  ) {
    score -= 18;
  }

  if (
    pushReason(
      reasons,
      /worsen|deteriorat|safety concern|red flag|halt|futility|terminate/i.test(t),
      it ? "Segnali di peggioramento / safety concern." : "Worsening / safety-concern signals.",
    )
  ) {
    score -= 22;
  }

  if (
    pushReason(
      reasons,
      /net:\s*directionally|nobody else has passed|open field|no competitor is clearly ahead/i.test(
        t,
      ),
      it
        ? "Sintesi net: campo aperto / nessuno ha ancora passato il test."
        : "Net take: open field / nobody has passed the test yet.",
    )
  ) {
    score += 8;
  }

  // Length heuristic: substantial notes get a small credibility bump (not a thesis bump)
  if (raw.length >= 400 && reasons.length === 0) {
    reasons.push(
      it
        ? "Nota lunga senza cue forti — score vicino al neutro."
        : "Long note without strong cues — score near neutral.",
    );
  }

  if (!reasons.length) {
    reasons.push(
      it
        ? "Nessun cue forte rilevato — score vicino a zero."
        : "No strong cues detected — score near zero.",
    );
  }

  const final = clamp(Math.round(score), -100, 100);
  return {
    score: final,
    band: bandFromScore(final),
    reasons,
  };
}
