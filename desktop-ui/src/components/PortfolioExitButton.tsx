import { useState } from "react";
import type { LossExitDecision } from "../sheet/portfolioLossAnalysis";
import { useT } from "../shared/i18n";
import type { PortfolioSellFailure, PortfolioSellResult } from "../sheet/portfolioSell";
import type { PortfolioSellHandler } from "./PortfolioSellButton";

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

/** Manual close — not the model recommendation (see PlanProbHero / badge). */
export function PortfolioExitButton({
  simKey,
  simRow,
  onSell,
  onSuccess,
  className = "",
  compact = false,
  exitDecision = "review",
}: {
  simKey: string;
  simRow?: Record<string, unknown> | null;
  onSell: PortfolioSellHandler;
  onSuccess?: () => void;
  className?: string;
  compact?: boolean;
  /** When "exit", button is red (urgent). Otherwise neutral "Sell". */
  exitDecision?: LossExitDecision;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const urgent = exitDecision === "exit";

  const runExit = () => {
    setBusy(true);
    try {
      const result = onSell(simKey, simRow ?? null, { confirm: true });
      if (result && !result.ok && result.reason !== "cancelled") {
        const msg = failureMessage(result.reason, t);
        if (msg && typeof window !== "undefined") window.alert(msg);
      }
      if (!result || result.ok) onSuccess?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition hover:brightness-95 disabled:opacity-50 ${
        urgent
          ? "border-[rgb(var(--signal-down))]/40 bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))]"
          : "border-[rgb(var(--border))]/60 bg-surface/80 text-ink-muted hover:text-ink"
      } ${compact ? "text-[9px] px-1.5 py-0" : ""} ${className}`}
      title={t("sim.lossAnalysis.exitSell.title")}
      onClick={(e) => {
        e.stopPropagation();
        runExit();
      }}
    >
      ↩ {t("sim.lossAnalysis.action.sellShares")}
    </button>
  );
}

export type { PortfolioSellHandler, PortfolioSellResult };
