import type { InvestSimInputEntry, InvestSimInputs } from "./investSimStorage";

/** Normalizza Completion Date in ``YYYY-MM-DD`` per chiavi stabili (allineato a simulation_preserve.py). */
export function normalizeCompletionDateForKey(cd: unknown): string {
  if (cd == null || cd === "" || cd === "—" || cd === "-") return "—";
  const s = String(cd).trim();
  if (!s || s === "—" || s === "-") return "—";

  const isoHead = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoHead) return isoHead[1];

  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    const dt = new Date(ms);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const da = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return s;
}

export function normalizedRowKey(ticker: string, cd: unknown): string {
  const tk = String(ticker ?? "")
    .trim()
    .toUpperCase();
  return `${tk}|${normalizeCompletionDateForKey(cd)}`;
}

/** Mappa righe Simulation per chiave normalizzata (sparkline, dettaglio, ecc.). */
export function buildSimRowByKeyMap(
  rows: Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const tk = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    map.set(normalizedRowKey(tk, row["Completion Date"]), row);
  }
  return map;
}

function entryWeight(e: InvestSimInputEntry): number {
  let w = 0;
  if (e.ignoreSheet) w += 1000;
  if (e.capital > 0) w += 100;
  if (e.buyPrice > 0) w += 10;
  return w;
}

function mergeEntry(a: InvestSimInputEntry, b: InvestSimInputEntry): InvestSimInputEntry {
  const pick =
    entryWeight(b) > entryWeight(a) ? b : entryWeight(a) > entryWeight(b) ? a : b;
  const other = pick === a ? b : a;
  return {
    buyPrice: pick.buyPrice > 0 ? pick.buyPrice : other.buyPrice,
    capital: pick.capital > 0 ? pick.capital : other.capital,
    ignoreSheet: Boolean(pick.ignoreSheet || other.ignoreSheet),
  };
}

/**
 * Riallinea chiavi localStorage al foglio Simulation corrente
 * (es. ``ANIK|31/05/2026`` → ``ANIK|2026-05-31``).
 */
export function reconcileInvestSimInputs(
  inputs: InvestSimInputs,
  rows: Record<string, unknown>[]
): InvestSimInputs {
  const canonByAlias = new Map<string, string>();

  for (const r of rows) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const cd = r["Completion Date"];
    const canon = normalizedRowKey(tk, cd);
    const aliases = [
      `${tk}|${String(cd ?? "—")}`,
      normalizedRowKey(tk, String(cd ?? "—")),
      `${tk}|${normalizeCompletionDateForKey(cd)}`,
    ];
    for (const a of aliases) canonByAlias.set(a, canon);
    canonByAlias.set(canon, canon);
    canonByAlias.set(tk, canon);
  }

  const out: InvestSimInputs = {};
  for (const [rawKey, entry] of Object.entries(inputs)) {
    if (!entry) continue;
    const parts = rawKey.split("|");
    const tk = parts[0]?.trim().toUpperCase() ?? "";
    const cdPart = parts.slice(1).join("|") || "—";
    const canon =
      canonByAlias.get(rawKey) ??
      canonByAlias.get(normalizedRowKey(tk, cdPart)) ??
      normalizedRowKey(tk, cdPart);
    const prev = out[canon];
    out[canon] = prev ? mergeEntry(prev, entry) : { ...entry };
  }
  return out;
}

export function mergeInvestSimInputs(
  a: InvestSimInputs,
  b: InvestSimInputs
): InvestSimInputs {
  const out: InvestSimInputs = { ...a };
  for (const [k, entry] of Object.entries(b)) {
    if (!entry) continue;
    const prev = out[k];
    out[k] = prev ? mergeEntry(prev, entry) : { ...entry };
  }
  return out;
}
