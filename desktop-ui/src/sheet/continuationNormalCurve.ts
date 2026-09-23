/**
 * Normal PDF helpers for P(continuation) Own / Population charts.
 */

export type ContNormalDist = {
  mu: number;
  sigma: number;
  n: number;
};

export type ContNormalPoint = {
  x: number;
  density: number;
};

/** Standard normal PDF. */
export function normalPdf(x: number, mu: number, sigma: number): number {
  if (!(sigma > 0) || !Number.isFinite(mu) || !Number.isFinite(x)) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/** Dense curve points on [0, 100] for AreaChart. */
export function buildNormalCurvePoints(
  dist: ContNormalDist,
  steps = 80,
): ContNormalPoint[] {
  const { mu, sigma } = dist;
  const out: ContNormalPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = (100 * i) / steps;
    out.push({ x, density: normalPdf(x, mu, sigma) });
  }
  return out;
}

/** Approximate percentile of value under N(mu, sigma), 0..100. */
export function approxNormalPercentile(
  value: number,
  dist: ContNormalDist,
): number | null {
  if (!Number.isFinite(value) || !(dist.sigma > 0)) return null;
  const z = (value - dist.mu) / dist.sigma;
  // Abramowitz–Stegun-ish erf approximation → CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-0.5 * z * z);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z >= 0 ? 1 - p : p;
  return Math.round(Math.max(0, Math.min(100, cdf * 100)) * 10) / 10;
}

export function resolveContDistOwn(
  simRow: Record<string, unknown> | null | undefined,
): ContNormalDist | null {
  if (!simRow) return null;
  const mu = Number(simRow.cont_dist_own_mu);
  const sigma = Number(simRow.cont_dist_own_sigma);
  const n = Number(simRow.cont_dist_own_n);
  if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) return null;
  return { mu, sigma, n: Number.isFinite(n) ? n : 0 };
}

export function resolveContDistPop(
  simRow: Record<string, unknown> | null | undefined,
): ContNormalDist | null {
  if (!simRow) return null;
  const mu = Number(simRow.cont_dist_pop_mu);
  const sigma = Number(simRow.cont_dist_pop_sigma);
  const n = Number(simRow.cont_dist_pop_n);
  if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) return null;
  return { mu, sigma, n: Number.isFinite(n) ? n : 0 };
}
