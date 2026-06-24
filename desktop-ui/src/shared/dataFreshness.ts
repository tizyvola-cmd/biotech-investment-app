/** Authoritative data refresh timestamp (manifest / workbook), not page reload. */

export function parseRefreshIso(iso: string | null | undefined): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function resolveDataRefreshIso(
  ...candidates: Array<string | null | undefined>
): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const iso of candidates) {
    const d = parseRefreshIso(iso);
    if (!d) continue;
    const ms = d.getTime();
    if (!best || ms > best.ms) best = { iso: iso!.trim(), ms };
  }
  return best?.iso ?? null;
}

/** Full date + time for the single “last data refresh” label. */
export function formatDataRefreshTimestamp(
  iso: string | null | undefined,
  lang: "it" | "en",
): string | null {
  const d = parseRefreshIso(iso);
  if (!d) return null;
  const locale = lang === "it" ? "it-IT" : "en-US";
  return d.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: lang !== "it",
  });
}
