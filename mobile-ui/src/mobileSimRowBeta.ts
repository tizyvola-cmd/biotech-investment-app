/** Beta + liquidity helpers — mirrors desktop simRowBetaLiquidity (mobile-only). */

import {
  computeLiquidityScore,
  normalizeLiquidityScore,
  parseLiquidityRatiosFromDisplay,
  resolveSimRowLiquidityScore,
} from "./mobileSimRowLiquidity";

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function toNum(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function resolveSimRowBeta(simRow: Record<string, unknown>): number | null {
  return toNum(simRow.beta ?? simRow.Beta ?? findCol(simRow, "beta (5y", "beta"));
}

export function resolveSimRowLiquiditaFy(simRow: Record<string, unknown>): string {
  const raw = simRow.liquidita_fy ?? findCol(simRow, "liquidità (fy)", "liquidita_fy", "liquidità");
  const s = String(raw ?? "").trim();
  return s && s !== "—" ? s : "";
}

export type BetaBucket = "high" | "elevated" | "market" | "idiosyncratic" | "inverse";

export function betaDisplay(beta: number): {
  text: string;
  color: string;
  weight: number;
  icon?: string;
  bucket: BetaBucket;
} {
  let color = "rgb(var(--ink))";
  let weight = 600;
  let icon: string | undefined;
  let bucket: BetaBucket = "market";

  if (beta < 0) {
    color = "rgb(var(--warn))";
    weight = 700;
    icon = "↔";
    bucket = "inverse";
  } else if (beta > 2) {
    color = "rgb(var(--warn))";
    weight = 700;
    icon = "⚡";
    bucket = "high";
  } else if (beta > 1.35) {
    color = "rgb(var(--warn))";
    weight = 600;
    bucket = "elevated";
  } else if (beta < 0.85) {
    color = "rgb(var(--positive))";
    weight = beta < 0.5 ? 700 : 600;
    bucket = "idiosyncratic";
  }

  return { text: beta.toFixed(2), color, weight, icon, bucket };
}

export function betaBucketLabel(bucket: BetaBucket, it: boolean): string {
  switch (bucket) {
    case "high":
      return it ? "forte legame al mercato" : "strong market link";
    case "elevated":
      return it ? "varianza più market-driven" : "more market-driven variance";
    case "idiosyncratic":
      return it ? "segnale più company-specific" : "cleaner company-specific signal";
    case "inverse":
      return it ? "correlazione inversa (raro)" : "inverse correlation (rare)";
    default:
      return it ? "correlazione ~ mercato" : "~ market correlation";
  }
}

export function liquidityBarStyle(score01: number): { color: string; backgroundImage: string } {
  const pct = Math.max(1, Math.min(100, Math.round(score01 * 100)));
  let fill = "rgba(var(--accent) / 0.2)";
  let color = "rgb(var(--accent))";
  if (score01 >= 0.75) {
    fill = "rgba(var(--positive) / 0.3)";
    color = "rgb(var(--positive))";
  } else if (score01 >= 0.55) {
    fill = "rgba(var(--positive) / 0.17)";
    color = "rgb(var(--positive))";
  } else if (score01 >= 0.4) {
    fill = "rgba(var(--warn) / 0.22)";
    color = "rgb(var(--warn))";
  }
  return {
    color,
    backgroundImage: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, transparent ${pct}%)`,
  };
}

export { computeLiquidityScore, normalizeLiquidityScore, parseLiquidityRatiosFromDisplay, resolveSimRowLiquidityScore };
