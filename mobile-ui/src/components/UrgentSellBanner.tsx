import { useMobileLang } from "../hooks/useMobileLang";
import type { UrgentSellBannerItem } from "../mobileUrgentSellBanner";

function fmtCap(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `€${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPnl(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${Math.round(n).toLocaleString("en-US")}`;
}

export function UrgentSellBanner({
  items,
  onDismiss,
  onSell,
}: {
  items: UrgentSellBannerItem[];
  onDismiss: () => void;
  onSell: (key: string) => void;
}) {
  const { t, lang } = useMobileLang();
  const it = lang === "it";
  if (!items.length) return null;

  return (
    <section className="urgent-sell-banner" role="alert" aria-live="assertive">
      <header className="urgent-sell-banner-head">
        <div className="urgent-sell-banner-titles">
          <p className="urgent-sell-banner-kicker">{t("urgentSell.kicker")}</p>
          <h2 className="urgent-sell-banner-title">
            {t("urgentSell.title", { n: String(items.length) })}
          </h2>
          <p className="urgent-sell-banner-sub">{t("urgentSell.subtitle")}</p>
        </div>
        <button
          type="button"
          className="urgent-sell-banner-x"
          aria-label={t("urgentSell.dismiss")}
          onClick={onDismiss}
        >
          ×
        </button>
      </header>

      <ul className="urgent-sell-banner-list">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="urgent-sell-banner-row"
              onClick={() => onSell(item.key)}
            >
              <span className="urgent-sell-banner-ticker">
                <strong>{item.ticker}</strong>
                {item.tag ? (
                  <span className="urgent-sell-banner-tag">{item.tag}</span>
                ) : null}
              </span>
              <span className="urgent-sell-banner-meta">
                {it ? "investito" : "invested"} {fmtCap(item.capitalEur)}
                {item.pnlEur != null ? (
                  <span
                    className={
                      item.pnlEur < 0
                        ? "urgent-sell-banner-pnl down"
                        : item.pnlEur > 0
                          ? "urgent-sell-banner-pnl up"
                          : "urgent-sell-banner-pnl"
                    }
                  >
                    ({fmtPnl(item.pnlEur)})
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="urgent-sell-banner-hint">{t("urgentSell.hint")}</p>
    </section>
  );
}
