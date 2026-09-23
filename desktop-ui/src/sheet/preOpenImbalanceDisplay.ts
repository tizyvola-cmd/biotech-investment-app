/**
 * Catalyst desk — Pre-Open Imbalance cell (Databento NOII / NYSE Pillar).
 * Context index only — not Soft BUY/SELL / Recommendation.
 */
import type { PreOpenImbalanceRow } from "../api/supernova";

export type PreOpenImbalanceCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none";
  tip: string;
};

function fmtShares(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

/**
 * Badge e.g. "▲ Buy +3.2% ind." — secondary absolute excess shares in the tooltip.
 * Outside window / no data → "—" (never prior-session stale).
 */
export function formatPreOpenImbalanceCell(
  row: PreOpenImbalanceRow | null | undefined,
  it: boolean,
  loading: boolean,
): PreOpenImbalanceCell {
  if (loading && !row) {
    return {
      label: "…",
      tone: "none",
      tip: it ? "Pre-Open in caricamento." : "Pre-Open loading.",
    };
  }

  if (!row || row.in_window !== true || !row.direction) {
    const outside = row?.status === "outside_window";
    return {
      label: "—",
      tone: "none",
      tip: outside
        ? it
          ? "Fuori dalla finestra di trasmissione (Nasdaq 9:28–9:30 ET / NYSE 9:00–9:30 ET). Mai l’ultimo valore della sessione precedente. Indice di contesto, non Soft BUY/SELL."
          : "Outside the transmission window (Nasdaq 9:28–9:30 ET / NYSE 9:00–9:30 ET). Never the prior session’s last print. Context index, not Soft BUY/SELL."
        : it
          ? "Nessun imbalance pre-open (listing sconosciuto, fuori finestra, o feed assente). Non è Soft BUY/SELL."
          : "No pre-open imbalance (unknown listing, outside window, or feed missing). Not Soft BUY/SELL.",
    };
  }

  const buy = row.direction === "Buy";
  const arrow = buy ? "▲" : "▼";
  const move =
    row.indicative_move_pct != null && Number.isFinite(row.indicative_move_pct)
      ? `${row.indicative_move_pct > 0 ? "+" : ""}${row.indicative_move_pct.toFixed(1)}% ind.`
      : it
        ? "ind. —"
        : "ind. —";
  const accel =
    row.imbalance_accelerating === true
      ? it
        ? " · accelera"
        : " · accel."
      : "";
  const label = `${arrow} ${row.direction} ${move}${accel}`;

  const tipParts = [
    it
      ? `Pre-Open Imbalance (${row.venue ?? "—"} / ${row.dataset ?? "—"}).`
      : `Pre-Open Imbalance (${row.venue ?? "—"} / ${row.dataset ?? "—"}).`,
    row.imbalance_shares != null
      ? it
        ? `Azioni in eccesso: ${fmtShares(row.imbalance_shares)}.`
        : `Excess shares: ${fmtShares(row.imbalance_shares)}.`
      : null,
    row.paired_shares != null
      ? it
        ? `Paired: ${fmtShares(row.paired_shares)}.`
        : `Paired: ${fmtShares(row.paired_shares)}.`
      : null,
    row.imbalance_ratio != null
      ? `ImbalanceRatio ${row.imbalance_ratio.toFixed(3)}.`
      : null,
    row.imbalance_accelerating === true
      ? it
        ? "ImbalanceAccelerating = sì (ratio 9:29 > 9:28, stessa direzione)."
        : "ImbalanceAccelerating = yes (9:29 ratio > 9:28, same direction)."
      : row.imbalance_accelerating === false
        ? it
          ? "Non in accelerazione."
          : "Not accelerating."
        : it
          ? "Accelerazione non calcolata (<2 snapshot) — solo direzione."
          : "Acceleration not computed (<2 snapshots) — direction only.",
    it
      ? "Indice di contesto pre-asta; non sostituisce Recommendation/Signal."
      : "Pre-auction context index; does not replace Recommendation/Signal.",
  ].filter(Boolean);

  return {
    label,
    sub:
      row.imbalance_shares != null
        ? it
          ? `${fmtShares(row.imbalance_shares)} ecc.`
          : `${fmtShares(row.imbalance_shares)} xs`
        : undefined,
    tone: buy ? "up" : "down",
    tip: tipParts.join(" "),
  };
}
