import type { PortfolioScopeMode } from "../sheet/portfolioScope";
import type { PortfolioTableOutlook } from "../sheet/portfolioGainLossStyle";
import {
  portfolioTickerOutlookColor,
  resolvePnlTabCardTone,
  resolveSimulationRowTone,
} from "../sheet/portfolioGainLossStyle";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { StudyTypeTickerIcon, STUDY_DRUG_ICON_PX } from "./StudyTypeTickerIcon";

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

/** Star when 24h manual EIS confirmed a material catalyst (loss or gain). */
export function ManualGainStarMark({
  title = "24h manual EIS — material catalyst confirmed",
  className = "",
  color = "#eab308",
}: {
  title?: string;
  className?: string;
  /** CSS color for ★ (each star in a sequence uses the next palette slot). */
  color?: string;
}) {
  return (
    <span
      className={`leading-none shrink-0 ${className}`}
      style={{ color }}
      title={title}
      aria-label={title}
    >
      ★
    </span>
  );
}

export function GainStarMarks({
  stars,
  max = 1,
  className = "",
  sizeClass = "text-[10px]",
  hiddenSuffix = false,
}: {
  stars: import("../sheet/gainStarLedger").GainStarDisplay[];
  max?: number;
  className?: string;
  sizeClass?: string;
  hiddenSuffix?: boolean;
}) {
  if (!stars.length) return null;
  const shown = stars.length > max ? stars.slice(-max) : stars;
  const hidden = stars.length - shown.length;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {shown.map((s) => (
        <ManualGainStarMark
          key={`${s.date}-${s.colorIndex}`}
          color={s.color}
          className={sizeClass}
          title={`${s.date} · EIS ${s.eisScore >= 0 ? "+" : ""}${s.eisScore.toFixed(1)} · 24h ${s.context}`}
        />
      ))}
      {hiddenSuffix && hidden > 0 ? (
        <span className="text-[8px] opacity-65 tabular-nums">+{hidden}</span>
      ) : null}
    </span>
  );
}

/** Portfolio label: 💼 + study + ticker on one row; company name under. */
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
  manualGainStar = false,
  manualGainStarTitle = "24h manual EIS — material catalyst confirmed",
  gainStars,
  simRow,
  clinicalMeta,
  companyName,
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
  /** ⭐ after 💼 when manual EIS confirms a positive catalyst. */
  manualGainStar?: boolean;
  manualGainStarTitle?: string;
  /** Daily gain stars (colored ★ sequence). */
  gainStars?: import("../sheet/gainStarLedger").GainStarDisplay[];
  simRow?: Record<string, unknown> | null;
  clinicalMeta?: import("../sheet/studyClassifier").ClinicalStudyTextMeta | null;
  /** Company name shown under the ticker (Simulation / Pulse). */
  companyName?: string | null;
}) {
  const company = String(
    companyName?.trim() ||
      (simRow
        ? (simRow["Società"] ??
            simRow["Societa"] ??
            simRow["Nome"] ??
            simRow["Company"] ??
            simRow["Company Name"] ??
            "")
        : ""),
  ).trim();
  const studyIcon = (
    <StudyTypeTickerIcon
      ticker={ticker}
      simRow={simRow}
      clinicalMeta={clinicalMeta}
      size={STUDY_DRUG_ICON_PX}
    />
  );

  const companyNode = company ? (
    <span
      className="block w-full min-w-0 truncate text-[9px] font-normal leading-tight"
      style={{ color: "rgb(var(--ink-muted))" }}
      title={company}
    >
      {company}
    </span>
  ) : null;

  if (!inPortfolio) {
    return (
      <span
        className={`sim-ticker-mark flex flex-col items-start gap-0 min-w-0 max-w-full overflow-hidden ${className}`}
      >
        <span className="flex items-center gap-x-1 min-w-0 max-w-full">
          <span className="inline-flex justify-center shrink-0 w-5">{studyIcon}</span>
          <span className="min-w-0 truncate tabular-nums font-semibold">{ticker}</span>
        </span>
        {companyNode}
      </span>
    );
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
      className="min-w-0 truncate tabular-nums font-bold hover:underline underline-offset-2 cursor-pointer text-left"
      style={{ color: markColor }}
      title={tickerTitle ?? "Open prediction curve"}
    >
      {ticker}
    </button>
  ) : (
    <span className="min-w-0 truncate tabular-nums font-bold" style={{ color: markColor }}>
      {ticker}
    </span>
  );

  const starNodes =
    gainStars && gainStars.length > 0 ? (
      <GainStarMarks stars={gainStars} sizeClass="text-[10px]" />
    ) : manualGainStar ? (
      <ManualGainStarMark title={manualGainStarTitle} />
    ) : null;

  return (
    <span
      className={`sim-ticker-mark flex flex-col items-start gap-0 min-w-0 max-w-full overflow-hidden ${className}`}
      title={onTickerClick ? undefined : portfolioMarkTitle}
    >
      <span className="flex items-center gap-x-0.5 min-w-0 max-w-full leading-tight">
        <span className="inline-flex justify-center shrink-0 w-3.5">
          <PortfolioBriefcaseMark title={portfolioMarkTitle} />
        </span>
        <span className="inline-flex justify-center shrink-0 w-5">{studyIcon}</span>
        {layout === "inline" && starNodes ? (
          <span className="inline-flex items-center gap-0.5 shrink-0">{starNodes}</span>
        ) : null}
        {tickerNode}
        {layout !== "inline" && starNodes ? (
          <span className="inline-flex items-center gap-0.5 shrink-0">{starNodes}</span>
        ) : null}
      </span>
      {companyNode}
    </span>
  );
}
