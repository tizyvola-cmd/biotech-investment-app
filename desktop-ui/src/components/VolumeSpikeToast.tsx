import { useEffect, useMemo, useRef, useState } from "react";
import {
  ackVolumeSpikeAlert,
  collectVolumeSpikeAlerts,
  fmtVolumeCompact,
  playTrumpetFanfare,
  VOLUME_SPIKE_MIN_RATIO,
  VOLUME_SPIKE_POLL_MS,
  type VolumeSpikeAlert,
} from "../sheet/volumeSpikeAlerts";

const AUTO_DISMISS_MS = 22_000;

type Props = {
  tickers: string[];
  lang: "it" | "en";
};

export function VolumeSpikeToast({ tickers, lang }: Props) {
  const it = lang === "it";
  const tickerKey = useMemo(
    () =>
      [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort().join(","),
    [tickers],
  );
  const [queue, setQueue] = useState<VolumeSpikeAlert[]>([]);
  const [active, setActive] = useState<VolumeSpikeAlert | null>(null);
  const playedForIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const list = tickerKey.split(",").filter(Boolean);
      if (!list.length) {
        if (!cancelled) setQueue([]);
        return;
      }
      const alerts = await collectVolumeSpikeAlerts(list);
      if (!cancelled) setQueue(alerts);
    };
    void poll();
    const id = window.setInterval(() => void poll(), VOLUME_SPIKE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tickerKey]);

  useEffect(() => {
    if (active) return;
    if (!queue.length) return;
    setActive(queue[0]!);
  }, [queue, active]);

  useEffect(() => {
    if (!active) return;
    if (playedForIdRef.current !== active.id) {
      playedForIdRef.current = active.id;
      playTrumpetFanfare();
    }
    const t = window.setTimeout(() => {
      ackVolumeSpikeAlert(active.id);
      setActive(null);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;

  const dismiss = () => {
    ackVolumeSpikeAlert(active.id);
    setActive(null);
  };

  return (
    <div
      className="fixed bottom-4 left-4 z-[80] w-[min(24rem,calc(100vw-1.5rem))]"
      role="alertdialog"
      aria-live="assertive"
    >
      <div className="rounded-xl border-2 border-amber-400/70 bg-[rgb(var(--surface))] shadow-xl px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {it ? "Picco di volume" : "Volume spike"}
              <span className="ml-1.5" aria-hidden>
                📯
              </span>
            </p>
            <p className="text-sm font-bold text-ink mt-0.5">
              {active.ticker}
              <span className="ml-2 tabular-nums text-teal-700 dark:text-teal-300">
                {fmtVolumeCompact(active.spikeVolume)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="text-ink-muted hover:text-ink text-sm leading-none px-1"
            aria-label={it ? "Chiudi" : "Dismiss"}
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
        <p className="text-[11px] text-ink-muted mt-1 tabular-nums">
          {active.spikeDate}
          {" · "}
          {it ? "vs mediana" : "vs median"} {fmtVolumeCompact(active.baselineVolume)}
          {" · "}
          <span className="font-semibold text-amber-800 dark:text-amber-200">
            ×{active.ratio.toFixed(1)}
          </span>
          {" "}
          <span className="opacity-80">
            ({it ? "soglia" : "threshold"} ×{VOLUME_SPIKE_MIN_RATIO})
          </span>
        </p>
        <p className="text-[12px] text-ink leading-snug mt-1.5">
          {it
            ? "Volume giornaliero anomalo rispetto alle ultime sessioni — controlla news/EIS e liquidità."
            : "Abnormal daily volume vs recent sessions — check news/EIS and liquidity."}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ml-auto text-[10px] font-medium text-ink-muted hover:text-ink"
            onClick={dismiss}
          >
            {it ? "Nascondi" : "Dismiss"}
          </button>
        </div>
        {queue.length > 1 ? (
          <p className="text-[9px] text-ink-muted mt-1.5">
            {it
              ? `+${queue.length - 1} altri picchi volume`
              : `+${queue.length - 1} more volume spikes`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
