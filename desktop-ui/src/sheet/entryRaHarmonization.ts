/**
 * Unifica la semantica RA live (Pick stocks) vs calibrazione storica (Model Lab ρ).
 * Live: RA alto = raccomandazione BUY più forte.
 * Calibrazione: ρ grezzo può essere negativo → formula polarizzata usata live.
 */
import { loadStoredRaPolarities } from "./rascorePolarityStore";

export type EntryRaPolarityStatus = {
  polaritiesLoaded: boolean;
  invertedCount: number;
  pairCount: number;
  updatedAt: string | null;
};

export function getEntryRaPolarityStatus(): EntryRaPolarityStatus {
  const stored = loadStoredRaPolarities();
  if (!stored) {
    return { polaritiesLoaded: false, invertedCount: 0, pairCount: 0, updatedAt: null };
  }
  const reliable = stored.polarities.filter((p) => p.reliable);
  return {
    polaritiesLoaded: reliable.length > 0,
    invertedCount: reliable.filter((p) => p.invertForPrice).length,
    pairCount: stored.pairCount,
    updatedAt: stored.updatedAt,
  };
}

export function entryRaHarmonizationTooltipLines(
  lang: "it" | "en",
  score: number,
): string[] {
  const status = getEntryRaPolarityStatus();
  const lines =
    lang === "it"
      ? [
          `RA ingresso ${score}/100 — più alto = raccomandazione BUY più forte (non prevede il movimento di oggi).`,
          "Formula live = RA polarizzato (Σ indici ρ+ − Σ indici ρ−): stessa del grafico Model Lab «Entry RA».",
          "Il RA grezzo (somma semplice) può correlare inversamente col prezzo in calibrazione — non usarlo per leggere la tabella.",
        ]
      : [
          `Entry RA ${score}/100 — higher = stronger BUY recommendation (not today's price direction).`,
          "Live formula = polarized RA (Σ ρ+ indices − Σ ρ− indices) — same as Model Lab «Entry RA» chart line.",
          "Raw RA (simple sum) can correlate inversely with price in calibration — do not use it to read the table.",
        ];

  if (status.polaritiesLoaded) {
    lines.push(
      lang === "it"
        ? `${status.invertedCount} indici sottratti da calibrazione (${status.pairCount} coppie storiche).`
        : `${status.invertedCount} indices subtracted from calibration (${status.pairCount} historical pairs).`,
    );
  } else {
    lines.push(
      lang === "it"
        ? "Calibrazione polarità in corso — apri Model Lab o attendi refresh Simulation."
        : "Polarity calibration pending — open Model Lab or wait for Simulation refresh.",
    );
  }
  return lines;
}
