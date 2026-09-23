import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshButton } from "../components/RefreshButton";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { DecisionRec } from "../decisionChartLogic";
import type { MobileScoreEnrichment } from "../hooks/useMobileScoreEnrichment";
import { suggestedInvestEur } from "../mobileBuySizing";
import { mobileSimCash } from "../mobilePortfolioCash";
import { buildMobileTradeRows, type MobileTradeRow } from "../mobileTradesBuild";
import { GainStarMarks, gainStarsForTicker } from "../gainStarDisplay";
import { daysFromCompletionDate } from "../opportunityLogic";
import type { InvestSimInputs, SheetTable } from "../types";

const CD_SOON_MAX_DAYS = 7;

const REC_ROW_CLASS: Record<DecisionRec, string> = {
  buy: "trades-row--rec-buy",
  hold: "trades-row--rec-hold",
  review: "trades-row--rec-review",
  sell: "trades-row--rec-sell",
};

function formatCdCompact(cd: string): string {
  const trimmed = cd.trim();
  if (!trimmed || trimmed === "—") return "—";
  const slash = trimmed.split("/");
  if (slash.length === 3) {
    const [d, m, y] = slash;
    const yy = y.length >= 2 ? y.slice(-2) : y;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${yy.padStart(2, "0")}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  return trimmed;
}

function fmtRecSizeEur(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `€${rounded}k`;
  }
  return `€${Math.round(abs)}`;
}

function StackedHeader({ lines, align = "center" }: { lines: [string, string]; align?: "left" | "center" }) {
  return (
    <span className={`trades-th-stacked${align === "left" ? " trades-th-stacked--left" : ""}`}>
      <span>{lines[0]}</span>
      <span>{lines[1]}</span>
    </span>
  );
}

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  enrichment: MobileScoreEnrichment;
  startingCapital: number;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  busy?: boolean;
  onRefresh: () => void;
  onOpenOpportunity: (key: string) => void;
  onSaveRow: (key: string, buyPrice: number, capital: number) => void;
};

function TradeInput({
  value,
  disabled,
  onChange,
  onCommit,
  inputMode = "decimal",
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <input
      className="trades-input"
      type="text"
      inputMode={inputMode}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function TradesView({
  sheet,
  inputs,
  dashSnapshot,
  enrichment,
  startingCapital,
  refreshLoading,
  lastUpdate,
  busy = false,
  onRefresh,
  onOpenOpportunity,
  onSaveRow,
}: Props) {
  const { t } = useMobileLang();
  const sizingBase = useMemo(() => {
    const cash = mobileSimCash(inputs, sheet, startingCapital);
    return cash.invested > 0 ? cash.invested : cash.startingCapital;
  }, [inputs, sheet, startingCapital]);
  const rows = useMemo(
    () => buildMobileTradeRows(sheet, inputs, dashSnapshot, enrichment),
    [sheet, inputs, dashSnapshot, enrichment],
  );

  const [drafts, setDrafts] = useState<Record<string, { buy: string; cap: string }>>({});

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, { buy: string; cap: string }> = {};
      for (const row of rows) {
        const existing = prev[row.key];
        next[row.key] = existing ?? {
          buy: row.buyPrice > 0 ? String(row.buyPrice) : row.priceUsd != null ? String(row.priceUsd) : "",
          cap: row.capital > 0 ? String(row.capital) : "",
        };
      }
      return next;
    });
  }, [rows]);

  const commitRow = useCallback(
    (row: MobileTradeRow) => {
      const draft = drafts[row.key];
      if (!draft) return;
      const buy = Number(draft.buy.replace(",", "."));
      const cap = Number(draft.cap.replace(",", "."));
      if (!Number.isFinite(buy) || buy < 0 || !Number.isFinite(cap) || cap < 0) return;
      if (buy === row.buyPrice && cap === row.capital) return;
      onSaveRow(row.key, buy, cap);
    },
    [drafts, onSaveRow],
  );

  return (
    <>
      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
      </div>
      <p className="hint trades-intro">{t("trades.intro")}</p>

      {rows.length === 0 ? (
        <p className="hint">{t("trades.empty")}</p>
      ) : (
        <div className="trades-table-wrap">
          <table className="trades-table">
            <thead>
              <tr>
                <th className="trades-col-ticker">
                  <StackedHeader align="left" lines={[t("trades.col.ticker1"), t("trades.col.ticker2")]} />
                </th>
                <th className="trades-col-cd">{t("trades.col.cd")}</th>
                <th className="trades-col-rb">
                  <StackedHeader lines={[t("trades.col.risk1"), t("trades.col.risk2")]} />
                </th>
                <th className="trades-col-recsize">
                  <StackedHeader lines={[t("trades.col.recSize1"), t("trades.col.recSize2")]} />
                </th>
                <th className="trades-col-buy">{t("trades.col.buy")}</th>
                <th className="trades-col-cap">{t("trades.col.capital")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.key] ?? { buy: "", cap: "" };
                const daysToCd = daysFromCompletionDate(row.cd);
                const cdSoonOpp =
                  !row.inPortfolio &&
                  daysToCd != null &&
                  daysToCd >= 0 &&
                  daysToCd <= CD_SOON_MAX_DAYS;
                const rowClass = REC_ROW_CLASS[row.rec];
                return (
                  <tr key={row.key} className={rowClass}>
                    <td className="trades-col-ticker">
                      <div className="trades-ticker-line">
                        <button type="button" className="trades-ticker-btn" onClick={() => onOpenOpportunity(row.key)}>
                          <strong>{row.ticker}</strong>
                        </button>
                        {row.inPortfolio ? (
                          <span
                            className="trades-portfolio-icon"
                            title={t("trades.inPortfolio")}
                            aria-label={t("trades.inPortfolio")}
                          >
                            💼
                          </span>
                        ) : null}
                        {gainStarsForTicker(dashSnapshot?.gainStarsByTicker, row.ticker).length ? (
                          <GainStarMarks
                            stars={gainStarsForTicker(dashSnapshot?.gainStarsByTicker, row.ticker)}
                            max={3}
                            className="trades-gain-stars"
                          />
                        ) : null}
                      </div>
                      {row.company && row.company !== row.ticker ? (
                        <span className="trades-company">{row.company}</span>
                      ) : null}
                    </td>
                    <td className="trades-col-cd">
                      {cdSoonOpp ? (
                        <span
                          className="trades-cd-star"
                          title={t("trades.cdSoonStar")}
                          aria-label={t("trades.cdSoonStar")}
                        >
                          ★
                        </span>
                      ) : null}
                      {formatCdCompact(row.cd)}
                    </td>
                    <td className="trades-col-rb">
                      <span className="trades-rb-stack">
                        <span className="trades-rb-risk">{row.riskScore ?? "—"}</span>
                        <span className="trades-rb-benefit">{row.benefitScore ?? "—"}</span>
                      </span>
                    </td>
                    <td className="trades-col-recsize">
                      {row.recSizePct != null ? (
                        <span className="trades-recsize-stack">
                          <span className="trades-recsize-eur">
                            {fmtRecSizeEur(suggestedInvestEur(sizingBase, row.recSizePct))}
                          </span>
                          <span className="trades-recsize-pct">{row.recSizePct}%</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="trades-col-buy">
                      <TradeInput
                        value={draft.buy}
                        disabled={busy}
                        onChange={(buy) => setDrafts((d) => ({ ...d, [row.key]: { ...draft, buy } }))}
                        onCommit={() => commitRow(row)}
                      />
                    </td>
                    <td className="trades-col-cap">
                      <TradeInput
                        value={draft.cap}
                        disabled={busy}
                        inputMode="numeric"
                        onChange={(cap) => setDrafts((d) => ({ ...d, [row.key]: { ...draft, cap } }))}
                        onCommit={() => commitRow(row)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
