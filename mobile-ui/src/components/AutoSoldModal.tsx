import type { MobileAutoSoldEvent } from "../dashboardTypes";
import { useMobileLang } from "../hooks/useMobileLang";

export function AutoSoldModal({
  event,
  onClose,
}: {
  event: MobileAutoSoldEvent;
  onClose: () => void;
}) {
  const { t } = useMobileLang();
  const items = event.items ?? [];
  if (!items.length) return null;

  return (
    <div className="auto-sold-modal-root" role="dialog" aria-modal="true" aria-labelledby="auto-sold-title">
      <button
        type="button"
        className="auto-sold-modal-backdrop"
        aria-label={t("autoSold.close")}
        onClick={onClose}
      />
      <div className="auto-sold-modal-panel">
        <header className="auto-sold-modal-head">
          <h2 id="auto-sold-title">{t("autoSold.title")}</h2>
          <button
            type="button"
            className="auto-sold-modal-x"
            onClick={onClose}
            aria-label={t("autoSold.close")}
          >
            ✕
          </button>
        </header>
        <p className="auto-sold-modal-sub">{t("autoSold.subtitle")}</p>
        {event.openCountAfter != null && Number.isFinite(event.openCountAfter) ? (
          <p className="auto-sold-modal-pipeline">
            {t("autoSold.openAfter", { n: String(event.openCountAfter) })}
          </p>
        ) : null}
        <ul className="auto-sold-modal-list">
          {items.map((s) => {
            const pct =
              s.dayPnlPct != null && Number.isFinite(s.dayPnlPct)
                ? `${s.dayPnlPct.toFixed(1)}%`
                : "—";
            const eur =
              s.dayPnlEur != null && Number.isFinite(s.dayPnlEur)
                ? `€${Math.round(s.dayPnlEur)}`
                : "—";
            return (
              <li key={s.key}>
                <strong>{s.ticker}</strong>
                <span>{t("autoSold.dayLine", { pct, eur })}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
