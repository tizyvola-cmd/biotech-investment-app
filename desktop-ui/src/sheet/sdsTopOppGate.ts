/**
 * SDS gates for Top Opportunities / strict pick — align Segnali with SuperNova.
 */
import type { SdsRow } from "../api/supernova";
import type { StrictPickFailure } from "./topOppsStrictPick";

/** Hot zone (≤60d): minimum SDS for new entry recommendations. */
export const SDS_HOT_ENTRY_MIN = 55;
/** Watch zone (61–120d): default minimum SDS for early watch list. */
export const SDS_WATCH_ENTRY_MIN = 30;
/** CD watch 61–90d — graduated gate (B). */
export const SDS_WATCH_EARLY_MIN = 25;
/** CD watch 91–120d — outer band, lower bar (B). */
export const SDS_WATCH_LATE_MIN = 20;

/** Minimum SDS for strict pick in CD watch zone, by days to CD. */
export function sdsWatchEntryMinForDays(daysToCd: number | null | undefined): number {
  if (daysToCd == null || !Number.isFinite(daysToCd)) return SDS_WATCH_ENTRY_MIN;
  if (daysToCd <= 90) return SDS_WATCH_EARLY_MIN;
  if (daysToCd <= 120) return SDS_WATCH_LATE_MIN;
  return SDS_WATCH_ENTRY_MIN;
}
/** Above this missing-data % → no operational recommendation (matches SDS backend). */
export const SDS_MISSING_DATA_BLOCK_PCT = 40;

export type SdsGateInfo = {
  sds: number;
  veto?: string | null;
  missing_data_pct?: number | null;
  zone_label?: string | null;
};

let _cachedSdsByTicker: Map<string, SdsGateInfo> | null = null;

export function setCachedSdsForTopOpps(map: Map<string, SdsGateInfo> | null): void {
  _cachedSdsByTicker = map;
}

export function getCachedSdsForTopOpps(): Map<string, SdsGateInfo> | null {
  return _cachedSdsByTicker;
}

export function sdsGateFromRow(row: SdsRow | null | undefined): SdsGateInfo | null {
  if (!row || row.sds == null || !Number.isFinite(row.sds)) return null;
  return {
    sds: row.sds,
    veto: row.veto,
    missing_data_pct: row.missing_data_pct,
    zone_label: row.zone_label,
  };
}

export function buildSdsByTicker(rows: SdsRow[] | null | undefined): Map<string, SdsGateInfo> {
  const m = new Map<string, SdsGateInfo>();
  for (const r of rows ?? []) {
    const tk = String(r.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    const info = sdsGateFromRow(r);
    if (info) m.set(tk, info);
  }
  return m;
}

export function isSdsExclusionReason(reason: string): boolean {
  return reason.startsWith("sds_");
}

/** Failures for strict pick / Top Opp (empty if pass). */
export function sdsStrictPickFailures(
  ticker: string,
  zone: "hot" | "watch",
  sdsByTicker: Map<string, SdsGateInfo> | null | undefined,
  daysToCd?: number | null,
): StrictPickFailure[] {
  if (!sdsByTicker || sdsByTicker.size === 0) {
    return [];
  }

  const info = sdsByTicker.get(ticker.trim().toUpperCase());
  if (!info) {
    return [{ code: "sds_unavailable", detail: "not in SDS cohort" }];
  }

  if (info.veto) {
    return [{ code: "sds_veto", detail: info.veto }];
  }

  const missing = info.missing_data_pct ?? 0;
  if (missing > SDS_MISSING_DATA_BLOCK_PCT) {
    return [{ code: "sds_low_confidence", detail: `${missing.toFixed(0)}%` }];
  }

  const min =
    zone === "hot" ? SDS_HOT_ENTRY_MIN : sdsWatchEntryMinForDays(daysToCd);
  if (info.sds < min) {
    return [
      {
        code: zone === "hot" ? "sds_below_hot" : "sds_below_watch",
        detail: `${info.sds.toFixed(1)} < ${min}`,
      },
    ];
  }

  return [];
}

export function sdsExclusionLabel(
  failure: StrictPickFailure,
  t: (key: import("../shared/i18n").TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const key = `signals.excluded.${failure.code}` as import("../shared/i18n").TranslationKey;
  const base = t(key);
  if (!failure.detail) return base;
  if (failure.code === "sds_veto") {
    return t("signals.excluded.sds_veto_detail", { veto: failure.detail });
  }
  if (failure.code === "sds_low_confidence") {
    return t("signals.excluded.sds_low_confidence_detail", { pct: failure.detail.replace("%", "") });
  }
  if (failure.code === "sds_below_hot" || failure.code === "sds_below_watch") {
    return t("signals.excluded.sds_below_detail", { detail: failure.detail });
  }
  if (failure.code === "sds_unavailable") {
    return t("signals.excluded.sds_unavailable_detail", { detail: failure.detail });
  }
  return base;
}
