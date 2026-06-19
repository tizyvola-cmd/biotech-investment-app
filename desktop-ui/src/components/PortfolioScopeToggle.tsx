import type { PortfolioScopeMode } from "../sheet/portfolioScope";
import type { PortfolioTableOutlook } from "../sheet/portfolioGainLossStyle";
import {
  portfolioTickerOutlookColor,
  resolvePnlTabCardTone,
  resolveSimulationRowTone,
} from "../sheet/portfolioGainLossStyle";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";

export function PortfolioScopeToggle({
  mode,
  onModeChange,
  counts,
  it,
}: {
  mode: PortfolioScopeMode;
  onModeChange: (m: PortfolioScopeMode) => void;
  counts: { total: number; portfolio: number; watch: number };
  it: boolean;
}) {
  const items: { id: PortfolioScopeMode; label: string; tip: string }[] = [
    {
      id: "all",
      label: it ? `Tutte (${counts.total})` : `All (${counts.total})`,
      tip: it ? "Tutti i ticker Simulation con feed AI" : "All Simulation tickers with AI feed",
    },
    {
      id: "portfolio",
      label: it ? `Portfolio (${counts.portfolio})` : `Portfolio (${counts.portfolio})`,
      tip: it
        ? "Solo società con posizione aperta (capitale > 0)"
        : "Only tickers with an open position (capital > 0)",
    },
    {
      id: "watch",
      label: it ? `To Watch (${counts.watch})` : `To Watch (${counts.watch})`,
      tip: it
        ? "Ticker in Simulation senza posizione attiva"
        : "Simulation tickers without an active position",
    },
  ];

  return (
    <SelectionChipGroup>
      {items.map(({ id, label, tip }) => (
        <SelectionChip
          key={id}
          active={mode === id}
          title={tip}
          onClick={() => onModeChange(id)}
        >
          {id === "portfolio" && (
            <span className="mr-0.5" style={{ color: mode === id ? "inherit" : "rgb(var(--signal-up))" }}>
              💼
            </span>
          )}
          {label}
        </SelectionChip>
      ))}
    </SelectionChipGroup>
  );
}

/** Briefcase mark for portfolio scope / real positions. */
export function PortfolioBriefcaseMark({
  title = "Portfolio position",
  className = "",
}: {
  title?: string;
  className?: string;
}) {
  return (
    <span className={`text-[11px] leading-none shrink-0 ${className}`} title={title} aria-hidden>
      💼
    </span>
  );
}

/** Portfolio label: ticker colorato + 💼 (ranking maialino in colonna Gain vs loss). */
export function PortfolioTickerMark({
  ticker,
  inPortfolio,
  pnlPct,
  pnlEur,
  pnlEur24h: _pnlEur24h,
  pnlPct24h: _pnlPct24h,
  pnlUnavailable: _pnlUnavailable,
  slope5d,
  slope20d,
  tableOutlook,
  className = "",
  layout = "stacked",
  onTickerClick,
  tickerTitle,
  portfolioMarkTitle = "Portfolio position",
}: {
  ticker: string;
  inPortfolio: boolean;
  pnlPct?: number | null;
  pnlEur?: number | null;
  pnlEur24h?: number | null;
  pnlPct24h?: number | null;
  pnlUnavailable?: boolean;
  slope5d?: number | null;
  slope20d?: number | null;
  /** Outlook riga tabella (curva) — prioritario sul colore P&L. */
  tableOutlook?: PortfolioTableOutlook | null;
  className?: string;
  layout?: "stacked" | "inline";
  /** Apre curva Prediction + recalibration per questo ticker. */
  onTickerClick?: () => void;
  tickerTitle?: string;
  portfolioMarkTitle?: string;
}) {
  if (!inPortfolio) {
    return <span className={className}>{ticker}</span>;
  }
  const tone =
    pnlEur != null || pnlPct != null
      ? resolvePnlTabCardTone(pnlEur, pnlPct)
      : resolveSimulationRowTone({
          inPortfolio: true,
          pnlEur,
          pnlPct,
          slope5d,
          slope20d,
        });
  const markColor =
    tableOutlook && tableOutlook !== "flat"
      ? portfolioTickerOutlookColor(tableOutlook)
      : tone === "loss"
        ? "rgb(var(--signal-down))"
        : tone === "gain"
          ? "rgb(var(--signal-up))"
          : "rgb(var(--ink))";

  const tickerNode = onTickerClick ? (
    <button
      type="button"
      onClick={onTickerClick}
      className="truncate tabular-nums max-w-full font-bold hover:underline underline-offset-2 cursor-pointer text-left"
      style={{ color: markColor }}
      title={tickerTitle ?? "Open prediction curve"}
    >
      {ticker}
    </button>
  ) : (
    <span className="truncate tabular-nums max-w-full">{ticker}</span>
  );

  if (layout === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1 font-bold leading-tight ${className}`}
        style={{ color: markColor }}
        title={onTickerClick ? undefined : portfolioMarkTitle}
      >
        <PortfolioBriefcaseMark title={portfolioMarkTitle} />
        {tickerNode}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex flex-col items-center gap-0.5 font-bold leading-tight ${className}`}
      style={{ color: markColor }}
      title={onTickerClick ? undefined : portfolioMarkTitle}
    >
      {tickerNode}
      <PortfolioBriefcaseMark title={portfolioMarkTitle} />
    </span>
  );
}
