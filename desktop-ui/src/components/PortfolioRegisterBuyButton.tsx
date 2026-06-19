import { useState } from "react";
import { useT } from "../shared/i18n";

export type PortfolioRegisterBuyHandler = (key: string) => void;

/** Register an off-portfolio opportunity as an open Simulation position (capital + buy price). */
export function PortfolioRegisterBuyButton({
  ticker,
  simKey,
  capitalEur,
  onRegisterBuy,
  className = "",
  compact = false,
}: {
  ticker: string;
  simKey: string;
  capitalEur: number;
  onRegisterBuy: PortfolioRegisterBuyHandler;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const runRegister = () => {
    const eur = Math.round(capitalEur);
    const ok = window.confirm(
      t("sim.lossAnalysis.registerBuy.confirm", {
        ticker: ticker.toUpperCase(),
        eur: eur.toLocaleString("en-US"),
      }),
    );
    if (!ok) return;
    setBusy(true);
    try {
      onRegisterBuy(simKey);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition hover:brightness-95 disabled:opacity-50 border-[rgb(var(--signal-up))]/40 bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))] hover:bg-[rgb(var(--signal-up))]/18 ${
        compact ? "text-[9px] px-1.5 py-0" : ""
      } ${className}`}
      title={t("sim.lossAnalysis.registerBuy.title")}
      onClick={(e) => {
        e.stopPropagation();
        runRegister();
      }}
    >
      + {t("sim.lossAnalysis.registerBuy.label")}
    </button>
  );
}
