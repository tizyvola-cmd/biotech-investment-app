import { useEffect, useMemo, useState } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur, fmtPct, fmtUsd } from "../simLogic";

export type RecTradeSide = "buy" | "sell";

export type RecTradeDraft = {
  key: string;
  ticker: string;
  side: RecTradeSide;
  /** Live spot USD — kept in sync with current sheet quote. */
  priceUsd: number | null;
  /** Suggested capital € for BUY (optional). */
  suggestedCapitalEur?: number | null;
  /** Open capital € for SELL. */
  openCapitalEur?: number | null;
  /** Open MTM P&L € for SELL. */
  openPnlEur?: number | null;
  openPnlPct?: number | null;
};

const CAP_PRESETS = [2500, 5000, 7500, 10_000];

export function RecTradeModal({
  draft,
  busy,
  err,
  onClose,
  onConfirm,
  onOpenDetail,
}: {
  draft: RecTradeDraft;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onConfirm: (capitalEur: number) => void;
  onOpenDetail?: () => void;
}) {
  const { t } = useMobileLang();
  const isBuy = draft.side === "buy";
  const suggested =
    draft.suggestedCapitalEur != null && draft.suggestedCapitalEur > 0
      ? Math.round(draft.suggestedCapitalEur)
      : 5000;
  const [capStr, setCapStr] = useState(String(suggested));

  useEffect(() => {
    setCapStr(String(suggested));
  }, [draft.key, suggested]);

  const capital = useMemo(() => {
    const n = Number(String(capStr).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }, [capStr]);

  const priceOk = draft.priceUsd != null && draft.priceUsd > 0;
  const canSubmit = isBuy
    ? priceOk && Number.isFinite(capital) && capital > 0
    : true;

  return (
    <div className="rec-trade-modal-root" role="dialog" aria-modal="true" aria-labelledby="rec-trade-title">
      <button
        type="button"
        className="rec-trade-modal-backdrop"
        aria-label={t("recTrade.close")}
        onClick={onClose}
      />
      <div className="rec-trade-modal-panel">
        <header className="rec-trade-modal-head">
          <h2 id="rec-trade-title">
            {isBuy
              ? t("recTrade.buyTitle", { ticker: draft.ticker })
              : t("recTrade.sellTitle", { ticker: draft.ticker })}
          </h2>
          <button
            type="button"
            className="rec-trade-modal-x"
            onClick={onClose}
            aria-label={t("recTrade.close")}
          >
            ✕
          </button>
        </header>

        <p className="rec-trade-modal-sub">
          {isBuy ? t("recTrade.buyLead") : t("recTrade.sellLead")}
        </p>

        <dl className="rec-trade-facts">
          <div>
            <dt>{t("recTrade.price")}</dt>
            <dd>
              <span key={priceOk ? String(draft.priceUsd) : "na"}>
                {priceOk ? fmtUsd(draft.priceUsd!) : "—"}
              </span>
              {isBuy ? (
                <span className="rec-trade-live">{t("recTrade.priceLive")}</span>
              ) : null}
            </dd>
          </div>
          {!isBuy ? (
            <>
              <div>
                <dt>{t("recTrade.openCapital")}</dt>
                <dd>
                  {draft.openCapitalEur != null
                    ? fmtEur(draft.openCapitalEur, 0)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("recTrade.openPnl")}</dt>
                <dd>
                  {draft.openPnlEur != null ? fmtEur(draft.openPnlEur) : "—"}
                  {draft.openPnlPct != null ? (
                    <span className="rec-trade-muted">
                      {" "}
                      ({fmtPct(draft.openPnlPct)})
                    </span>
                  ) : null}
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        {isBuy ? (
          <div className="rec-trade-cap">
            <label htmlFor="rec-trade-cap">{t("recTrade.capital")}</label>
            <div className="rec-trade-presets">
              {CAP_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`rec-trade-preset${capital === p ? " is-active" : ""}`}
                  onClick={() => setCapStr(String(p))}
                >
                  €{p.toLocaleString("en-US")}
                </button>
              ))}
            </div>
            <input
              id="rec-trade-cap"
              inputMode="decimal"
              value={capStr}
              onChange={(e) => setCapStr(e.target.value)}
              placeholder="5000"
            />
            {suggested > 0 ? (
              <p className="hint">
                {t("recTrade.suggested", { eur: fmtEur(suggested, 0) })}
              </p>
            ) : null}
          </div>
        ) : null}

        {err ? <p className="msg err">{err}</p> : null}

        <div className="rec-trade-actions">
          <button
            type="button"
            className={`btn ${isBuy ? "btn-primary" : "btn-rec-sell"}`}
            disabled={busy || !canSubmit}
            onClick={() => onConfirm(isBuy ? capital : draft.openCapitalEur ?? 0)}
          >
            {busy
              ? "…"
              : isBuy
                ? t("recTrade.confirmBuy")
                : t("recTrade.confirmSell")}
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onClose}>
            {t("recTrade.cancel")}
          </button>
        </div>
        {onOpenDetail ? (
          <button
            type="button"
            className="rec-trade-detail-link"
            disabled={busy}
            onClick={onOpenDetail}
          >
            {t("recTrade.viewDetail")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
