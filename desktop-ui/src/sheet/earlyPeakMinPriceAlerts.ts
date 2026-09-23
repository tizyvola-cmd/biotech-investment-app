/**
 * Persist early-peak buy-at-minimum targets and popup alert dedupe.
 */
import {
  currentPriceUsdFromSimRow,
  earlyPeakMinAlertId,
  formatBuyMinPriceUsd,
  priceAtOrBelowBuyMinTarget,
  type EarlyPeakBuyMinTarget,
} from "./earlyPeakBuyMinTarget";

const TARGETS_KEY = "supernova_early_peak_min_targets_v1";
const ACK_KEY = "supernova_early_peak_min_ack_v1";

export type EarlyPeakMinHitAlert = {
  id: string;
  target: EarlyPeakBuyMinTarget;
  currentPriceUsd: number;
  formattedTarget: string;
  formattedCurrent: string;
};

export function loadEarlyPeakMinTargets(): Map<string, EarlyPeakBuyMinTarget> {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Map();
    const map = new Map<string, EarlyPeakBuyMinTarget>();
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const t = item as EarlyPeakBuyMinTarget;
      if (!t.key || !t.ticker || !(t.buyAtMinTargetUsd > 0)) continue;
      map.set(t.key, t);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function saveEarlyPeakMinTargets(map: Map<string, EarlyPeakBuyMinTarget>): void {
  try {
    const list = [...map.values()].slice(-80);
    localStorage.setItem(TARGETS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function loadEarlyPeakMinAcks(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function ackEarlyPeakMinAlert(id: string): void {
  try {
    const next = loadEarlyPeakMinAcks();
    next.add(id);
    const list = [...next];
    const trimmed = list.length > 200 ? list.slice(list.length - 200) : list;
    localStorage.setItem(ACK_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

/**
 * Merge fresh early-peak BUY hits into stored targets (freeze min at first sight).
 * Remove targets whose key is no longer in the active set.
 */
export function syncEarlyPeakMinTargets(
  active: EarlyPeakBuyMinTarget[],
  now: Date = new Date(),
): Map<string, EarlyPeakBuyMinTarget> {
  const stored = loadEarlyPeakMinTargets();
  const activeKeys = new Set(active.map((a) => a.key));
  const next = new Map<string, EarlyPeakBuyMinTarget>();

  for (const hit of active) {
    const prev = stored.get(hit.key);
    if (prev && prev.buyAtMinTargetUsd > 0) {
      next.set(hit.key, {
        ...prev,
        ticker: hit.ticker,
        signalDayPct: hit.signalDayPct ?? prev.signalDayPct,
      });
    } else {
      next.set(hit.key, {
        ...hit,
        setAtIso: hit.setAtIso || now.toISOString(),
      });
    }
  }

  for (const [key, t] of stored) {
    if (!activeKeys.has(key) && next.has(key)) continue;
    if (activeKeys.has(key)) continue;
    // Keep stale targets 5 calendar days — user may still want the alert.
    const ageMs = now.getTime() - new Date(t.setAtIso).getTime();
    if (Number.isFinite(ageMs) && ageMs <= 5 * 86400_000) {
      next.set(key, t);
    }
  }

  saveEarlyPeakMinTargets(next);
  return next;
}

/** Alerts for targets whose live price reached the weekly minimum. */
export function collectEarlyPeakMinHitAlerts(
  targets: Map<string, EarlyPeakBuyMinTarget>,
  rowByKey: Map<string, Record<string, unknown>>,
  acked: Set<string> = loadEarlyPeakMinAcks(),
): EarlyPeakMinHitAlert[] {
  const out: EarlyPeakMinHitAlert[] = [];
  for (const target of targets.values()) {
    const simRow = rowByKey.get(target.key) ?? null;
    const current = currentPriceUsdFromSimRow(simRow);
    if (!priceAtOrBelowBuyMinTarget(current, target.buyAtMinTargetUsd)) continue;
    const id = earlyPeakMinAlertId(target.key, target.buyAtMinTargetUsd);
    if (acked.has(id)) continue;
    const formattedTarget = formatBuyMinPriceUsd(target.buyAtMinTargetUsd);
    const formattedCurrent = formatBuyMinPriceUsd(current);
    if (!formattedTarget || !formattedCurrent || current == null) continue;
    out.push({
      id,
      target,
      currentPriceUsd: current,
      formattedTarget,
      formattedCurrent,
    });
  }
  out.sort((a, b) => a.target.ticker.localeCompare(b.target.ticker));
  return out;
}
