/**
 * Dashboard catalyst-index colors: green = positive, red = negative, yellow = neutral.
 * Signed prints keep red/green also when the market is closed; the age of the
 * print is carried by the last-reading badge, not by the color.
 * Gray is only for missing values.
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

/** Signed % → always green/red, live or carried from the last session. */
export function deskSignedLiveTone(
  pct: number | null | undefined,
): DeskIndexTone {
  if (pct == null || !Number.isFinite(pct)) return "empty";
  return pct >= 0 ? "pos" : "neg";
}

/**
 * Map a cell tone to a color. Outdated prints keep their red/green.
 * When tone is flat/warn, prefer signed % → red/green if provided.
 */
export function deskCellTone(
  tone: "up" | "down" | "flat" | "warn" | "none" | "stale" | string | null | undefined,
  opts?: { signedPct?: number | null },
): DeskIndexTone {
  if (tone === "none" || tone == null) return "empty";
  if (tone === "stale") {
    const p = opts?.signedPct;
    if (p != null && Number.isFinite(p)) return p >= 0 ? "pos" : "neg";
    return "stale";
  }
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
  // empty + stale share muted gray: no usable value to color.
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
