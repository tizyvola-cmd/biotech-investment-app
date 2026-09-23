import { useMemo, useState } from "react";
import { SegToggle } from "./MobileUi";
import { PContWindCell } from "./PContWindCell";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  buildMobileWhatIf24h,
  filterMobileWhatIfRows,
  type MobileWhatIfScope,
} from "../mobileWhatIf24h";
import { fmtEur } from "../simLogic";
import type { InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  onOpenDetail: (key: string) => void;
};

export function MobileWhatIf24hTable({ sheet, inputs, onOpenDetail }: Props) {
  const { t, lang } = useMobileLang();
  const it = lang === "it";
  const [scope, setScope] = useState<MobileWhatIfScope>("all");

  const bundle = useMemo(() => buildMobileWhatIf24h(sheet, inputs), [sheet, inputs]);
  const rows = useMemo(
    () => (bundle ? filterMobileWhatIfRows(bundle.rows, scope) : []),
    [bundle, scope],
  );

  if (!bundle) {
    return (
      <section className="card dash-whatif-card">
        <header className="dash-section-head">
          <h3>{t("dashboard.whatif.title")}</h3>
        </header>
        <p className="hint">{t("dashboard.whatif.empty")}</p>
      </section>
    );
  }

  return (
    <section className="card dash-whatif-card">
      <header className="dash-section-head">
        <h3>{t("dashboard.whatif.title")}</h3>
        <p className="hint">
          {t("dashboard.whatif.sub", {
            n: String(bundle.nAll),
            cap: fmtEur(bundle.capitalPerTicker, 0),
          })}
        </p>
      </header>

      <div className="dash-whatif-kpis">
        <div className="dash-whatif-kpi">
          <span className="dash-whatif-kpi-label">{t("dashboard.whatif.kpiPf")}</span>
          <strong
            className={
              bundle.pfPnlEur >= 0 ? "tone-up" : "tone-down"
            }
          >
            {fmtEur(bundle.pfPnlEur, 0)}
          </strong>
          <span className="hint">{bundle.nPortfolio} names</span>
        </div>
        <div className="dash-whatif-kpi">
          <span className="dash-whatif-kpi-label">{t("dashboard.whatif.kpiUni")}</span>
          <strong
            className={
              bundle.uniPnlEur >= 0 ? "tone-up" : "tone-down"
            }
          >
            {fmtEur(bundle.uniPnlEur, 0)}
          </strong>
          <span className="hint">{bundle.nAll} names</span>
        </div>
        <div className="dash-whatif-kpi">
          <span className="dash-whatif-kpi-label">{t("dashboard.whatif.kpiCap")}</span>
          <strong>
            {bundle.capturePct != null ? `${bundle.capturePct}%` : "—"}
          </strong>
          <span className="hint">
            {t("dashboard.whatif.missed", {
              eur: fmtEur(bundle.missedUpsideEur, 0),
            })}
          </span>
        </div>
      </div>

      <SegToggle
        value={scope}
        onChange={setScope}
        options={[
          { id: "all", label: t("dashboard.whatif.scopeAll"), badge: bundle.nAll },
          {
            id: "portfolio",
            label: t("dashboard.whatif.scopePf"),
            badge: bundle.nPortfolio,
          },
          { id: "off", label: t("dashboard.whatif.scopeOff"), badge: bundle.nOff },
        ]}
      />

      <div className="dash-whatif-table-wrap">
        <table className="dash-whatif-table">
          <thead>
            <tr>
              <th>{t("dashboard.whatif.colTicker")}</th>
              <th>{t("dashboard.whatif.colD24")}</th>
              <th>{t("dashboard.whatif.colG10")}</th>
              <th>{t("dashboard.whatif.colWind")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const dCls =
                row.d1 == null
                  ? ""
                  : row.d1 > 0
                    ? "tone-up"
                    : row.d1 < 0
                      ? "tone-down"
                      : "";
              return (
                <tr
                  key={row.key}
                  className={row.strongWind ? "dash-whatif-row--strong" : undefined}
                  onClick={() => onOpenDetail(row.key)}
                >
                  <td>
                    <button
                      type="button"
                      className="dash-open-ticker"
                      onClick={() => onOpenDetail(row.key)}
                    >
                      {row.inPortfolio ? (
                        <span className="dash-wind-briefcase" aria-hidden>
                          ▣
                        </span>
                      ) : null}
                      <strong>{row.ticker}</strong>
                    </button>
                    {row.pnlEur != null ? (
                      <div className="dash-open-meta">{fmtEur(row.pnlEur, 0)}</div>
                    ) : null}
                  </td>
                  <td className={`tabular-nums ${dCls}`}>
                    {row.d1 != null
                      ? `${row.d1 >= 0 ? "+" : ""}${row.d1.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="tabular-nums">
                    {row.g10 != null
                      ? `${row.g10 >= 0 ? "+" : ""}${row.g10.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td>
                    <PContWindCell windKind={row.windKind} pCont={row.pCont} it={it} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint dash-whatif-foot">{t("dashboard.whatif.foot")}</p>
    </section>
  );
}
