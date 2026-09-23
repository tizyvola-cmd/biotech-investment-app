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

export type OlsRegression = {
  slope: number;
  intercept: number;
  r: number | null;
  /** Two endpoints for chart overlay — spans xSpan or data min/max. */
  line: { x: number; y: number }[];
};

/**
 * Theil-Sen robust regression y = slope·x + intercept.
 *
 * Slope is the median of pair-wise slopes; intercept is the median of
 * per-point residuals after applying the slope. Insensitive to outliers
 * with ≥29% breakdown point (vs OLS which has 0%), so the drawn line
 * reflects the *typical* relationship rather than a fit dominated by a
 * few high-leverage points.
 *
 * Rationale: for small-n scatter plots (n ~ 15-30) with 1-2 influential
 * points, OLS can produce a visually steep line while Pearson r stays
 * weak, misleading the reader. Theil-Sen keeps the visual and the
 * correlation coherent.
 *
 * Returns `null` for n < 3 or when all x values are equal.
 */
export function linearRegressionTheilSen(
  xs: number[],
  ys: number[],
  xSpan?: { min: number; max: number },
): OlsRegression | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const n = xs.length;
  const slopes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = xs[j]! - xs[i]!;
      if (dx === 0) continue;
      slopes.push((ys[j]! - ys[i]!) / dx);
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  const slope =
    slopes.length % 2 === 0 ? 0.5 * (slopes[mid - 1]! + slopes[mid]!) : slopes[mid]!;

  const residuals: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) residuals[i] = ys[i]! - slope * xs[i]!;
  residuals.sort((a, b) => a - b);
  const rMid = Math.floor(n / 2);
  const intercept =
    n % 2 === 0 ? 0.5 * (residuals[rMid - 1]! + residuals[rMid]!) : residuals[rMid]!;

  const r = pearsonR(xs, ys);
  const xMin = xSpan?.min ?? Math.min(...xs);
  const xMax = xSpan?.max ?? Math.max(...xs);
  const y0 = slope * xMin + intercept;
  const y1 = slope * xMax + intercept;
  return {
    slope: Math.round(slope * 10000) / 10000,
    intercept: Math.round(intercept * 10000) / 10000,
    r,
    line: [
      { x: xMin, y: Math.round(y0 * 100) / 100 },
      { x: xMax, y: Math.round(y1 * 100) / 100 },
    ],
  };
}

/**
 * Ordinary least-squares y = slope·x + intercept.
 * Returns regression line endpoints for scatter overlay (n ≥ 3).
 *
 * Prefer {@link linearRegressionTheilSen} for visual overlays on small
 * scatter plots (n < ~50): OLS is heavily biased by 1-2 outliers, which
 * makes the drawn line look more significant than the correlation
 * warrants. Keep OLS only when you need the algebraic slope (e.g. to
 * decompose y into a linear component of x plus residuals — see the
 * MCS-net regression in `ModelComparisonPanel`).
 */
export function linearRegressionOLS(
  xs: number[],
  ys: number[],
  xSpan?: { min: number; max: number },
): OlsRegression | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (sxx < 1e-12) return null;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = pearsonR(xs, ys);
  const xMin = xSpan?.min ?? Math.min(...xs);
  const xMax = xSpan?.max ?? Math.max(...xs);
  const y0 = slope * xMin + intercept;
  const y1 = slope * xMax + intercept;
  return {
    slope: Math.round(slope * 10000) / 10000,
    intercept: Math.round(intercept * 10000) / 10000,
    r,
    line: [
      { x: xMin, y: Math.round(y0 * 100) / 100 },
      { x: xMax, y: Math.round(y1 * 100) / 100 },
    ],
  };
}

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

/** Partial Pearson r(x,y | z) — linear association of x and y net of z. */
export function partialPearsonR(xs: number[], ys: number[], zs: number[]): number | null {
  if (xs.length < 4 || xs.length !== ys.length || ys.length !== zs.length) return null;
  const rxy = pearsonR(xs, ys);
  const rxz = pearsonR(xs, zs);
  const ryz = pearsonR(ys, zs);
  if (rxy == null || rxz == null || ryz == null) return null;
  const denom = Math.sqrt(Math.max(0, 1 - rxz * rxz) * Math.max(0, 1 - ryz * ryz));
  if (denom <= 1e-12) return null;
  return Math.round(((rxy - rxz * ryz) / denom) * 1000) / 1000;
}

/** Spearman rank ρ — robust when scores are skewed or ties are few. */
export function spearmanR(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const rank = (vals: number[]): number[] => {
    const indexed = vals.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const out = new Array<number>(vals.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j += 1;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[indexed[k]!.i] = avgRank;
      i = j + 1;
    }
    return out;
  };
  return pearsonR(rank(xs), rank(ys));
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

/** 95% confidence interval for Pearson r via Fisher z transform. Needs n ≥ 4. */
export function fisherZ95Ci(r: number, n: number): { lo: number; hi: number } | null {
  if (n < 4 || !Number.isFinite(r)) return null;
  const clipped = Math.max(-0.999, Math.min(0.999, r));
  const z = 0.5 * Math.log((1 + clipped) / (1 - clipped));
  const se = 1 / Math.sqrt(n - 3);
  const zLo = z - 1.96 * se;
  const zHi = z + 1.96 * se;
  const toR = (zv: number) => (Math.exp(2 * zv) - 1) / (Math.exp(2 * zv) + 1);
  return {
    lo: Math.round(toR(zLo) * 100) / 100,
    hi: Math.round(toR(zHi) * 100) / 100,
  };
}

export function formatFisherCi(ci: { lo: number; hi: number } | null | undefined): string {
  if (!ci) return "";
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  return `[${fmt(ci.lo)}, ${fmt(ci.hi)}]`;
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
