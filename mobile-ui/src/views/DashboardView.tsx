import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshButton } from "../components/RefreshButton";
import { ThemeToggle } from "../components/ThemeToggle";
import { MobilePortfolioAllocationPie } from "../components/MobilePortfolioAllocationPie";
import { PContWindCell } from "../components/PContWindCell";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { MobileTheme } from "../hooks/useTheme";
import type { MobileScoreEnrichment } from "../hooks/useMobileScoreEnrichment";
import { enrichRecommendationRows } from "../mobileActionsTable";
import {
  buildMobileDashOpenPositions,
  type MobileDashOpenPosRow,
  type MobileDashWindRow,
} from "../mobileDashWindTable";
import {
  isSnapshotStale,
  recommendationsForMode,
  snapshotAgeLabel,
} from "../mobileDashboard";
import {
  pushRecSignalNotification,
  type RecSignalSnapshot,
} from "../mobileRecSignalBanner";
import {
  applyMobileVisitDeltas,
  buildMobileVisitBaselineFromLive,
  captureMobileVisitBaseline,
  saveMobileVisitLeaveSnapshot,
  type MobileVisitBaseline,
} from "../mobileVisitBaseline";
import { SoftSignalsBookPanel } from "../components/SoftSignalsBookPanel";
import { UrgentSellBanner } from "../components/UrgentSellBanner";
import { RedBellAlertModal } from "../components/RedBellAlertModal";
import {
  buildUrgentSellItemsFromSnapshot,
  saveUrgentSellAck,
  urgentSellNeedsBanner,
} from "../mobileUrgentSellBanner";
import {
  buildRedBellAlertItems,
  pushRedBellNotification,
  redBellNeedsAlert,
  saveRedBellAck,
} from "../mobileRiskAlerts";
import {
  pulseTickerGivebackBell,
  sumOpenWinsEur,
} from "../pulseLossOfWinsBell";
import { fmtEur, fmtPct } from "../simLogic";
import type { ChartBundle, InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  enrichment: MobileScoreEnrichment;
  chartBundle?: ChartBundle | null;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  theme: MobileTheme;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenDetail: (key: string) => void;
  /** Soft BUY / Soft SELL chip → sim trade sheet. */
  onOpenRecTrade: (key: string, side: "buy" | "sell") => void;
  /** Per-email book — ignore operator Pulse openPositions in the snapshot. */
  useTesterBook?: boolean;
  /** Logged-in email — same account as desktop for this companion session. */
  linkedEmail?: string | null;
};

function normalizeAction(action: string): string {
  return action.trim().toUpperCase();
}

function isBuyAction(action: string): boolean {
  const a = normalizeAction(action);
  return a === "BUY" || a === "COMPRA";
}

function isSellAction(action: string): boolean {
  const a = normalizeAction(action);
  return a === "SELL" || a === "VENDI";
}

function LossOfWinsBell({
  lossEur,
  totalWinsEur,
  it,
  givebackPctOfPeak,
  peakEur,
  purchasedPlusGainsEur,
}: {
  lossEur: number;
  totalWinsEur: number;
  it: boolean;
  givebackPctOfPeak?: number | null;
  peakEur?: number | null;
  purchasedPlusGainsEur?: number | null;
}) {
  const base = purchasedPlusGainsEur ?? peakEur;
  const title =
    givebackPctOfPeak != null && base != null
      ? it
        ? `Campanella: giveback ${givebackPctOfPeak.toFixed(0)}% del G/L vinto — base ${fmtEur(base, 0)} (auto-sell book = G2 20%)`
        : `Bell: giveback ${givebackPctOfPeak.toFixed(0)}% of G/L won — base ${fmtEur(base, 0)} (book auto-sell = G2 20%)`
      : (() => {
          const sharePct =
            totalWinsEur > 0 ? (Math.abs(lossEur) / totalWinsEur) * 100 : 0;
          return it
            ? `Campanella: giveback ${fmtEur(lossEur, 0)} = ${sharePct.toFixed(0)}% del G/L vinto (auto-sell book = G2 20%)`
            : `Bell: giveback ${fmtEur(lossEur, 0)} = ${sharePct.toFixed(0)}% of G/L won (book auto-sell = G2 20%)`;
        })();
  return (
    <span className="dash-loss-wins-bell" title={title} aria-label={title} role="img">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path
          fill="currentColor"
          d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm6.4-6.2V11a6.4 6.4 0 0 0-5.1-6.25V4.2a1.3 1.3 0 1 0-2.6 0v.55A6.4 6.4 0 0 0 5.6 11v4.8L4 17.4v.8h16v-.8l-1.6-1.6Z"
        />
      </svg>
    </span>
  );
}

export function DashboardView({
  sheet,
  inputs,
  dashSnapshot,
  enrichment: _enrichment,
  chartBundle,
  refreshLoading,
  lastUpdate,
  theme,
  onToggleTheme,
  onRefresh,
  onOpenDetail,
  onOpenRecTrade,
  useTesterBook = false,
  linkedEmail = null,
}: Props) {
  const { lang, t } = useMobileLang();
  const it = lang === "it";

  const openKeysInBook = useMemo(() => {
    const keys = new Set<string>();
    for (const [k, e] of Object.entries(inputs)) {
      if (e && !e.ignoreSheet && (e.capital ?? 0) > 0 && (e.buyPrice ?? 0) > 0) {
        keys.add(k);
      }
    }
    return keys;
  }, [inputs]);

  const actionRows = useMemo(() => {
    const raw = recommendationsForMode(dashSnapshot, "all");
    const chartPts = new Map<string, import("../types").ChartPoint[]>();
    if (chartBundle?.series) {
      for (const [k, series] of Object.entries(chartBundle.series)) {
        if (series?.points?.length) chartPts.set(k, series.points);
      }
    }
    return enrichRecommendationRows(raw, sheet, inputs, {
      chartPointsByKey: chartPts,
      lang,
    });
  }, [dashSnapshot, sheet, inputs, chartBundle, lang]);

  /** Desktop Home Soft SELL list — empty array means "None now". */
  const hasOpsSoftLists =
    Array.isArray(dashSnapshot?.softBuys) && Array.isArray(dashSnapshot?.softSells);

  const buyRows = useMemo(() => {
    // Soft BUY = off-book suggestions (same list as desktop Home).
    const notInBook = (key: string) => !openKeysInBook.has(key);
    if (hasOpsSoftLists) {
      const ops = (dashSnapshot!.softBuys ?? []).filter((b) => notInBook(b.key));
      if (!ops.length) return [];
      return enrichRecommendationRows(
        ops.map((b) => ({
          key: b.key,
          ticker: b.ticker,
          action: "BUY",
          probPct: null,
          reason: "soft_buy_ops",
          readingPct: null,
          planReturnPct: null,
          profile: "opportunity" as const,
          daysToCd: null,
        })),
        sheet,
        inputs,
        { lang },
      ).sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return actionRows
      .filter((r) => isBuyAction(r.action) && notInBook(r.key))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [hasOpsSoftLists, dashSnapshot, actionRows, sheet, inputs, lang, openKeysInBook]);

  const sellRows = useMemo(() => {
    // Soft SELL only for positions in THIS email’s open book (same as desktop account).
    const inBook = (key: string) => openKeysInBook.has(key);
    if (hasOpsSoftLists) {
      const ops = (dashSnapshot!.softSells ?? []).filter((s) => inBook(s.key));
      if (!ops.length) return [];
      return enrichRecommendationRows(
        ops.map((s) => ({
          key: s.key,
          ticker: s.ticker,
          action: "SELL",
          probPct: null,
          reason: s.tag ? `ops_${s.tag}` : "soft_sell_ops",
          readingPct: null,
          planReturnPct: null,
          profile: "portfolio" as const,
          daysToCd: null,
        })),
        sheet,
        inputs,
        { lang },
      ).sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    const fromSnap = actionRows.filter((r) => isSellAction(r.action) && inBook(r.key));
    const byKey = new Map(fromSnap.map((r) => [r.key, r]));
    return [...byKey.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [hasOpsSoftLists, dashSnapshot, actionRows, sheet, inputs, lang, openKeysInBook]);

  const recActionByKey = useMemo(() => {
    const m = new Map<string, string>();
    if (hasOpsSoftLists) {
      const sellKeys = new Set((dashSnapshot?.softSells ?? []).map((s) => s.key));
      for (const r of actionRows) {
        if (sellKeys.has(r.key)) m.set(r.key, "SELL");
        else if (isSellAction(r.action) || isBuyAction(r.action)) m.set(r.key, "HOLD");
        else m.set(r.key, r.action);
      }
      for (const s of dashSnapshot?.softSells ?? []) m.set(s.key, "SELL");
    } else {
      for (const r of actionRows) m.set(r.key, r.action);
    }
    return m;
  }, [actionRows, hasOpsSoftLists, dashSnapshot]);

  const openRowsRaw = useMemo(
    () =>
      buildMobileDashOpenPositions(
        sheet,
        inputs,
        recActionByKey,
        lang,
        !hasOpsSoftLists,
        useTesterBook ? null : dashSnapshot?.openPositions,
        useTesterBook ? null : dashSnapshot?.allocation,
      ),
    [
      sheet,
      inputs,
      recActionByKey,
      lang,
      hasOpsSoftLists,
      useTesterBook,
      dashSnapshot?.openPositions,
      dashSnapshot?.allocation,
    ],
  );

  /** Shared Pulse snapshot fields are operator-only — hide for per-email books. */
  const bookDashSnapshot = useMemo(() => {
    if (!useTesterBook || !dashSnapshot) return dashSnapshot;
    return {
      ...dashSnapshot,
      openPositions: undefined,
      allocation: undefined,
      priorDayBook: undefined,
      investSimInputs: inputs,
    };
  }, [useTesterBook, dashSnapshot, inputs]);

  /** Freeze open MTM at companion enter — desktop snapshot Δ is often stuck at €0. */
  const visitBaselineRef = useRef<MobileVisitBaseline | null | undefined>(undefined);
  const [visitBaseline, setVisitBaseline] = useState<MobileVisitBaseline | null>(null);
  useEffect(() => {
    if (!openRowsRaw.length) return;
    if (visitBaselineRef.current !== undefined) return;
    const live = openRowsRaw.map((r) => ({ key: r.key, pnlEur: r.pnlEur }));
    const baseline = captureMobileVisitBaseline(live);
    visitBaselineRef.current = baseline;
    setVisitBaseline(baseline);
  }, [openRowsRaw]);

  useEffect(() => {
    const persistLeave = () => {
      if (!openRowsRaw.length) return;
      saveMobileVisitLeaveSnapshot(buildMobileVisitBaselineFromLive(
        openRowsRaw.map((r) => ({ key: r.key, pnlEur: r.pnlEur })),
      ));
    };
    /**
     * Persist on real leave only. Avoid visibilitychange while the dashboard
     * stays mounted (desktop browser / PWA alt-tab) — that overwrote the prior
     * visit baseline with live MTM and zeroed Δ on the next open.
     * `pagehide` covers mobile background / tab discard.
     */
    window.addEventListener("pagehide", persistLeave);
    return () => {
      window.removeEventListener("pagehide", persistLeave);
      persistLeave();
    };
  }, [openRowsRaw]);

  const openRows: MobileDashOpenPosRow[] = useMemo(
    () => applyMobileVisitDeltas(openRowsRaw, visitBaseline),
    [openRowsRaw, visitBaseline],
  );

  const totalOpenWinsEur = useMemo(() => sumOpenWinsEur(openRows), [openRows]);

  const urgentSellItems = useMemo(() => {
    const openByKey = new Map(
      openRows.map((r) => [
        r.key,
        { capitalEur: r.invested, pnlEur: r.pnlEur },
      ]),
    );
    const openKeySet = new Set(openByKey.keys());
    if (hasOpsSoftLists) {
      return buildUrgentSellItemsFromSnapshot({
        softSells: (dashSnapshot?.softSells ?? []).filter((s) => openKeySet.has(s.key)),
        openByKey,
      });
    }
    return buildUrgentSellItemsFromSnapshot({
      softSells: sellRows.map((r) => ({
        key: r.key,
        ticker: r.ticker,
        tag: null,
        capitalEur: openByKey.get(r.key)?.capitalEur ?? null,
        pnlEur: openByKey.get(r.key)?.pnlEur ?? null,
      })),
      openByKey,
    });
  }, [hasOpsSoftLists, dashSnapshot?.softSells, sellRows, openRows]);

  const signalSnap: RecSignalSnapshot = useMemo(
    () => ({
      buyKeys: [],
      sellKeys: sellRows.map((r) => r.key),
    }),
    [sellRows],
  );

  const [urgentSellOpen, setUrgentSellOpen] = useState(false);
  const [redBellOpen, setRedBellOpen] = useState(false);
  const lastPushSigRef = useRef<string>("");
  const lastRedBellPushSigRef = useRef<string>("");

  const redBellItems = useMemo(() => {
    // Tester book builds opens from local inputs (no peak history) — borrow peaks
    // from the desktop-published snapshot so red-bell alerts still fire.
    const peakByKey = new Map<string, number>();
    for (const p of dashSnapshot?.openPositions ?? []) {
      if (
        p?.key &&
        p.peakPnlEur != null &&
        Number.isFinite(p.peakPnlEur) &&
        p.peakPnlEur > 0
      ) {
        peakByKey.set(p.key, p.peakPnlEur);
      }
    }
    const enriched = openRows.map((r) => ({
      ...r,
      peakPnlEur: r.peakPnlEur ?? peakByKey.get(r.key) ?? null,
      capitalEur: r.invested,
    }));
    return buildRedBellAlertItems(enriched);
  }, [openRows, dashSnapshot?.openPositions]);

  useEffect(() => {
    const showUrgent = urgentSellNeedsBanner(urgentSellItems);
    setUrgentSellOpen(showUrgent);
    if (showUrgent) {
      void pushRecSignalNotification(
        { buyKeys: [], sellKeys: urgentSellItems.map((i) => i.key) },
        it,
      );
      return;
    }
    // Soft BUY alerts removed — push only for Soft/Urgent SELL on this email’s book.
    if (!signalSnap.sellKeys.length) return;
    const sig = signalSnap.sellKeys.slice().sort().join(",");
    if (sig === lastPushSigRef.current) return;
    lastPushSigRef.current = sig;
    void pushRecSignalNotification(signalSnap, it);
  }, [signalSnap, urgentSellItems, it]);

  useEffect(() => {
    const show = redBellNeedsAlert(redBellItems);
    setRedBellOpen(show);
    if (!show) return;
    const sig = redBellItems
      .map((i) => i.key)
      .sort()
      .join("|");
    if (sig === lastRedBellPushSigRef.current) return;
    lastRedBellPushSigRef.current = sig;
    void pushRedBellNotification(redBellItems, it);
  }, [redBellItems, it]);

  const dismissUrgentSell = () => {
    saveUrgentSellAck(urgentSellItems);
    setUrgentSellOpen(false);
  };

  const dismissRedBell = () => {
    saveRedBellAck(redBellItems);
    setRedBellOpen(false);
  };

  const syncLabel = snapshotAgeLabel(dashSnapshot?.updated_at, lang);
  const syncStale = isSnapshotStale(dashSnapshot?.updated_at);

  return (
    <>
      {redBellOpen && redBellItems.length > 0 ? (
        <RedBellAlertModal
          items={redBellItems}
          onClose={dismissRedBell}
          onOpenTicker={(key) => onOpenDetail(key)}
        />
      ) : null}

      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
        {syncLabel ? (
          <span className={`snapshot-age${syncStale ? " snapshot-age--stale" : ""}`}>{syncLabel}</span>
        ) : null}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      {linkedEmail ? (
        <p className="dash-email-link" title={t("dashboard.emailLink.tip")}>
          <span className="dash-email-link-kicker">{t("dashboard.emailLink.kicker")}</span>
          <strong className="dash-email-link-addr">{linkedEmail}</strong>
        </p>
      ) : null}

      {urgentSellOpen && urgentSellItems.length > 0 ? (
        <UrgentSellBanner
          items={urgentSellItems}
          onDismiss={dismissUrgentSell}
          onSell={(key) => {
            dismissUrgentSell();
            onOpenRecTrade(key, "sell");
          }}
        />
      ) : null}

      <SoftSignalsBookPanel
        buyRows={buyRows}
        sellRows={sellRows}
        priorDayBook={bookDashSnapshot?.priorDayBook}
        onOpenBuy={(k) => onOpenRecTrade(k, "buy")}
        onOpenSell={(k) => onOpenRecTrade(k, "sell")}
      />

      <section className="card dash-open-card">
        <header className="dash-section-head">
          <h3>{t("dashboard.open.title", { n: openRows.length })}</h3>
          <p className="hint">
            {t("dashboard.open.sub")} ·{" "}
            {linkedEmail
              ? t("dashboard.book.emailHint", { email: linkedEmail })
              : t("dashboard.book.sharedHint")}
          </p>
        </header>
        {openRows.length === 0 ? (
          <p className="hint">{t("dashboard.open.empty")}</p>
        ) : (
          <div className="dash-open-table-wrap dash-open-table-wrap--compact">
            <table className="dash-open-table dash-open-table--compact">
              <thead>
                <tr>
                  <th>{t("dashboard.open.colTicker")}</th>
                  <th>{t("dashboard.open.colMove")}</th>
                  <th>{t("dashboard.open.colRec")}</th>
                  <th>{t("dashboard.open.colWind")}</th>
                  <th>{t("dashboard.open.colInvested")}</th>
                  <th>{t("dashboard.open.colPnl")}</th>
                </tr>
              </thead>
              <tbody>
                {openRows.map((row) => {
                  const rec = (row.recAction ?? "HOLD").toUpperCase();
                  const recCls =
                    rec === "BUY" || rec === "COMPRA"
                      ? "dash-open-rec--buy"
                      : rec === "SELL" || rec === "VENDI"
                        ? "dash-open-rec--sell"
                        : "dash-open-rec--hold";
                  const windAsRow: MobileDashWindRow = {
                    key: row.key,
                    ticker: row.ticker,
                    inPortfolio: true,
                    d1: row.d1,
                    d7: null,
                    m1: null,
                    g10: null,
                    pCont: row.pCont,
                    contBand: null,
                    windKind: row.windKind,
                  };
                  const pnlCls =
                    row.pnlEur == null ? "" : row.pnlEur >= 0 ? "tone-up" : "tone-down";
                  const d24 = row.pnlPct24h ?? row.d1;
                  const d24Cls =
                    d24 == null ? "" : d24 > 0.05 ? "tone-up" : d24 < -0.05 ? "tone-down" : "";
                  const dVisit = row.deltaPnlEurSinceVisit;
                  const dVisitCls =
                    dVisit == null
                      ? ""
                      : dVisit > 0.5
                        ? "tone-up"
                        : dVisit < -0.5
                          ? "tone-down"
                          : "";
                  const giveback = pulseTickerGivebackBell(
                    row.pnlEur,
                    row.peakPnlEur,
                    undefined,
                    undefined,
                    { investedAt: row.investedAt, capitalEur: row.invested },
                  );
                  const showLossBell = giveback.hit;
                  return (
                    <tr key={row.key} onClick={() => onOpenDetail(row.key)}>
                      <td className="dash-open-td-ticker">
                        <button
                          type="button"
                          className="dash-open-ticker"
                          onClick={() => onOpenDetail(row.key)}
                        >
                          <strong>{row.ticker}</strong>
                          {showLossBell && row.pnlEur != null ? (
                            <LossOfWinsBell
                              lossEur={row.pnlEur}
                              totalWinsEur={totalOpenWinsEur}
                              it={it}
                              givebackPctOfPeak={giveback.givebackPctOfPeak}
                              peakEur={giveback.peakEff}
                              purchasedPlusGainsEur={giveback.purchasedPlusGainsEur}
                            />
                          ) : null}
                        </button>
                        <div className="dash-open-meta">
                          {row.daysToCd != null
                            ? `T${row.daysToCd >= 0 ? "−" : "+"}${Math.abs(row.daysToCd)}d`
                            : "—"}
                        </div>
                      </td>
                      <td className="tabular-nums dash-open-td-move">
                        <div className={d24Cls}>
                          {d24 != null
                            ? `${d24 >= 0 ? "+" : ""}${d24.toFixed(1)}%`
                            : "—"}
                        </div>
                        <div className={`dash-open-meta ${dVisitCls}`}>
                          {dVisit != null ? fmtEur(dVisit, 0) : "—"}
                        </div>
                      </td>
                      <td className="dash-open-td-rec">
                        <span className={`dash-open-rec ${recCls}`}>
                          {rec === "BUY" || rec === "COMPRA"
                            ? "BUY"
                            : rec === "SELL" || rec === "VENDI"
                              ? "SELL"
                              : "HOLD"}
                        </span>
                      </td>
                      <td className="dash-open-td-wind">
                        <PContWindCell
                          windKind={windAsRow.windKind}
                          pCont={row.pCont}
                          it={it}
                        />
                      </td>
                      <td className="tabular-nums dash-open-td-inv">
                        <div>{fmtEur(row.invested, 0)}</div>
                        <div className="dash-open-meta">
                          {row.weightPct != null ? `${row.weightPct.toFixed(1)}%` : "—"}
                        </div>
                      </td>
                      <td className={`tabular-nums dash-open-td-pnl ${pnlCls}`}>
                        <div>{row.pnlEur != null ? fmtEur(row.pnlEur, 0) : "—"}</div>
                        <div className="dash-open-meta">
                          {row.pnlPct != null ? fmtPct(row.pnlPct) : "—"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MobilePortfolioAllocationPie
        sheet={sheet}
        inputs={inputs}
        dashSnapshot={bookDashSnapshot}
        openRows={openRows}
        onOpenDetail={onOpenDetail}
      />
    </>
  );
}
