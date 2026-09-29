/**
 * Heuristic competition-landscape score from analyst free text.
 * Not Soft BUY/SELL — context only for EIS deep dive.
 *
 * Score ∈ [-100, +100]: higher = more favorable landscape for the ticker
 * (empty SoC / first-in-class / weak peers). Lower = crowded / ahead peers / weak own data.
 */

export type CompetitionLandscapeBand =
  | "favorable"
  | "mixed"
  | "crowded"
  | "hostile"
  | "empty";

export type CompetitionLandscapeScore = {
  score: number | null;
  band: CompetitionLandscapeBand;
  reasons: string[];
  /** Named peers / precedents detected in the text. */
  namedPeers: string[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pushReason(reasons: string[], hit: boolean, text: string): boolean {
  if (hit) reasons.push(text);
  return hit;
}

/**
 * Score competition / SoC free text for a ticker's competitive position.
 */
export function scoreCompetitionLandscape(
  text: string | null | undefined,
  it = false,
): CompetitionLandscapeScore {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return {
      score: null,
      band: "empty",
      reasons: [
        it
          ? "Nessun testo — incolla SoC / competition per uno score euristico."
          : "No text — paste SoC / competition notes for a heuristic score.",
      ],
      namedPeers: [],
    };
  }

  const t = raw.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const namedPeers: string[] = [];

  const peerPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /\banakinra\b|\baramis\b/i, name: "Anakinra (ARAMIS)" },
    { re: /\bcantargia\b|\bcan10\b/i, name: "Cantargia (CAN10)" },
    { re: /\babatacept\b|\batrium\b|\bachlys\b/i, name: "Abatacept (ATRIUM/ACHLYS)" },
    { re: /\bsobi\b/i, name: "Sobi" },
    { re: /\bbms\b|\bbristol[- ]myers\b/i, name: "Bristol-Myers Squibb" },
  ];
  for (const p of peerPatterns) {
    if (p.re.test(raw) && !namedPeers.includes(p.name)) namedPeers.push(p.name);
  }

  // Empty / no approved SoC → favorable
  if (
    pushReason(
      reasons,
      /no approved|nessun.? farmaco approvato|no disease-specific|empty of specific|campo vuoto|nessuna alternativ/i.test(
        t,
      ),
      it
        ? "Nessun farmaco disease-specific approvato (SoC assente / supporto)."
        : "No approved disease-specific drug (empty / supportive SoC).",
    )
  ) {
    score += 28;
  }

  if (
    pushReason(
      reasons,
      /supportive care|best supportive|rest, avoiding|terapia di supporto/i.test(t),
      it ? "SoC descritto come supporto / HF standard." : "SoC described as supportive / standard HF care.",
    )
  ) {
    score += 8;
  }

  // First-in-class / most advanced on same population
  if (
    pushReason(
      reasons,
      /first in class|most clinically advanced|più avanzat|nessun competitor.*(avanti|ahead)|no competitor is clearly ahead/i.test(
        t,
      ),
      it
        ? "Posizionamento first-in-class / più avanzato sulla stessa popolazione."
        : "First-in-class / most advanced on the same population.",
    )
  ) {
    score += 22;
  }

  // Failed direct precedent — mixed (validates risk but clears peers)
  if (
    pushReason(
      reasons,
      /(failed|fallit|no significant|no survival benefit|ineffective|non ha funzionato).{0,80}(anakinra|aramis|trial|endpoint)|anakinra.{0,60}(failed|no significant|ineffective)/i.test(
        t,
      ),
      it
        ? "Precedente diretto fallito (es. anakinra/ARAMIS) — campo libero ma rischio di classe."
        : "Direct precedent failed (e.g. anakinra/ARAMIS) — open field but class risk.",
    )
  ) {
    score += 6;
    score -= 12;
  }

  // Preclinical / far behind peers → slight positive (not near-term threat)
  if (
    pushReason(
      reasons,
      /preclinical|far behind|not a near-term|preclinico|lontano da/i.test(t),
      it
        ? "Peer ancora preclinici / non near-term."
        : "Peers still preclinical / not near-term.",
    )
  ) {
    score += 10;
  }

  // Different population → mild threat only
  if (
    pushReason(
      reasons,
      /different (and smaller )?patient population|not a direct competitor|popolazione diversa|non competitor diretto|ici[- ]associated|checkpoint inhibitor/i.test(
        t,
      ),
      it
        ? "Peer su popolazione diversa (es. ICI-myocarditis) — minaccia indiretta."
        : "Peer on different population (e.g. ICI-myocarditis) — indirect threat.",
    )
  ) {
    score -= 8;
  }

  // Same-indication Phase 2/3 peers → crowded
  const phaseHits =
    (t.match(/phase\s*3|fase\s*3/g) ?? []).length +
    (t.match(/phase\s*2|fase\s*2/g) ?? []).length;
  if (
    pushReason(
      reasons,
      phaseHits >= 2 && /competitor|candidate|in development|in sviluppo|trial/i.test(t),
      it
        ? "Più programmi Phase 2/3 citati nello stesso spazio."
        : "Multiple Phase 2/3 programs cited in the same space.",
    )
  ) {
    score -= 18;
  } else if (
    pushReason(
      reasons,
      /phase\s*3|fase\s*3/.test(t) && /competitor|direct|stessa popolazione|same (patient )?population/i.test(t),
      it ? "Peer Phase 3 sulla stessa indicazione." : "Phase 3 peer on the same indication.",
    )
  ) {
    score -= 24;
  }

  // Own weak efficacy evidence → hurts competitive *position* even if peers weak
  if (
    pushReason(
      reasons,
      /missed.{0,40}(primary|co-primary)|mancat.{0,40}endpoint|surrogate|only on a surrogate|nessuna.{0,30}clinical efficacy|nobody has really passed/i.test(
        t,
      ),
      it
        ? "Evidenza clinica ancora debole / endpoint surrogate (anche per il titolo)."
        : "Clinical evidence still weak / surrogate endpoints (including this ticker).",
    )
  ) {
    score -= 16;
  }

  // Explicit crowded / competitive language
  if (
    pushReason(
      reasons,
      /highly competitive|crowded field|campo affollato|forte competition|many competitors/i.test(t),
      it ? "Testo che descrive un campo affollato." : "Text describes a crowded field.",
    )
  ) {
    score -= 20;
  }

  score = clamp(Math.round(score), -100, 100);

  let band: CompetitionLandscapeBand;
  if (score >= 25) band = "favorable";
  else if (score >= 0) band = "mixed";
  else if (score >= -25) band = "crowded";
  else band = "hostile";

  if (!reasons.length) {
    reasons.push(
      it
        ? "Score euristico generico — aggiungi SoC, peer Phase, esiti falliti."
        : "Generic heuristic — add SoC, peer phase, failed precedents.",
    );
  }

  return { score, band, reasons: reasons.slice(0, 8), namedPeers };
}

export function competitionBandLabel(band: CompetitionLandscapeBand, it: boolean): string {
  switch (band) {
    case "favorable":
      return it ? "Favorevole" : "Favorable";
    case "mixed":
      return it ? "Misto" : "Mixed";
    case "crowded":
      return it ? "Affollato" : "Crowded";
    case "hostile":
      return it ? "Ostile" : "Hostile";
    default:
      return it ? "—" : "—";
  }
}
