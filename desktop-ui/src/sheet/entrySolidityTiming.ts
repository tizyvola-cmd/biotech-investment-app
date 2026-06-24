/**
 * Sub-indice timing per solidità ingresso — «Ha senso investire ORA?»
 *
 * Separato dallo Score Reliability (affidabilità modello).
 * · T−11…T−3 → picco (+10)
 * · T−12…T−60 → positivo decrescente (pre-picco, attendi o accumula gradualmente)
 * · T−61+ → leggermente negativo (oltre 2 mesi — monitor, non ingresso)
 * · T−2…T−0 → basso (zona binaria)
 */
import { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";

/** Finestra ingresso ottimale (giorni al CD). */
export const ENTRY_TIMING_PEAK_MIN_DAYS = 3;
export const ENTRY_TIMING_PEAK_MAX_DAYS = 11;

export type EntryTimingBand =
  | "peak"
  | "pre_peak"
  | "beyond_hot"
  | "binary"
  | "past"
  | "unknown";

/** −2 … +10 — solo solidità ingresso. */
export function entryTimingSolidityPoints(days: number | null | undefined): number | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 0) return 0;

  if (days >= ENTRY_TIMING_PEAK_MIN_DAYS && days <= ENTRY_TIMING_PEAK_MAX_DAYS) {
    return 10;
  }

  if (days < ENTRY_TIMING_PEAK_MIN_DAYS) return 2;

  if (days <= SIM_HOT_ZONE_DAYS) {
    const span = Math.max(1, SIM_HOT_ZONE_DAYS - ENTRY_TIMING_PEAK_MAX_DAYS);
    const t = (days - ENTRY_TIMING_PEAK_MAX_DAYS) / span;
    return Math.round((8 - t * 6) * 10) / 10;
  }

  if (days <= SIM_MONITOR_HORIZON_DAYS) {
    const span = Math.max(1, SIM_MONITOR_HORIZON_DAYS - SIM_HOT_ZONE_DAYS);
    const t = (days - SIM_HOT_ZONE_DAYS) / span;
    return Math.round((-1.2 - t * 0.8) * 10) / 10;
  }

  return -2;
}

export function entryTimingBand(days: number | null | undefined): EntryTimingBand {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days < 0) return "past";
  if (days >= ENTRY_TIMING_PEAK_MIN_DAYS && days <= ENTRY_TIMING_PEAK_MAX_DAYS) return "peak";
  if (days < ENTRY_TIMING_PEAK_MIN_DAYS) return "binary";
  if (days <= SIM_HOT_ZONE_DAYS) return "pre_peak";
  if (days <= SIM_MONITOR_HORIZON_DAYS) return "beyond_hot";
  return "unknown";
}

export function entryTimingSolidityLabel(
  days: number | null | undefined,
  lang: "it" | "en" = "it",
): string {
  const pts = entryTimingSolidityPoints(days);
  const band = entryTimingBand(days);
  if (pts == null) return lang === "it" ? "Timing n/d" : "Timing n/a";

  const ptStr = `${pts >= 0 ? "+" : ""}${pts.toFixed(1)}`;
  if (lang === "it") {
    switch (band) {
      case "peak":
        return `Timing ingresso ${ptStr} · finestra T−11…T−3 (T−${days}d)`;
      case "pre_peak":
        return `Timing ingresso ${ptStr} · pre-picco T−${days}d (≤2 mesi)`;
      case "beyond_hot":
        return `Timing ingresso ${ptStr} · oltre 2 mesi (T−${days}d) — monitor`;
      case "binary":
        return `Timing ingresso ${ptStr} · zona binaria T−${days}d`;
      case "past":
        return `Timing ingresso ${ptStr} · post-CD`;
      default:
        return `Timing ingresso ${ptStr}`;
    }
  }
  switch (band) {
    case "peak":
      return `Entry timing ${ptStr} · T−11…T−3 window (T−${days}d)`;
    case "pre_peak":
      return `Entry timing ${ptStr} · pre-peak T−${days}d (≤2 mo)`;
    case "beyond_hot":
      return `Entry timing ${ptStr} · beyond 2 mo (T−${days}d) — monitor`;
    case "binary":
      return `Entry timing ${ptStr} · binary zone T−${days}d`;
    case "past":
      return `Entry timing ${ptStr} · post-CD`;
    default:
      return `Entry timing ${ptStr}`;
  }
}

/** True se il timing consente «investire ora» (non oltre 2 mesi, non binario). */
export function entryTimingAllowsInvestNow(days: number | null | undefined): boolean {
  const pts = entryTimingSolidityPoints(days);
  if (pts == null) return false;
  if (days != null && days < ENTRY_TIMING_PEAK_MIN_DAYS) return false;
  return pts >= 0;
}

export type EntryTimingFailureCode =
  | "timing_binary"
  | "timing_pre_peak"
  | "timing_beyond_hot";

export function entryTimingSolidityFailures(
  days: number | null | undefined,
): { code: EntryTimingFailureCode; detail?: string }[] {
  if (days == null || !Number.isFinite(days)) return [];
  const out: { code: EntryTimingFailureCode; detail?: string }[] = [];

  if (days < ENTRY_TIMING_PEAK_MIN_DAYS && days >= 0) {
    out.push({ code: "timing_binary", detail: String(days) });
    return out;
  }

  if (days > SIM_HOT_ZONE_DAYS && days <= SIM_MONITOR_HORIZON_DAYS) {
    out.push({ code: "timing_beyond_hot", detail: String(days) });
    return out;
  }

  if (days > ENTRY_TIMING_PEAK_MAX_DAYS && days <= SIM_HOT_ZONE_DAYS) {
    out.push({ code: "timing_pre_peak", detail: String(days) });
  }

  return out;
}

/** Sostituisce ``precat_too_early`` — timing ingresso esplicito. */
export function replacesPrecatTooEarlyFailure(days: number | null | undefined): boolean {
  return days != null && Number.isFinite(days) && days > ENTRY_TIMING_PEAK_MAX_DAYS;
}
