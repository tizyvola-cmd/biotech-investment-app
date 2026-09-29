import { useMemo } from "react";
import { useT } from "../shared/i18n";
import type { PortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import { PortfolioDailyPnlLedgerTable } from "./PortfolioDailyPnlLedgerTable";
import { ClosedPiggyBankBeerGlass } from "./ClosedPiggyBankBeerGlass";
import { useClosedPiggyBank } from "../hooks/useClosedPiggyBank";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { computePortfolioCashFlow } from "../sheet/experimentCashFlow";
import { loadUiPrefsLocal } from "../sheet/uiPrefs";

/** Icona griglia giornaliera (non refresh). */
export function DailyLedgerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.25" />
      <path d="M2.5 6h11M2.5 10h11M6 6v7.5M10 2.5v11" />
    </svg>
  );
}

export function PortfolioDailyPnlDrawer({
  open,
  onClose,
  ledger,
}: {
  open: boolean;
  onClose: () => void;
  ledger: PortfolioDailyPnlLedger | null;
}) {
  const t = useT();
  const { display, reset } = useClosedPiggyBank(ledger);
  const openCapitalEur = useMemo(() => {
    if (!ledger?.rows) return 0;
    return ledger.rows
      .filter((r) => !r.archived)
      .reduce((sum, r) => sum + (Number.isFinite(r.capital) ? r.capital : 0), 0);
  }, [ledger]);
  const cashFlow = useMemo(() => {
    const pref = loadUiPrefsLocal();
    const budget = pref.topCapitalPortfolio ?? pref.topCapital;
    const starting =
      budget != null && Number.isFinite(budget) && budget > 0 ? budget : 50_000;
    return computePortfolioCashFlow(ledger, openCapitalEur, starting);
  }, [ledger, openCapitalEur]);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      align="end"
      aria-label={t("sim.pnl.ledger.title")}
      panelClassName="flex h-full !max-h-none w-full max-w-5xl flex-col overflow-hidden border-l border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{t("sim.pnl.ledger.title")}</p>
          <p className="text-[11px] text-ink-muted leading-snug">{t("sim.pnl.ledger.subtitle")}</p>
        </div>
        <AppModalCloseButton onClose={onClose} className="h-7 w-7 px-0" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
        <ClosedPiggyBankBeerGlass
          display={display}
          onReset={reset}
          reinvestedEur={cashFlow.gainsRecycledInOpenEur}
          openFromBudgetEur={cashFlow.capitalNotFromGainsEur}
          gainsCashEur={
            cashFlow.gainsRecycledInOpenEur <= 0.5
              ? Math.max(0, display.pnlEur)
              : Math.max(0, display.pnlEur - cashFlow.gainsRecycledInOpenEur)
          }
        />
        <PortfolioDailyPnlLedgerTable ledger={ledger} windowResetToken={open} />
      </div>
    </AppModal>
  );
}
