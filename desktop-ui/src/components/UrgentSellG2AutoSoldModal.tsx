import { AppModal, AppModalCloseButton } from "./AppModal";
import { useT } from "../shared/i18n";
import type { G2AutoSoldNotice } from "../sheet/urgentSellG2AutoExecute";

export function UrgentSellG2AutoSoldModal({
  open,
  sold,
  onClose,
}: {
  open: boolean;
  sold: G2AutoSoldNotice[];
  onClose: () => void;
}) {
  const t = useT();
  if (!open || sold.length === 0) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="g2-auto-sold-title"
      panelClassName="max-w-md w-full bg-[rgb(var(--panel))] border border-[rgb(var(--signal-down))]/40 shadow-xl rounded-lg p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="g2-auto-sold-title"
          className="text-base font-semibold text-[rgb(var(--signal-down))]"
        >
          {t("g2AutoSold.modal.title")}
        </h2>
        <AppModalCloseButton onClose={onClose} />
      </div>
      <p className="mt-1 text-sm text-[rgb(var(--muted))]">
        {t("g2AutoSold.modal.subtitle")}
      </p>
      <ul className="mt-3 space-y-2 max-h-[50vh] overflow-y-auto">
        {sold.map((s) => {
          const pct =
            s.dayPnlPct != null && Number.isFinite(s.dayPnlPct)
              ? `${s.dayPnlPct.toFixed(1)}%`
              : "—";
          const eur = `€${s.dayPnlEur.toFixed(0)}`;
          return (
            <li
              key={s.key}
              className="flex items-baseline justify-between gap-3 rounded border border-[rgb(var(--border))]/60 px-3 py-2"
            >
              <span className="font-semibold tracking-wide">{s.ticker}</span>
              <span className="text-sm tabular-nums text-[rgb(var(--signal-down))]">
                {t("g2AutoSold.modal.dayLine", { pct, eur })}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="rounded px-3 py-1.5 text-sm font-medium bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))] hover:bg-[rgb(var(--signal-down))]/25"
          onClick={onClose}
        >
          {t("g2AutoSold.modal.close")}
        </button>
      </div>
    </AppModal>
  );
}
