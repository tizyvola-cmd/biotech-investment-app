/**
 * Clickable attention ★ on Catalyst rows.
 * Yellow = mark for attention (sort only; does not keep beyond 30d).
 * Red = Companies of interest / manual enroll (always on Catalyst table).
 * Click red ★ → white (unenroll); after refresh / tab change the row leaves if only pinned by interest.
 */
import { useCallback, useState, useSyncExternalStore, type MouseEvent } from "react";
import { removeCatalystInterest } from "../api/supernova";
import { notifyCatalystInterestChanged } from "../hooks/useCatalystInterestTickers";
import { useAttentionStar } from "../sheet/attentionStarStore";
import {
  isCatalystInterestTicker,
  listCatalystInterestTickers,
  setCatalystInterestTickers,
  subscribeCatalystInterest,
} from "../sheet/catalystInterestStore";

export function AttentionStarToggle({
  ticker,
  it = false,
  sizeClass = "text-[12px]",
  className = "",
}: {
  ticker: string;
  it?: boolean;
  sizeClass?: string;
  className?: string;
}) {
  const { starred, toggle } = useAttentionStar(ticker);
  const tk = ticker.trim().toUpperCase();
  const enrolled = useSyncExternalStore(
    subscribeCatalystInterest,
    () => (tk ? isCatalystInterestTicker(tk) : false),
    () => false,
  );
  const [busy, setBusy] = useState(false);

  const kind = enrolled ? "enrolled" : starred ? "watch" : "off";
  const tip =
    kind === "enrolled"
      ? it
        ? "Inserita a mano — clic per togliere (stella bianca); esce dalla lista al refresh"
        : "Added by hand — click to clear (white star); leaves the list on refresh"
      : kind === "watch"
        ? it
          ? "Attenzione (lista Catalyst) — clic per togliere"
          : "Watching from Catalyst list — click to clear"
        : it
          ? "Segna per attenzione (stella gialla)"
          : "Mark for attention (yellow star)";

  const unenroll = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!tk || !enrolled || busy) return;
      setBusy(true);
      // Optimistic: star goes white immediately; keep local until DELETE settles.
      const previous = listCatalystInterestTickers();
      setCatalystInterestTickers(previous.filter((t) => t !== tk));
      try {
        await removeCatalystInterest(tk);
        notifyCatalystInterestChanged();
      } catch {
        setCatalystInterestTickers(previous);
        notifyCatalystInterestChanged();
      } finally {
        setBusy(false);
      }
    },
    [tk, enrolled, busy],
  );

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center leading-none shrink-0 rounded focus:outline-none focus-visible:ring-2 disabled:opacity-60 ${
        kind === "enrolled"
          ? "ring-1 ring-rose-500/70 hover:bg-rose-500/15 focus-visible:ring-rose-400"
          : "hover:bg-amber-400/15 focus-visible:ring-amber-400"
      } ${sizeClass} ${className}`}
      title={tip}
      aria-label={tip}
      aria-pressed={kind !== "off"}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (kind === "enrolled") {
          void unenroll(e);
          return;
        }
        toggle();
      }}
    >
      <span
        className={
          kind === "enrolled"
            ? "text-rose-500 drop-shadow-[0_0_1px_rgba(180,20,40,0.45)]"
            : kind === "watch"
              ? "text-amber-400 drop-shadow-[0_0_1px_rgba(180,120,0,0.45)]"
              : "text-ink-muted/45 hover:text-amber-500/80"
        }
        aria-hidden
      >
        {busy ? "…" : kind === "off" ? "☆" : "★"}
      </span>
    </button>
  );
}
