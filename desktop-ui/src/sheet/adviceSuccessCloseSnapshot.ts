import type { SheetTable } from "../types";
import { lastUsEquityCloseSessionKey } from "./marketSession";

const STORAGE_KEY = "supernova_advice_success_close_v1";

export type AdviceSuccessKpiDisplay = {
  value: string;
  sub: string;
  tooltip?: string;
  accent?: "up" | "down" | "warn" | "accent";
};

export type AdviceSuccessCloseSnapshot = AdviceSuccessKpiDisplay & {
  freezeKey: string;
  /** YYYY-MM-DD — last NYSE close session captured in this snapshot. */
  closeSessionKey: string;
  savedAt: string;
};

/** Freeze key = language + last completed NYSE close session (not live prices). */
export function buildAdviceSuccessFreezeKey(
  lang: "it" | "en",
  ref: Date = new Date(),
): string {
  return `${lang}|${lastUsEquityCloseSessionKey(ref)}`;
}

/** Ticker rows for audit export — current sheet close fields at export time. */
export function buildAdviceSuccessFreezeTickerRows(
  simTable: SheetTable | null | undefined,
): { ticker: string; price: string; dailyVarPct: string }[] {
  if (!simTable?.rows?.length) return [];
  const out: { ticker: string; price: string; dailyVarPct: string }[] = [];
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const price = String(r["Prezzo Corrente ($)"] ?? "").trim();
    let daily = "";
    for (const col of ["Var. Giorn. %", "Var. Giorn.%", "Var. Giornaliera %"]) {
      const raw = r[col];
      if (raw != null && raw !== "") {
        daily = String(raw).trim();
        break;
      }
    }
    out.push({ ticker: tk, price, dailyVarPct: daily });
  }
  return out;
}

export function loadAdviceSuccessCloseSnapshot(): AdviceSuccessCloseSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdviceSuccessCloseSnapshot;
    if (!parsed?.freezeKey || typeof parsed.value !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAdviceSuccessCloseSnapshot(snapshot: AdviceSuccessCloseSnapshot): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

/**
 * Success efficiency must not move intraday — locked at the last NYSE close
 * and recomputed only when a new close session completes.
 */
export function resolveAdviceSuccessKpiDisplay(
  freezeKey: string,
  compute: () => AdviceSuccessKpiDisplay,
): AdviceSuccessKpiDisplay & { frozen: boolean; savedAt: string | null; closeSessionKey: string | null } {
  if (!freezeKey) {
    const live = compute();
    return { ...live, frozen: false, savedAt: null, closeSessionKey: null };
  }

  const closeSessionKey = freezeKey.split("|")[1] ?? null;
  const cached = loadAdviceSuccessCloseSnapshot();
  if (cached?.freezeKey === freezeKey && cached.value !== "—") {
    return {
      value: cached.value,
      sub: cached.sub,
      tooltip: cached.tooltip,
      accent: cached.accent,
      frozen: true,
      savedAt: cached.savedAt,
      closeSessionKey: cached.closeSessionKey ?? closeSessionKey,
    };
  }

  const live = compute();
  if (live.value !== "—") {
    saveAdviceSuccessCloseSnapshot({
      freezeKey,
      closeSessionKey: closeSessionKey ?? "",
      savedAt: new Date().toISOString(),
      ...live,
    });
  }
  return {
    ...live,
    frozen: false,
    savedAt: new Date().toISOString(),
    closeSessionKey,
  };
}
