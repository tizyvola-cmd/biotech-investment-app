import { useEffect, useMemo, useState } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur, fmtUsd } from "../simLogic";

const CAP_PRESETS = [2500, 5000, 7500, 10_000];

type Props = {
  ticker: string;
  /** Live spot USD — follows current sheet quote as it updates. */
  priceUsd: number | null;
  /** Suggested capital for BUY. */
  suggestedCapitalEur?: number | null;
  /** Open book capital (SELL). */
  openCapitalEur?: number | null;
  hasPosition: boolean;
  busy?: boolean;
  err?: string | null;
  onBuy: (capitalEur: number) => void;
  onSell: () => void;
};

export function OpportunityTradePanel({
  ticker,
  priceUsd,
  suggestedCapitalEur,
  openCapitalEur,
  hasPosition,
  busy = false,
  err = null,
  onBuy,
  onSell,
}: Props) {
  const { t } = useMobileLang();
  const suggested =
    suggestedCapitalEur != null && suggestedCapitalEur > 0
      ? Math.round(suggestedCapitalEur)
      : 5000;
  const [capStr, setCapStr] = useState(String(suggested));

  useEffect(() => {
    setCapStr(String(suggested));
  }, [ticker, suggested]);

  const capital = useMemo(() => {
    const n = Number(String(capStr).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }, [capStr]);

  const priceOk = priceUsd != null && priceUsd > 0;
  const canBuy = priceOk && Number.isFinite(capital) && capital > 0 && !busy;
  const canSell = hasPosition && !busy;

  return (
    <section className="opp-trade-panel" aria-label={t("oppTrade.title")}>
      <p className="mob-section-title">{t("oppTrade.title")}</p>
      <p className="opp-trade-lead">{t("oppTrade.lead")}</p>

      <div className="opp-trade-price-row">
        <span className="opp-trade-label">{t("oppTrade.price")}</span>
        <strong className="opp-trade-price" key={priceOk ? String(priceUsd) : "na"}>
          {priceOk ? fmtUsd(priceUsd!) : "—"}
        </strong>
        <span className="opp-trade-live">{t("oppTrade.priceLive")}</span>
      </div>

      <label className="opp-trade-cap-label" htmlFor="opp-trade-cap">
        {t("oppTrade.capital")}
      </label>
      <div className="opp-trade-presets">
        {CAP_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`opp-trade-preset${capital === p ? " is-active" : ""}`}
            onClick={() => setCapStr(String(p))}
            disabled={busy}
          >
            €{p.toLocaleString("en-US")}
          </button>
        ))}
      </div>
      <input
        id="opp-trade-cap"
        className="opp-trade-cap-input"
        inputMode="decimal"
        value={capStr}
        onChange={(e) => setCapStr(e.target.value)}
        placeholder="5000"
        disabled={busy}
      />

      {err ? <p className="msg err">{err}</p> : null}

      <div className="opp-trade-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canBuy}
          onClick={() => onBuy(capital)}
        >
          {busy ? "…" : t("oppTrade.buy")}
        </button>
        <button
          type="button"
          className="btn btn-rec-sell"
          disabled={!canSell}
          onClick={onSell}
          title={
            hasPosition
              ? openCapitalEur != null
                ? t("oppTrade.sellHint", { eur: fmtEur(openCapitalEur, 0) })
                : t("oppTrade.sell")
              : t("oppTrade.sellDisabled")
          }
        >
          {busy ? "…" : t("oppTrade.sell")}
        </button>
      </div>
    </section>
  );
}
