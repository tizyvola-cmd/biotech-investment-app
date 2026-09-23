/**
 * Once per NY session day, scan off-sheet tickers for volume ≥400%
 * (24h VOL VS PREV first, 7d as tail) and hook a trusted next CD.
 */
import { fetchHypeVolumeFunnelStatus, runHypeVolumeFunnelScan } from "../api/supernova";

const STORAGE_KEY = "supernova.hypeVolumeFunnel.fired.v1";
let inFlight = false;

function todayKey(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function alreadyFiredToday(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { day?: string }) : null;
    return parsed?.day === todayKey();
  } catch {
    return false;
  }
}

function markFired(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ day: todayKey() }));
  } catch {
    /* quota */
  }
}

const HYPE_FUNNEL_DONE_EVENT = "supernova-hype-volume-funnel-done";

function pollUntilIdle(onAccepted: () => void, attempts = 24): void {
  void fetchHypeVolumeFunnelStatus()
    .then((doc) => {
      const running = Boolean(doc?.status?.running);
      const last = doc?.status?.last;
      if ((running || last == null) && attempts > 0) {
        window.setTimeout(() => pollUntilIdle(onAccepted, attempts - 1), 5_000);
        return;
      }
      const n = doc?.status?.last?.accepted ?? doc?.entries?.length ?? 0;
      if (n > 0) onAccepted();
      window.dispatchEvent(
        new CustomEvent(HYPE_FUNNEL_DONE_EVENT, { detail: { accepted: n } }),
      );
    })
    .catch(() => {
      /* next dashboard tick retries via sessionStorage miss only if we didn't mark */
    });
}

/** Idempotent: one scan per NY day. Marks fired after the job starts. */
export function maybeRunHypeVolumeFunnelScan(onAccepted?: () => void): void {
  if (inFlight || alreadyFiredToday()) return;
  inFlight = true;
  void runHypeVolumeFunnelScan()
    .then((res) => {
      if (!res?.started && !res?.done) return;
      markFired();
      if (onAccepted) pollUntilIdle(onAccepted);
    })
    .catch(() => {
      /* retry next dashboard load */
    })
    .finally(() => {
      inFlight = false;
    });
}
