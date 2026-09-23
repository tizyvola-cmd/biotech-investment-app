import type { MarketContextDecisionCtx, MarketContextSnapshotDoc, McsDayComponents } from "./marketContextScore";

export type McsDriverKey = "sector" | "macro" | "breadth" | "fda";

const DRIVER_WEIGHTS: Record<McsDriverKey, number> = {
  sector: 0.4,
  macro: 0.3,
  breadth: 0.2,
  fda: 0.1,
};

/** XBI session volume vs trailing mean — surge when well above normal. */
export const MCS_VOLUME_SURGE_MIN_RATIO = 1.3;

export type McsBannerSummary = {
  headlineIt: string;
  headlineEn: string;
  attributionIt: string;
  attributionEn: string;
  volumeSurge: boolean;
  volumeRatio: number | null;
  dominantDriver: McsDriverKey | null;
};

function driverScores(comps: McsDayComponents | null | undefined): Array<{
  key: McsDriverKey;
  score: number;
  weighted: number;
}> {
  if (!comps) return [];
  const raw: Array<{ key: McsDriverKey; score: number | null | undefined }> = [
    { key: "sector", score: comps.sector?.score },
    { key: "macro", score: comps.macro?.score },
    { key: "breadth", score: comps.breadth?.score },
    { key: "fda", score: comps.fda?.score },
  ];
  return raw
    .filter((d): d is { key: McsDriverKey; score: number } => d.score != null && Number.isFinite(d.score))
    .map((d) => ({ key: d.key, score: d.score, weighted: d.score * DRIVER_WEIGHTS[d.key] }))
    .sort((a, b) => b.weighted - a.weighted);
}

export function xbiVolumeSurgeRatio(
  doc: MarketContextSnapshotDoc | null | undefined,
): number | null {
  const bars = doc?.series?.XBI ?? doc?.series?.["^XBI"] ?? [];
  const withVol = bars.filter((b) => b.volume != null && b.volume > 0);
  if (withVol.length < 8) return null;
  const last = withVol[withVol.length - 1]!.volume!;
  const window = withVol.slice(-21, -1);
  if (window.length < 5) return null;
  const avg = window.reduce((s, b) => s + b.volume!, 0) / window.length;
  if (avg <= 0) return null;
  return last / avg;
}

function volumeHeadlineSuffix(ratio: number | null, it: boolean): string {
  if (ratio == null || ratio < MCS_VOLUME_SURGE_MIN_RATIO) return "";
  const pct = Math.round((ratio - 1) * 100);
  return it
    ? ` · Volume investimenti in aumento (+${pct}% su XBI vs media recente)`
    : ` · Investment volume rising (+${pct}% on XBI vs recent avg)`;
}

function bandHeadline(ctx: MarketContextDecisionCtx, it: boolean): string {
  if (ctx.mcsBand === "adverse") {
    return it ? "Raffreddamento generale del mercato" : "Broad market cooling";
  }
  if (ctx.mcsBand === "favorable") {
    return it
      ? "Mercato relativamente calmo — calo titolo più probabile causa interna"
      : "Market relatively calm — stock drops more likely company-specific";
  }
  if (ctx.mcsBand === "ambiguous") {
    return it ? "Contesto di mercato misto" : "Mixed market context";
  }
  return it ? "Contesto di mercato non disponibile" : "Market context unavailable";
}

function attributionForDriver(
  key: McsDriverKey,
  comps: McsDayComponents,
  it: boolean,
): string {
  if (key === "sector") {
    const slope = comps.sector?.xbi_slope_5d_pct;
    if (slope != null && Number.isFinite(slope)) {
      const signed = `${slope > 0 ? "+" : ""}${slope.toFixed(1)}%`;
      return it
        ? `Oscillazione spiegata soprattutto dal settore biotech (XBI ${signed} su 5 giorni).`
        : `Move driven mainly by the biotech sector (XBI ${signed} over 5 days).`;
    }
    return it
      ? "Oscillazione spiegata soprattutto dal settore biotech (ETF XBI)."
      : "Move driven mainly by the biotech sector (XBI ETF).";
  }
  if (key === "macro") {
    const vix = comps.macro?.vix_level;
    const vixPart =
      vix != null && Number.isFinite(vix) ? (it ? `VIX ${vix.toFixed(1)}` : `VIX ${vix.toFixed(1)}`) : null;
    return it
      ? `Oscillazione spiegata soprattutto da macro / paura di mercato${vixPart ? ` (${vixPart})` : ""}.`
      : `Move driven mainly by macro / market fear${vixPart ? ` (${vixPart})` : ""}.`;
  }
  if (key === "breadth") {
    return it
      ? "Oscillazione spiegata soprattutto da partecipazione debole del listino (breadth bassa — pochi titoli tengono il rialzo)."
      : "Move driven mainly by weak market participation (low breadth — few stocks holding the rally).";
  }
  return it
    ? "Oscillazione spiegata soprattutto da pressione regolatoria FDA (CRL recenti su biotech)."
    : "Move driven mainly by FDA regulatory pressure (recent CRLs on biotech).";
}

export function buildMcsBannerSummary(
  doc: MarketContextSnapshotDoc | null | undefined,
  ctx: MarketContextDecisionCtx,
): McsBannerSummary {
  const latest = doc?.latest ?? doc?.history?.[doc.history.length - 1] ?? null;
  const comps = latest?.components ?? null;
  const volumeRatio = xbiVolumeSurgeRatio(doc);
  const volumeSurge = volumeRatio != null && volumeRatio >= MCS_VOLUME_SURGE_MIN_RATIO;
  const drivers = driverScores(comps);
  const dominant = drivers[0]?.key ?? null;

  const headlineBaseIt = bandHeadline(ctx, true);
  const headlineBaseEn = bandHeadline(ctx, false);
  const volIt = volumeHeadlineSuffix(volumeRatio, true);
  const volEn = volumeHeadlineSuffix(volumeRatio, false);

  const attributionIt =
    comps && dominant
      ? attributionForDriver(dominant, comps, true)
      : "Componenti MCS non disponibili — apri i dettagli con l'icona meteo.";
  const attributionEn =
    comps && dominant
      ? attributionForDriver(dominant, comps, false)
      : "MCS components unavailable — open details via the weather icon.";

  return {
    headlineIt: headlineBaseIt + volIt,
    headlineEn: headlineBaseEn + volEn,
    attributionIt,
    attributionEn,
    volumeSurge,
    volumeRatio,
    dominantDriver: dominant,
  };
}
