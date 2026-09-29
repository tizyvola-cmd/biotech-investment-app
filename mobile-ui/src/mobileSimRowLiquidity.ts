/** Liquidity score 0–1 from simulation row (mirrors desktop simRowBetaLiquidity). */

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

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function computeLiquidityScore(
  currentRatio: number | null,
  quickRatio: number | null,
  cashRatio: number | null,
): number | null {
  const parts: { w: number; v: number }[] = [];
  if (currentRatio != null) parts.push({ w: 0.4, v: clip01(currentRatio / 2) });
  if (quickRatio != null) parts.push({ w: 0.35, v: clip01(quickRatio / 1.5) });
  if (cashRatio != null) parts.push({ w: 0.25, v: clip01(cashRatio / 0.5) });
  if (!parts.length) return null;
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  return wSum > 0 ? parts.reduce((s, p) => s + p.w * p.v, 0) / wSum : 1;
}

export function parseLiquidityRatiosFromDisplay(raw: string): {
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
} {
  const s = raw.trim();
  const cr = /CR\s*([\d.]+)/i.exec(s);
  const qr = /QR\s*([\d.]+)/i.exec(s);
  const cash =
    /Cash[^|]*?([\d.]+)\s*M/i.exec(s) ??
    /Cash\s*([\d.]+)/i.exec(s) ??
    /CAR\s*([\d.]+)/i.exec(s);
  return {
    currentRatio: cr ? toNum(cr[1]) : null,
    quickRatio: qr ? toNum(qr[1]) : null,
    cashRatio: cash ? toNum(cash[1]) : null,
  };
}

export function normalizeLiquidityScore(raw: number): number {
  if (raw > 1 && raw <= 100) return raw / 100;
  if (raw > 100) return 1;
  return Math.max(0, Math.min(1, raw));
}

export function resolveSimRowLiquidityScore(simRow: Record<string, unknown>): number | null {
  const direct = toNum(findCol(simRow, "liquidity_score", "liq score"));
  if (direct != null) return normalizeLiquidityScore(direct);

  const cr = toNum(simRow.current_ratio ?? findCol(simRow, "current_ratio", "current ratio"));
  const qr = toNum(simRow.quick_ratio ?? findCol(simRow, "quick_ratio", "quick ratio"));
  const car = toNum(simRow.cash_ratio ?? findCol(simRow, "cash_ratio", "cash ratio"));
  const fromCols = computeLiquidityScore(cr, qr, car);
  if (fromCols != null) return fromCols;

  const fyRaw = String(
    simRow.liquidita_fy ?? findCol(simRow, "liquidità (fy)", "liquidita_fy", "liquidità", "liquidity fy") ?? "",
  ).trim();
  if (!fyRaw || fyRaw === "—") return null;
  const parsed = parseLiquidityRatiosFromDisplay(fyRaw);
  return computeLiquidityScore(parsed.currentRatio, parsed.quickRatio, parsed.cashRatio);
}
