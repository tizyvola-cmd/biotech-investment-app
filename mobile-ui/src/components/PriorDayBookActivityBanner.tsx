/**
 * Prior-day buys / yesterday+today sells — same recap as desktop Home.
 * Data comes from desktop snapshot `priorDayBook` (Pulse book at publish).
 */
import { useEffect, useState } from "react";
import type { MobilePriorDayBookItem, MobilePriorDayBookSlice } from "../dashboardTypes";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur } from "../simLogic";

const DISMISS_KEY = "supernova_mobile_prior_day_book_dismiss_v1";

function isDismissed(dayKey: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === dayKey;
  } catch {
    return false;
  }
}

function dismiss(dayKey: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, dayKey);
  } catch {
    /* ignore */
  }
}

function hasRows(book: MobilePriorDayBookSlice | null | undefined): boolean {
  return Boolean(book && (book.buys.length > 0 || book.sells.length > 0));
}

function ActivityLine({ item }: { item: MobilePriorDayBookItem }) {
  const capital =
    item.capitalEur != null && Number.isFinite(item.capitalEur)
      ? fmtEur(item.capitalEur, 0)
      : "—";
  const pnl =
    item.pnlEur != null && Number.isFinite(item.pnlEur)
      ? `${item.pnlEur > 0 ? "+" : ""}${fmtEur(item.pnlEur, 0)}`
      : null;
  const pnlCls =
    item.pnlEur == null ? "" : item.pnlEur >= 0 ? "tone-up" : "tone-down";
  return (
    <li className="prior-day-banner-row">
      <strong>{item.ticker}</strong>
      <span className="prior-day-banner-meta">
        {capital}
        {pnl != null ? <span className={pnlCls}> ({pnl})</span> : null}
      </span>
    </li>
  );
}

export function PriorDayBookActivityBanner({
  book,
}: {
  book: MobilePriorDayBookSlice | null | undefined;
}) {
  const { t, lang } = useMobileLang();
  const [hidden, setHidden] = useState(() =>
    book?.dayKey ? isDismissed(book.dayKey) : true,
  );

  useEffect(() => {
    if (!book?.dayKey) {
      setHidden(true);
      return;
    }
    setHidden(isDismissed(book.dayKey));
  }, [book?.dayKey]);

  if (hidden || !hasRows(book) || !book) return null;

  return (
    <section className="prior-day-banner" aria-label={t("priorDay.aria")}>
      <div className="prior-day-banner-head">
        <div>
          <p className="prior-day-banner-kicker">{t("priorDay.kicker")}</p>
          <h3 className="prior-day-banner-title">
            {t("priorDay.title", { day: book.dayKey })}
          </h3>
          <p className="hint prior-day-banner-sub">{t("priorDay.sub")}</p>
        </div>
        <button
          type="button"
          className="prior-day-banner-x"
          aria-label={t("priorDay.dismiss")}
          onClick={() => {
            dismiss(book.dayKey);
            setHidden(true);
          }}
        >
          ×
        </button>
      </div>
      <div className="prior-day-banner-cols">
        <div className="prior-day-banner-col prior-day-banner-col--buy">
          <p className="prior-day-banner-col-title">
            {lang === "it"
              ? `Acquistati (${book.buys.length})`
              : `Bought (${book.buys.length})`}
          </p>
          {book.buys.length ? (
            <ul>
              {book.buys.map((b) => (
                <ActivityLine key={`b-${b.key}`} item={b} />
              ))}
            </ul>
          ) : (
            <p className="hint">{t("priorDay.noBuys")}</p>
          )}
        </div>
        <div className="prior-day-banner-col prior-day-banner-col--sell">
          <p className="prior-day-banner-col-title">
            {lang === "it"
              ? `Venduti (${book.sells.length})`
              : `Sold (${book.sells.length})`}
          </p>
          {book.sells.length ? (
            <ul>
              {book.sells.map((s) => (
                <ActivityLine key={`s-${s.key}`} item={s} />
              ))}
            </ul>
          ) : (
            <p className="hint">{t("priorDay.noSells")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
