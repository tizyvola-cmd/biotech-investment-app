/**
 * Soft BUY/SELL + prior-day bought/sold — compact mobile twin of desktop
 * Home «Segnali & book» (no what-if KPI strip).
 */
import type { MobileActionRow } from "../mobileActionsTable";
import type { MobilePriorDayBookItem, MobilePriorDayBookSlice } from "../dashboardTypes";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur } from "../simLogic";

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
    <li className="soft-signals-activity-row">
      <strong>{item.ticker}</strong>
      <span className="soft-signals-activity-meta">
        {capital}
        {pnl != null ? <span className={pnlCls}> ({pnl})</span> : null}
      </span>
    </li>
  );
}

function RecChip({
  row,
  tone,
  onOpen,
}: {
  row: MobileActionRow;
  tone: "buy" | "sell";
  onOpen: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className={`dash-rec-chip dash-rec-chip--${tone}`}
      onClick={() => onOpen(row.key)}
    >
      <span className="dash-rec-chip-ticker">{row.ticker}</span>
    </button>
  );
}

type Props = {
  buyRows: MobileActionRow[];
  sellRows: MobileActionRow[];
  priorDayBook?: MobilePriorDayBookSlice | null;
  onOpenBuy: (key: string) => void;
  onOpenSell: (key: string) => void;
};

export function SoftSignalsBookPanel({
  buyRows,
  sellRows,
  priorDayBook,
  onOpenBuy,
  onOpenSell,
}: Props) {
  const { t, lang } = useMobileLang();
  const it = lang === "it";
  const dayKey = priorDayBook?.dayKey ?? "";
  const buysDone = priorDayBook?.buys ?? [];
  const sellsDone = priorDayBook?.sells ?? [];

  return (
    <section className="soft-signals-panel" aria-label={t("signalsBook.aria")}>
      <header className="soft-signals-head">
        <p className="soft-signals-kicker">{t("signalsBook.kicker")}</p>
        <h3 className="soft-signals-title">{t("signalsBook.title")}</h3>
        <p className="hint soft-signals-sub">{t("signalsBook.sub")}</p>
      </header>

      <div className="soft-signals-grid">
        <div className="soft-signals-col soft-signals-col--buy">
          <div className="soft-signals-block soft-signals-block--suggest">
            <p className="soft-signals-block-title">
              {t("signalsBook.buySuggest", { n: buyRows.length })}
            </p>
            <p className="hint soft-signals-block-sub">{t("signalsBook.buySuggestSub")}</p>
            {buyRows.length === 0 ? (
              <p className="hint">{t("dashboard.rec.buyEmpty")}</p>
            ) : (
              <div className="dash-rec-chips">
                {buyRows.map((row) => (
                  <RecChip key={row.key} row={row} tone="buy" onOpen={onOpenBuy} />
                ))}
              </div>
            )}
          </div>
          <div className="soft-signals-block soft-signals-block--done-buy">
            <p className="soft-signals-block-title">
              {it
                ? `Acquistati ieri (${buysDone.length})${dayKey ? ` · ${dayKey}` : ""}`
                : `Bought yesterday (${buysDone.length})${dayKey ? ` · ${dayKey}` : ""}`}
            </p>
            {buysDone.length === 0 ? (
              <p className="hint">{t("priorDay.noBuys")}</p>
            ) : (
              <ul className="soft-signals-activity">
                {buysDone.map((b) => (
                  <ActivityLine key={`b-${b.key}`} item={b} />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="soft-signals-col soft-signals-col--sell">
          <div className="soft-signals-block soft-signals-block--suggest">
            <p className="soft-signals-block-title">
              {t("signalsBook.sellSuggest", { n: sellRows.length })}
            </p>
            <p className="hint soft-signals-block-sub">{t("signalsBook.sellSuggestSub")}</p>
            {sellRows.length === 0 ? (
              <p className="hint">{t("dashboard.rec.sellEmpty")}</p>
            ) : (
              <div className="dash-rec-chips">
                {sellRows.map((row) => (
                  <RecChip key={row.key} row={row} tone="sell" onOpen={onOpenSell} />
                ))}
              </div>
            )}
          </div>
          <div className="soft-signals-block soft-signals-block--done-sell">
            <p className="soft-signals-block-title">
              {it
                ? `Venduti ieri/oggi (${sellsDone.length})`
                : `Sold yesterday/today (${sellsDone.length})`}
            </p>
            {sellsDone.length === 0 ? (
              <p className="hint">{t("priorDay.noSells")}</p>
            ) : (
              <ul className="soft-signals-activity">
                {sellsDone.map((s) => (
                  <ActivityLine key={`s-${s.key}`} item={s} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
