/**
 * Dashboard catalyst-index colors: green = positive, red = negative, yellow = neutral.
 * Gray is reserved for outdated / market-closed carry (last print, not live).
 * Excel-like text colors (no chip boxes) — display only, not a Soft BUY/SELL gate.
 */

export type DeskIndexTone = "pos" | "neg" | "neu" | "empty" | "stale";

export function toDeskIndexTone(
  tone: "up" | "down" | "flat" | "none" | "warn" | "stale" | string | null | undefined,
): DeskIndexTone {
  if (tone === "up") return "pos";
  if (tone === "down") return "neg";
  if (tone === "flat" || tone === "warn") return "neu";
  if (tone === "stale") return "stale";
  return "empty";
}

export function recToDeskIndexTone(
  rec: "buy" | "sell" | "hold" | "review" | "none" | string,
): DeskIndexTone {
  if (rec === "buy") return "pos";
  if (rec === "sell") return "neg";
  if (rec === "hold" || rec === "review") return "neu";
  return "empty";
}

/**
 * Signed live % → always green/red (never gray).
 * Gray only when `stale` (last session print while market closed / carry).
 */
export function deskSignedLiveTone(
  pct: number | null | undefined,
  opts?: { stale?: boolean },
): DeskIndexTone {
  if (opts?.stale) return "stale";
  if (pct == null || !Number.isFinite(pct)) return "empty";
  return pct >= 0 ? "pos" : "neg";
}

/**
 * Map a cell tone, forcing gray when the print is outdated.
 * When live and tone is flat/warn, prefer signed % → red/green if provided.
 */
export function deskLiveOrStaleTone(
  tone: "up" | "down" | "flat" | "warn" | "none" | "stale" | string | null | undefined,
  opts?: { stale?: boolean; signedPct?: number | null },
): DeskIndexTone {
  if (opts?.stale) return "stale";
  if (tone === "none" || tone == null) return "empty";
  if (tone === "stale") return "stale";
  if (tone === "flat" || tone === "warn") {
    const p = opts?.signedPct;
    if (p != null && Number.isFinite(p)) return p >= 0 ? "pos" : "neg";
    // Conceptual neutral (e.g. diverge label without a %) stays yellow — not gray.
    return "neu";
  }
  return toDeskIndexTone(tone);
}

/** Plain text / number color — no background boxes. Palette tokens on SuperNova. */
export function deskIndexTextClass(tone: DeskIndexTone): string {
  if (tone === "pos") {
    return "text-[rgb(var(--positive))]";
  }
  if (tone === "neg") {
    return "text-[rgb(var(--negative))]";
  }
  if (tone === "neu") {
    return "text-[rgb(var(--signal-neutral))]";
  }
  // empty + stale share muted gray; stale is semantic (outdated print).
  return "text-ink-muted";
}

/** @deprecated Prefer deskIndexTextClass for Excel-style cells. */
export function deskIndexChipClass(tone: DeskIndexTone): string {
  if (tone === "pos") {
    return `bg-transparent border-transparent ${deskIndexTextClass(tone)}`;
  }
  if (tone === "neg") {
    return `bg-transparent border-transparent ${deskIndexTextClass(tone)}`;
  }
  if (tone === "neu") {
    return `bg-transparent border-transparent ${deskIndexTextClass(tone)}`;
  }
  return "bg-transparent text-ink-muted border-transparent";
}
