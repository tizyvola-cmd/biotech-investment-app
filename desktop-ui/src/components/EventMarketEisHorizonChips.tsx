/**
 * Compact 12h / 24h / 36h market EIS chips for a single event card.
 * Hover tip on EIS label / chips — no static SCORE LEGEND box.
 */
import { eisColor } from "../sheet/eventImpactScore";
import {
  formatEisHorizonScore,
  type EisMarketHorizons,
  type EisMarketHorizonReading,
} from "../sheet/eventMarketEisHorizons";
import { eisScoreLegendCopy, ScoreChipTip } from "./EisScoreLegendHover";

function HorizonChip({
  reading,
}: {
  reading: EisMarketHorizonReading;
}) {
  const label = `${reading.hours}h`;
  if (reading.pending || reading.score == null) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-white/25 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted tabular-nums">
        {label} —
      </span>
    );
  }
  const color = eisColor(reading.score);
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}14`,
      }}
    >
      {label} {formatEisHorizonScore(reading.score)}
    </span>
  );
}

export function EventMarketEisHorizonChips({
  horizons,
  it,
  className,
}: {
  horizons: EisMarketHorizons;
  it: boolean;
  className?: string;
}) {
  const tip = eisScoreLegendCopy(it).eis;
  return (
    <ScoreChipTip tip={tip} align="right" className={className}>
      <span
        className="inline-flex flex-wrap items-center justify-end gap-1 cursor-help"
        aria-label={tip}
      >
        <span className="text-[9px] font-bold uppercase tracking-wide text-ink-muted">EIS</span>
        <HorizonChip reading={horizons.h12} />
        <HorizonChip reading={horizons.h24} />
        <HorizonChip reading={horizons.h36} />
      </span>
    </ScoreChipTip>
  );
}
