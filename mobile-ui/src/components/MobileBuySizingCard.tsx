import { useMobileLang } from "../hooks/useMobileLang";
import type { DecisionChartTickerRow, DecisionRec } from "../decisionChartLogic";
import { suggestedInvestEur, suggestedInvestPctForBuy } from "../mobileBuySizing";
import { fmtEur } from "../simLogic";

type Props = {
  row: DecisionChartTickerRow;
  totalCapital: number;
};

const REC_LABEL: Record<DecisionRec, string> = {
  buy: "BUY",
  hold: "HOLD",
  review: "UNCERTAIN",
  sell: "SELL",
};

export function MobileBuySizingCard({ row, totalCapital }: Props) {
  const { t } = useMobileLang();
  const isBuy = row.rec === "buy";
  const pct = suggestedInvestPctForBuy(row.scores);
  const eur = suggestedInvestEur(totalCapital, pct);

  return (
    <section className="card buy-sizing-card">
      <h2>{t("buySizing.title")}</h2>
      <p className="buy-sizing-hero">
        <strong>{row.ticker}</strong>
        {isBuy ? (
          <span className="buy-sizing-pct">{pct}%</span>
        ) : (
          <span className={`decision-rec-badge rec-${row.rec}`}>{REC_LABEL[row.rec]}</span>
        )}
      </p>
      {isBuy ? (
        <>
          <p className="hint">
            {t("buySizing.hint", {
              pct: String(pct),
              eur: fmtEur(eur),
              capital: fmtEur(totalCapital, 0),
            })}
          </p>
          <p className="hint buy-sizing-risk">
            {t("buySizing.riskNote")}
            {row.scores.riskV2 != null ? ` · Risk ${Math.round(row.scores.riskV2)}` : ""}
            {row.scores.regRisk != null ? ` · Reg ${Math.round(row.scores.regRisk)}` : ""}
          </p>
        </>
      ) : (
        <p className="hint">{t("buySizing.notBuy")}</p>
      )}
    </section>
  );
}
