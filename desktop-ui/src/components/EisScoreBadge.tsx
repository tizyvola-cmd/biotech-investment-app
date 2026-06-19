import { summarizeTickerEis } from "../sheet/tickerEisSummary";
import { eisBarPercent, eisColor } from "../sheet/eventImpactScore";

export function EisScoreBadge({
  ticker,
  clinicalKpi,
  it = false,
  compact = false,
  onClick,
  className = "",
}: {
  ticker: string;
  clinicalKpi?: number | null;
  it?: boolean;
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const summary = summarizeTickerEis(ticker, it ? "it" : "en", clinicalKpi);
  const score = summary.score;

  if (score == null || !Number.isFinite(score)) {
    const inner = (
      <span className={`text-[10px] text-ink-muted/70 ${className}`.trim()}>
        EIS —
      </span>
    );
    if (onClick) {
      return (
        <button type="button" onClick={onClick} className="text-left hover:opacity-80">
          {inner}
        </button>
      );
    }
    return inner;
  }

  const color = eisColor(score);
  const w = eisBarPercent(score);
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";
  const feeds =
    summary.feedLabels.length > 0
      ? summary.feedLabels.join(" · ")
      : summary.eventCount > 0
        ? it
          ? `${summary.eventCount} eventi`
          : `${summary.eventCount} events`
        : "";
  const title = [summary.breakdownHint, feeds, onClick ? (it ? "Clicca per dettaglio" : "Click for detail") : ""]
    .filter(Boolean)
    .join(" · ");

  const badge = (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-full ${
        compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"
      } ${onClick ? "hover:ring-2 hover:ring-[rgb(var(--accent))]/25 transition" : ""}`}
      style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
    >
      {arrow} EIS {score >= 0 ? "+" : ""}
      {score.toFixed(1)}
    </span>
  );

  const body = (
    <div className={`min-w-0 ${className}`.trim()} title={title}>
      {onClick ? (
        <button type="button" onClick={onClick} className="text-left">
          {badge}
        </button>
      ) : (
        badge
      )}
      {!compact && (
        <>
          <div className="h-1 bg-slate-200/80 rounded-full mt-1 overflow-hidden max-w-[5.5rem]">
            <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
          </div>
          {feeds ? (
            <p className="text-[9px] text-ink-muted/75 mt-0.5 truncate max-w-[9rem]" title={feeds}>
              {feeds}
            </p>
          ) : null}
        </>
      )}
    </div>
  );

  return body;
}

/** Inline «· EIS +X.X» for compact metric rows. */
export function EisScoreInline({
  ticker,
  clinicalKpi,
  it = false,
  onClick,
}: {
  ticker: string;
  clinicalKpi?: number | null;
  it?: boolean;
  onClick?: () => void;
}) {
  const summary = summarizeTickerEis(ticker, it ? "it" : "en", clinicalKpi);
  const score = summary.score;
  if (score == null || !Number.isFinite(score)) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-[11px] text-ink-muted/70 hover:text-[rgb(var(--accent))] hover:underline"
      >
        EIS —
      </button>
    );
  }
  const color = eisColor(score);
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-semibold tabular-nums hover:underline"
      style={{ color }}
      title={summary.breakdownHint || (it ? "Dettaglio EIS" : "EIS detail")}
    >
      {arrow} EIS {score >= 0 ? "+" : ""}
      {score.toFixed(1)}
    </button>
  );
}
