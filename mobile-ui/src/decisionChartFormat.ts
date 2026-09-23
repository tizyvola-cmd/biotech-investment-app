/** Format 24h price change for decision chart ticker chips. */
export function formatChange24h(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0.0%";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function change24hTone(v: number | null | undefined): "pos" | "neg" | "flat" {
  if (v == null || !Number.isFinite(v)) return "flat";
  if (v > 0.5) return "pos";
  if (v < -0.5) return "neg";
  return "flat";
}

export function change24hEmphasis(v: number | null | undefined): boolean {
  return v != null && Number.isFinite(v) && Math.abs(v) >= 3;
}
