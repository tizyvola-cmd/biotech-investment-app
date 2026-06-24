import { useMemo } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtEur, fmtPct, type SimulationPosition } from "../simLogic";
import type { InvestSimInputs } from "../types";

type Props = {
  positions: SimulationPosition[];
  inputs: InvestSimInputs;
  totalPnl: number;
  totalPnlPct: number | null;
  pnl24h: number;
  pnl24hPct: number | null;
  capital: number;
};

export function MobilePiggyBank({
  positions,
  inputs,
  totalPnl,
  totalPnlPct,
  pnl24h,
  pnl24hPct,
  capital,
}: Props) {
  const { t } = useMobileLang();

  const { closedCount, closedPnl } = useMemo(() => {
    let count = 0;
    let pnl = 0;
    for (const e of Object.values(inputs)) {
      if (!e.soldAt) continue;
      count++;
      const c = (e as { closedPnlEur?: number }).closedPnlEur;
      if (c != null && Number.isFinite(c)) pnl += c;
    }
    return { closedCount: count, closedPnl: pnl };
  }, [inputs]);

  const chips = useMemo(() => {
    return positions
      .filter((p) => p.capital > 0)
      .sort((a, b) => Math.abs(b.pnlEur) - Math.abs(a.pnlEur))
      .slice(0, 6)
      .map((p) => {
        const sign = p.pnlEur >= 0 ? "+" : "";
        const tone = p.pnlEur >= 0 ? "up" : p.pnlEur <= -50 ? "down" : "warn";
        return { ticker: p.ticker, label: `${sign}${fmtEur(p.pnlEur).replace("€ ", "€")}`, tone };
      });
  }, [positions]);

  const totalTone = totalPnl >= 0 ? "up" : "down";

  return (
    <section className="piggy-panel card">
      <div className="piggy-panel-head">
        <span className="piggy-panel-icon" aria-hidden>
          🐷
        </span>
        <div>
          <h2 className="piggy-panel-title">{t("piggy.title")}</h2>
          <p className={`piggy-panel-total tone-${totalTone}`}>
            {fmtEur(totalPnl)} ({fmtPct(totalPnlPct)})
          </p>
        </div>
      </div>
      <div className="piggy-panel-chips-row">
        <span className="piggy-stat-chip tone-up">
          {t("piggy.open24h", { amount: fmtEur(pnl24h) })}
        </span>
        {closedCount > 0 ? (
          <span className="piggy-stat-chip tone-warn">
            {t("piggy.closed", { n: closedCount, amount: fmtEur(closedPnl) })}
          </span>
        ) : null}
        <span className="piggy-stat-chip">
          {t("piggy.capital", { amount: fmtEur(capital, 0).replace("+", "") })}
        </span>
      </div>
      {pnl24hPct != null ? (
        <p className="piggy-panel-sub">
          24h {fmtPct(pnl24hPct)} · {t("piggy.positions", { n: positions.length })}
        </p>
      ) : null}
      {chips.length > 0 ? (
        <div className="piggy-ticker-chips">
          {chips.map((c) => (
            <span key={c.ticker} className={`piggy-ticker-chip tone-${c.tone}`}>
              {c.ticker} {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
