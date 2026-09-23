/**
 * Catalyst Bias column (Framework v2 signal 3).
 * Weights are ARBITRARY starting points — calibrate later. Not Soft BUY/SELL.
 */

export type BiasWeights = {
  wRr: number;
  wPriceVol: number;
  wInsider: number;
  wSector: number;
  bullThreshold: number;
  bearThreshold: number;
  rrThreshold: number;
};

/** Arbitrary uncalibrated defaults (brief). Configurable — not truth. */
export const DEFAULT_BIAS_WEIGHTS: BiasWeights = {
  wRr: 0.35,
  wPriceVol: 0.3,
  wInsider: 0.15,
  wSector: 0.2,
  bullThreshold: 0.3,
  bearThreshold: -0.3,
  rrThreshold: 0.05,
};

export type BiasInput = {
  rr10?: number | null;
  priceVolKind?: "together_up" | "together_down" | "diverge" | "other" | null;
  insiderNetBuy30d?: number | null;
  relativeMove?: number | null;
};

export type BiasCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none";
  tip: string;
  score: number | null;
};

function signRr(rr: number | null | undefined, thr: number): number {
  if (rr == null || !Number.isFinite(rr)) return 0;
  if (rr > thr) return 1;
  if (rr < -thr) return -1;
  return 0;
}

function signPv(kind: BiasInput["priceVolKind"]): number {
  if (kind === "together_up") return 1;
  if (kind === "together_down") return -1;
  return 0;
}

function signNum(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  if (v > 0) return 1;
  if (v < 0) return -1;
  return 0;
}

export function computeBiasScore(
  input: BiasInput,
  weights: BiasWeights = DEFAULT_BIAS_WEIGHTS,
): { score: number | null; label: "bullish_build" | "fear_hedge" | "mixed" | null } {
  const sRr = signRr(input.rr10, weights.rrThreshold);
  const sPv = signPv(input.priceVolKind);
  const sIn = signNum(input.insiderNetBuy30d);
  const sSec = signNum(input.relativeMove);
  if (sRr === 0 && sPv === 0 && sIn === 0 && sSec === 0) {
    return { score: null, label: null };
  }
  const score =
    weights.wRr * sRr +
    weights.wPriceVol * sPv +
    weights.wInsider * sIn +
    weights.wSector * sSec;
  const rounded = Math.round(score * 10000) / 10000;
  if (rounded > weights.bullThreshold) return { score: rounded, label: "bullish_build" };
  if (rounded < weights.bearThreshold) return { score: rounded, label: "fear_hedge" };
  return { score: rounded, label: "mixed" };
}

export function priceVolKindFromLabel(
  label: string | null | undefined,
): BiasInput["priceVolKind"] {
  const s = String(label ?? "").toLowerCase();
  if (s.includes("together ↑") || s.includes("insieme ↑")) return "together_up";
  if (s.includes("together ↓") || s.includes("insieme ↓")) return "together_down";
  if (s.includes("diverge") || s.includes("discordi")) return "diverge";
  return "other";
}

export function formatBiasCell(input: BiasInput, it: boolean): BiasCell {
  const { score, label } = computeBiasScore(input);
  if (score == null || !label) {
    return {
      label: "—",
      tone: "none",
      tip: it
        ? "Bias inconcludente: nessun segno da RR / prezzo-vol / insider / vs XBI. Pesi arbitrari, non calibrati. Non è Soft BUY/SELL."
        : "Inconclusive bias: no sign from RR / price-vol / insider / vs XBI. Arbitrary uncalibrated weights. Not Soft BUY/SELL.",
      score: null,
    };
  }
  if (label === "bullish_build") {
    return {
      label: it ? "Build rialzista" : "Bullish build",
      sub: score.toFixed(2),
      tone: "up",
      tip: it
        ? `BiasScore ${score.toFixed(2)} (pesi arbitrari 0.35/0.30/0.15/0.20). Direzione, non attenzione. Non è Soft BUY/SELL.`
        : `BiasScore ${score.toFixed(2)} (arbitrary weights 0.35/0.30/0.15/0.20). Direction, not attention. Not Soft BUY/SELL.`,
      score,
    };
  }
  if (label === "fear_hedge") {
    return {
      label: it ? "Paura / hedge" : "Fear / hedge",
      sub: score.toFixed(2),
      tone: "down",
      tip: it
        ? `BiasScore ${score.toFixed(2)}. Pende verso protezione. Pesi non calibrati. Non è Soft BUY/SELL.`
        : `BiasScore ${score.toFixed(2)}. Leans protective. Weights uncalibrated. Not Soft BUY/SELL.`,
      score,
    };
  }
  return {
    label: it ? "Misto" : "Mixed",
    sub: score.toFixed(2),
    tone: "flat",
    tip: it
      ? `BiasScore ${score.toFixed(2)} — misto / inconcludente. Non è Soft BUY/SELL.`
      : `BiasScore ${score.toFixed(2)} — mixed / inconclusive. Not Soft BUY/SELL.`,
    score,
  };
}
