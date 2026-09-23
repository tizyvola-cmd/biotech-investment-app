import type { DecisionRec } from "../decisionChartLogic";
import { change24hEmphasis, change24hTone, formatChange24h } from "../decisionChartFormat";
import { GainStarMarks, ProvisionalGainStar, type GainStarSnapshot } from "../gainStarDisplay";

export type ZoneTickerChip = {
  key: string;
  ticker: string;
  change24h: number | null;
  isRescue?: boolean;
  hasPortfolio?: boolean;
  gainStars?: GainStarSnapshot[];
  showProvisionalStar?: boolean;
};

const ZONE_LABEL: Record<DecisionRec, string> = {
  buy: "BUY",
  hold: "HOLD",
  review: "UNCERTAIN",
  sell: "SELL",
};

type TickerChipProps = {
  ticker: string;
  change24h: number | null;
  isRescue?: boolean;
  zone: DecisionRec;
  onPress: () => void;
};

function TickerChip({
  ticker,
  change24h,
  isRescue,
  hasPortfolio,
  gainStars,
  showProvisionalStar,
  zone,
  onPress,
}: TickerChipProps & { hasPortfolio?: boolean; gainStars?: GainStarSnapshot[]; showProvisionalStar?: boolean }) {
  const tone = change24hTone(change24h);
  const emph = change24hEmphasis(change24h);

  return (
    <button
      type="button"
      className={`dc-ticker-chip dc-ticker-chip--${zone} dc-ticker-chip--${tone}${emph ? " dc-ticker-chip--emph" : ""}${isRescue ? " dc-ticker-chip--rescue" : ""}`}
      onClick={onPress}
    >
      <span className="dc-ticker-chip-symbol">{ticker}</span>
      {hasPortfolio || (gainStars?.length ?? 0) > 0 || showProvisionalStar ? (
        <span className="dc-ticker-chip-marks" aria-hidden>
          {hasPortfolio ? <span className="dc-ticker-chip-portfolio">💼</span> : null}
          {gainStars?.length ? <GainStarMarks stars={gainStars} max={3} className="dc-ticker-chip-stars" /> : null}
          {!gainStars?.length && showProvisionalStar ? (
            <ProvisionalGainStar className="dc-ticker-chip-stars" />
          ) : null}
        </span>
      ) : null}
      <span className={`dc-ticker-chip-var dc-ticker-chip-var--${tone}`}>{formatChange24h(change24h)}</span>
      {isRescue ? <span className="dc-ticker-chip-rescue-dot" aria-hidden /> : null}
    </button>
  );
}

type ZoneCardProps = {
  zone: DecisionRec;
  tickers: ZoneTickerChip[];
  onTickerPress: (key: string) => void;
};

export function DecisionZoneCard({ zone, tickers, onTickerPress }: ZoneCardProps) {
  if (!tickers.length) return null;

  return (
    <section className={`dc-zone-card dc-zone-card--${zone}`}>
      <header className={`dc-zone-header dc-zone-header--${zone}`}>
        <span className={`dc-zone-dot dc-zone-dot--${zone}`} aria-hidden />
        <span className={`dc-zone-label dc-zone-label--${zone}`}>{ZONE_LABEL[zone]}</span>
        <span className={`dc-zone-count dc-zone-count--${zone}`}>{tickers.length}</span>
      </header>
      <div className={`dc-zone-chips dc-zone-chips--${zone}`}>
        {tickers.map((t) => (
          <TickerChip
            key={t.key}
            ticker={t.ticker}
            change24h={t.change24h}
            isRescue={t.isRescue}
            hasPortfolio={t.hasPortfolio}
            gainStars={t.gainStars}
            showProvisionalStar={t.showProvisionalStar}
            zone={zone}
            onPress={() => onTickerPress(t.key)}
          />
        ))}
      </div>
    </section>
  );
}
