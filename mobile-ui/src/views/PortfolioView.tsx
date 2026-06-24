import { useEffect, useMemo, useState } from "react";
import { BackButton } from "../components/BackButton";
import { MobilePortfolioTrendPanel } from "../components/MobilePortfolioTrendPanel";
import { CrownedPigIcon } from "../components/CrownedPigIcon";
import { VariationHorizonSparkline } from "../components/VariationHorizonSparkline";
import { RefreshButton } from "../components/RefreshButton";
import { fetchSimHistory, invalidateSimHistoryCache } from "../api";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import {
  buildPortfolioCheckRows,
  buildPortfolioPnlRows,
  portfolioSummary,
  type Verdict,
} from "../mobilePortfolioTable";
import { fmtEur, fmtPct } from "../simLogic";
import type { InvestSimInputs, InvestSimHistoryPoint, SheetTable } from "../types";

type SubTab = "check24h" | "pnl" | "trend";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  onRefresh: () => void;
  onOpenDetail: (key: string) => void;
  onBack?: () => void;
};

function verdictClass(v: Verdict): string {
  const map: Record<Verdict, string> = {
    RISE: "verdict-rise",
    DROP: "verdict-drop",
    WATCH: "verdict-watch",
    FLAT: "verdict-flat",
    REVIEW: "verdict-review",
  };
  return map[v];
}

function fmtTargetDays(days: number | null, lang: "it" | "en"): string | null {
  if (days == null || days <= 0) return null;
  return lang === "it" ? `${days}g` : `${days}d`;
}

function expectedTargetGainUsd(returnPct: number | null, capitalUsd: number): number | null {
  if (returnPct == null || !Number.isFinite(returnPct) || capitalUsd <= 0) return null;
  return Math.round((capitalUsd * returnPct) / 100);
}

function fmtSignedUsdCompact(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtRoiTargetSubline(
  days: number | null,
  returnPct: number | null,
  capitalUsd: number,
  lang: "it" | "en",
): string | null {
  const d = fmtTargetDays(days, lang);
  const gain = fmtSignedUsdCompact(expectedTargetGainUsd(returnPct, capitalUsd));
  if (d && gain) return `${d} · ${gain}`;
  return d ?? gain;
}

export function PortfolioView({
  sheet,
  inputs,
  dashSnapshot,
  refreshLoading,
  lastUpdate,
  onRefresh,
  onOpenDetail,
  onBack,
}: Props) {
  const { t, lang } = useMobileLang();
  const [subTab, setSubTab] = useState<SubTab>("check24h");
  const [trendSelectedKey, setTrendSelectedKey] = useState<string | null>(null);
  const [trendHistory, setTrendHistory] = useState<InvestSimHistoryPoint[]>([]);
  const [trendHistoryLoading, setTrendHistoryLoading] = useState(false);
  const enrich = useMemo(
    () => ({
      portfolioCheck: dashSnapshot?.portfolioCheck,
      recommendations: dashSnapshot?.recommendations,
    }),
    [dashSnapshot],
  );
  const summary = useMemo(() => portfolioSummary(sheet, inputs), [sheet, inputs]);
  const checkRows = useMemo(
    () => buildPortfolioCheckRows(sheet, inputs, enrich),
    [sheet, inputs, enrich],
  );
  const pnlRows = useMemo(
    () => buildPortfolioPnlRows(sheet, inputs, enrich),
    [sheet, inputs, enrich],
  );

  const trendPositions = useMemo(
    () => checkRows.map((r) => ({ key: r.key, ticker: r.ticker })),
    [checkRows],
  );

  useEffect(() => {
    if (subTab !== "trend") return;
    invalidateSimHistoryCache();
    setTrendHistoryLoading(true);
    void fetchSimHistory()
      .then(setTrendHistory)
      .finally(() => setTrendHistoryLoading(false));
  }, [subTab, lastUpdate]);

  useEffect(() => {
    if (trendSelectedKey && !trendPositions.some((p) => p.key === trendSelectedKey)) {
      setTrendSelectedKey(null);
    }
  }, [trendSelectedKey, trendPositions]);

  const gainPct =
    summary.count > 0 ? Math.round((summary.gainCount / summary.count) * 100) : 0;

  return (
    <>
      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
      </div>

      <div className="sub-tab-group" role="tablist" aria-label="Portfolio views">
        {(
          [
            ["check24h", t("portfolio.views.24h")],
            ["pnl", t("portfolio.views.pnl")],
            ["trend", t("portfolio.views.trend")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={subTab === id}
            className={subTab === id ? "sub-tab-btn active" : "sub-tab-btn"}
            onClick={() => setSubTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "check24h" && (
        <>
          <div className="portfolio-summary-bar card">
            <p>
              {t("portfolio.summary", {
                count: summary.count,
                loss: summary.lossCount,
                gain: summary.gainCount,
              })}
            </p>
            <p className={summary.pnl >= 0 ? "tone-up" : "tone-down"}>
              {t("portfolio.totalPnl")} {fmtEur(summary.pnl)} ({fmtPct(summary.pnlPct)})
            </p>
            <p>
              24h: {fmtEur(summary.pnl24h)} ({fmtPct(summary.pnl24hPct)})
            </p>
          </div>

          <div className="portfolio-table-wrap portfolio-check-wrap">
            <table className="portfolio-check-table">
              <colgroup>
                <col className="pcol-ticker" />
                <col span={5} className="pcol-data" />
              </colgroup>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th title={t("portfolio.check.ppiHint")}>PPI</th>
                  <th title={t("portfolio.check.varHint")}>{t("portfolio.check.var")}</th>
                  <th>ROI</th>
                  <th title={t("portfolio.check.roiTargetHint")}>{t("portfolio.check.roiTarget")}</th>
                  <th>{t("portfolio.check.verdict")}</th>
                </tr>
              </thead>
              <tbody>
                {checkRows.map((r) => (
                  <tr key={r.key} onClick={() => onOpenDetail(r.key)}>
                    <td className="pcol-ticker-cell">{r.ticker}</td>
                    <td>{r.ppi != null ? Math.round(r.ppi) : "—"}</td>
                    <td className="pcol-var-spark">
                      <VariationHorizonSparkline d1={r.mv1d} d7={r.mv1w} m1={r.mv1m} />
                    </td>
                    <td className={r.roiPct != null && r.roiPct >= 0 ? "tone-up" : "tone-down"}>
                      {fmtPct(r.roiPct, 1)}
                    </td>
                    <td className="stack-cell">
                      <span>{r.roiTarget != null ? fmtPct(r.roiTarget, 1) : "—"}</span>
                      {(() => {
                        const sub = fmtRoiTargetSubline(
                          r.roiTargetDays,
                          r.roiTarget,
                          r.pos.capital,
                          lang,
                        );
                        return sub ? <span className="stack-sub">{sub}</span> : null;
                      })()}
                    </td>
                    <td className="verdict-cell stack-cell">
                      <span className={`verdict-badge ${verdictClass(r.verdict)}`}>{r.verdict}</span>
                      {r.verdictProbPct != null ? (
                        <span className="verdict-prob stack-sub">{r.verdictProbPct}%</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subTab === "pnl" && (
        <>
          <div className="pnl-total-gain-card pnl-box-up">
            <div className="pnl-total-gain-head">
              <CrownedPigIcon size={44} />
              <div className="pnl-total-gain-copy">
                <h3 className="pnl-total-gain-title">{t("portfolio.totalGain")}</h3>
                <p className="pnl-hero-value pnl-total-gain-value">
                  <span>{fmtEur(summary.pnl)}</span>{" "}
                  <span>{fmtPct(summary.pnlPct)}</span>
                  <span className="pnl-24h-paren">
                    {" "}
                    ({t("portfolio.gain24h")} {fmtEur(summary.pnl24h)} {fmtPct(summary.pnl24hPct)})
                  </span>
                </p>
              </div>
            </div>
            <p className="pnl-total-gain-meta">
              {fmtEur(summary.capital, 0).replace("+", "")}{" "}
              {t("portfolio.invested")} · {t("portfolio.value")} {fmtEur(summary.value, 0)}
            </p>
            <p className="hint pnl-total-gain-sub">
              {summary.count}/{summary.count} tickers · {t("portfolio.views.24h")}
            </p>
          </div>

          <div className="portfolio-table-wrap">
            <table className="portfolio-pnl-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>CD</th>
                  <th>Total</th>
                  <th>24h</th>
                </tr>
              </thead>
              <tbody>
                {pnlRows.map((r) => (
                  <tr key={r.key} onClick={() => onOpenDetail(r.key)}>
                    <td>{r.ticker}</td>
                    <td className="sim-cd-cell">{r.cd.replace(/^\d{4}-/, "").replace(/-/g, "/")}</td>
                    <td>
                      {fmtPct(r.totalPnlPct, 2)}/{fmtEur(r.totalPnlEur ?? 0)}
                    </td>
                    <td>
                      {fmtPct(r.pnl24hPct, 2)}/{fmtEur(r.pnl24hEur ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint portfolio-pnl-footer">
            {t("portfolio.gainFooter", {
              gain: summary.gainCount,
              loss: summary.lossCount,
              pct: gainPct,
            })}
          </p>
        </>
      )}

      {subTab === "trend" && (
        <MobilePortfolioTrendPanel
          history={trendHistory}
          positions={trendPositions}
          selectedKey={trendSelectedKey}
          onSelectKey={setTrendSelectedKey}
          loading={trendHistoryLoading}
        />
      )}

      {onBack ? <BackButton variant="bottom" onClick={onBack} /> : null}
    </>
  );
}
