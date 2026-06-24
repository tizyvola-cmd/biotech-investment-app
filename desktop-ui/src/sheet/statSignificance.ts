/**
 * Significance stars for correlation / p-value stats.
 * * p<0.05 · ** p<0.01 · *** p<0.001 · ns = not significant
 */

export type SignificanceStars = "*" | "**" | "***" | "ns";

export function significanceStars(p: number | null | undefined): SignificanceStars {
  if (p == null || !Number.isFinite(p)) return "ns";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "ns";
}

/** Two-tailed p-value for Pearson/Spearman ρ with n paired observations. */
export function correlationTwoTailedPValue(r: number, n: number): number | null {
  if (n < 3 || !Number.isFinite(r)) return null;
  const absR = Math.min(0.999999999, Math.abs(r));
  if (absR >= 1) return 0;
  const df = n - 2;
  const t = absR * Math.sqrt(df / (1 - absR * absR));
  const p = 2 * (1 - studentTCdf(t, df));
  return Math.min(1, Math.max(0, p));
}

function studentTCdf(t: number, df: number): number {
  if (df <= 0 || t < 0) return 0.5;
  const x = df / (df + t * t);
  return 1 - 0.5 * regularizedIncompleteBeta(df / 2, 0.5, x);
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta =
    logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaCF(a, b, x);
  }
  return 1 - (Math.exp(Math.log(1 - x) * b + Math.log(x) * a - lnBeta) / b) * betaCF(b, a, 1 - x);
}

function betaCF(a: number, b: number, x: number): number {
  const maxIter = 200;
  const eps = 3e-7;
  let am = 1;
  let bm = 1;
  let az = 1;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let bz = 1 - (qab * x) / qap;
  let aold = 0;
  for (let m = 1; m <= maxIter; m += 1) {
    const em = m;
    let tem = em + em;
    let d =
      (em * (b - em) * x) / ((qam + tem) * (a + tem));
    am = 1 + d * am;
    bm = 1 + d * bm;
    d = (-(a + em) * (qab + em) * x) / ((a + tem) * (qap + tem));
    az = 1 + d * az;
    bz = 1 + d * bz;
    if (bm !== 0) {
      const rat = az / bm;
      if (Math.abs(rat - aold) < eps * Math.abs(rat)) return rat;
      aold = rat;
    }
  }
  return aold;
}

const GAMMA_COEFF = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450548,
  0.1208650973866179e-2, -0.5395239384953e-5,
];

function logGamma(z: number): number {
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of GAMMA_COEFF) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

export type CorrelationSignificance = {
  p: number | null;
  stars: SignificanceStars;
};

/** Pearson ρ between paired numeric series (n ≥ 3). */
export function pearsonR(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den <= 0 || !Number.isFinite(den)) return null;
  return Math.round((num / den) * 1000) / 1000;
}

export function correlationSignificance(
  rho: number | null | undefined,
  n: number | null | undefined,
): CorrelationSignificance {
  if (rho == null || n == null || n < 3 || !Number.isFinite(rho)) {
    return { p: null, stars: "ns" };
  }
  const p = correlationTwoTailedPValue(rho, n);
  return { p, stars: significanceStars(p) };
}

export function formatSignedCorrelation(
  rho: number | null | undefined,
  decimals = 2,
): string {
  if (rho == null || !Number.isFinite(rho)) return "n/d";
  return `${rho >= 0 ? "+" : ""}${rho.toFixed(decimals)}`;
}

/** e.g. "+0.49 **" or "+0.12 ns" */
export function formatCorrelationWithStars(
  rho: number | null | undefined,
  n: number | null | undefined,
  decimals = 2,
): string {
  const value = formatSignedCorrelation(rho, decimals);
  if (value === "n/d") return value;
  const { stars } = correlationSignificance(rho, n);
  return `${value} ${stars}`;
}

export function formatPValue(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "n/d";
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

/** Minimum |ρ| for two-tailed significance at α (default p<0.05), given n pairs. */
export function criticalAbsCorrelation(
  n: number,
  alpha = 0.05,
): number | null {
  if (n < 3) return null;
  // Step scan: the beta-CDF used for p-values can be non-monotonic at ~1e-4 precision,
  // so binary search may land below the true threshold.
  for (let i = 1; i <= 999; i += 1) {
    const r = i / 1000;
    const p = correlationTwoTailedPValue(r, n);
    if (p != null && p <= alpha) return Math.round(r * 1000) / 1000;
  }
  return 0.999;
}

export function isCorrelationSignificant(
  rho: number | null | undefined,
  n: number | null | undefined,
  alpha = 0.05,
): boolean {
  if (rho == null || n == null || n < 3) return false;
  const p = correlationTwoTailedPValue(rho, n);
  return p != null && p < alpha;
}

function normalCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

function rankWithTies(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/** Two-tailed Mann–Whitney U (normal approx + tie correction). Needs ≥2 per group. */
export function mannWhitneyTwoTailedP(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const n1 = a.length;
  const n2 = b.length;
  const combined = [...a, ...b];
  const ranks = rankWithTies(combined);
  let r1 = 0;
  for (let i = 0; i < n1; i += 1) r1 += ranks[i]!;
  const u1 = n1 * n2 + (n1 * (n1 + 1)) / 2 - r1;
  const u = Math.min(u1, n1 * n2 - u1);

  const tieCounts = new Map<number, number>();
  for (const v of combined) tieCounts.set(v, (tieCounts.get(v) ?? 0) + 1);
  let tieSum = 0;
  for (const t of tieCounts.values()) {
    if (t > 1) tieSum += t * t * t - t;
  }

  const mu = (n1 * n2) / 2;
  const sigma2 = (n1 * n2 * (n1 + n2 + 1 - tieSum / (n1 + n2))) / 12;
  if (sigma2 <= 0) return null;
  const z = (u - mu) / Math.sqrt(sigma2);
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return Math.min(1, Math.max(0, p));
}

export function groupComparisonSignificance(
  groupA: number[],
  groupB: number[],
): CorrelationSignificance {
  const p = mannWhitneyTwoTailedP(groupA, groupB);
  return { p, stars: significanceStars(p) };
}

/** e.g. "0.042 *" or "0.18 ns" */
export function formatPValueWithStars(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "n/d";
  return `${formatPValue(p)} ${significanceStars(p)}`;
}
