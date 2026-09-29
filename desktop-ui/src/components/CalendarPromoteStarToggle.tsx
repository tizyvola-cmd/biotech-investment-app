/**
 * Red ★ before a Calendar ticker — promote / demote into the Catalyst table
 * (same interest watchlist as manual enroll; layout matches Catalyst AttentionStarToggle).
 */
import { useCallback, useState, useSyncExternalStore, type MouseEvent } from "react";
import {
  enrollCatalystInterest,
  removeCatalystInterest,
} from "../api/supernova";
import { notifyCatalystInterestChanged } from "../hooks/useCatalystInterestTickers";
import {
  isCatalystInterestTicker,
  subscribeCatalystInterest,
} from "../sheet/catalystInterestStore";

export function CalendarPromoteStarToggle({
  ticker,
  company,
  cdIso,
  it = false,
  sizeClass = "text-[14px]",
  className = "",
}: {
  ticker: string;
  company?: string | null;
  /** Prefer exact catalyst day when promoting from Calendar. */
  cdIso?: string | null;
  it?: boolean;
  sizeClass?: string;
  className?: string;
}) {
  const tk = ticker.trim().toUpperCase();
  const enrolled = useSyncExternalStore(
    subscribeCatalystInterest,
    () => (tk ? isCatalystInterestTicker(tk) : false),
    () => false,
  );
  const [busy, setBusy] = useState(false);

  const tip = enrolled
    ? it
      ? "In Catalyst (stella rossa) — clic per togliere"
      : "On Catalyst (red star) — click to remove"
    : it
      ? "Promuovi in Catalyst (stella rossa)"
      : "Promote to Catalyst (red star)";

  const onToggle = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!tk || busy) return;
      setBusy(true);
      try {
        if (enrolled) {
          await removeCatalystInterest(tk);
        } else {
          const cd = (cdIso || "").trim().slice(0, 10);
          await enrollCatalystInterest({
            ticker: tk,
            company: (company || "").trim() || undefined,
            cd_iso: /^\d{4}-\d{2}-\d{2}$/.test(cd) ? cd : undefined,
            open_pipeline: true,
            discover: !/^\d{4}-\d{2}-\d{2}$/.test(cd),
            note: "Promoted from Calendar",
          });
        }
        notifyCatalystInterestChanged();
      } catch {
        /* keep UI usable */
      } finally {
        setBusy(false);
      }
    },
    [tk, busy, enrolled, company, cdIso],
  );

  if (!tk) return null;

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center leading-none shrink-0 min-w-[1.1rem] rounded px-0.5 focus:outline-none focus-visible:ring-2 hover:bg-rose-500/20 focus-visible:ring-rose-400 disabled:opacity-60 ${sizeClass} ${className}`}
      title={tip}
      aria-label={tip}
      aria-pressed={enrolled}
      disabled={busy}
      onClick={(ev) => void onToggle(ev)}
    >
      <span
        className={
          enrolled
            ? "text-rose-600 font-black drop-shadow-[0_0_1px_rgba(180,20,40,0.55)]"
            : "text-rose-500/80 hover:text-rose-600 font-semibold"
        }
        aria-hidden
      >
        {busy ? "…" : enrolled ? "★" : "☆"}
      </span>
    </button>
  );
}
