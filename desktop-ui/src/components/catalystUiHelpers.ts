import type { CatalystRow, SheetTable } from "../types";
import { buildFutureCdCalendar, CLINICAL_6M_DAYS } from "../sheet/clinicalSimulationFilter";
import { readPred7Pp } from "../sheet/simulationPlanGain";
import { t } from "../shared/i18n";

const INVALID_TICKER = new Set(["", "NAN", "NONE", "NULL", "N/A", "#N/A", "NAT", "—"]);

/** Ticker da id ``TICKER|YYYY-MM-DD`` o campo raw; scarta NaN/pandas export. */
export function normalizeCatalystTicker(id: string, raw?: unknown): string {
  const fromId = (id.split("|")[0] ?? "").trim().toUpperCase();
  if (raw == null || raw === "") return INVALID_TICKER.has(fromId) ? "" : fromId;
  if (typeof raw === "number" && Number.isNaN(raw)) {
    return INVALID_TICKER.has(fromId) ? "" : fromId;
  }
  const t = String(raw).trim().toUpperCase();
  if (!t || INVALID_TICKER.has(t)) return INVALID_TICKER.has(fromId) ? "" : fromId;
  return t;
}

export function isValidCatalystTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return t.length > 0 && !INVALID_TICKER.has(t);
}

export function catalystDirectionKind(direction: string): "up" | "down" | "neutral" {
  if (direction.includes("↑")) return "up";
  if (direction.includes("↓")) return "down";
  return "neutral";
}

export function catalystSignalMeta(row: CatalystRow): { className: string; label: string } {
  const kind = catalystDirectionKind(row.direction);
  const strong =
    row.confidence != null && row.confidence > 0.75 && kind !== "neutral";
  const prefix = strong ? t("catalyst.signal.strong") : "";
  if (kind === "up") return { className: "signal-up", label: `${prefix}${t("catalyst.signal.long")}` };
  if (kind === "down") return { className: "signal-down", label: `${prefix}${t("catalyst.signal.short")}` };
  return { className: "signal-neutral", label: t("catalyst.signal.neutral") };
}

export function daysUntilCompletion(completionDate: string): number | null {
  if (!completionDate) return null;
  const d = new Date(completionDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function qualityDotClass(score: number | null): string | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score < 1) return "quality-dot-green";
  if (score <= 2) return "quality-dot-yellow";
  return "quality-dot-red";
}

export function fmtPctSigned(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

function simDirectionFromPred(pred7: number | null): string {
  if (pred7 == null) return "→ Stabile";
  if (pred7 >= 1) return "↑ Rialzo";
  if (pred7 <= -1) return "↓ Ribasso";
  return "→ Stabile";
}

function normSimCdIso(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || s === "—") return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "";
  const dt = new Date(ms);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Prossimi CD da foglio Simulation (non dal JSON catalyst passati). */
export function upcomingCatalystStripFromSimulation(
  simTable: SheetTable | null,
  limit = 5
): CatalystRow[] {
  const entries = buildFutureCdCalendar(simTable, null, CLINICAL_6M_DAYS)
    .sort((a, b) => a.daysToCd - b.daysToCd)
    .slice(0, limit);

  const rowByTickerCd = new Map<string, Record<string, unknown>>();
  for (const row of simTable?.rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!isValidCatalystTicker(tk)) continue;
    const iso = normSimCdIso(row["Completion Date"]);
    if (!iso) continue;
    rowByTickerCd.set(`${tk}|${iso}`, row as Record<string, unknown>);
  }

  return entries.map((e) => {
    const simRow = rowByTickerCd.get(`${e.ticker}|${e.cdIso}`) ?? null;
    const pred7 = simRow ? readPred7Pp(simRow) : null;
    return {
      id: `${e.ticker}|${e.cdIso}`,
      ticker: e.ticker,
      completionDate: e.cdIso,
      direction: simDirectionFromPred(pred7),
      confidence: null,
      dataQualityScore: null,
      stars: "",
      phase: e.phase ?? "",
      sponsorMatch: "",
      datiScarsi: false,
      predIncomplete: false,
      runUp30d: null,
      modelD7Pct: pred7,
      v5Q05Pct: null,
      v5Q95Pct: null,
      raw: simRow ?? {},
    };
  });
}

/** Fallback: righe dashboard (storico) — solo CD futuri e ticker validi. */
export function upcomingCatalystStrip(rows: CatalystRow[], limit = 5): CatalystRow[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [...rows]
    .filter((r) => {
      if (!isValidCatalystTicker(r.ticker)) return false;
      if (!r.completionDate) return false;
      const d = new Date(r.completionDate);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      return d.getTime() >= today.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.completionDate).getTime() - new Date(b.completionDate).getTime()
    )
    .slice(0, limit);
}
