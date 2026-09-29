/**
 * Catalyst Days page — DeskPageScroll shell + Interest watch + Daily News + HomeSignalsDesk.
 * Soft BUY/SELL unchanged.
 * One Refresh (on the desk) runs Daily News search + catalyst table reload.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HomeSignalsDesk } from "./HomeSignalsDesk";
import {
  CatalystDailyNewsBox,
  type CatalystDailyNewsBoxHandle,
} from "./CatalystDailyNewsBox";
import { CatalystInterestWatchPanel } from "./CatalystInterestWatchPanel";
import { DeskPageScroll } from "./DeskPageScroll";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { useClinicalPreCdRecords } from "../hooks/useClinicalPreCdRecords";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useLang } from "../shared/i18n";
import { DESK_CALENDAR_HORIZON_DAYS } from "../sheet/deskCalendarEvents";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "./LossRiskPoopCell";
import type { CutoffTopKpiFocus } from "./HomeSignalsDesk";

function CatalystCalendarExplainer() {
  const { lang } = useLang();
  const it = lang === "it";
  const n = DESK_CALENDAR_HORIZON_DAYS;
  return (
    <aside
      className="shrink-0 rounded-xl border border-[#F3C451]/25 bg-[rgb(var(--surface))] px-3 py-2.5 space-y-1.5"
      aria-label={it ? "Spiegazione calendario Catalyst" : "Catalyst calendar explainer"}
    >
      <p className="text-[11px] font-semibold text-[#F3C451]">
        {it ? "Calendario Catalyst" : "Catalyst calendar"}
      </p>
      <p className="text-[10px] leading-snug text-[#C5CDDC]">
        {it
          ? `Il comportamento del mercato è monitorato con indici chiari (Trends, volume, momentum, short interest, vs XBI…). Così si vede in anticipo quando il mercato si scalda o si raffredda su una società — fino a ${n} giorni prima della catalyst (periodo sensibile in cui sono attesi gli shift).`
          : `Market behaviour is monitored through clear indices (Trends, volume, momentum, short interest, vs XBI…). That shows early when the market is heating or cooling on a name — up to ${n} days before the catalyst (the sensitive window when shifts are expected).`}
      </p>
      <p className="text-[10px] leading-snug text-ink-muted">
        {it
          ? "Le catalyst sono milestone cliniche e non cliniche in cui è atteso un chiaro avanzamento nello sviluppo di un farmaco — e quindi del valore complessivo della società, soprattutto se ha pochi o nessun prodotto approvato."
          : "Catalysts are clinical and non-clinical milestones where a drug is expected to advance clearly — and with it the company's overall value, especially names with few or no approved products."}
      </p>
    </aside>
  );
}

export function CatalystDaysPage({
  simTable,
  inputs,
  sdsRows,
  chartBundle,
  lossRiskCatalog,
  catalogByRowKey,
  onOpenEvaluationTopKpi,
  onReloadSimulation,
  hasPremium = true,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  sdsRows?: SdsRow[] | null;
  chartBundle?: ChartBundle | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  onOpenEvaluationTopKpi?: (focus: CutoffTopKpiFocus) => void;
  onReloadSimulation?: () => Promise<SheetTable | null> | Promise<void> | void;
  hasPremium?: boolean;
}) {
  const { history } = useInvestSimPortfolioHistory();
  const { records, reload: reloadClinical } = useClinicalPreCdRecords();
  const newsRef = useRef<CatalystDailyNewsBoxHandle>(null);
  /** Paint the desk table first; Interest + Daily News mount on idle. */
  const [auxReady, setAuxReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const show = () => {
      if (!cancelled) setAuxReady(true);
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(show, { timeout: 450 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(show, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const refreshDailyNews = useCallback(async () => {
    await newsRef.current?.refresh();
  }, []);

  const handleInterestEnrolled = useCallback(
    async (_ticker: string) => {
      await reloadClinical?.();
      await onReloadSimulation?.();
      await refreshDailyNews();
    },
    [reloadClinical, onReloadSimulation, refreshDailyNews],
  );

  return (
    <DeskPageScroll data-page="catalyst-days" className="px-3 pt-2 pb-2 gap-2">
      <CatalystCalendarExplainer />
      {auxReady ? (
        <ViewErrorBoundary label="Catalyst Days · News">
          <div className="shrink-0">
            <CatalystDailyNewsBox
              ref={newsRef}
              simRows={(simTable?.rows as Array<Record<string, unknown>> | undefined) ?? null}
              aboveOtherSlot={
                <CatalystInterestWatchPanel
                  embedded
                  hasPremium={hasPremium}
                  onEnrolled={handleInterestEnrolled}
                />
              }
            />
          </div>
        </ViewErrorBoundary>
      ) : (
        <div
          className="shrink-0 h-[8.5rem] rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))]"
          aria-hidden
        />
      )}
      <ViewErrorBoundary label="Catalyst Days · Desk">
        <HomeSignalsDesk
          simTable={simTable}
          inputs={inputs}
          sdsRows={sdsRows ?? []}
          chartBundle={chartBundle ?? null}
          history={history}
          lossRiskCatalog={lossRiskCatalog}
          catalogByRowKey={catalogByRowKey}
          clinicalRecords={records}
          onOpenEvaluationTopKpi={onOpenEvaluationTopKpi}
          onReloadSimulation={onReloadSimulation}
          onExtraRefresh={refreshDailyNews}
        />
      </ViewErrorBoundary>
    </DeskPageScroll>
  );
}

/** @deprecated use CatalystDaysPage */
export { CatalystDaysPage as CatalystDeskView };

