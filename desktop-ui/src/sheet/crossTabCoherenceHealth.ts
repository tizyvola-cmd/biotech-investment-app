/**
 * Valutazione salute coerenza cross-tab — livelli ok / warn / error per metrica e popup desktop.
 */
import type { CrossTabCoherenceReport } from "./crossTabCoherence";

export type CoherenceHealthLevel = "ok" | "warn" | "error";

export type CoherenceMetricId =
  | "storeAlignment"
  | "buyPriceInputs"
  | "storeFreshness"
  | "publishSource"
  | "relaxedDrift"
  | "strictHot"
  | "relaxedHot"
  | "storeHot"
  | "upsidePct"
  | "minAff"
  | "slopeFeed"
  | "openPos"
  | "storeAge"
  | "buyWarn";

export type CoherenceCriticalIssue = {
  id: CoherenceMetricId;
  titleKey: import("../shared/i18n").TranslationKey;
  detailKey: import("../shared/i18n").TranslationKey;
  /** Cosa fare — mostrato in evidenza nel popup. */
  actionKey?: import("../shared/i18n").TranslationKey;
  tickers?: string[];
  detailVars?: Record<string, string | number>;
};

export type CoherenceHealthAssessment = {
  overall: CoherenceHealthLevel;
  metricLevels: Record<CoherenceMetricId, CoherenceHealthLevel>;
  criticalIssues: CoherenceCriticalIssue[];
  warningIssues: CoherenceCriticalIssue[];
  signature: string;
};

const STORE_STALE_WARN_MIN = 120;
const STORE_STALE_ERROR_MIN = 360;
const UNPUBLISHED_WARN_MIN = 30;

function normKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => String(k).trim().toUpperCase()).filter(Boolean))].sort();
}

function tickerFromOppKey(key: string): string {
  const m = /^co:([^|]+)\|/i.exec(key.trim());
  return (m?.[1] ?? key).trim().toUpperCase();
}

function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  const sa = normKeys(a);
  const sb = normKeys(b);
  if (sa.length !== sb.length) return false;
  return sa.every((k, i) => k === sb[i]);
}

function storeUsesStrictPublisher(publishedBy: CrossTabCoherenceReport["store"]["publishedBy"]): boolean {
  return publishedBy === "dashboard-strict" || publishedBy === "decision-lab";
}

export function assessCrossTabCoherenceHealth(
  report: CrossTabCoherenceReport,
): CoherenceHealthAssessment {
  const strictHotKeys = normKeys(report.strictHotKeys ?? []);
  const storeHotKeys = normKeys(report.store.hotKeys);
  const divergent = normKeys(report.divergentTickers);
  const buyWarn = report.buyPriceWarningTickers.length;
  const age = report.storeAgeMinutes;
  const pub = report.store.publishedBy;

  const metricLevels: Record<CoherenceMetricId, CoherenceHealthLevel> = {
    storeAlignment: "ok",
    buyPriceInputs: "ok",
    storeFreshness: "ok",
    publishSource: "ok",
    relaxedDrift: "ok",
    strictHot: "ok",
    relaxedHot: "ok",
    storeHot: "ok",
    upsidePct: "ok",
    minAff: "ok",
    slopeFeed: "ok",
    openPos: "ok",
    storeAge: "ok",
    buyWarn: "ok",
  };

  const criticalIssues: CoherenceCriticalIssue[] = [];
  const warningIssues: CoherenceCriticalIssue[] = [];

  const storeMisaligned =
    storeHotKeys.length > 0 &&
    (!setsEqual(storeHotKeys, strictHotKeys) ||
      storeHotKeys.some((k) => !strictHotKeys.includes(k)));

  if (storeMisaligned && (storeUsesStrictPublisher(pub) || pub == null)) {
    const orphaned = storeHotKeys.filter((k) => !strictHotKeys.includes(k));
    const staleStoreOnly = strictHotKeys.length === 0 && orphaned.length > 0;

    if (staleStoreOnly) {
      metricLevels.storeAlignment = "warn";
      metricLevels.storeHot = "warn";
      metricLevels.strictHot = "ok";
      warningIssues.push({
        id: "storeAlignment",
        titleKey: "coherenceAlert.issue.staleStore.title",
        detailKey: "coherenceAlert.issue.staleStore.detail",
        actionKey: "coherenceAlert.action.refreshTopOpps",
        tickers: orphaned.map(tickerFromOppKey),
        detailVars: { storeN: storeHotKeys.length },
      });
    } else {
      metricLevels.storeAlignment = "error";
      metricLevels.storeHot = "error";
      criticalIssues.push({
        id: "storeAlignment",
        titleKey: "coherenceAlert.issue.storeMismatch.title",
        detailKey: "coherenceAlert.issue.storeMismatch.detail",
        actionKey: "coherenceAlert.action.refreshTopOpps",
        tickers: orphaned.map(tickerFromOppKey),
        detailVars: {
          storeN: storeHotKeys.length,
          strictN: strictHotKeys.length,
        },
      });
    }
  } else if (
    strictHotKeys.length > 0 &&
    storeHotKeys.length === 0 &&
    age != null &&
    age >= UNPUBLISHED_WARN_MIN
  ) {
    metricLevels.storeAlignment = "warn";
    metricLevels.storeHot = "warn";
    metricLevels.strictHot = "warn";
    warningIssues.push({
      id: "storeAlignment",
      titleKey: "coherenceAlert.issue.unpublishedHot.title",
      detailKey: "coherenceAlert.issue.unpublishedHot.detail",
      actionKey: "coherenceAlert.action.refreshTopOpps",
      tickers: strictHotKeys,
      detailVars: { n: strictHotKeys.length, ageMin: age },
    });
  } else {
    metricLevels.storeHot = setsEqual(storeHotKeys, strictHotKeys) ? "ok" : "warn";
    metricLevels.strictHot = "ok";
  }

  if (buyWarn > 0) {
    metricLevels.buyPriceInputs = "error";
    metricLevels.buyWarn = "error";
    criticalIssues.push({
      id: "buyPriceInputs",
      titleKey: "coherenceAlert.issue.buyPrice.title",
      detailKey: "coherenceAlert.issue.buyPrice.detail",
      actionKey: "coherenceAlert.action.fixBuyPrice",
      tickers: report.buyPriceWarningTickers,
      detailVars: { n: buyWarn },
    });
  }

  if (age != null) {
    if (
      age >= STORE_STALE_ERROR_MIN &&
      (report.openPositions > 0 || storeHotKeys.length > 0)
    ) {
      metricLevels.storeFreshness = "error";
      metricLevels.storeAge = "error";
      criticalIssues.push({
        id: "storeFreshness",
        titleKey: "coherenceAlert.issue.storeStale.title",
        detailKey: "coherenceAlert.issue.storeStale.detail",
        actionKey: "coherenceAlert.action.refreshTopOpps",
        detailVars: { ageMin: age, ageHours: Math.round((age / 60) * 10) / 10 },
      });
    } else if (age >= STORE_STALE_WARN_MIN && report.openPositions > 0) {
      metricLevels.storeFreshness = "warn";
      metricLevels.storeAge = "warn";
      warningIssues.push({
        id: "storeFreshness",
        titleKey: "coherenceAlert.issue.storeAging.title",
        detailKey: "coherenceAlert.issue.storeAging.detail",
        actionKey: "coherenceAlert.action.refreshTopOpps",
        detailVars: { ageMin: age, ageHours: Math.round((age / 60) * 10) / 10 },
      });
    } else if (age >= STORE_STALE_WARN_MIN * 1.5) {
      metricLevels.storeFreshness = "warn";
      metricLevels.storeAge = "warn";
    }
  }

  if (pub === "dashboard-preview" && storeHotKeys.length > 0) {
    metricLevels.publishSource = "error";
    metricLevels.storeHot = "error";
    criticalIssues.push({
      id: "publishSource",
      titleKey: "coherenceAlert.issue.legacyPublish.title",
      detailKey: "coherenceAlert.issue.legacyPublish.detail",
      actionKey: "coherenceAlert.action.refreshTopOpps",
      tickers: storeHotKeys,
    });
  } else if (pub == null && storeHotKeys.length > 0) {
    metricLevels.publishSource = "warn";
    warningIssues.push({
      id: "publishSource",
      titleKey: "coherenceAlert.issue.unknownPublish.title",
      detailKey: "coherenceAlert.issue.unknownPublish.detail",
      actionKey: "coherenceAlert.action.refreshTopOpps",
      tickers: storeHotKeys,
    });
  }

  // relaxedDrift is purely diagnostic — relaxed mode is never used in the active
  // investment pipeline (Decision Lab and all publish paths use strict exclusively).
  // Show divergent count in the metric grid but never raise warn/error alerts.
  const divergentInStore = divergent.filter((t) =>
    storeHotKeys.some((k) => tickerFromOppKey(k) === t),
  );
  if (divergent.length > 0 || divergentInStore.length > 0) {
    metricLevels.relaxedDrift = "ok";
    metricLevels.relaxedHot = "ok";
  }

  const overall: CoherenceHealthLevel = criticalIssues.length
    ? "error"
    : warningIssues.length
      ? "warn"
      : "ok";

  const signature = buildCoherenceAlertSignature(criticalIssues);

  return {
    overall,
    metricLevels,
    criticalIssues,
    warningIssues,
    signature,
  };
}

/**
 * Stable dismiss key for the coherence modal.
 * Must NOT include ticking fields like ageMin/ageHours — otherwise "Close for now"
 * reopens on the next check as the store ages by one more minute.
 */
export function buildCoherenceAlertSignature(issues: CoherenceCriticalIssue[]): string {
  if (!issues.length) return "";
  return issues
    .map((i) => {
      const vars: Record<string, string | number> = { ...(i.detailVars ?? {}) };
      delete vars.ageMin;
      delete vars.ageHours;
      // titleKey distinguishes storeStale (6h+) vs storeAging (2h+) without the clock.
      return `${i.id}:${i.titleKey}:${(i.tickers ?? []).join(",")}:${JSON.stringify(vars)}`;
    })
    .sort()
    .join("|");
}
