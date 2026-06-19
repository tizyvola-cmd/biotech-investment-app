import type { DirectionalCalibDoc } from "../data/accuracyModelData";
import type { SignalLiveRow } from "../data/signalCalibrationData";

const HORIZON_LABELS: Record<string, string> = {
  t1: "T+1",
  t3: "T+3",
  t5: "T+5",
};

export type StrongSignalsHighlight =
  | {
      kind: "horizon";
      hitPct: number;
      windowLabel: string;
    }
  | {
      kind: "live";
      ticker: string;
      pred5Pct: number;
      daysToCd: number;
      direction: "up" | "down";
    };

export function peakUsefulHorizonHit(
  doc: DirectionalCalibDoc | null | undefined,
): StrongSignalsHighlight | null {
  const ph = doc?.per_horizon;
  if (!ph) return null;
  let best: StrongSignalsHighlight | null = null;
  for (const [key, bucket] of Object.entries(ph)) {
    const useful = bucket?.useful;
    const pct = useful?.hit_pct;
    const n = useful?.n ?? 0;
    if (pct == null || !Number.isFinite(pct) || n <= 0) continue;
    if (best?.kind !== "horizon" || pct > best.hitPct) {
      best = {
        kind: "horizon",
        hitPct: pct,
        windowLabel: HORIZON_LABELS[key] ?? key.toUpperCase(),
      };
    }
  }
  return best;
}

export function bestPendingUsefulSignal(
  rows: SignalLiveRow[] | null | undefined,
): StrongSignalsHighlight | null {
  if (!rows?.length) return null;
  const pending = rows.filter((r) => {
    if (r.actual_5d_pct != null) return false;
    if (!r.signal_emitted) return false;
    if (r.days_to_cd == null) return false;
    const aff = r.affid ?? 0;
    const p5 = Math.abs(r.pred5_pp ?? 0);
    return aff >= 50 && p5 >= 2;
  });
  if (!pending.length) return null;

  const ranked = [...pending].sort((a, b) => scorePending(b) - scorePending(a));
  const top = ranked[0];
  const dir = String(top.direction ?? "").toLowerCase();
  if (dir !== "up" && dir !== "down") return null;
  const pred5 = top.pred5_pp;
  if (pred5 == null || !Number.isFinite(pred5)) return null;

  return {
    kind: "live",
    ticker: String(top.ticker ?? "").toUpperCase(),
    pred5Pct: pred5,
    daysToCd: Math.round(top.days_to_cd!),
    direction: dir,
  };
}

function scorePending(r: SignalLiveRow): number {
  const tier = r.signal_tier === "strong" ? 1.5 : 1;
  return tier * Math.abs(r.pred5_pp ?? 0) * (r.affid ?? 0);
}

export function resolveStrongSignalsHighlight(
  directional: DirectionalCalibDoc | null | undefined,
  liveLatest: SignalLiveRow[] | null | undefined,
  pendingCount: number,
): StrongSignalsHighlight | null {
  if (pendingCount > 0) {
    const live = bestPendingUsefulSignal(liveLatest);
    if (live) return live;
  }
  return peakUsefulHorizonHit(directional);
}

export function formatDaysToCdOffset(days: number): string {
  if (days > 0) return `+${days}`;
  return String(days);
}

export function formatPred5Signed(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
