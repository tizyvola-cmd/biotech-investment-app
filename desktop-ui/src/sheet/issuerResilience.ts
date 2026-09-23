/**
 * Issuer resilience profile for Decision Chart / exit logic.
 * Distinguishes fragile small/illiquid names from large/liquid/commercial ones
 * using fields already on the Simulation row (+ live ADV overlay).
 */
import { clinicalPhaseFromSimRow } from "./simRowClinicalMeta";
import {
  resolveSimRowBeta,
  resolveSimRowLiquidityScore,
  toSimMetricNum,
} from "./simRowBetaLiquidity";

export type IssuerResilienceBand = "fragile" | "balanced" | "resilient";

export type IssuerResilienceInput = {
  marketCapUsd: number | null;
  advShares20d: number | null;
  beta: number | null;
  /** FY balance-sheet liquidity 0–1. */
  liquidityScore: number | null;
  /** Study/asset phase text — commercial/approved ranks as resilient signal. */
  clinicalPhase: string | null;
  /** Regulatory approved-signal hits (auto/K-8), if known. */
  hasApprovedSignal?: boolean | null;
};

export type IssuerResilienceProfile = {
  band: IssuerResilienceBand;
  score: number;
  marketCapUsd: number | null;
  advShares20d: number | null;
  beta: number | null;
  liquidityScore: number | null;
  commercialPhase: boolean;
  reasons: string[];
};

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().replace(/\n/g, " ").includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

/** Parse Market Cap cell ($1.2B, 800M, raw USD number, etc.) → USD. */
export function parseMarketCapUsd(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  // Snapshot stores Yahoo market cap as raw USD (e.g. 36618748).
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const s = String(raw).trim().replace(/,/g, "").replace(/\$/g, "");
  if (!s) return null;
  const loose = /([\d.]+)\s*([TtBbMmKk])\b/.exec(s);
  if (loose) {
    const n = Number(loose[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const u = loose[2]!.toUpperCase();
    if (u === "T") return n * 1e12;
    if (u === "B") return n * 1e9;
    if (u === "M") return n * 1e6;
    if (u === "K") return n * 1e3;
  }
  const n = toSimMetricNum(s);
  return n != null && n > 0 ? n : null;
}

export function isCommercialOrApprovedPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return /approv|market|commercial|launched|registrat|on.?market|revenue/.test(
    phase.toLowerCase(),
  );
}

/**
 * Score 0–100 (higher = more resilient). Band thresholds:
 *  fragile < 40 · balanced 40–64 · resilient ≥ 65
 */
export function computeIssuerResilience(input: IssuerResilienceInput): IssuerResilienceProfile {
  let score = 50;
  const reasons: string[] = [];
  const mcap = input.marketCapUsd;
  const adv = input.advShares20d;
  const beta = input.beta;
  const liq = input.liquidityScore;
  const commercial =
    isCommercialOrApprovedPhase(input.clinicalPhase) || input.hasApprovedSignal === true;

  if (mcap != null && Number.isFinite(mcap) && mcap > 0) {
    if (mcap >= 10e9) {
      score += 22;
      reasons.push("mcap≥$10B");
    } else if (mcap >= 2e9) {
      score += 14;
      reasons.push("mcap≥$2B");
    } else if (mcap >= 500e6) {
      score += 6;
      reasons.push("mcap≥$500M");
    } else if (mcap < 100e6) {
      score -= 18;
      reasons.push("mcap<$100M");
    } else if (mcap < 300e6) {
      score -= 10;
      reasons.push("mcap<$300M");
    }
  }

  if (adv != null && Number.isFinite(adv) && adv > 0) {
    if (adv >= 1_000_000) {
      score += 16;
      reasons.push("ADV≥1M");
    } else if (adv >= 300_000) {
      score += 8;
      reasons.push("ADV≥300k");
    } else if (adv < 50_000) {
      score -= 18;
      reasons.push("ADV<50k");
    } else if (adv < 150_000) {
      score -= 10;
      reasons.push("ADV<150k");
    }
  }

  if (beta != null && Number.isFinite(beta)) {
    if (beta > 2.2) {
      score -= 10;
      reasons.push("β>2.2");
    } else if (beta > 1.6) {
      score -= 5;
      reasons.push("β>1.6");
    } else if (beta > 0 && beta < 0.9) {
      score += 4;
      reasons.push("β<0.9");
    }
  }

  if (liq != null && Number.isFinite(liq)) {
    if (liq >= 0.7) {
      score += 8;
      reasons.push("FY liq strong");
    } else if (liq < 0.35) {
      score -= 8;
      reasons.push("FY liq weak");
    }
  }

  if (commercial) {
    score += 14;
    reasons.push("commercial/approved phase");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: IssuerResilienceBand =
    score >= 65 ? "resilient" : score < 40 ? "fragile" : "balanced";

  return {
    band,
    score,
    marketCapUsd: mcap,
    advShares20d: adv,
    beta,
    liquidityScore: liq,
    commercialPhase: commercial,
    reasons,
  };
}

export function marketCapUsdFromSimRow(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  if (!simRow) return null;
  return parseMarketCapUsd(
    simRow["Market Cap"] ??
      simRow.market_cap ??
      simRow.marketCap ??
      findCol(simRow, "market cap", "market_cap"),
  );
}

export function issuerResilienceFromSimRow(
  simRow: Record<string, unknown> | null | undefined,
  opts?: { hasApprovedSignal?: boolean | null },
): IssuerResilienceProfile | null {
  if (!simRow) return null;
  const marketCapUsd = marketCapUsdFromSimRow(simRow);
  const advShares20d = toSimMetricNum(
    simRow.adv_shares_20d ?? findCol(simRow, "adv_shares_20d", "adv 20d", "avg_volume_20d"),
  );
  const beta = resolveSimRowBeta(simRow);
  const liquidityScore = resolveSimRowLiquidityScore(simRow);
  const clinicalPhase = clinicalPhaseFromSimRow(simRow) || null;
  return computeIssuerResilience({
    marketCapUsd,
    advShares20d,
    beta,
    liquidityScore,
    clinicalPhase,
    hasApprovedSignal: opts?.hasApprovedSignal,
  });
}
