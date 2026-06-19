function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export type MobileTargetProgressTone = "up" | "down" | "warn" | "muted";

export function computeMobileTargetProgress(opts: {
  targetMode: "rise" | "fall" | "flat" | null | undefined;
  targetPriceUsd: number | null | undefined;
  currPriceUsd: number | null | undefined;
  planReturnPct?: number | null;
  buyPriceUsd?: number | null;
  inPortfolio?: boolean;
}): { ratio: number | null; tone: MobileTargetProgressTone } {
  if (opts.targetMode === "fall") return { ratio: null, tone: "warn" };
  if (opts.targetMode === "flat" || opts.targetPriceUsd == null) {
    return { ratio: null, tone: "muted" };
  }

  const target = opts.targetPriceUsd;
  const curr = opts.currPriceUsd;
  if (target == null || curr == null || curr <= 0 || target <= 0) {
    return { ratio: null, tone: "muted" };
  }

  const buy = opts.buyPriceUsd;
  const inPortfolio = opts.inPortfolio === true;

  // Portfolio: avanzamento dal prezzo di acquisto al target.
  if (inPortfolio && buy != null && buy > 0 && target > buy) {
    const ratio = clamp01((curr - buy) / (target - buy));
    return { ratio, tone: ratio >= 1 ? "up" : ratio > 0 ? "up" : "down" };
  }

  const planRet = opts.planReturnPct;
  if (planRet != null && planRet > 0 && target > curr * 0.5) {
    const entry = target / (1 + planRet / 100);
    if (entry > 0 && target > entry) {
      const ratio = clamp01((curr - entry) / (target - entry));
      return { ratio, tone: ratio >= 1 ? "up" : ratio > 0 ? "up" : "down" };
    }
  }

  // Prezzo già al/sopra target.
  if (curr >= target) {
    return { ratio: 1, tone: "up" };
  }

  // Fallback: buy manuale su opportunità tracciata.
  if (buy != null && buy > 0 && target > buy) {
    const ratio = clamp01((curr - buy) / (target - buy));
    return { ratio, tone: ratio >= 1 ? "up" : ratio > 0 ? "up" : "down" };
  }

  return { ratio: null, tone: "muted" };
}
