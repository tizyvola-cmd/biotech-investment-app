/**
 * slopeEventLog — persistenza, conferma ed export degli eventi di cambio pendenza.
 *
 * Schema di un evento:
 *  • Alla rilevazione: slope5d, slope20d, delta, regime, days_to_cd, pred_pct_median
 *  • Alla conferma (dopo CD): pnl effettivo, slope finale, correttezza
 *
 * Uso:
 *   addSlopeEvent(...)           → scrive su localStorage
 *   confirmPendingSlopeEvents()  → chiama su ogni checkSignals pass
 *   downloadSlopeLog()           → scarica il file JSON per ricalibrare il modello
 */

// ── Tipi pubblici ─────────────────────────────────────────────────────────────

export type SlopeEventKind = "slope_dec" | "slope_rev" | "slope_acc";

export type SlopeEventRecord = {
  /** Chiave univoca: ticker-cd-kind-timestamp */
  id: string;
  ticker: string;
  /** Data CD in formato DD/MM/YYYY */
  cd: string;
  /** Timestamp ms rilevazione */
  detected_at: number;
  kind: SlopeEventKind;
  /** Giorni rimanenti al CD al momento del rilevamento */
  days_to_cd_at_detection: number;
  slope5d: number;
  slope20d: number;
  /** slope5d − slope20d (pp/g) */
  delta_pp_per_day: number;
  run_up_30d: number | null;
  regime: string;
  /** Mediana curva in quel momento (pp), null se slope non disponibile */
  pred_pct_median: number | null;
  /**
   * True se al momento della rilevazione era aperta una posizione reale (capitale > 0).
   * Permette di distinguere eventi "live trading" da eventi "passive observation"
   * raccolti per ampliare il dataset di calibrazione. Opzionale per back-compat
   * con record salvati prima di questo campo.
   */
  had_open_position?: boolean;
  /**
   * Prezzo del titolo al momento della rilevazione (se disponibile dal foglio).
   * Necessario per calcolare un "P&L proxy" alla conferma quando non c'è una
   * posizione aperta (e quindi nessun P&L reale). Opzionale per back-compat.
   */
  price_at_detection?: number | null;

  // ── Conferma (compilata quando CD ≤ 0) ──
  /** null = in attesa · true = previsione corretta · false = smentita */
  confirmed: boolean | null;
  /** P&L % effettivo al momento della conferma (o proxy basato sul prezzo) */
  actual_pnl_pct: number | null;
  /** "live" = P&L reale di una posizione aperta · "proxy" = variazione prezzo */
  actual_pnl_source?: "live" | "proxy" | null;
  /** slope5d rilevato al momento della conferma */
  confirmed_slope5d: number | null;
  /** Timestamp conferma */
  resolution_at: number | null;
};

export type SlopeEventLog = {
  version: "1.0";
  description: string;
  events: SlopeEventRecord[];
  exported_at?: string;
};

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "supernova_slope_log_v1";
const MAX_EVENTS  = 500;

export function loadSlopeLog(): SlopeEventLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: "1.0", description: "Log eventi cambio pendenza curva pre-catalyst", events: [] };
    return JSON.parse(raw) as SlopeEventLog;
  } catch {
    return { version: "1.0", description: "Log eventi cambio pendenza curva pre-catalyst", events: [] };
  }
}

export function saveSlopeLog(log: SlopeEventLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch { /* quota esaurita — ignora */ }
}

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Aggiunge un nuovo evento al log (se non già presente con stesso id).
 * Restituisce true se aggiunto, false se duplicato.
 */
export function addSlopeEvent(
  event: Omit<
    SlopeEventRecord,
    | "id"
    | "confirmed"
    | "actual_pnl_pct"
    | "actual_pnl_source"
    | "confirmed_slope5d"
    | "resolution_at"
  >
): { added: boolean; record: SlopeEventRecord } {
  const log  = loadSlopeLog();
  const id   = `${event.ticker}-${event.cd}-${event.kind}-${event.detected_at}`;

  // Deduplicazione: non aggiungere se esiste già un evento identico (stesso ticker+cd+kind entro 24h)
  const alreadyExists = log.events.some(
    (e) =>
      e.ticker === event.ticker &&
      e.cd === event.cd &&
      e.kind === event.kind &&
      Math.abs(e.detected_at - event.detected_at) < 86_400_000, // 24h
  );
  if (alreadyExists) {
    const existing = log.events.find(
      (e) => e.ticker === event.ticker && e.cd === event.cd && e.kind === event.kind,
    )!;
    return { added: false, record: existing };
  }

  const record: SlopeEventRecord = {
    ...event, id,
    confirmed: null, actual_pnl_pct: null, actual_pnl_source: null,
    confirmed_slope5d: null, resolution_at: null,
  };
  log.events = [record, ...log.events].slice(0, MAX_EVENTS);
  saveSlopeLog(log);
  return { added: true, record };
}

/**
 * Scansiona gli eventi in attesa e li conferma quando:
 *  - il CD è passato (days ≤ 0)
 *  - e abbiamo il P&L effettivo
 *
 * Chiamato automaticamente a ogni checkSignals.
 * Restituisce il numero di eventi appena confermati.
 */
export function confirmPendingSlopeEvents(
  /**
   * Mappa ticker+cd → snapshot corrente dei ticker nel foglio.
   * ``priceNow`` permette di calcolare un P&L proxy quando non c'è una
   * posizione aperta reale (``pnlPct`` resta null).
   */
  tickerData: Map<
    string,
    {
      pnlPct: number | null;
      slope5d: number | null;
      days: number | null;
      priceNow?: number | null;
    }
  >,
): number {
  const log = loadSlopeLog();
  let confirmed = 0;

  for (const ev of log.events) {
    if (ev.confirmed !== null) continue; // già confermato

    const key  = `${ev.ticker}::${ev.cd}`;
    const data = tickerData.get(key);
    if (!data || data.days == null || data.days > 0) continue; // CD non ancora passata

    // Determina correttezza in base al kind.
    // Preferenza: P&L reale ("live"). Fallback: variazione di prezzo proxy
    // calcolata da ``price_at_detection`` salvato sul record vs ``priceNow``.
    const liveP = data.pnlPct;
    let pnl: number | null = liveP;
    let pnlSrc: "live" | "proxy" | null = liveP != null ? "live" : null;
    if (pnl == null && ev.price_at_detection != null && data.priceNow != null && ev.price_at_detection > 0) {
      pnl = ((data.priceNow - ev.price_at_detection) / ev.price_at_detection) * 100;
      pnlSrc = "proxy";
    }
    const s5_now = data.slope5d;
    let was_correct: boolean;

    if (ev.kind === "slope_rev") {
      // Inversione confermata se P&L < −2% (stock sceso come previsto)
      was_correct = pnl != null ? pnl < -2 : false;
    } else if (ev.kind === "slope_dec") {
      // Decelerazione confermata se P&L negativo OPPURE slope corrente ancora negativo
      was_correct = (pnl != null && pnl < -1) || (s5_now != null && s5_now < 0);
    } else {
      // Accelerazione confermata se P&L > +2%
      was_correct = pnl != null ? pnl > 2 : false;
    }

    ev.confirmed         = was_correct;
    ev.actual_pnl_pct    = pnl;
    ev.actual_pnl_source = pnlSrc;
    ev.confirmed_slope5d = s5_now;
    ev.resolution_at     = Date.now();
    confirmed++;
  }

  if (confirmed > 0) saveSlopeLog(log);
  return confirmed;
}

// ── Export ────────────────────────────────────────────────────────────────────

export function buildExportLog(): SlopeEventLog {
  return { ...loadSlopeLog(), exported_at: new Date().toISOString() };
}

/** Scarica il file slope_events_YYYY-MM-DD.json nel browser / Electron. */
export function downloadSlopeLog(): void {
  const json = JSON.stringify(buildExportLog(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `slope_events_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Svuota il log (usato dai test / reset manuale). */
export function clearSlopeLog(): void {
  saveSlopeLog({ version: "1.0", description: "Log eventi cambio pendenza curva pre-catalyst", events: [] });
}
