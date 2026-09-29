import { useMemo } from "react";
import { BackButton } from "./BackButton";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { DecisionChartTickerRow, DecisionRec } from "../decisionChartLogic";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileScoreEnrichment } from "../hooks/useMobileScoreEnrichment";
import { resolveMobileDecisionRow } from "../mobileDecisionChartBuild";
import { suggestedInvestEur, suggestedInvestPctForBuy } from "../mobileBuySizing";
import { mobileSimCash } from "../mobilePortfolioCash";
import { fmtEur, fmtPct, fmtUsd, pred5FromRow, type SimulationPosition } from "../simLogic";
import { getNasdaqStatus } from "../marketHours";
import type { InvestSimInputs, SheetTable } from "../types";

type VerdictKey = "detail.verdict.drop" | "detail.verdict.rise" | "detail.verdict.flat" | "detail.verdict.watch";

type Props = {
  rowKey: string;
  row: Record<string, unknown>;
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  enrichment: MobileScoreEnrichment;
  startingCapital: number;
  pos: SimulationPosition | undefined;
  detailBuy: string;
  detailCap: string;
  setDetailBuy: (v: string) => void;
  setDetailCap: (v: string) => void;
  busy: boolean;
  err: string | null;
  msg: string | null;
  backLabel?: string;
  onBack: () => void;
  onSave: () => void;
  onClose: () => void;
};

const REC_LABEL: Record<DecisionRec, string> = {
  buy: "BUY",
  hold: "HOLD",
  review: "UNCERTAIN",
  sell: "SELL",
};

function resolveDecisionRow(
  rowKey: string,
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): DecisionChartTickerRow | null {
  return resolveMobileDecisionRow(rowKey, sheet, inputs, snapshot, enrichment);
}

function findNum(r: Record<string, unknown>, kws: string[]): number | null {
  for (const kw of kws) {
    const col = Object.keys(r).find((c) => c.toLowerCase().includes(kw.toLowerCase()));
    if (!col) continue;
    const raw = r[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").replace(/%/g, ""));
    if (Number.isFinite(n)) return Math.abs(n) <= 1.5 ? n * 100 : n;
  }
  return null;
}

function verdictKey(pnlPct: number, mv24: number | null): VerdictKey {
  if (mv24 != null && mv24 <= -2) return "detail.verdict.drop";
  if (mv24 != null && mv24 >= 2) return "detail.verdict.rise";
  if (Math.abs(pnlPct) < 0.5) return "detail.verdict.flat";
  return "detail.verdict.watch";
}

export function DetailScreen({
  rowKey,
  row,
  sheet,
  inputs,
  dashSnapshot,
  enrichment,
  startingCapital,
  pos,
  detailBuy,
  detailCap,
  setDetailBuy,
  setDetailCap,
  busy,
  err,
  msg,
  backLabel,
  onBack,
  onSave,
  onClose,
}: Props) {
  const { t } = useMobileLang();
  const p = pos;
  const hasPosition = (p?.capital ?? 0) > 0;
  const cash = useMemo(() => mobileSimCash(inputs, sheet, startingCapital), [inputs, sheet, startingCapital]);
  const decisionRow = useMemo(
    () => resolveDecisionRow(rowKey, sheet, inputs, dashSnapshot, enrichment),
    [rowKey, sheet, inputs, dashSnapshot, enrichment],
  );
  const rec = decisionRow?.rec ?? "review";
  const recSizePct = rec === "buy" && decisionRow ? suggestedInvestPctForBuy(decisionRow.scores) : null;
  const recSizeEur =
    recSizePct != null ? suggestedInvestEur(cash.invested > 0 ? cash.invested : cash.startingCapital, recSizePct) : null;
  const currPrice = p?.currPrice ?? null;
  const pred5 = pred5FromRow(row);
  const prob = findNum(row, ["recovery", "p(rec", "prob rec"]);
  const ppi = findNum(row, ["ppi", "plan prob"]);
  const roiTarget = findNum(row, ["roi target", "target roi"]);
  const mv24 = findNum(row, ["var. giorn", "var giorn"]);
  const verdictCode = p ? verdictKey(p.pnlPct, mv24) : null;
  const verdictLabel = verdictCode ? t(verdictCode) : "—";
  const verdictClass = verdictCode ? verdictCode.replace("detail.verdict.", "") : "";
  const slope = findNum(row, ["mii slope", "slope"]);

  const useCurrentPrice = () => {
    if (currPrice != null && currPrice > 0) setDetailBuy(String(currPrice));
  };

  const marketStatus = useMemo(() => getNasdaqStatus(), []);
  const marketOpen = marketStatus.open;
  const typedBuyNum = Number(detailBuy.replace(",", "."));
  const typedBuyValid = Number.isFinite(typedBuyNum) && typedBuyNum > 0;
  const priceMismatchPct =
    typedBuyValid && currPrice != null && currPrice > 0
      ? Math.abs(typedBuyNum - currPrice) / currPrice
      : 0;
  const showMarketClosedNotice = !hasPosition && !marketOpen && currPrice != null && currPrice > 0;
  const showMismatchWarn = !hasPosition && marketOpen && priceMismatchPct > 0.01 && currPrice != null;

  return (
    <main className="app-main detail-screen">
      <BackButton label={backLabel} onClick={onBack} />

      <div className="detail-header-block">
        <h1 className="detail-ticker">{p?.ticker ?? String(row.Ticker)}</h1>
        <p className="detail-company">{hasPosition ? p?.name || String(row.Nome ?? "") : `CD ${p?.completionDate ?? "—"}`}</p>
        {hasPosition ? (
          <span className={`verdict-badge verdict-${verdictClass}`}>{verdictLabel}</span>
        ) : null}
      </div>

      {err ? <p className="msg err">{err}</p> : null}
      {msg ? <p className="msg ok">{msg}</p> : null}

      <section className="card detail-capital-card">
        <div className="detail-capital-grid">
          <div>
            <span className="detail-metric-label">{t("detail.capitalInvested")}</span>
            <strong>{fmtEur(cash.invested, 0)}</strong>
          </div>
          <div>
            <span className="detail-metric-label">{t("detail.capitalAvailable")}</span>
            <strong className={cash.available < 0 ? "tone-down" : "tone-up"}>{fmtEur(cash.available, 0)}</strong>
          </div>
          <div>
            <span className="detail-metric-label">{t("detail.recommendation")}</span>
            <span className={`decision-rec-badge rec-${rec}`}>{REC_LABEL[rec]}</span>
          </div>
          <div>
            <span className="detail-metric-label">{t("detail.recSize")}</span>
            <strong>
              {recSizePct != null ? (
                <>
                  {recSizePct}%
                  {recSizeEur != null ? ` · ${fmtEur(recSizeEur, 0)}` : null}
                </>
              ) : (
                "—"
              )}
            </strong>
          </div>
        </div>
      </section>

      {hasPosition ? (
        <>
          <div className="detail-metrics-row">
            <div>
              <span className="detail-metric-label">{t("detail.pRecovery")}</span>
              <strong>{prob != null ? `${Math.round(prob)}%` : "—"}</strong>
            </div>
            <div>
              <span className="detail-metric-label">{t("detail.action")}</span>
              <strong>{t("detail.holdAction")}</strong>
            </div>
          </div>

          <div className="detail-reading-grid card">
            <div>
              <span>{t("detail.portfolioEntry")}</span>
              <strong className={p!.pnlPct >= 0 ? "tone-up" : "tone-down"}>{fmtPct(p!.pnlPct)}</strong>
            </div>
            <div>
              <span>{t("detail.lastReading")}</span>
              <strong>{mv24 != null ? `${fmtPct(mv24)} / ${fmtUsd((p!.capital * mv24) / 100)}` : "—"}</strong>
            </div>
            <div>
              <span>{t("detail.tradingDay")}</span>
              <strong className={p!.pnlPct >= 0 ? "tone-up" : "tone-down"}>
                {fmtPct(p!.pnlPct)} / {fmtUsd(p!.pnlEur)}
              </strong>
            </div>
          </div>

          <section className="card detail-section">
            <h2>{t("detail.gainIdeaTitle")}</h2>
            <p className="detail-gain-idea">
              {t("detail.gainInProgress", {
                amount: `${p!.pnlEur >= 0 ? "+" : ""}${fmtUsd(Math.abs(p!.pnlEur)).replace("$ ", "€ ")}`,
              })}
            </p>
            <p className="hint">
              {t("detail.targetRoiHint", {
                roi: fmtPct(roiTarget),
                ppi: ppi != null ? String(Math.round(ppi)) : "—",
                capital: fmtUsd(p!.capital, 0),
              })}
            </p>
          </section>

          <section className="card detail-section">
            <h2>{t("detail.slopeModelTitle")}</h2>
            <p className="detail-slope-line">
              {t("detail.slopeModelLine", {
                slope: slope != null ? `${slope.toFixed(1)}°` : "—",
                ppi: ppi != null ? String(Math.round(ppi)) : "—",
                roi: fmtPct(roiTarget),
              })}
            </p>
          </section>
        </>
      ) : null}

      <div className="card detail-form-card">
        <h2>{hasPosition ? t("detail.editSim") : t("detail.addSim")}</h2>
        {!hasPosition ? <p className="hint detail-form-hint">{t("detail.formHint")}</p> : null}
        {showMarketClosedNotice ? (
          <div className="detail-market-closed-notice" role="note">
            <strong>{t("detail.marketClosedTitle")}</strong>
            <p className="hint">
              {t("detail.marketClosedHint", { price: fmtUsd(currPrice!) })}
            </p>
          </div>
        ) : null}
        <div className="field detail-field">
          <label>{t("detail.buyPrice")}</label>
          <input
            className="detail-touch-input"
            inputMode="decimal"
            value={detailBuy}
            onChange={(e) => setDetailBuy(e.target.value)}
            placeholder={currPrice ? String(currPrice) : "0"}
          />
          {!hasPosition && currPrice != null && currPrice > 0 ? (
            <button type="button" className="link-btn detail-quick-fill" onClick={useCurrentPrice}>
              {t("detail.useCurrentPrice", { price: fmtUsd(currPrice) })}
            </button>
          ) : null}
          {showMismatchWarn ? (
            <div className="detail-price-mismatch-warn" role="alert">
              <span>
                {t("detail.priceMismatchWarn", {
                  price: fmtUsd(currPrice!),
                  diff: `${(priceMismatchPct * 100).toFixed(1)}%`,
                })}
              </span>
              <button type="button" className="link-btn" onClick={useCurrentPrice}>
                {t("detail.priceMismatchAck")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="field detail-field">
          <label>{t("detail.capital")}</label>
          <input
            className="detail-touch-input"
            inputMode="decimal"
            value={detailCap}
            onChange={(e) => setDetailCap(e.target.value)}
            placeholder={t("detail.capitalPlaceholder")}
          />
        </div>
        <div className="btn-row detail-btn-row">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={onSave}>
            {busy ? "…" : hasPosition ? t("detail.saveChanges") : t("detail.addSim")}
          </button>
          {hasPosition ? (
            <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={onClose}>
              {t("detail.closePosition")}
            </button>
          ) : null}
        </div>
      </div>

      {!hasPosition ? (
        <div className="card">
          <h2>{t("detail.summary")}</h2>
          <div className="metric-grid metric-grid-compact">
            <div>
              <span>{t("detail.marketPrice")}</span>
              <strong>{fmtUsd(currPrice)}</strong>
            </div>
            <div>
              <span>{t("detail.pred5")}</span>
              <strong className={pred5 != null && pred5 >= 0 ? "tone-up" : "tone-down"}>
                {pred5 != null ? fmtPct(pred5) : t("detail.notAvailable")}
              </strong>
            </div>
          </div>
        </div>
      ) : null}

      <section className="card detail-section detail-desktop-note">
        <p className="hint">{t("detail.desktopNote")}</p>
      </section>

      <BackButton variant="bottom" onClick={onBack} />
    </main>
  );
}
