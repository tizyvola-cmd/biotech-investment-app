/**
 * Catalyst desk — Pre-Mkt Conviction cell (FREE proxy of opening pressure).
 * NOT official Pre-Open Imbalance / NOII. Context only — not Soft BUY/SELL.
 */
import type { PreMktConvictionRow } from "../api/supernova";

export type PreMktConvictionCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none";
  tip: string;
  /** Visual confirm when Search Buzz aligns with together ↑/↓. */
  confirmed: boolean;
};

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtVol(n: number): string {
  if (n >= 10) return `${n.toFixed(0)}x`;
  return `${n.toFixed(1)}x`;
}

/** Overlay same-day Search Buzz onto an API row for ConvictionConfirmed. */
export function applySearchBuzzConfirm(
  row: PreMktConvictionRow | null | undefined,
  searchBuzzDeltaPct: number | null | undefined,
): PreMktConvictionRow | null | undefined {
  if (!row) return row;
  const conviction = row.conviction;
  if (conviction !== "together_up" && conviction !== "together_down") {
    return { ...row, conviction_confirmed: conviction ? false : null };
  }
  if (searchBuzzDeltaPct == null || !Number.isFinite(searchBuzzDeltaPct)) {
    return { ...row, conviction_confirmed: null };
  }
  const ok =
    conviction === "together_up" ? searchBuzzDeltaPct > 0 : searchBuzzDeltaPct < 0;
  return { ...row, conviction_confirmed: ok, search_buzz_delta_pct: searchBuzzDeltaPct };
}

/**
 * Badge e.g. "▲ +2.1% (vol 2.3x)" — confirmed flag is separate (border/dot in UI).
 * No pre-market trades → "—". Never labeled as order imbalance.
 */
export function formatPreMktConvictionCell(
  row: PreMktConvictionRow | null | undefined,
  it: boolean,
  loading: boolean,
): PreMktConvictionCell {
  if (loading && !row) {
    return {
      label: "…",
      tone: "none",
      tip: it ? "Pre-Mkt Conviction in caricamento." : "Pre-Mkt Conviction loading.",
      confirmed: false,
    };
  }

  const conviction = row?.conviction;
  if (
    !row ||
    !conviction ||
    row.pre_mkt_price_change_pct == null ||
    !Number.isFinite(row.pre_mkt_price_change_pct)
  ) {
    return {
      label: "—",
      tone: "none",
      confirmed: false,
      tip: it
        ? "Nessun trade pre-market registrato (4:00–9:30 ET), o dato assente. Proxy gratuito — NON è l’order imbalance ufficiale delle borse. Non è Soft BUY/SELL."
        : "No pre-market trades recorded (4:00–9:30 ET), or data missing. Free proxy — NOT the official exchange order imbalance. Not Soft BUY/SELL.",
    };
  }

  const px = row.pre_mkt_price_change_pct;
  const vr = row.pre_mkt_vol_ratio;
  const arrow = px > 0 ? "▲" : px < 0 ? "▼" : "·";
  const volPart =
    vr != null && Number.isFinite(vr) ? ` (vol ${fmtVol(vr)})` : "";
  const label = `${arrow} ${fmtPct(px)}${volPart}`;

  const kindLabel =
    conviction === "together_up"
      ? "Together ↑"
      : conviction === "together_down"
        ? "Together ↓"
        : it
          ? "Diverge (mossa debole)"
          : "Diverge (weak move)";

  const confirmed = row.conviction_confirmed === true;
  const priorSession = row.status === "prior_session";
  const tipParts = [
    it
      ? "Pre-Mkt Conviction = proxy gratuito su trade già eseguiti in pre-market (4:00–9:30 ET). NON è l’order imbalance ufficiale (NOII / asta)."
      : "Pre-Mkt Conviction = free proxy from executed pre-market trades (4:00–9:30 ET). NOT the official order imbalance (NOII / auction).",
    priorSession
      ? it
        ? `Mercato chiuso oggi — ultima sessione pre-market${row.session_date ? ` (${row.session_date})` : ""}.`
        : `Market closed today — last pre-market session${row.session_date ? ` (${row.session_date})` : ""}.`
      : null,
    `${kindLabel}.`,
    vr != null
      ? `PreMktVolRatio ${vr.toFixed(2)}× (soglia together > 1.5).`
      : it
        ? "Volume pre-market non disponibile su Yahoo chart (spesso 0 in extended hours) — solo mossa di prezzo → Diverge."
        : "Pre-market volume unavailable on Yahoo chart (often 0 in extended hours) — price move only → Diverge.",
    confirmed
      ? it
        ? "ConvictionConfirmed: Search Buzz (G-Trends) dello stesso giorno allineato."
        : "ConvictionConfirmed: same-day Search Buzz (G-Trends) aligned."
      : row.conviction_confirmed == null
        ? it
          ? "Search Buzz stesso giorno assente — solo badge base."
          : "Same-day Search Buzz missing — base badge only."
        : null,
    it
      ? "Indice di contesto; non sostituisce Recommendation/Signal né il Pre-Open ufficiale."
      : "Context index; does not replace Recommendation/Signal or official Pre-Open.",
  ].filter(Boolean);

  // Color by signed pre-mkt move (diverge included) — yellow only when ~flat.
  let tone: PreMktConvictionCell["tone"] = "flat";
  if (conviction === "together_up") tone = "up";
  else if (conviction === "together_down") tone = "down";
  else if (px > 0) tone = "up";
  else if (px < 0) tone = "down";

  return {
    label,
    sub: priorSession
      ? it
        ? `${kindLabel} · sess. prec.`
        : `${kindLabel} · prior`
      : kindLabel,
    tone,
    tip: tipParts.join(" "),
    confirmed,
  };
}
