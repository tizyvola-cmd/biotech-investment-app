import type { RecommendationCall } from "./recommendationContributions";

export type DecisionSpectrumCall = RecommendationCall;

export type NearestThreshold = {
  target: "buy" | "sell" | "hold";
  points: number;
};

/** Map value to 0–100% along [min, max]. */
export function spectrumPct(v: number, min = 0, max = 100): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

/** Distance to the nearest zone boundary (sell / hold entry / buy). */
export function nearestThresholdGap(
  score: number,
  sellThreshold: number,
  buyThreshold: number,
): NearestThreshold {
  const rs = Math.round(score);
  const rSell = Math.round(sellThreshold);
  const rBuy = Math.round(buyThreshold);

  if (rs < rSell) {
    return { target: "hold", points: rSell - rs };
  }
  if (rs >= rBuy) {
    return { target: "hold", points: rs - rBuy };
  }
  const toBuy = rBuy - rs;
  const toSell = rs - rSell;
  if (toBuy <= toSell) return { target: "buy", points: toBuy };
  return { target: "sell", points: toSell };
}

export function scorePositionZone(
  score: number,
  sellThreshold: number,
  buyThreshold: number,
): "sell" | "hold" | "buy" {
  if (score >= buyThreshold) return "buy";
  if (score <= sellThreshold) return "sell";
  return "hold";
}

/** Visual emphasis follows call; REVIEW inherits score zone when unambiguous. */
export function callAccent(
  call: DecisionSpectrumCall,
  scoreZone?: "sell" | "hold" | "buy",
): "sell" | "hold" | "buy" | "review" {
  if (call === "REVIEW" && scoreZone === "sell") return "sell";
  if (call === "REVIEW" && scoreZone === "buy") return "buy";
  if (call === "REVIEW" && scoreZone === "hold") return "hold";
  switch (call) {
    case "SELL":
      return "sell";
    case "BUY":
      return "buy";
    case "HOLD":
      return "hold";
    default:
      return "review";
  }
}

export function gapStripBounds(
  scorePct: number,
  thresholdPct: number,
): { left: number; width: number } {
  const left = Math.min(scorePct, thresholdPct);
  const width = Math.abs(scorePct - thresholdPct);
  return { left, width: Math.max(width, 0.5) };
}
