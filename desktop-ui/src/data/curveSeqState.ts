/**
 * Loader per ``data/pred_curve_seq_state.json``.
 *
 * Espone lo stato delle ricalibrazioni della curva pred (% vs T−60) per ogni
 * catalyst ``TICKER|CD``: quali timepoint sono già ancorati al close reale
 * (offset CD-relativi) e quando è stata eseguita l'ultima ricalibrazione.
 *
 * Vedi anche ``data_orchestrator._pred_curve_seq_apply_to_predictions``.
 */

import { fetchProjectJson } from "./projectData";

const SEQ_STATE_FILE = "pred_curve_seq_state.json";

/** Offset calendario standard usati come timepoint di ancoraggio (gg da CD). */
export const SEQ_CAL_OFFSETS: readonly number[] = [
  -60, -30, -10, -7, -5, -3, 4, 7,
];

export type CurveSeqKnot = {
  trade_date?: string;
  cal_offset?: number;
  pct_vs_p60?: number | null;
  rsi_14?: number | null;
  slope_pct_45d?: number | null;
  exc_slope_vs_xbi?: number | null;
  vol_ratio?: number | null;
  vol_accel?: number | null;
  vol_price_div?: number | null;
  close_last?: number | null;
};

export type CurveSeqEvent = {
  ticker: string;
  completion_date: string;
  p60_usd?: number | null;
  locked_pct?: Record<string, number | null>;
  knots?: Record<string, CurveSeqKnot>;
  last_run?: string | null;
};

export type CurveSeqDoc = {
  version?: number;
  events?: Record<string, CurveSeqEvent>;
};

export async function loadCurveSeqState(): Promise<{
  doc: CurveSeqDoc | null;
  source: string;
  error?: string;
}> {
  const { data, detail } = await fetchProjectJson<CurveSeqDoc>(SEQ_STATE_FILE);
  if (data && typeof data === "object") {
    return { doc: data, source: `local (${SEQ_STATE_FILE})` };
  }
  return {
    doc: null,
    source: "",
    error: detail || `Recalibration state file not found (${SEQ_STATE_FILE}).`,
  };
}

/** Chiave standard: ``TICKER|YYYY-MM-DD``. */
export function curveSeqKey(ticker: string, cdIso: string): string {
  return `${ticker.trim().toUpperCase()}|${cdIso.trim()}`;
}

export type CurveSeqSummary = {
  /** Offset (gg da CD) effettivamente ancorati a un valore osservato (close reale o 8-K). */
  anchoredOffsets: number[];
  /** Offset standard che, alla data corrente, sarebbero ancorabili (CD+off <= today). */
  expectedOffsets: number[];
  /** Numero di nodi ancorati (esclude T−60 che è sempre 0% baseline). */
  anchoredCount: number;
  /** Numero di nodi attesi (esclude T−60 baseline). */
  expectedCount: number;
  /** Data ISO ``YYYY-MM-DD`` dell'ultima esecuzione che ha aggiornato lo stato. */
  lastRun: string | null;
  /** Prezzo di riferimento T−60 in $ (baseline % vs T−60). */
  p60Usd: number | null;
  /** Mappa offset → pct vs T−60 (dai knots). */
  anchoredPct: Record<number, number | null>;
};

/**
 * Calcola gli offset attesi (CD+off <= today) tra quelli standard, escludendo
 * T−60 che è il baseline (sempre 0%).
 */
function computeExpectedOffsets(
  completionDateIso: string,
  todayIso: string,
): number[] {
  try {
    const cd = new Date(completionDateIso + "T00:00:00Z");
    const today = new Date(todayIso + "T00:00:00Z");
    if (Number.isNaN(cd.getTime()) || Number.isNaN(today.getTime())) return [];
    const out: number[] = [];
    for (const off of SEQ_CAL_OFFSETS) {
      if (off === -60) continue;
      const target = new Date(cd);
      target.setUTCDate(target.getUTCDate() + off);
      if (target.getTime() <= today.getTime()) out.push(off);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Estrae il riepilogo ricalibrazione per un catalyst (``TICKER|CD-iso``).
 */
export function summarizeCurveSeqEvent(
  doc: CurveSeqDoc | null | undefined,
  ticker: string,
  completionDateIso: string,
  todayIso?: string,
): CurveSeqSummary | null {
  if (!doc?.events) return null;
  const key = curveSeqKey(ticker, completionDateIso);
  const ev = doc.events[key];
  if (!ev) return null;

  const lockedRaw = ev.locked_pct ?? {};
  const knotsRaw = ev.knots ?? {};
  const anchored: number[] = [];
  const anchoredPct: Record<number, number | null> = {};

  for (const k of Object.keys(lockedRaw)) {
    const off = Number(k);
    if (!Number.isFinite(off) || off === -60) continue;
    anchored.push(off);
    const v = lockedRaw[k];
    anchoredPct[off] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  // Considera anche knots che hanno pct_vs_p60 ma non sono in locked_pct
  for (const k of Object.keys(knotsRaw)) {
    const off = Number(k);
    if (!Number.isFinite(off) || off === -60) continue;
    if (anchored.includes(off)) continue;
    const pct = knotsRaw[k]?.pct_vs_p60;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      anchored.push(off);
      anchoredPct[off] = pct;
    }
  }
  anchored.sort((a, b) => a - b);

  const today = (todayIso ?? new Date().toISOString().slice(0, 10)).trim();
  const expected = computeExpectedOffsets(completionDateIso, today);

  return {
    anchoredOffsets: anchored,
    expectedOffsets: expected,
    anchoredCount: anchored.length,
    expectedCount: expected.length,
    lastRun: ev.last_run ?? null,
    p60Usd:
      typeof ev.p60_usd === "number" && Number.isFinite(ev.p60_usd)
        ? ev.p60_usd
        : null,
    anchoredPct,
  };
}

/** Etichetta compatta per un offset (es. ``−30`` o ``+7``). */
export function fmtOffsetLabel(off: number): string {
  if (off === 0) return "0";
  return off > 0 ? `+${off}` : `−${Math.abs(off)}`;
}

/** Formatta la lista degli offset ancorati in modo compatto (es. ``−30, −10, −7``). */
export function fmtAnchoredList(offsets: number[], max: number = 5): string {
  if (!offsets.length) return "—";
  if (offsets.length <= max) return offsets.map(fmtOffsetLabel).join(", ");
  const head = offsets.slice(0, max).map(fmtOffsetLabel).join(", ");
  return `${head} (+${offsets.length - max})`;
}

/** Differenza in giorni rispetto a oggi (ISO date string). Null se invalida. */
export function daysSinceIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.floor(
      (today.getTime() - d.getTime()) / 86_400_000,
    );
  } catch {
    return null;
  }
}
