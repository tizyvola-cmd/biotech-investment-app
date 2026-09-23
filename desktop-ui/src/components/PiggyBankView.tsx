import { useCallback, useEffect, useMemo, useState } from "react";
import type { SimulationNavFocus } from "../sheet/investSimStorage";
import type { InvestmentSimulationViewProps } from "./InvestmentSimulationView";
import { InvestmentSimulationView } from "./InvestmentSimulationView";
import { InvestmentSimOutcomesPanel } from "./InvestmentSimOutcomesPanel";
import { useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

type PiggyBankTab = "pnl" | "simPortfolio";

export type PiggyBankViewProps = Omit<InvestmentSimulationViewProps, "initialView"> & {
  initialTab?: PiggyBankTab | "trend";
  onInitialTabConsumed?: () => void;
};

function tabBtn(active: boolean) {
  return `rounded-md px-3 py-1.5 text-sm transition ${
    active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
  }`;
}

function normalizeTab(tab: PiggyBankTab | "trend" | undefined): PiggyBankTab {
  if (tab === "simPortfolio") return "simPortfolio";
  return "pnl";
}

/** Piggy Bank — P&L · Sim portfolio (Trend tab removed). */
export function PiggyBankView(props: PiggyBankViewProps) {
  const {
    initialTab,
    onInitialTabConsumed,
    focusTicker,
    onFocusConsumed,
    ...simProps
  } = props;

  const t = useT();
  const [tab, setTab] = useState<PiggyBankTab>(() => normalizeTab(initialTab));

  useEffect(() => {
    if (!initialTab) return;
    setTab(normalizeTab(initialTab));
    onInitialTabConsumed?.();
  }, [initialTab, onInitialTabConsumed]);

  // Incoming focus: daily ledger / snapshot → P&L (Trend chart retired).
  useEffect(() => {
    if (!focusTicker) return;
    if (focusTicker.openDailyLedger) {
      setTab("pnl");
      return;
    }
    const v = focusTicker.view;
    if (v === "snapshotBar" || v === "trendChart" || v === "lossAnalysis") setTab("pnl");
  }, [focusTicker]);

  const handleOpenDailyLedger = useCallback(() => {
    setTab("pnl");
  }, []);

  const simulationFocus = useMemo<SimulationNavFocus | null>(() => {
    if (!focusTicker) return null;
    if (tab === "pnl") {
      const view =
        focusTicker.view === "trendChart" ? "lossAnalysis" : focusTicker.view ?? "lossAnalysis";
      return { ...focusTicker, view: view === "snapshotBar" ? "lossAnalysis" : view };
    }
    return focusTicker;
  }, [focusTicker, tab]);

  return (
    <section className="card piggy-bank-view flex flex-col flex-1">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">{t("piggyBank.page.title")}</h2>
          <p className="text-xs text-ink-muted">{t("piggyBank.page.subtitle")}</p>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap items-center">
          <button type="button" className={tabBtn(tab === "pnl")} onClick={() => setTab("pnl")}>
            {t("piggyBank.tab.pnl")}
          </button>
          <button
            type="button"
            className={tabBtn(tab === "simPortfolio")}
            onClick={() => setTab("simPortfolio")}
          >
            {t("piggyBank.tab.simPortfolio")}
          </button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {tab === "pnl" && (
          <div key="piggy-pnl" className="flex flex-col flex-1 min-h-0 min-w-0">
            <ViewErrorBoundary label="Piggy Bank · P&L">
              <InvestmentSimulationView
                {...simProps}
                initialView="lossAnalysis"
                focusTicker={simulationFocus}
                onFocusConsumed={onFocusConsumed}
              />
            </ViewErrorBoundary>
          </div>
        )}

        {tab === "simPortfolio" && (
          <div className="flex flex-col flex-1 min-h-0 pr-1 p-4">
            <ViewErrorBoundary label="Piggy Bank · Sim portfolio">
              <InvestmentSimOutcomesPanel
                simTable={simProps.simTable ?? null}
                onOpenDailyPnlLedger={handleOpenDailyLedger}
              />
            </ViewErrorBoundary>
          </div>
        )}
      </div>
    </section>
  );
}
