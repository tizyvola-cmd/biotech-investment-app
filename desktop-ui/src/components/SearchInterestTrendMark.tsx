import type { SearchInterestRow } from "../api/supernova";
import {
  formatSearchInterest1dCell,
  formatSearchInterestCell,
  formatSearchInterestLegCells,
  searchInterest1dTooltip,
  searchInterestLegsTooltip,
  searchInterestToneClass,
  searchInterestTooltip,
  type SearchInterestCell,
} from "../sheet/searchInterestDisplay";

/** Green/red triangle next to the %; width grows with |delta|. */
export function SearchInterestTrendMark({ cell }: { cell: SearchInterestCell }) {
  if (cell.tone === "none" || cell.tone === "flat" || cell.deltaPct == null) {
    return <span>{cell.label}</span>;
  }
  const fat = cell.arrowFat;
  const hw = 2.0 + fat * 3.2;
  const w = Math.round(10 + fat * 6);
  const h = 12;
  const cx = w / 2;
  const up = cell.tone === "up";
  const points = up
    ? `${cx},1.2 ${cx + hw},${h - 1} ${cx - hw},${h - 1}`
    : `${cx},${h - 1.2} ${cx + hw},1 ${cx - hw},1`;
  return (
    <span className="inline-flex items-center gap-0.5">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        aria-hidden
        className="shrink-0"
      >
        <polygon points={points} fill="currentColor" />
      </svg>
      <span>{cell.label}</span>
    </span>
  );
}

/**
 * Primary = daily Δ% (today 3-m). Secondary line = ~24h (`now 1-d`) when present.
 * Soft BUY/SELL unchanged — display only.
 */
export function SearchInterestDualMark({
  row,
  loading,
  ticker,
  it,
  align = "center",
}: {
  row: SearchInterestRow | null | undefined;
  loading: boolean;
  ticker: string;
  it: boolean;
  align?: "center" | "right" | "left";
}) {
  const cell = formatSearchInterestCell(row, loading);
  const cell1d = formatSearchInterest1dCell(row, loading);
  const tip3m = searchInterestTooltip(row, cell, ticker, it, loading);
  const tip1d = searchInterest1dTooltip(row, cell1d, ticker, it, loading);
  const alignCls =
    align === "right" ? "items-end text-right" : align === "left" ? "items-start text-left" : "items-center text-center";
  return (
    <div className={`inline-flex flex-col gap-0.5 leading-tight ${alignCls}`}>
      <span className={`tabular-nums font-semibold ${searchInterestToneClass(cell.tone)}`} title={tip3m}>
        <SearchInterestTrendMark cell={cell} />
      </span>
      {cell1d.tone !== "none" ? (
        <span
          className={`tabular-nums text-[9px] font-semibold ${searchInterestToneClass(cell1d.tone)}`}
          title={tip1d}
        >
          <span className="text-ink-muted font-medium mr-0.5">24h</span>
          <SearchInterestTrendMark cell={cell1d} />
        </span>
      ) : null}
    </div>
  );
}

/** Ticker / company / product Trends stacked in one calendar cell. */
export function SearchInterestLegsStack({
  row,
  loading,
  ticker,
  company,
  product,
  it,
}: {
  row: SearchInterestRow | null | undefined;
  loading: boolean;
  ticker: string;
  company?: string | null;
  product?: string | null;
  it: boolean;
}) {
  const lines = formatSearchInterestLegCells(row, loading, { ticker, company, product }, it);
  const tip = searchInterestLegsTooltip(row, lines, ticker, it, loading);
  const visible = lines.filter((line) => line.cell.tone !== "none");
  const shown = visible.length ? visible : lines.slice(0, 1);
  const cell1d = formatSearchInterest1dCell(row, loading);
  const tip1d = searchInterest1dTooltip(row, cell1d, ticker, it, loading);
  return (
    <div className="flex flex-col gap-0.5 leading-tight" title={tip}>
      {shown.map((line) => (
        <div
          key={line.kind}
          className={`tabular-nums font-semibold ${searchInterestToneClass(line.cell.tone)}`}
        >
          <SearchInterestTrendMark cell={line.cell} />
        </div>
      ))}
      {cell1d.tone !== "none" ? (
        <div
          className={`tabular-nums text-[9px] font-semibold ${searchInterestToneClass(cell1d.tone)}`}
          title={tip1d}
        >
          <span className="text-ink-muted font-medium mr-0.5">24h</span>
          <SearchInterestTrendMark cell={cell1d} />
        </div>
      ) : null}
    </div>
  );
}
