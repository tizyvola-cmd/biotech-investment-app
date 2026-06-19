import type { ClosedSuccessMetrics, TodaySuccessMetrics } from "../sheet/portfolioSuccessBridge";
import { useT } from "../shared/i18n";

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("it-IT")} €`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "sky" | "amber";
  title?: string;
}) {
  const color =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "sky"
          ? "text-sky-700 dark:text-sky-300"
          : accent === "amber"
            ? "text-amber-700 dark:text-amber-300"
            : "";
  return (
    <div
      className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-3 py-2 min-w-0"
      title={title}
    >
      <p className="text-[9px] uppercase tracking-wide text-ink-muted leading-tight">{label}</p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${color}`}>{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted mt-0.5 leading-snug">{sub}</p> : null}
    </div>
  );
}

/** Due orizzonti allineati: chiusure vs oggi — stesso pannello su Performance e Diversificazione. */
export function PortfolioSuccessBridgePanel({
  closed,
  today,
}: {
  closed: ClosedSuccessMetrics | null;
  today: TodaySuccessMetrics | null;
}) {
  const t = useT();

  if (!closed && !today) return null;

  return (
    <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.04] p-3 space-y-3">
      <div>
        <h4 className="text-[11px] font-semibold text-ink">{t("modelLab.successBridge.title")}</h4>
        <p className="text-[10px] text-ink-muted leading-relaxed mt-0.5 max-w-3xl">
          {t("modelLab.successBridge.lead")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800/80 dark:text-indigo-200/90">
            {t("modelLab.successBridge.closedHorizon")}
          </p>
          {closed ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label={t("modelLab.successBridge.closedWinRate")}
                  value={fmtPct(closed.winRatePct)}
                  sub={t("modelLab.successBridge.closedWinSub", {
                    wins: closed.winCount,
                    losses: closed.lossCount,
                    n: closed.sampleSize,
                  })}
                  accent={
                    closed.winRatePct == null
                      ? undefined
                      : closed.winRatePct >= 50
                        ? "up"
                        : closed.winRatePct < 35
                          ? "down"
                          : "amber"
                  }
                  title={t("modelLab.successBridge.closedWinTip")}
                />
                <MetricCard
                  label={t("modelLab.successBridge.closedExpectancy")}
                  value={fmtEur(closed.expectancyEurPerTrade)}
                  sub={t("modelLab.successBridge.closedExpectancySub")}
                  accent={
                    closed.expectancyEurPerTrade == null
                      ? undefined
                      : closed.expectancyEurPerTrade >= 0
                        ? "up"
                        : "down"
                  }
                  title={t("modelLab.successBridge.closedExpectancyTip")}
                />
              </div>
              {closed.realizedDailyPnlEur != null ? (
                <MetricCard
                  label={t("modelLab.successBridge.closedRealizedDaily")}
                  value={fmtEur(closed.realizedDailyPnlEur)}
                  sub={t("modelLab.successBridge.closedRealizedDailySub")}
                  accent={closed.realizedDailyPnlEur >= 0 ? "up" : "down"}
                />
              ) : null}
              {closed.lowSample ? (
                <p className="text-[9px] text-amber-700 dark:text-amber-300 leading-snug">
                  {t("modelLab.diversify.lowSample", { n: closed.sampleSize })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[10px] text-ink-muted italic">{t("modelLab.successBridge.closedEmpty")}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800/80 dark:text-sky-200/90">
            {t("modelLab.successBridge.todayHorizon")}
          </p>
          {today ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label={t("modelLab.missedOpp.kpiDeltaActual")}
                  value={fmtEur(today.pnlActualEur)}
                  sub={t("modelLab.successBridge.todayActualSub")}
                  accent={
                    today.pnlActualEur == null
                      ? undefined
                      : today.pnlActualEur >= 0
                        ? "up"
                        : "down"
                  }
                  title={t("modelLab.successBridge.todayActualTip")}
                />
                <MetricCard
                  label={t("modelLab.missedOpp.kpiCaptureRateFair")}
                  value={fmtPct(today.capturePctFair ?? today.capturePct)}
                  sub={t("modelLab.missedOpp.kpiCaptureFairHint")}
                  accent="sky"
                  title={t("modelLab.successBridge.todayCaptureFairTip")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label={t("modelLab.missedOpp.kpiGapVsFairRec")}
                  value={fmtEur(today.gapVsFairRecEur ?? today.gapVsRecEur)}
                  sub={
                    today.pnlFairRecommendationsEur != null
                      ? t("modelLab.successBridge.todayFairRecSub", {
                          eur: fmtEur(today.pnlFairRecommendationsEur),
                        })
                      : t("modelLab.missedOpp.kpiGapFairHint")
                  }
                  title={t("modelLab.successBridge.todayGapFairTip")}
                />
                <MetricCard
                  label={t("modelLab.missedOpp.kpiGapVsRec")}
                  value={fmtEur(today.gapVsRecEur)}
                  sub={
                    today.pnlRecommendationsEur != null
                      ? t("modelLab.successBridge.todayRecSub", {
                          eur: fmtEur(today.pnlRecommendationsEur),
                        })
                      : t("modelLab.missedOpp.kpiGapHint")
                  }
                  title={t("modelLab.successBridge.todayGapTip")}
                />
              </div>
              {today.daysTracked < 2 ? (
                <p className="text-[9px] text-ink-muted leading-snug">
                  {t("modelLab.successBridge.todayHistoryShort", { n: today.daysTracked })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[10px] text-ink-muted italic">{t("modelLab.successBridge.todayEmpty")}</p>
          )}
        </div>
      </div>

      <p className="text-[9px] text-ink-muted/85 leading-relaxed border-t border-[rgb(var(--border))]/30 pt-2">
        {t("modelLab.successBridge.footer")}
      </p>
    </div>
  );
}
