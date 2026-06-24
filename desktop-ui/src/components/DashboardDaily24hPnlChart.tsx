import { useMemo } from "react";
import type { DecisionSimTick } from "../sheet/investDecisionSimLoop";
import {
  buildMissedOppPnlDailySeries,
  type MissedOppDailySnapshot,
} from "../sheet/missedOpportunityAudit";
import {
  buildDecisionSimPnlDailySeries,
  mergeMissedOppDailyWithSimLoop,
  resolveLiveSimLoopTotalPnl,
} from "../sheet/decisionSimPnlDaily";
import { useLang, useT } from "../shared/i18n";
import { MissedOppPnlLineChart } from "./MissedOppPnlLineChart";
import { buildMissedOppPnlLineDefs } from "./missedOppPnlChartLines";

export function DashboardDaily24hPnlChart({
  history,
  ticks,
  livePiggyTotalPnlEur,
  pnlActualEur,
  className,
}: {
  history: MissedOppDailySnapshot[];
  ticks: DecisionSimTick[];
  livePiggyTotalPnlEur: number;
  pnlActualEur: number | null;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const pnlDailyData = useMemo(() => buildMissedOppPnlDailySeries(history), [history]);

  const simPnlDaily = useMemo(() => {
    const liveTotal = resolveLiveSimLoopTotalPnl(ticks, livePiggyTotalPnlEur);
    return buildDecisionSimPnlDailySeries(ticks, liveTotal);
  }, [ticks, livePiggyTotalPnlEur]);

  const pnlDailyWithSim = useMemo(
    () => mergeMissedOppDailyWithSimLoop(pnlDailyData, simPnlDaily),
    [pnlDailyData, simPnlDaily],
  );

  const matchedComparison = useMemo(() => {
    if (!pnlDailyData.length) {
      return {
        matchedDays: pnlActualEur != null ? 1 : 0,
        firstDate: null as string | null,
      };
    }
    return {
      matchedDays: pnlDailyData.length,
      firstDate: pnlDailyData[0]?.date ?? null,
    };
  }, [pnlDailyData, pnlActualEur]);

  const pnlLineDefs = useMemo(() => buildMissedOppPnlLineDefs(t), [t]);

  return (
    <div
      className={`tester-monitor-panel rounded-xl flex flex-col h-full min-h-0 p-2 min-h-[260px] ${className ?? ""}`}
    >
      <div className="shrink-0 space-y-0.5 mb-1">
        <h3 className="text-[10px] font-semibold text-ink">
          {t("modelLab.missedOpp.chartPnlDailyTitle")}
        </h3>
        <p className="text-[8px] text-ink-muted leading-snug">
          {t("modelLab.missedOpp.chartPnlDailySub")}
        </p>
        {matchedComparison.matchedDays > 0 ? (
          <p className="text-[7px] text-ink-muted/90 leading-snug">
            {it ? (
              <>
                Finestra allineata:{" "}
                <span className="tabular-nums">{matchedComparison.matchedDays}</span>{" "}
                giorno/i di snapshot reali
                {matchedComparison.firstDate ? ` dal ${matchedComparison.firstDate}` : ""}. Arancio =
                portfolio reale · blu tratteggiato = sim loop paper.
              </>
            ) : (
              <>
                Matched window:{" "}
                <span className="tabular-nums">{matchedComparison.matchedDays}</span>{" "}
                day(s) of real snapshots
                {matchedComparison.firstDate ? ` since ${matchedComparison.firstDate}` : ""}. Orange =
                actual portfolio · blue dashed = paper sim loop.
              </>
            )}
          </p>
        ) : null}
      </div>

      <div className="flex-1 min-h-[180px] flex flex-col">
        {pnlDailyWithSim.length ? (
          <MissedOppPnlLineChart
            data={pnlDailyWithSim.map((d) => ({
              date: d.date,
              allGainers: d.dayAllGainers,
              simLoop: d.daySimLoop,
              fairRecommendations: d.dayFairRecommendations,
              actual: d.dayActual,
            }))}
            lines={pnlLineDefs}
            fill
            curveType="monotone"
          />
        ) : (
          <p className="text-xs text-ink-muted py-4 text-center flex-1 flex items-center justify-center">
            {t("modelLab.missedOpp.trendPending")}
          </p>
        )}
      </div>
    </div>
  );
}
