import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";

/** User clicked «Approfondisci» on a feed row — prefill Copilot chat. */
export type CopilotStudyFocus = {
  ticker: string;
  company?: string;
  event?: ClinicalPublicationEvent;
  prefill: string;
  /** Invia subito il prefill all'apertura chat (pulsante toolbar). */
  autoSend?: boolean;
};

/** Summary strutturato criticità + passi avanti (ticker in filtro tabella). */
export function buildTickerCritSummaryPrefill(ticker: string, it: boolean): string {
  const tk = ticker.trim().toUpperCase();
  if (it) {
    return (
      `Su ${tk} prepara un summary strutturato delle **criticità** e dei **passi avanti** ` +
      `usando solo righe e KPI della tabella Catalyst Feed (EIS, T+1/T+3, indicatori ORR/DCR, data_gaps). ` +
      `Sezioni: Contesto · Passi avanti · Criticità/rischi · KPI & prezzo · Lacune dati. ` +
      `Cita id evento e NCT; non inventare numeri.`
    );
  }
  return (
    `For ${tk}, write a structured summary of **risks/criticalities** and **progress** ` +
    `using only Catalyst Feed table rows (EIS, T+1/T+3, ORR/DCR KPIs, data_gaps). ` +
    `Sections: Context · Progress · Risks · KPI & price · Data gaps. ` +
    `Cite event ids and NCT; do not invent figures.`
  );
}

export function buildTickerKpiReviewPrefill(ticker: string, it: boolean): string {
  const tk = ticker.trim().toUpperCase();
  if (it) {
    return `Per ${tk}: spiega ORR, DCR, EIS e reazione prezzo T+1/T+3 delle righe visibili in tabella, con tabella comparativa eventi.`;
  }
  return `For ${tk}: explain ORR, DCR, EIS and T+1/T+3 price moves for visible table rows, with a short event comparison.`;
}

export function buildCopilotPrefill(
  rec: ClinicalPreCdRecord,
  ev: ClinicalPublicationEvent,
  it: boolean,
): string {
  const title = String(ev.event_title ?? "").trim();
  const ticker = String(rec.ticker ?? "").trim();
  if (it) {
    return title
      ? `Approfondisci questo studio/report per ${ticker}: «${title.slice(0, 120)}». Spiega dati clinici, KPI, implicazioni e reazione prezzo T+1/T+3.`
      : `Approfondisci gli eventi clinici visibili per ${ticker} in tabella.`;
  }
  return title
    ? `Deep-dive this study/report for ${ticker}: «${title.slice(0, 120)}». Explain clinical data, KPIs, implications and T+1/T+3 price reaction.`
    : `Deep-dive the clinical events shown for ${ticker} in the table.`;
}
