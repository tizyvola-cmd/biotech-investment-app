/**

 * Market Interest Gate (MIG) — gate indipendente dal SDS / Score Reliability.

 * Misura «pendenza di interesse» del mercato: Δprezzo × liquidità (volume).

 */



export type MIGVerdict = "PASS" | "WATCH" | "BLOCK";



export type MIGConfig = {

  /** Soglia minima |slope angle|° per interesse strutturale (default 20°). */

  minSlopeAngleDeg: number;

  /** Banda grigia sotto la soglia (default 8°). */

  watchBandDeg: number;

  /** Delta minimo |°| per segnalare cambio regime (batch compare). */

  minSignificantDeltaDeg: number;

  /** Sensibilità arctan — più alto = angoli più piatti (default 15). */

  normalizationFactor: number;

  /** Sotto questa vol ratio con prezzo ↑ → penalità divergenza (default 0.8). */

  lowVolumeThreshold: number;

};



export const DEFAULT_MIG_CONFIG: MIGConfig = {

  minSlopeAngleDeg: 20,

  watchBandDeg: 8,

  minSignificantDeltaDeg: 5,

  normalizationFactor: 15,

  lowVolumeThreshold: 0.8,

};



export type MarketInterestSnapshot = {

  ticker: string;

  cd?: string;

  daysToCd?: number | null;

  /** Variazione prezzo % (tipicamente ~5g). */

  deltaPricePct: number;

  /** Volume ratio (es. avg5d / avg20d). */

  volRatio: number;

  deltaSource?: string;

  volSource?: string;

  /** Pendenza modello Pred+5/5 **prima** ricalib giornaliera (pp/g). */

  preDailyModelSlope5dPpPerDay?: number | null;

  /** Pendenza modello Pred+5/5 **dopo** ricalib giornaliera (pp/g). */

  postDailyModelSlope5dPpPerDay?: number | null;

};



export type ModelSlopeCalibrationTier =

  | "aligned"

  | "drift"

  | "diverge"

  | "contrarian"

  | "unknown";



export type MIGModelCalibration = {

  modelSlopeAngleDeg: number | null;

  /** Mercato MII − modello (°). */

  slopeDeltaDeg: number | null;

  /** 0–100 — allineamento inclinometro vs pendenza modello. */

  calibrationScore: number | null;

  calibrationTier: ModelSlopeCalibrationTier;

};



export type MIGResult = {

  ticker: string;

  cd?: string;

  daysToCd?: number | null;

  deltaPricePct: number;

  volRatio: number;

  miiRaw: number;

  slopeAngleDeg: number;

  /** vs curva Prediction+recalib **prima** daily open. */

  calibPreDaily: MIGModelCalibration;

  /** vs curva **dopo** ricalib giornaliera (ancoraggio live oggi). */

  calibPostDaily: MIGModelCalibration;

  verdict: MIGVerdict;

  lowVolumePenalty: boolean;

  detail: string;

  /** Origine del ΔP ~5g usato per MII (es. Var.1M→5d vs Var.giorn×5). */
  deltaSource?: string;

  volSource?: string;

};



export function computeMiiRaw(

  deltaPricePct: number,

  volRatio: number,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): { raw: number; lowVolumePenalty: boolean } {

  const vr = Math.max(0, volRatio);

  let lowVolumePenalty = false;

  let raw = deltaPricePct * Math.log(vr + 1) * Math.sqrt(vr);

  if (deltaPricePct > 0 && vr < config.lowVolumeThreshold) {

    raw *= 0.55;

    lowVolumePenalty = true;

  }

  return { raw: round4(raw), lowVolumePenalty };

}



export function slopeAngleFromMiiRaw(

  miiRaw: number,

  normalizationFactor: number = DEFAULT_MIG_CONFIG.normalizationFactor,

): number {

  if (!Number.isFinite(miiRaw)) return 0;

  const angle = (Math.atan(miiRaw / normalizationFactor) * 180) / Math.PI;

  return round2(angle);

}



/** Stesso arctan(MII/vol) usato per mercato, applicato a un Δ% (es. slope modello × 5). */

export function slopeAngleFromDeltaAndVol(

  deltaPricePct: number,

  volRatio: number,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): number {

  const { raw } = computeMiiRaw(deltaPricePct, volRatio, config);

  return slopeAngleFromMiiRaw(raw, config.normalizationFactor);

}



const CALIB_MAX_GAP_DEG = 28;

const CALIB_ALIGNED_DEG = 8;

const CALIB_DRIFT_DEG = 18;

const CALIB_CONTRARIAN_MIN_DEG = 5;



const EMPTY_CALIB: MIGModelCalibration = {

  modelSlopeAngleDeg: null,

  slopeDeltaDeg: null,

  calibrationScore: null,

  calibrationTier: "unknown",

};



export function computeModelSlopeCalibration(

  marketSlopeAngleDeg: number,

  modelSlope5dPpPerDay: number | null | undefined,

  volRatio: number,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): MIGModelCalibration {

  if (modelSlope5dPpPerDay == null || !Number.isFinite(modelSlope5dPpPerDay)) {

    return { ...EMPTY_CALIB };

  }



  const modelDeltaPct5d = modelSlope5dPpPerDay * 5;

  const modelSlopeAngleDeg = slopeAngleFromDeltaAndVol(

    modelDeltaPct5d,

    volRatio,

    config,

  );

  const slopeDeltaDeg = round2(marketSlopeAngleDeg - modelSlopeAngleDeg);

  const gapAbs = Math.abs(slopeDeltaDeg);



  const oppositeSign =

    Math.abs(marketSlopeAngleDeg) >= CALIB_CONTRARIAN_MIN_DEG &&

    Math.abs(modelSlopeAngleDeg) >= CALIB_CONTRARIAN_MIN_DEG &&

    Math.sign(marketSlopeAngleDeg) !== Math.sign(modelSlopeAngleDeg);



  let calibrationScore = round2(

    Math.max(0, Math.min(100, 100 - (gapAbs / CALIB_MAX_GAP_DEG) * 100)),

  );

  if (oppositeSign) {

    calibrationScore = round2(Math.max(0, calibrationScore * 0.55 - 12));

  }



  let calibrationTier: ModelSlopeCalibrationTier;

  if (oppositeSign) calibrationTier = "contrarian";

  else if (gapAbs < CALIB_ALIGNED_DEG) calibrationTier = "aligned";

  else if (gapAbs < CALIB_DRIFT_DEG) calibrationTier = "drift";

  else calibrationTier = "diverge";



  return {

    modelSlopeAngleDeg,

    slopeDeltaDeg,

    calibrationScore,

    calibrationTier,

  };

}



/** Gap % simmetrico tra inclinometro MII e pendenza modello (0 = identici). */

export function miiModelGapPct(

  miiAngleDeg: number,

  modelAngleDeg: number | null | undefined,

): number | null {

  if (modelAngleDeg == null || !Number.isFinite(modelAngleDeg)) return null;

  const gap = Math.abs(miiAngleDeg - modelAngleDeg);

  const den = Math.max(Math.abs(miiAngleDeg), Math.abs(modelAngleDeg), 3);

  return round2((gap / den) * 100);

}



function appendCalibDetail(

  parts: string[],

  label: string,

  calib: MIGModelCalibration,

): void {

  if (calib.modelSlopeAngleDeg == null) return;

  parts.push(

    `${label} ${calib.modelSlopeAngleDeg >= 0 ? "+" : ""}${calib.modelSlopeAngleDeg.toFixed(1)}°`,

  );

  if (calib.slopeDeltaDeg != null) {

    parts.push(

      `Δ${label} ${calib.slopeDeltaDeg >= 0 ? "+" : ""}${calib.slopeDeltaDeg.toFixed(1)}°`,

    );

  }

  if (calib.calibrationScore != null) {

    parts.push(`${label} ${calib.calibrationScore.toFixed(0)}/100`);

  }

}



export function verdictFromSlopeAngle(

  slopeAngleDeg: number,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): MIGVerdict {

  const abs = Math.abs(slopeAngleDeg);

  if (abs >= config.minSlopeAngleDeg) return "PASS";

  if (abs >= config.minSlopeAngleDeg - config.watchBandDeg) return "WATCH";

  return "BLOCK";

}



export function evaluateMarketInterest(

  snapshot: MarketInterestSnapshot,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): MIGResult {

  const { raw, lowVolumePenalty } = computeMiiRaw(

    snapshot.deltaPricePct,

    snapshot.volRatio,

    config,

  );

  const slopeAngleDeg = slopeAngleFromMiiRaw(raw, config.normalizationFactor);

  const verdict = verdictFromSlopeAngle(slopeAngleDeg, config);



  const calibPreDaily = computeModelSlopeCalibration(

    slopeAngleDeg,

    snapshot.preDailyModelSlope5dPpPerDay,

    snapshot.volRatio,

    config,

  );

  const calibPostDaily = computeModelSlopeCalibration(

    slopeAngleDeg,

    snapshot.postDailyModelSlope5dPpPerDay,

    snapshot.volRatio,

    config,

  );



  const detailParts: string[] = [

    `ΔP ${fmtPct(snapshot.deltaPricePct)}`,

    `Vol ${snapshot.volRatio.toFixed(2)}×`,

    `MII ${raw.toFixed(2)}`,

    `${slopeAngleDeg >= 0 ? "+" : ""}${slopeAngleDeg.toFixed(1)}°`,

  ];

  appendCalibDetail(detailParts, "pre", calibPreDaily);

  appendCalibDetail(detailParts, "post", calibPostDaily);

  if (lowVolumePenalty) detailParts.push("low-vol↑");



  return {

    ticker: snapshot.ticker,

    cd: snapshot.cd,

    daysToCd: snapshot.daysToCd,

    deltaPricePct: snapshot.deltaPricePct,

    volRatio: snapshot.volRatio,

    miiRaw: raw,

    slopeAngleDeg,

    calibPreDaily,

    calibPostDaily,

    verdict,

    lowVolumePenalty,

    detail: detailParts.join(" · "),

    deltaSource: snapshot.deltaSource,

    volSource: snapshot.volSource,

  };

}



export type MIGBatchResult = {

  pass: MIGResult[];

  watch: MIGResult[];

  block: MIGResult[];

  all: MIGResult[];

};



/** Valuta tutta la cohort Simulation — ordine per |angle| desc. */

export function evaluateBatch(

  snapshots: MarketInterestSnapshot[],

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): MIGBatchResult {

  const all = snapshots

    .map((s) => evaluateMarketInterest(s, config))

    .sort((a, b) => Math.abs(b.slopeAngleDeg) - Math.abs(a.slopeAngleDeg));



  const pass: MIGResult[] = [];

  const watch: MIGResult[] = [];

  const block: MIGResult[] = [];

  for (const r of all) {

    if (r.verdict === "PASS") pass.push(r);

    else if (r.verdict === "WATCH") watch.push(r);

    else block.push(r);

  }

  return { pass, watch, block, all };

}



export type MIGRegimeChange = {

  ticker: string;

  prevVerdict: MIGVerdict;

  currVerdict: MIGVerdict;

  deltaAngleDeg: number;

  significant: boolean;

};



export function detectRegimeChange(

  prev: MIGResult,

  curr: MIGResult,

  config: MIGConfig = DEFAULT_MIG_CONFIG,

): MIGRegimeChange {

  const deltaAngleDeg = round2(curr.slopeAngleDeg - prev.slopeAngleDeg);

  const crossedVerdict = prev.verdict !== curr.verdict;

  const significant =

    crossedVerdict ||

    Math.abs(deltaAngleDeg) >= config.minSignificantDeltaDeg;

  return {

    ticker: curr.ticker,

    prevVerdict: prev.verdict,

    currVerdict: curr.verdict,

    deltaAngleDeg,

    significant,

  };

}



function round2(n: number): number {

  return Math.round(n * 100) / 100;

}



function round4(n: number): number {

  return Math.round(n * 10_000) / 10_000;

}



function fmtPct(v: number): string {

  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

}



export function formatMIGResult(r: MIGResult): string {

  return `${r.ticker} ${r.verdict} ${r.slopeAngleDeg.toFixed(1)}° (${r.detail})`;

}


