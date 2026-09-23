import type { RecommendationCall } from "../sheet/recommendationContributions";
import {
  callAccent,
  gapStripBounds,
  nearestThresholdGap,
  scorePositionZone,
  spectrumPct,
} from "../sheet/decisionSpectrumLayout";

export type DecisionSpectrumProps = {
  score: number;
  sellThreshold: number;
  buyThreshold: number;
  call: RecommendationCall;
  subtitle?: string;
  min?: number;
  max?: number;
  it?: boolean;
};

const CALL_LABEL: Record<RecommendationCall, [string, string]> = {
  BUY: ["Buy", "Buy"],
  HOLD: ["Hold", "Hold"],
  SELL: ["Sell", "Sell"],
  REVIEW: ["Incerto", "Uncertain"],
};

function accentClasses(accent: ReturnType<typeof callAccent>) {
  switch (accent) {
    case "sell":
      return {
        pill: "border-negative/60 text-ink",
        needle: "bg-negative",
        zoneBg: "bg-negative/18 dark:bg-negative/22",
        zoneText: "text-negative",
        gap: "text-negative",
      };
    case "buy":
      return {
        pill: "border-positive/60 text-ink",
        needle: "bg-positive",
        zoneBg: "bg-positive/18 dark:bg-positive/22",
        zoneText: "text-positive",
        gap: "text-positive",
      };
    case "hold":
      return {
        pill: "border-accent/60 text-ink",
        needle: "bg-accent",
        zoneBg: "bg-accent/18 dark:bg-accent/22",
        zoneText: "text-accent",
        gap: "text-accent",
      };
    default:
      return {
        pill: "border-[rgb(var(--warn))]/60 text-ink",
        needle: "bg-[rgb(var(--warn))]",
        zoneBg: "bg-[rgb(var(--warn))]/15 dark:bg-[rgb(var(--warn))]/20",
        zoneText: "text-[rgb(var(--warn))]",
        gap: "text-[rgb(var(--warn))]",
      };
  }
}

export function DecisionSpectrum({
  score,
  sellThreshold,
  buyThreshold,
  call,
  subtitle,
  min = 0,
  max = 100,
  it = false,
}: DecisionSpectrumProps) {
  const roundedScore = Math.round(score);
  const roundedSell = Math.round(sellThreshold);
  const roundedBuy = Math.round(buyThreshold);

  const scorePct = spectrumPct(roundedScore, min, max);
  const sellPct = spectrumPct(roundedSell, min, max);
  const buyPct = spectrumPct(roundedBuy, min, max);

  const scoreZone = scorePositionZone(roundedScore, roundedSell, roundedBuy);
  const accent = callAccent(call, scoreZone);
  const cls = accentClasses(accent);
  const nearest = nearestThresholdGap(roundedScore, roundedSell, roundedBuy);
  const nearestPct =
    nearest.target === "buy"
      ? buyPct
      : nearest.target === "sell"
        ? sellPct
        : scoreZone === "buy"
          ? buyPct
          : sellPct;
  const strip = gapStripBounds(scorePct, nearestPct);

  const gapColorClass =
    nearest.target === "buy"
      ? "text-positive"
      : nearest.target === "sell"
        ? "text-negative"
        : "text-accent";

  const stripColorClass =
    nearest.target === "buy"
      ? "bg-positive/70"
      : nearest.target === "sell"
        ? "bg-negative/70"
        : "bg-accent/70";

  const gapText =
    nearest.target === "buy"
      ? it
        ? `+${nearest.points} per Buy`
        : `+${nearest.points} to reach Buy`
      : nearest.target === "sell"
        ? it
          ? `−${nearest.points} per Sell`
          : `−${nearest.points} to reach Sell`
        : scoreZone === "buy"
          ? it
            ? `−${nearest.points} per Hold`
            : `−${nearest.points} to reach Hold`
          : it
            ? `+${nearest.points} per Hold`
            : `+${nearest.points} to reach Hold`;

  const callLabel = it ? CALL_LABEL[call][0] : CALL_LABEL[call][1];

  const zoneLabels = {
    sell: it ? "sell" : "sell",
    hold: it ? "hold" : "hold",
    buy: it ? "buy" : "buy",
  };

  const positionNote =
    scoreZone === "sell"
      ? it
        ? `P(plan) ${roundedScore} sotto soglia Sell (${roundedSell})`
        : `P(plan) ${roundedScore} below Sell threshold (${roundedSell})`
      : scoreZone === "buy"
        ? it
          ? `P(plan) ${roundedScore} sopra soglia Buy (${roundedBuy})`
          : `P(plan) ${roundedScore} above Buy threshold (${roundedBuy})`
        : it
          ? `P(plan) ${roundedScore} tra ${roundedSell} e ${roundedBuy}`
          : `P(plan) ${roundedScore} between ${roundedSell} and ${roundedBuy}`;

  const scoreBannerBorder =
    scoreZone === "sell"
      ? "border-negative"
      : scoreZone === "buy"
        ? "border-positive"
        : "border-accent";

  const scoreBannerText =
    scoreZone === "sell"
      ? "text-negative"
      : scoreZone === "buy"
        ? "text-positive"
        : "text-accent";

  return (
    <div className="decision-spectrum space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
        {it ? "Spettro decisione" : "Decision spectrum"}
      </p>

      {/* Track */}
      <div className="relative h-10 rounded-md border border-[rgb(var(--border))]/50 overflow-visible">
        {/* Gap strip along top edge → nearest threshold */}
        <div
          className={`absolute top-0 h-1 z-10 rounded-t-md ${stripColorClass}`}
          style={{ left: `${strip.left}%`, width: `${strip.width}%` }}
        />

        <div className="absolute inset-0 rounded-md overflow-hidden">
          {/* Three shaded zones — rosso / azzurro / verde */}
          <div
            className="absolute inset-y-0 left-0 bg-negative/30 dark:bg-negative/38"
            style={{ width: `${sellPct}%` }}
          />
          <div
            className="absolute inset-y-0 bg-accent/32 dark:bg-accent/40"
            style={{ left: `${sellPct}%`, width: `${buyPct - sellPct}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-positive/30 dark:bg-positive/38"
            style={{ width: `${100 - buyPct}%` }}
          />

          {/* Dashed boundaries */}
          <div
            className="absolute top-0 bottom-0 border-l-2 border-dashed border-negative/80"
            style={{ left: `${sellPct}%` }}
          />
          <div
            className="absolute top-0 bottom-0 border-l-2 border-dashed border-positive/80"
            style={{ left: `${buyPct}%` }}
          />

          {/* Zone labels — bold, inside each band */}
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-extrabold uppercase tracking-wide text-negative drop-shadow-sm pointer-events-none select-none"
            style={{ left: `${sellPct / 2}%` }}
          >
            {zoneLabels.sell}
          </span>
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-extrabold uppercase tracking-wide text-accent drop-shadow-sm pointer-events-none select-none"
            style={{ left: `${(sellPct + buyPct) / 2}%` }}
          >
            {zoneLabels.hold}
          </span>
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-extrabold uppercase tracking-wide text-positive drop-shadow-sm pointer-events-none select-none"
            style={{ left: `${buyPct + (100 - buyPct) / 2}%` }}
          >
            {zoneLabels.buy}
          </span>

          {/* Needle at score */}
          <div
            className={`absolute top-0 bottom-0 w-[3px] z-20 rounded-full ${cls.needle}`}
            style={{ left: `${scorePct}%`, transform: "translateX(-50%)" }}
          />

          {/* Score mini-banner inside the track */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 pointer-events-none"
            style={{ left: `${scorePct}%` }}
          >
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-extrabold tabular-nums leading-none border-2 bg-white dark:bg-slate-900 shadow-sm ${scoreBannerBorder} ${scoreBannerText}`}
            >
              {roundedScore}
            </span>
          </div>
        </div>
      </div>

      {/* Threshold numbers only */}
      <div className="relative h-3 text-[8px] tabular-nums text-ink-muted">
        <span className="absolute -translate-x-1/2" style={{ left: `${sellPct}%` }}>
          {roundedSell}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${buyPct}%` }}>
          {roundedBuy}
        </span>
      </div>

      {/* Status caption — call drives color, not score zone */}
      <p className="text-[11px] leading-snug">
        <span className={`font-bold ${cls.gap}`}>{callLabel}</span>
        {subtitle ? (
          <span className="text-ink-muted">
            {" "}
            — {subtitle}
          </span>
        ) : null}
        <span className={`${gapColorClass} font-semibold`}>
          {" "}
          · {gapText}
        </span>
      </p>
      <p className="text-[9px] text-ink-muted/80 leading-snug">{positionNote}</p>
    </div>
  );
}

/** Demo props — VIR-like HOLD. */
export const DEMO_DECISION_SPECTRUM_PROPS: DecisionSpectrumProps = {
  score: 61,
  sellThreshold: 40,
  buyThreshold: 65,
  call: "HOLD",
  subtitle: "keep, no exit signal",
  it: false,
};
