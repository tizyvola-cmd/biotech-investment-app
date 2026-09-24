/**
 * Catalyst desk per-row provenance: { asof, source, session_day }.
 * Display values stay flat; `_desk` carries when/where the print came from
 * so weekend cells can show a grey «ven» badge instead of looking live.
 */
import {
  isDuringUsEquityRegularHours,
  printSessionDayKey,
} from "./marketSession";

export type DeskFieldProvenance = {
  /** ISO timestamp of the print. */
  asof: string;
  /** server_hourly | yahoo | cache | hole_fill | client_legacy */
  source: string;
  /** YYYY-MM-DD of the US equity session the print belongs to. */
  session_day?: string;
};

export type DeskRowProvenance = {
  asof: string;
  source: string;
  session_day?: string;
  /** Optional per-signal-field stamps. */
  fields?: Record<string, DeskFieldProvenance>;
};

export type WithDeskProvenance<T extends object> = T & {
  _desk?: DeskRowProvenance;
};

export function deskProvenanceOf(row: unknown): DeskRowProvenance | null {
  if (!row || typeof row !== "object") return null;
  const meta = (row as { _desk?: DeskRowProvenance })._desk;
  if (!meta || typeof meta !== "object") return null;
  if (!meta.asof && !meta.source) return null;
  return meta;
}

/** Print timestamp carried by the server row itself, when it has one. */
function rowPrintStamp(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  for (const k of ["asof", "as_of", "updated_at"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Session a stamp belongs to; a date-only server stamp already is that day. */
function sessionDayOfStamp(stamp: string): string {
  const day = stamp.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp.trim())) return day;
  const d = new Date(stamp);
  return printSessionDayKey(Number.isNaN(d.getTime()) ? new Date() : d);
}

export function stampDeskRowProvenance<T extends object>(
  row: T,
  source: string,
  opts?: {
    asof?: string | null;
    sessionDay?: string | null;
    signalKeys?: readonly string[];
  },
): WithDeskProvenance<T> {
  const asof = (opts?.asof || rowPrintStamp(row) || new Date().toISOString()).trim();
  const sessionDay =
    (opts?.sessionDay || "").trim().slice(0, 10) || sessionDayOfStamp(asof);
  const fields: Record<string, DeskFieldProvenance> = {};
  if (opts?.signalKeys?.length) {
    const o = row as Record<string, unknown>;
    for (const k of opts.signalKeys) {
      const v = o[k];
      if (v == null) continue;
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      if (typeof v === "string" && (!v.trim() || v.trim() === "—")) continue;
      fields[k] = { asof, source, session_day: sessionDay };
    }
  }
  const prev = deskProvenanceOf(row);
  return {
    ...row,
    _desk: {
      asof,
      source,
      session_day: sessionDay,
      fields: {
        ...(prev?.fields || {}),
        ...fields,
      },
    },
  };
}

/** Prefer next provenance when it has signal; else keep prior `_desk`. */
export function coalesceDeskProvenance<T extends object>(
  prev: T,
  next: T,
  nextHasSignal: boolean,
): WithDeskProvenance<T> {
  const pMeta = deskProvenanceOf(prev);
  const nMeta = deskProvenanceOf(next);
  if (nextHasSignal && nMeta) {
    return {
      ...(next as object),
      _desk: {
        ...nMeta,
        fields: { ...(pMeta?.fields || {}), ...(nMeta.fields || {}) },
      },
    } as WithDeskProvenance<T>;
  }
  if (pMeta) {
    return { ...(next as object), _desk: pMeta } as WithDeskProvenance<T>;
  }
  return next as WithDeskProvenance<T>;
}

/**
 * True when the print is from a prior US session and markets are closed now
 * (weekend / holiday carry — show grey «ven» badge).
 */
export function deskRowIsStaleCarry(
  row: unknown,
  now: Date = new Date(),
): boolean {
  if (isDuringUsEquityRegularHours(now)) {
    // During a session day still mark if asof session is older than last session.
    const meta = deskProvenanceOf(row);
    if (!meta?.session_day && !meta?.asof) return Boolean(
      row &&
        typeof row === "object" &&
        (row as { stale?: boolean }).stale === true,
    );
  }
  const meta = deskProvenanceOf(row);
  if (!meta) {
    return Boolean(
      row &&
        typeof row === "object" &&
        (row as { stale?: boolean }).stale === true,
    );
  }
  const last = printSessionDayKey(now);
  const day = (meta.session_day || "").slice(0, 10);
  if (day && day < last) return true;
  if (day && day === last && !isDuringUsEquityRegularHours(now)) return true;
  return Boolean((row as { stale?: boolean }).stale);
}

/** Short weekday badge for stale carry — Italian «ven», English «Fri». */
export function deskStaleSessionBadge(
  row: unknown,
  it: boolean,
  now: Date = new Date(),
): string | null {
  if (!deskRowIsStaleCarry(row, now)) return null;
  const meta = deskProvenanceOf(row);
  const day =
    (meta?.session_day || meta?.asof || "").slice(0, 10) ||
    printSessionDayKey(now);
  const d = new Date(`${day}T16:00:00Z`);
  if (Number.isNaN(d.getTime())) return it ? "ven" : "Fri";
  const wd = d.getUTCDay(); // 0 Sun … 5 Fri
  const itMap = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  const enMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return it ? itMap[wd] ?? "ven" : enMap[wd] ?? "Fri";
}

export function deskStaleProvenanceTip(
  row: unknown,
  it: boolean,
  now: Date = new Date(),
): string | null {
  if (!deskRowIsStaleCarry(row, now)) return null;
  const meta = deskProvenanceOf(row);
  const badge = deskStaleSessionBadge(row, it, now);
  const day = meta?.session_day || meta?.asof?.slice(0, 10) || "—";
  const src = meta?.source || "cache";
  return it
    ? `Ultima stampa ${badge} (${day}) · fonte ${src}. Mercato chiuso — non è un dato live.`
    : `Last print ${badge} (${day}) · source ${src}. Market closed — not a live print.`;
}

export type EventVolEmptyReason = "loading" | "not_loaded" | "no_options";

/**
 * Distinguish empty Expect/Skew dashes:
 * - loading: fetch in flight
 * - not_loaded: never printed / hole not filled yet
 * - no_options: Yahoo had no option chain for this name
 */
export function resolveEventVolEmptyReason(
  row: unknown,
  loading: boolean,
): EventVolEmptyReason | null {
  if (loading) return "loading";
  if (!row || typeof row !== "object") return "not_loaded";
  const o = row as Record<string, unknown>;
  const hasPrint =
    o.ivr != null ||
    o.em_straddle != null ||
    o.em_event != null ||
    o.rr10 != null ||
    o.pcr_vol != null ||
    o.skew_ratio != null;
  if (hasPrint) return null;
  const reason = String(o.empty_reason || "").toLowerCase();
  if (reason === "no_options" || reason === "no_chain") return "no_options";
  if (reason === "not_loaded" || reason === "budget") return "not_loaded";
  // Empty shell after a live attempt often carries stale=true + no prints.
  if (o.stale === true && o.asof) return "no_options";
  return "not_loaded";
}

export function eventVolEmptyLabel(
  reason: EventVolEmptyReason | null,
  it: boolean,
): string {
  if (reason === "loading") return "…";
  if (reason === "no_options") return it ? "no opt" : "no opt";
  if (reason === "not_loaded") return it ? "n/d" : "n/a";
  return "—";
}

export function eventVolEmptyTip(
  reason: EventVolEmptyReason | null,
  it: boolean,
): string {
  if (reason === "loading") {
    return it ? "Expectation in caricamento." : "Expectation loading.";
  }
  if (reason === "no_options") {
    return it
      ? "Nessuna catena opzioni quotata su Yahoo per questo titolo. Non è Soft BUY/SELL."
      : "No listed option chain on Yahoo for this name. Not Soft BUY/SELL.";
  }
  if (reason === "not_loaded") {
    return it
      ? "Dato non ancora caricato sul pack server (attendi l’hourly o Refresh). Non è Soft BUY/SELL."
      : "Not loaded on the server pack yet (wait for hourly or Refresh). Not Soft BUY/SELL.";
  }
  return it
    ? "Expectation assente. Non è Soft BUY/SELL."
    : "Expectation missing. Not Soft BUY/SELL.";
}
