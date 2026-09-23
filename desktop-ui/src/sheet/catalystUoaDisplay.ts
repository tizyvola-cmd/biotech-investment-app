import type { CatalystUoaRow } from "../api/supernova";

export type UoaCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none" | "warn";
  tip: string;
};

/** Display only — UOA flag. — while 20d history is building. Not Soft BUY/SELL. */
export function formatUoaCell(
  row: CatalystUoaRow | null | undefined,
  it: boolean,
  loading: boolean,
): UoaCell {
  if (!row || row.uoa_flag == null) {
    const building = row?.status === "building_history";
    const noFeed = row?.status === "no_avg_vol_feed";
    const have = row?.history_days ?? 0;
    const need = row?.history_needed ?? 20;
    return {
      label: loading ? "…" : "—",
      tone: "none",
      tip: loading
        ? it
          ? "UOA in caricamento."
          : "UOA loading."
        : building
          ? it
            ? `Storico volume in raccolta: ${have}/${need} sedute. UOA si attiva dopo ${need} giorni di snapshot Yahoo. Non è Soft BUY/SELL.`
            : `Building volume history: ${have}/${need} sessions. UOA unlocks after ${need} daily Yahoo snapshots. Not Soft BUY/SELL.`
          : noFeed
            ? it
              ? "Feed AvgVolume 20g per strike ancora assente — non inventiamo il ratio. Non è Soft BUY/SELL."
              : "No per-strike 20d AvgVolume feed yet — ratio not invented. Not Soft BUY/SELL."
            : it
              ? "Nessuna copertura UOA. Non è Soft BUY/SELL."
              : "No UOA coverage. Not Soft BUY/SELL.",
    };
  }
  if (row.uoa_flag !== true || row.vol_ratio == null || !row.side) {
    return {
      label: "—",
      tone: "none",
      tip: it
        ? "Nessun strike con vol >5× media 20g e volume > OI ieri. Non è Soft BUY/SELL."
        : "No strike with vol >5× 20d avg and volume > prior OI. Not Soft BUY/SELL.",
    };
  }
  const side = row.side === "put" ? "Put" : "Call";
  const ratio = row.vol_ratio.toFixed(1);
  return {
    label: `${side} ${ratio}x vol`,
    sub:
      row.premium != null && Number.isFinite(row.premium)
        ? `$${Math.round(row.premium).toLocaleString()}`
        : undefined,
    tone: row.side === "put" ? "down" : "up",
    tip: it
      ? `UOA: ${side} volume ${ratio}× media 20g e > OI ieri. Sweep multi-exchange rimandato a v3. Non è Soft BUY/SELL.`
      : `UOA: ${side} volume ${ratio}× 20d avg and > prior OI. Multi-exchange sweeps deferred to v3. Not Soft BUY/SELL.`,
  };
}
