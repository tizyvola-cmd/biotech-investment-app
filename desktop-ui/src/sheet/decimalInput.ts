/** Parse free-text decimal (3,92 · 3.92 · 1.234,56). */
export function parseInputDecimal(raw: string): number {
  let s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // 1.234,56 → thousands dots + decimal comma
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Display stored number for editing (Italian-style comma decimal). */
export function formatDecimalInput(n: number, maxFrac = 4): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  let s = n.toFixed(maxFrac);
  s = s.replace(/\.?0+$/, "");
  return s.replace(".", ",");
}
