import type { EventVolIndexRow } from "../api/supernova";
import { eventVolPairKey } from "../api/supernova";
import {
  deskStaleProvenanceTip,
  deskStaleSessionBadge,
  eventVolEmptyLabel,
  eventVolEmptyTip,
  resolveEventVolEmptyReason,
} from "./deskFieldProvenance";

export type EventVolCell = {
  label: string;
  sub?: string;
  tip: string;
  tone: "up" | "down" | "flat" | "none";
  /** Last IVR/EM prints for sparkline (signal 4). Empty until ≥2 history points. */
  series?: number[];
  /** Brief 5d delta slope — null until ≥6 daily prints. */
  slope5d?: number | null;
  /** TRUE when slope itself is rising (needs ≥11 prints). */
  accelerating?: boolean | null;
  /** Empty-cell taxonomy when label is a dash / n/a / no opt. */
  emptyReason?: "loading" | "not_loaded" | "no_options" | null;
  /** Weekend carry badge e.g. «ven». */
  staleBadge?: string | null;
};

function eventVolHasPrint(row: EventVolIndexRow | null | undefined): boolean {
  return Boolean(
    row &&
      (row.ivr != null ||
        row.em_straddle != null ||
        row.em_event != null ||
        row.rr10 != null ||
        row.pcr_vol != null ||
        row.skew_ratio != null),
  );
}

export { eventVolHasPrint };

/**
 * Exact ticker|eventDate first; else nearest dated print for the same ticker
 * (Friday hot-zone cache often keys a slightly different catalyst date than today's desk).
 */
export function resolveEventVolRow(
  byKey: Record<string, EventVolIndexRow> | null | undefined,
  ticker: string,
  eventDate: string,
): EventVolIndexRow | undefined {
  if (!byKey) return undefined;
  const tk = ticker.trim().toUpperCase();
  const day = String(eventDate || "").slice(0, 10);
  if (!tk) return undefined;
  const exact = byKey[eventVolPairKey(tk, day)];
  if (eventVolHasPrint(exact)) return exact;

  const prefix = `${tk}|`;
  const targetMs = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T12:00:00Z`) : NaN;
  let best: EventVolIndexRow | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [key, row] of Object.entries(byKey)) {
    if (!key.startsWith(prefix) || !eventVolHasPrint(row)) continue;
    const rowDay = key.slice(prefix.length, prefix.length + 10);
    const rowMs = /^\d{4}-\d{2}-\d{2}$/.test(rowDay) ? Date.parse(`${rowDay}T12:00:00Z`) : NaN;
    const dist =
      Number.isFinite(targetMs) && Number.isFinite(rowMs)
        ? Math.abs(rowMs - targetMs)
        : Number.POSITIVE_INFINITY;
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }
  return best ?? exact;
}

/** Copy nearest ticker prints onto the calendar pair keys so live row lookups hit. */
export function aliasEventVolRowsForPairs(
  byKey: Record<string, EventVolIndexRow> | null | undefined,
  pairs: Array<{ ticker: string; eventDate: string }>,
): Record<string, EventVolIndexRow> {
  const out: Record<string, EventVolIndexRow> = { ...(byKey || {}) };
  for (const p of pairs) {
    const tk = p.ticker.trim().toUpperCase();
    const day = String(p.eventDate || "").slice(0, 10);
    if (!tk || !day) continue;
    const key = eventVolPairKey(tk, day);
    if (eventVolHasPrint(out[key])) continue;
    const resolved = resolveEventVolRow(out, tk, day);
    if (resolved) out[key] = resolved;
  }
  return out;
}

function slopeTone(slope: number | null | undefined, upIsGood: boolean): EventVolCell["tone"] {
  if (slope == null || !Number.isFinite(slope) || Math.abs(slope) < 1e-4) return "flat";
  const up = slope > 0;
  if (upIsGood) return up ? "up" : "down";
  return up ? "down" : "up";
}

export function formatIvrCell(
  row: EventVolIndexRow | null | undefined,
  it: boolean,
  loading: boolean,
): EventVolCell {
  if (!row || (row.ivr == null && row.em_straddle == null)) {
    const emptyReason = resolveEventVolEmptyReason(row, loading);
    return {
      label: eventVolEmptyLabel(emptyReason, it),
      tone: "none",
      tip: eventVolEmptyTip(emptyReason, it),
      series: [],
      slope5d: null,
      accelerating: null,
      emptyReason,
      staleBadge: null,
    };
  }
  const ivr = row.ivr;
  const slope = row.ivr_slope_5d ?? row.ivr_slope;
  const em = row.em_straddle ?? row.em_event;
  const accel = row.ivr_accelerating;

  // Arrow and color stay locked: green ↔ ↑ (rising), red ↔ ↓ (falling).
  let tone: EventVolCell["tone"] = "flat";
  let arrow = "";
  if (accel === true || (slope != null && slope > 1e-4)) {
    tone = "up";
    arrow = " ↑";
  } else if (slope != null && slope < -1e-4) {
    tone = "down";
    arrow = " ↓";
  } else if (accel === false && slope != null && Math.abs(slope) <= 1e-4) {
    tone = "flat";
    arrow = " →";
  }

  // Prioritize EM % (jump size the market prices). Arrow = recent trend of Expectation.
  const emLabel = em != null ? `EM ${(em * 100).toFixed(1)}%${arrow}` : null;
  const ivrLabel = ivr != null ? `IVR ${ivr.toFixed(2)}${arrow}` : null;
  const label = emLabel ?? ivrLabel ?? "—";
  // Second line only when both exist — IVR as supporting ratio, no second arrow.
  const sub =
    em != null && ivr != null
      ? `IVR ${ivr.toFixed(2)}`
      : undefined;

  const staleBadge = deskStaleSessionBadge(row, it);
  const staleTip = deskStaleProvenanceTip(row, it);
  const parts = [
    it
      ? em != null
        ? `EM ${((em ?? 0) * 100).toFixed(1)}% = ampiezza del salto che il mercato prezza (né su né giù).`
        : "EM non disponibile."
      : em != null
        ? `EM ${((em ?? 0) * 100).toFixed(1)}% = size of the jump the market prices (not up or down).`
        : "EM unavailable.",
    ivr != null
      ? it
        ? `IVR ${ivr.toFixed(2)} = quanto l’Expectation è alta vs una scadenza «normale» (>1 = salto più grande del solito).`
        : `IVR ${ivr.toFixed(2)} = how elevated Expectation is vs a “normal” expiry (>1 = bigger jump than usual).`
      : null,
    arrow.includes("↑")
      ? it
        ? "Freccia ↑ / verde: Expectation in salita negli ultimi giorni."
        : "Arrow ↑ / green: Expectation rising over recent days."
      : arrow.includes("↓")
        ? it
          ? "Freccia ↓ / rosso: Expectation in calo."
          : "Arrow ↓ / red: Expectation falling."
        : it
          ? "Nessuna freccia: pendenza piatta o troppo poca storia."
          : "No arrow: flat slope or not enough history.",
    staleTip,
  ].filter(Boolean);
  return {
    label,
    sub,
    tip: parts.join(" "),
    tone,
    series: row.ivr_series ?? [],
    slope5d: row.ivr_slope_5d ?? null,
    accelerating: accel ?? null,
    emptyReason: null,
    staleBadge,
  };
}

export function formatSkewCell(
  row: EventVolIndexRow | null | undefined,
  it: boolean,
  loading: boolean,
): EventVolCell {
  if (!row || (row.rr10 == null && row.skew_ratio == null && row.pcr_vol == null)) {
    const emptyReason = resolveEventVolEmptyReason(row, loading);
    return {
      label: eventVolEmptyLabel(emptyReason, it),
      tone: "none",
      tip:
        emptyReason === "no_options"
          ? it
            ? "Nessuno skew — nessuna catena opzioni quotata. Non è Soft BUY/SELL."
            : "No skew — no listed option chain. Not Soft BUY/SELL."
          : emptyReason === "not_loaded"
            ? it
              ? "Skew non ancora caricato sul pack server. Non è Soft BUY/SELL."
              : "Skew not loaded on the server pack yet. Not Soft BUY/SELL."
            : eventVolEmptyTip(emptyReason, it),
      emptyReason,
      staleBadge: null,
    };
  }
  const rr = row.rr10;
  const label =
    rr != null
      ? `RR ${rr > 0 ? "+" : ""}${(rr * 100).toFixed(1)}`
      : row.skew_ratio != null
        ? `SR ${row.skew_ratio.toFixed(2)}`
        : "—";
  const sub =
    row.pcr_vol != null
      ? `PCR ${row.pcr_vol.toFixed(2)}`
      : row.rr_slope != null
        ? `Δ ${row.rr_slope > 0 ? "+" : ""}${row.rr_slope.toFixed(3)}`
        : undefined;
  const staleBadge = deskStaleSessionBadge(row, it);
  const staleTip = deskStaleProvenanceTip(row, it);
  const parts = [
    it
      ? "RR = IV call +10% − IV put −10%. RR negativo = put più care (più assicurazione) → segnale positivo (verde). RR positivo = call più care (scommessa già pagata) → segnale negativo (rosso)."
      : "RR = +10% call IV − −10% put IV. Negative RR = puts richer (more insurance) → positive signal (green). Positive RR = calls richer (upside already paid for) → negative signal (red).",
    row.skew_cboe != null
      ? it
        ? `Skew CBOE-style ${row.skew_cboe.toFixed(3)} (si comprime = domanda call).`
        : `CBOE-style skew ${row.skew_cboe.toFixed(3)} (compressing = call demand).`
      : null,
    row.pcr_vol != null
      ? it
        ? `Put/call volume ${row.pcr_vol.toFixed(2)}${row.pcr_vol_slope != null ? ` (pendenza ${row.pcr_vol_slope.toFixed(3)})` : ""} — PCR alto = più volume put (assicurazione).`
        : `Put/call volume ${row.pcr_vol.toFixed(2)}${row.pcr_vol_slope != null ? ` (slope ${row.pcr_vol_slope.toFixed(3)})` : ""} — high PCR = more put volume (insurance).`
      : null,
    staleTip,
    it
      ? "Conta la pendenza pre-evento, non solo il livello. Non è Soft BUY/SELL."
      : "The pre-event slope matters, not just the level. Not Soft BUY/SELL.",
  ].filter(Boolean);
  const rrSlope = row.rr_slope;
  const pcrSlope = row.pcr_vol_slope;
  // Desk convention: put-rich / insurance = positive tell; call-rich = caution.
  let tone: EventVolCell["tone"] = slopeTone(rrSlope, false);
  if (tone === "flat" && pcrSlope != null) {
    tone = slopeTone(pcrSlope, true);
  }
  if (tone === "flat" && rr != null) {
    tone = rr > 0.02 ? "down" : rr < -0.02 ? "up" : "flat";
  }
  return {
    label,
    sub,
    tone,
    tip: parts.join(" "),
    emptyReason: null,
    staleBadge,
  };
}

export function eventVolToneClass(tone: EventVolCell["tone"] | "warn"): string {
  if (tone === "up") return "text-emerald-800 dark:text-emerald-300";
  if (tone === "down") return "text-rose-700 dark:text-rose-300";
  if (tone === "warn") return "text-amber-800 dark:text-amber-300";
  return "text-ink-muted";
}

/** SVG path for IVR/EM sparkline (signal 4). Null until ≥2 prints. */
export function ivrSparklinePath(values: number[], width = 48, height = 12): string | null {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
