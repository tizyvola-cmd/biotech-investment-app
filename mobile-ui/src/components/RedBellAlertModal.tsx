import type { RedBellAlertItem } from "../mobileRiskAlerts";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur } from "../simLogic";

export function RedBellAlertModal({
  items,
  onClose,
  onOpenTicker,
}: {
  items: RedBellAlertItem[];
  onClose: () => void;
  onOpenTicker?: (key: string) => void;
}) {
  const { t } = useMobileLang();
  if (!items.length) return null;

  return (
    <div
      className="risk-alert-modal-root"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="red-bell-alert-title"
      aria-live="assertive"
    >
      <button
        type="button"
        className="risk-alert-modal-backdrop"
        aria-label={t("redBell.close")}
        onClick={onClose}
      />
      <div className="risk-alert-modal-panel risk-alert-modal-panel--bell">
        <header className="risk-alert-modal-head">
          <span className="risk-alert-modal-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                fill="currentColor"
                d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm6.4-6.2V11a6.4 6.4 0 0 0-5.1-6.25V4.2a1.3 1.3 0 1 0-2.6 0v.55A6.4 6.4 0 0 0 5.6 11v4.8L4 17.4v.8h16v-.8l-1.6-1.6Z"
              />
            </svg>
          </span>
          <div className="risk-alert-modal-titles">
            <p className="risk-alert-modal-kicker">{t("redBell.kicker")}</p>
            <h2 id="red-bell-alert-title">
              {t("redBell.title", { n: String(items.length) })}
            </h2>
          </div>
          <button
            type="button"
            className="risk-alert-modal-x"
            onClick={onClose}
            aria-label={t("redBell.close")}
          >
            ✕
          </button>
        </header>
        <p className="risk-alert-modal-sub">{t("redBell.subtitle")}</p>
        <ul className="risk-alert-modal-list">
          {items.map((item) => {
            const pct =
              item.givebackPct != null && Number.isFinite(item.givebackPct)
                ? `${item.givebackPct.toFixed(0)}%`
                : "—";
            const base =
              item.purchasedPlusGainsEur != null
                ? fmtEur(item.purchasedPlusGainsEur, 0)
                : "—";
            const pnl =
              item.pnlEur != null && Number.isFinite(item.pnlEur)
                ? fmtEur(item.pnlEur, 0)
                : "—";
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className="risk-alert-modal-row"
                  onClick={() => {
                    onOpenTicker?.(item.key);
                    onClose();
                  }}
                >
                  <strong>{item.ticker}</strong>
                  <span>{t("redBell.line", { pct, base, pnl })}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn-lg risk-alert-modal-ok" onClick={onClose}>
          {t("redBell.close")}
        </button>
      </div>
    </div>
  );
}
