import { useMemo } from "react";
import {
  formatPriceVariationPct,
  getDeltaLabel,
  maxAbsPctForWindows,
  windowDelta,
  type PriceWindowData,
} from "../mobilePriceVariation";

const BAR_MAX = 64;
const BAR_MAX_COMPACT = 50;
const TICKER_POS = "#2a78d6";
const TICKER_NEG = "#185FA5";
const MARKET_FILL = "rgba(195, 194, 183, 0.72)";

type Props = {
  ticker: string;
  windows: PriceWindowData[];
  marketLabel?: string;
  compact?: boolean;
};

function barHeight(pct: number | null, maxAbs: number, barMax = BAR_MAX): number {
  if (pct == null || !Number.isFinite(pct) || maxAbs <= 0) return 0;
  return Math.max(2, Math.min(barMax, (Math.abs(pct) / maxAbs) * barMax));
}

function DualBarCell({
  data,
  maxAbs,
  marketLabel,
  barMax,
}: {
  data: PriceWindowData;
  maxAbs: number;
  marketLabel: string;
  barMax: number;
}) {
  const tickerH = barHeight(data.tickerChange, maxAbs, barMax);
  const marketH = barHeight(data.marketChange, maxAbs, barMax);
  const tickerUp = (data.tickerChange ?? 0) >= 0;
  const marketUp = (data.marketChange ?? 0) >= 0;
  const tickerColor = tickerUp ? TICKER_POS : TICKER_NEG;
  const tickerTone = tickerUp ? "tone-up" : "tone-down";

  return (
    <div className="mob-pv-col">
      <span className="mob-pv-win">{data.window}</span>
      <div className="mob-pv-col-labels">
        <span>T</span>
        <span>{marketLabel.slice(0, 3)}</span>
      </div>
      <div className="mob-pv-bars" style={{ height: barMax * 2 + 4 }}>
        <div className="mob-pv-baseline" />
        <div className="mob-pv-bar-group">
          <div className="mob-pv-bar-slot">
            {data.tickerChange != null && tickerH > 0 ? (
              <div
                className="mob-pv-bar mob-pv-bar-ticker"
                style={{
                  height: tickerH,
                  background: tickerColor,
                  ...(tickerUp ? { bottom: barMax + 2 } : { top: barMax + 2 }),
                }}
              />
            ) : (
              <div className="mob-pv-bar mob-pv-bar-empty" />
            )}
          </div>
          <div className="mob-pv-bar-slot">
            {data.marketChange != null && marketH > 0 ? (
              <div
                className="mob-pv-bar mob-pv-bar-market"
                style={{
                  height: marketH,
                  background: MARKET_FILL,
                  ...(marketUp ? { bottom: barMax + 2 } : { top: barMax + 2 }),
                }}
              />
            ) : (
              <div className="mob-pv-bar mob-pv-bar-empty" />
            )}
          </div>
        </div>
      </div>
      <span className={`mob-pv-ticker-pct ${tickerTone}`}>
        {formatPriceVariationPct(data.tickerChange)}
      </span>
    </div>
  );
}

function SummaryBadge({ windowKey, delta }: { windowKey: string; delta: number | null }) {
  if (delta == null) {
    return <span className="mob-pv-badge mob-pv-badge--inline">{windowKey} —</span>;
  }
  const info = getDeltaLabel(delta);
  const cls =
    info.style === "out" ? "mob-pv-badge--out" : info.style === "under" ? "mob-pv-badge--under" : "mob-pv-badge--inline";
  const text =
    info.style === "inline"
      ? `${windowKey} ~mkt`
      : `${windowKey} ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`;
  return <span className={`mob-pv-badge ${cls}`}>{text}</span>;
}

export function MobilePriceVariationChart({ ticker, windows, marketLabel = "XBI", compact = false }: Props) {
  const maxAbs = useMemo(() => maxAbsPctForWindows(windows), [windows]);
  const barMax = compact ? BAR_MAX_COMPACT : BAR_MAX;

  const summaryWindows = useMemo(
    () => windows.filter((w) => w.window === "1D" || w.window === "7D" || w.window === "1M"),
    [windows],
  );

  return (
    <div className={`mob-pv-chart${compact ? " mob-pv-chart--compact" : ""}`} aria-label={`${ticker} vs ${marketLabel}`}>
      <div className="mob-pv-grid">
        {windows.map((w) => (
          <DualBarCell key={w.window} data={w} maxAbs={maxAbs} marketLabel={marketLabel} barMax={barMax} />
        ))}
      </div>
      <div className="mob-pv-badges">
        {summaryWindows.map((w) => (
          <SummaryBadge
            key={w.window}
            windowKey={w.window}
            delta={windowDelta(w.tickerChange, w.marketChange)}
          />
        ))}
      </div>
    </div>
  );
}

export { mostSignificantDeltaPreview } from "../mobilePriceVariation";
