import { useT } from "../shared/i18n";
import type { MIGResult } from "../sheet/marketInterestGate";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { MigMarketModelSlopesCard } from "./MigMarketModelSlopesCard";

export function MigMarketModelSlopesDrawer({
  open,
  onClose,
  ticker,
  row,
  pnlPct24h,
  pnlEur24h,
}: {
  open: boolean;
  onClose: () => void;
  ticker: string;
  row: MIGResult | null;
  pnlPct24h?: number | null;
  pnlEur24h?: number | null;
}) {
  const t = useT();

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      align="end"
      aria-label={t("sim.lossAnalysis.miiDrawer.title")}
      panelClassName="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {t("sim.lossAnalysis.miiDrawer.title")} · {ticker.toUpperCase()}
          </p>
          <p className="text-[11px] text-ink-muted leading-snug">
            {t("sim.lossAnalysis.miiDrawer.subtitle")}
          </p>
        </div>
        <AppModalCloseButton onClose={onClose} className="flex h-7 w-7 items-center justify-center" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <MigMarketModelSlopesCard row={row} pnlPct24h={pnlPct24h} pnlEur24h={pnlEur24h} />
      </div>
    </AppModal>
  );
}
