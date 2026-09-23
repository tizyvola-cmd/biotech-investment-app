import { useMemo } from "react";
import { CrownedPigIcon } from "../components/CrownedPigIcon";
import { MobileSimCapitalSelect } from "../components/MobileSimCapitalSelect";
import { RefreshButton } from "../components/RefreshButton";
import { useMobileLang } from "../hooks/useMobileLang";
import { localeForLang } from "../langStorage";
import { closedDealsSummary, portfolioSummary } from "../mobilePortfolioTable";
import { buildPositions, fmtEur, fmtPct } from "../simLogic";
import type { InvestSimInputEntry, InvestSimInputs, SheetTable } from "../types";

function formatPositionDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const s = iso.trim();
  const isoDayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = isoDayOnly ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function resolvePositionInvestedAt(entry: InvestSimInputEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.purchaseDate && entry.purchaseDate.trim() !== "") return entry.purchaseDate;
  if (entry.investedAt && entry.investedAt.trim() !== "") return entry.investedAt;
  return null;
}

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  startingCapital: number;
  onStartingCapitalChange: (value: number) => void;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  onRefresh: () => void;
};

export function PiggyBankTabView({
  sheet,
  inputs,
  startingCapital,
  onStartingCapitalChange,
  refreshLoading,
  lastUpdate,
  onRefresh,
}: Props) {
  const { t, lang } = useMobileLang();
  const locale = localeForLang(lang);
  const summary = useMemo(() => portfolioSummary(sheet, inputs), [sheet, inputs]);
  const closed = useMemo(() => closedDealsSummary(inputs), [inputs]);
  const positions = useMemo(
    () => buildPositions(sheet, inputs).filter((p) => p.capital > 0),
    [sheet, inputs],
  );

  return (
    <>
      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
      </div>

      <section className="card piggy-capital-panel">
        <div className="piggy-capital-panel-row">
          <div className="piggy-capital-panel-info">
            <h3>{t("piggy.simBudgetTitle")}</h3>
            <p className="hint">{t("simCapital.hint")}</p>
          </div>
          <MobileSimCapitalSelect
            value={startingCapital}
            onChange={onStartingCapitalChange}
            sheet={sheet}
            inputs={inputs}
          />
        </div>
      </section>

      <section className="card piggy-summary-hero">
        <div className="piggy-summary-head">
          <CrownedPigIcon size={36} />
          <h2>{t("piggy.summaryTitle")}</h2>
        </div>
        <p className="piggy-summary-capital">
          {t("piggy.capital", { amount: fmtEur(summary.capital, 0).replace("+", "") })}
        </p>
      </section>

      <div className="piggy-kpi-grid">
        <div className="card piggy-kpi tone-up">
          <span className="piggy-kpi-label">{t("piggy.gainOpen")}</span>
          <strong className="piggy-kpi-value">{fmtEur(summary.pnl)}</strong>
          <span className="hint">{fmtPct(summary.pnlPct)}</span>
        </div>
        <div className="card piggy-kpi tone-warn">
          <span className="piggy-kpi-label">{t("piggy.gainClosed")}</span>
          <strong className="piggy-kpi-value">{fmtEur(closed.pnlEur)}</strong>
          <span className="hint">
            {t("piggy.closed", { n: closed.count, amount: "" }).replace(/\s+$/, "")}
          </span>
        </div>
        <div className="card piggy-kpi tone-accent">
          <span className="piggy-kpi-label">{t("piggy.gain24h")}</span>
          <strong className="piggy-kpi-value">{fmtEur(summary.pnl24h)}</strong>
          <span className="hint">{fmtPct(summary.pnl24hPct)}</span>
        </div>
      </div>

      {positions.length > 0 ? (
        <section className="card piggy-positions-card">
          <h3>{t("piggy.openPositions")}</h3>
          <div className="piggy-positions-table-wrap">
            <table className="piggy-positions-table">
              <thead>
                <tr>
                  <th>{t("piggy.col.ticker")}</th>
                  <th>{t("piggy.col.investedAt")}</th>
                  <th>{t("piggy.col.capitalIn")}</th>
                  <th>{t("piggy.col.pnl")}</th>
                  <th>{t("piggy.col.cd")}</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const investedAt = resolvePositionInvestedAt(inputs[p.key]);
                  const pnlTone =
                    p.pnlUnavailable ? "" : p.pnlEur >= 0 ? "tone-up" : "tone-down";
                  return (
                    <tr key={p.key}>
                      <td className="piggy-col-ticker">
                        <strong>{p.ticker}</strong>
                        {p.name && p.name !== p.ticker ? (
                          <span className="piggy-col-name">{p.name}</span>
                        ) : null}
                      </td>
                      <td className="piggy-col-date">{formatPositionDate(investedAt, locale)}</td>
                      <td className="piggy-col-num">{fmtEur(p.capital, 0)}</td>
                      <td className={`piggy-col-num ${pnlTone}`}>
                        {p.pnlUnavailable ? (
                          <span title={t("piggy.col.pnlUnavailable")}>—</span>
                        ) : (
                          <>
                            {fmtEur(p.pnlEur, 0)}
                            <span className="piggy-col-pnl-pct">{fmtPct(p.pnlPct)}</span>
                          </>
                        )}
                      </td>
                      <td className="piggy-col-date">{p.completionDate || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
