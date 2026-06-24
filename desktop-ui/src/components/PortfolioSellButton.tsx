import { useState } from "react";
import { useT } from "../shared/i18n";
import type { PortfolioSellFailure, PortfolioSellResult } from "../sheet/portfolioSell";

export type PortfolioSellHandler = (
  key: string,
  simRow?: Record<string, unknown> | null,
  opts?: { confirm?: boolean },
) => PortfolioSellResult | void;

function failureMessage(
  reason: PortfolioSellFailure,
  t: ReturnType<typeof useT>,
): string {
  switch (reason) {
    case "no_row":
      return t("sim.pnl.sellFailed.noRow");
    case "not_in_portfolio":
      return t("sim.pnl.sellFailed.notInPortfolio");
    case "no_capital":
      return t("sim.pnl.sellFailed.noCapital");
    case "cancelled":
      return "";
    default:
      return t("sim.pnl.sellFailed.generic");
  }
}

export function PortfolioSellButton({
  ticker,
  simKey,
  simRow,
  onSell,
  className = "",
  compact = false,
}: {
  ticker: string;
  simKey: string;
  simRow?: Record<string, unknown> | null;
  onSell: PortfolioSellHandler;
  className?: string;
  /** Smaller padding for dense toolbars. */
  compact?: boolean;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const runSell = (confirm: boolean) => {
    setBusy(true);
    try {
      const result = onSell(simKey, simRow ?? null, { confirm });
      if (result && !result.ok && result.reason !== "cancelled") {
        const msg = failureMessage(result.reason, t);
        if (msg && typeof window !== "undefined") window.alert(msg);
      }
      if (!result || result.ok) setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  if (armed) {
    return (
      <div
        className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}
        role="group"
        aria-label={t("sim.pnl.sellConfirmGroup", { ticker })}
      >
        <button
          type="button"
          className="btn-sell-cancel"
          disabled={busy}
          onClick={() => setArmed(false)}
        >
          {t("sim.pnl.sellCancel")}
        </button>
        <button
          type="button"
          className={`btn-sell ${compact ? "btn-sell-compact" : ""}`}
          disabled={busy}
          onClick={() => runSell(false)}
          title={t("sim.pnl.sellTitle", { ticker })}
        >
          {t("sim.pnl.sellConfirm", { ticker })}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`btn-sell ${compact ? "btn-sell-compact" : ""} ${className}`}
      disabled={busy}
      onClick={() => setArmed(true)}
      title={t("sim.pnl.sellTitle", { ticker })}
    >
      {t("sim.lossAnalysis.action.sellShares")}
    </button>
  );
}
