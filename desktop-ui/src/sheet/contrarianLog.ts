/**
 * contrarianLog — persistence and confirmation of slope5d ↔ pred5
 * divergence events (contrarian setup).
 *
 * A contrarian event is recorded when slope5d and pred5 point in
 * opposite directions (|pred5| ≥ 1 pp), signaling that the model
 * "bets" against the current direction of the pre-catalyst curve.
 *
 * Analytical purpose:
 *   Measure how often the model beats the curve (and vice versa),
 *   to calibrate the slopeAlign factor weight in the score.
 *
 * Divergence types:
 *   "model_up"   → pred5 ↑ but slope5d ↓  (optimistic model, pessimistic curve)
 *   "model_down" → pred5 ↓ but slope5d ↑  (pessimistic model, optimistic curve)
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type ContrarianDivType = "model_up" | "model_down";

export type ContrarianEventRecord = {
  /** Unique key */
  id: string;
  ticker: string;
  /** CD date in DD/MM/YYYY format */
  cd: string;
  detected_at: number;
  /** Days to CD at detection time */
  days_to_cd_at_detection: number;
  /** Pre-cat 5d slope (pp/d) */
  slope5d: number;
  /** Bias-corrected post-CD T+5 prediction (pp) */
  pred5: number;
  /**
   * "model_up"   = model predicts ↑ but curve is ↓
   * "model_down" = model predicts ↓ but curve is ↑
   */
  divergence_type: ContrarianDivType;
  regime: string;
  /** Posizione aperta al rilevamento (allineato al log slope). */
  had_open_position?: boolean;

  // ── Confirmation (filled when CD ≤ 0) ───────────────────────────────────
  /** null = pending · true = model was right · false = curve was right */
  confirmed: boolean | null;
  actual_pnl_pct: number | null;
  resolution_at: number | null;
};

export type ContrarianEventLog = {
  version: "1.0";
  description: string;
  events: ContrarianEventRecord[];
  exported_at?: string;
};

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "supernova_contrarian_log_v1";
const MAX_EVENTS  = 300;

const EMPTY_LOG: ContrarianEventLog = {
  version: "1.0",
  description: "Slope5d vs pred5 divergence log (contrarian setup) — for slopeAlign calibration",
  events: [],
};

export function loadContrarianLog(): ContrarianEventLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_LOG, events: [] };
    return JSON.parse(raw) as ContrarianEventLog;
  } catch {
    return { ...EMPTY_LOG, events: [] };
  }
}

export function saveContrarianLog(log: ContrarianEventLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch { /* quota exceeded — ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds a divergence event to the log.
 * Dedup: same ticker+cd+type within 24 h.
 */
export function addContrarianEvent(
  event: Omit<ContrarianEventRecord, "id" | "confirmed" | "actual_pnl_pct" | "resolution_at">
): { added: boolean; record: ContrarianEventRecord } {
  const log = loadContrarianLog();
  const id  = `${event.ticker}-${event.cd}-${event.divergence_type}-${event.detected_at}`;

  const alreadyExists = log.events.some(
    (e) =>
      e.ticker          === event.ticker &&
      e.cd              === event.cd     &&
      e.divergence_type === event.divergence_type &&
      Math.abs(e.detected_at - event.detected_at) < 86_400_000, // 24 h
  );

  if (alreadyExists) {
    const existing = log.events.find(
      (e) => e.ticker === event.ticker && e.cd === event.cd && e.divergence_type === event.divergence_type,
    )!;
    return { added: false, record: existing };
  }

  const record: ContrarianEventRecord = {
    ...event, id,
    confirmed: null, actual_pnl_pct: null, resolution_at: null,
  };
  log.events = [record, ...log.events].slice(0, MAX_EVENTS);
  saveContrarianLog(log);
  return { added: true, record };
}

/**
 * Scans pending events and confirms them when the CD has passed (days ≤ 0).
 *
 * Confirmation criteria ("model was right"):
 *   model_up   → P&L > +2%  (optimistic model, and it was right)
 *   model_down → P&L < −2%  (pessimistic model, and it was right)
 *
 * Returns the number of events just confirmed.
 */
export function confirmPendingContrarianEvents(
  tickerData: Map<string, { pnlPct: number | null; days: number | null }>,
): number {
  const log = loadContrarianLog();
  let confirmed = 0;

  for (const ev of log.events) {
    if (ev.confirmed !== null) continue;

    const key  = `${ev.ticker}::${ev.cd}`;
    const data = tickerData.get(key);
    if (!data || data.days == null || data.days > 0) continue;

    const pnl = data.pnlPct;
    const was_correct =
      ev.divergence_type === "model_up"
        ? (pnl != null ? pnl > 2  : false)   // model predicted ↑, right if P&L > +2%
        : (pnl != null ? pnl < -2 : false);   // model predicted ↓, right if P&L < −2%

    ev.confirmed      = was_correct;
    ev.actual_pnl_pct = pnl;
    ev.resolution_at  = Date.now();
    confirmed++;
  }

  if (confirmed > 0) saveContrarianLog(log);
  return confirmed;
}

// ── Export ────────────────────────────────────────────────────────────────────

export function buildExportContrarianLog(): ContrarianEventLog {
  return { ...loadContrarianLog(), exported_at: new Date().toISOString() };
}

/** Downloads contrarian_events_YYYY-MM-DD.json in the browser / Electron. */
export function downloadContrarianLog(): void {
  const json = JSON.stringify(buildExportContrarianLog(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `contrarian_events_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Clears the log. */
export function clearContrarianLog(): void {
  saveContrarianLog({ ...EMPTY_LOG, events: [] });
}
