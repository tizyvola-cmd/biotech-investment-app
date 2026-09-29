import type { CatalystVsXbiRow } from "../api/supernova";

export type VsXbiCell = {
  label: string;
  tone: "up" | "down" | "flat" | "none";
  tip: string;
};

/** Display only — RelativeMove_simple = stock − XBI (β=1). Not Soft BUY/SELL. */
export function formatVsXbiCell(
  row: CatalystVsXbiRow | null | undefined,
  it: boolean,
  loading: boolean,
): VsXbiCell {
  if (!row || row.relative_move == null) {
    return {
      label: loading ? "…" : "—",
      tone: "none",
      tip: loading
        ? it
          ? "vs XBI in caricamento."
          : "vs XBI loading."
        : it
          ? "Storia prezzo insufficiente per stock o XBI. Non è Soft BUY/SELL."
          : "Insufficient price history for stock or XBI. Not Soft BUY/SELL.",
    };
  }
  const pct = row.relative_move * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(1)}%`,
    tone: pct > 0.15 ? "up" : pct < -0.15 ? "down" : "flat",
    tip: [
      it
        ? `RelativeMove (β=1) = rendimento titolo − XBI su ${row.horizon_days ?? 5}g = ${sign}${pct.toFixed(2)}%.`
        : `RelativeMove (β=1) = stock return − XBI over ${row.horizon_days ?? 5}d = ${sign}${pct.toFixed(2)}%.`,
      row.stock_return != null
        ? it
          ? `Titolo ${(row.stock_return * 100).toFixed(1)}% · XBI ${((row.xbi_return ?? 0) * 100).toFixed(1)}%.`
          : `Stock ${(row.stock_return * 100).toFixed(1)}% · XBI ${((row.xbi_return ?? 0) * 100).toFixed(1)}%.`
        : null,
      it
        ? "Distingue eccitazione idiosincratica da un rally di settore. Non è Soft BUY/SELL."
        : "Separates idiosyncratic excitement from a sector rally. Not Soft BUY/SELL.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
