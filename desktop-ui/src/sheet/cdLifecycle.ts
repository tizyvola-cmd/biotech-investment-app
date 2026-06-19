/**
 * Ciclo di vita CD — allineato a Simulation (solo futuri) + monitoraggio post-CD.
 *
 * - **pre_cd** — CD futuro o oggi (foglio Simulation, segnali pre-cat)
 * - **post_cd_watch** — fino a 7 giorni calendario dopo il CD (monitoraggio attivo)
 * - **past_catalyst** — oltre 7 gg post-CD → archivio (past_catalyst_predictions)
 */
import { daysFromToday } from "./simulationPlanGain";

/** Giorni calendario di monitoraggio dopo il CD (incluso T+7). */
export const POST_CD_WATCH_CAL_DAYS = 7;

export type CdLifecyclePhase = "pre_cd" | "post_cd_watch" | "past_catalyst" | "unknown";

export function resolveCdLifecyclePhase(days: number | null | undefined): CdLifecyclePhase {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days >= 0) return "pre_cd";
  // Incluso T+7 (es. days === -7); archivio da T+8 (days <= -8).
  if (days >= -POST_CD_WATCH_CAL_DAYS) return "post_cd_watch";
  return "past_catalyst";
}

export function resolveCdLifecycleFromDate(cd: string | null | undefined): CdLifecyclePhase {
  if (!cd?.trim()) return "unknown";
  return resolveCdLifecyclePhase(daysFromToday(cd));
}

/** Giorni trascorsi dal CD (1 = primo giorno dopo il CD). */
export function daysPastCd(days: number | null | undefined): number | null {
  if (days == null || !Number.isFinite(days) || days >= 0) return null;
  return -days;
}

export function isPreCd(days: number | null | undefined): boolean {
  return resolveCdLifecyclePhase(days) === "pre_cd";
}

export function isPostCdWatch(days: number | null | undefined): boolean {
  return resolveCdLifecyclePhase(days) === "post_cd_watch";
}

/** Oltre la finestra post-CD — non mostrare in tab operative. */
export function isPastCatalystArchived(days: number | null | undefined): boolean {
  return resolveCdLifecyclePhase(days) === "past_catalyst";
}

export function isActiveCdMonitoring(days: number | null | undefined): boolean {
  const p = resolveCdLifecyclePhase(days);
  return p === "pre_cd" || p === "post_cd_watch";
}

export function cdLifecycleLabel(
  days: number | null | undefined,
  lang: "it" | "en",
): string | null {
  const phase = resolveCdLifecyclePhase(days);
  const it = lang === "it";
  if (phase === "post_cd_watch") {
    const past = daysPastCd(days);
    const t = past != null ? `T+${past}` : it ? "post-CD" : "post-CD";
    return it ? `Watch post-CD · ${t}` : `Post-CD watch · ${t}`;
  }
  if (phase === "past_catalyst") {
    return it ? "Past catalyst" : "Past catalyst";
  }
  return null;
}

export function cdLifecycleShortLabel(
  days: number | null | undefined,
  lang: "it" | "en",
): string | null {
  const phase = resolveCdLifecyclePhase(days);
  if (phase !== "post_cd_watch") return null;
  const past = daysPastCd(days);
  const it = lang === "it";
  if (past != null) return `T+${past}`;
  return it ? "Post-CD" : "Post-CD";
}

/** Filtra record con CD ancora in monitoraggio attivo (pre-CD o watch 7 gg). */
export function filterByActiveCdMonitoring<T extends { cd?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const days = r.cd ? daysFromToday(r.cd) : null;
    return isActiveCdMonitoring(days);
  });
}

export type ActivePortfolioCdRef = { ticker: string; cd: string; days: number | null };

/** Posizioni con capitale > 0 ancora in finestra attiva (incluso watch post-CD senza riga Simulation). */
export function activePortfolioCdsFromInputs(
  inputs: import("./investSimStorage").InvestSimInputs,
): ActivePortfolioCdRef[] {
  const out: ActivePortfolioCdRef[] = [];
  for (const [key, entry] of Object.entries(inputs)) {
    if (!entry || (entry.capital ?? 0) <= 0) continue;
    const pipe = key.indexOf("|");
    if (pipe <= 0) continue;
    const ticker = key.slice(0, pipe).trim().toUpperCase();
    const cd = key.slice(pipe + 1).trim();
    if (!ticker || !cd) continue;
    const days = daysFromToday(cd);
    if (!isActiveCdMonitoring(days)) continue;
    out.push({ ticker, cd, days });
  }
  return out;
}
