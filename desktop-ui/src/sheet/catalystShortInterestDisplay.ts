import type { CatalystShortInterestRow } from "../api/supernova";

export type ShortInterestCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none" | "warn";
  tip: string;
};

function feeBadge(delta: number | null | undefined): string | undefined {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  const bps = Math.round(delta * 10_000);
  if (bps === 0) return undefined;
  return `Fee ${bps > 0 ? "+" : ""}${bps}bps`;
}

/**
 * Primary print = ΔSI vs prior bi-monthly print.
 * Rising = bears adding conviction; falling = covering / wall thinning.
 * Display only — not Soft BUY/SELL.
 */
export function formatShortInterestCell(
  row: CatalystShortInterestRow | null | undefined,
  it: boolean,
  loading: boolean,
): ShortInterestCell {
  if (!row) {
    return {
      label: loading ? "…" : "—",
      tone: "none",
      tip: loading
        ? it
          ? "Short interest in caricamento (stampa bi-mensile)."
          : "Short interest loading (bi-monthly print)."
        : it
          ? "Nessuna copertura short interest (tipico sulle micro-cap). Dato bi-mensile, non intra-day. Non è Soft BUY/SELL."
          : "No short-interest coverage (common on micro-caps). Bi-monthly print, not intra-day. Not Soft BUY/SELL.",
    };
  }

  const delta = row.si_delta_pct;
  const dtc = row.days_to_cover;
  const squeeze = row.squeeze_risk === true;

  if (delta == null || !Number.isFinite(delta)) {
    return {
      label: "—",
      sub: dtc != null ? `DTC ${dtc.toFixed(1)}d` : undefined,
      tone: "none",
      tip: [
        it
          ? "ΔSI assente: manca la stampa precedente (o la corrente). Non inventiamo 0%."
          : "ΔSI missing: prior (or current) print unavailable. We do not invent 0%.",
        dtc != null
          ? it
            ? `DTC disponibile: ${dtc.toFixed(1)}g.`
            : `DTC available: ${dtc.toFixed(1)}d.`
          : null,
        it ? "Dato bi-mensile. Non è Soft BUY/SELL." : "Bi-monthly print. Not Soft BUY/SELL.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const sign = delta > 0 ? "+" : "";
  const rising = delta > 0.05;
  const falling = delta < -0.05;
  const fee = squeeze ? feeBadge(row.borrow_fee_delta_5d) : undefined;
  const subParts = [
    dtc != null ? `DTC ${dtc.toFixed(1)}d` : null,
    fee,
  ].filter(Boolean);

  const parts = [
    it
      ? `ΔSI = variazione short interest vs stampa precedente = ${sign}${delta.toFixed(1)}%.`
      : `ΔSI = short-interest change vs prior print = ${sign}${delta.toFixed(1)}%.`,
    rising
      ? it
        ? "In crescita: i ribassisti aumentano la scommessa — la loro convinzione si rafforza, non si indebolisce."
        : "Rising: bears are adding to the bet — their conviction is strengthening, not fading."
      : falling
        ? it
          ? "In calo: alcuni stanno già chiudendo — il «muro» di short si assottiglia."
          : "Falling: some are already covering — the short wall is thinning."
        : it
          ? "Quasi invariato rispetto alla stampa precedente."
          : "Almost unchanged vs the prior print.",
    dtc != null
      ? it
        ? `DTC (contesto): ${dtc.toFixed(1)} giorni.`
        : `DTC (context): ${dtc.toFixed(1)} days.`
      : null,
    row.si_asof
      ? it
        ? `Stampa FINRA/Yahoo al ${row.si_asof}.`
        : `FINRA/Yahoo print as of ${row.si_asof}.`
      : null,
    squeeze
      ? it
        ? "Squeeze risk: DTC > 5, fee in aumento, prezzo 5g > 0."
        : "Squeeze risk: DTC > 5, borrow fee rising, 5d price > 0."
      : null,
    it
      ? "Dato bi-mensile, non intra-day. Non è Soft BUY/SELL."
      : "Bi-monthly print, not intra-day. Not Soft BUY/SELL.",
  ].filter(Boolean);

  return {
    label: `ΔSI ${sign}${delta.toFixed(1)}%`,
    sub: subParts.length ? subParts.join(" · ") : undefined,
    tone: squeeze ? "warn" : rising ? "down" : falling ? "up" : "flat",
    tip: parts.join(" "),
  };
}
