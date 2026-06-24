import type { IndexId } from "../lib/scoring/zoneWeights";
import type { ScoringZone } from "../lib/scoring/zoneWeights";
import { topCompositeDrivers } from "../lib/scoring/compositeScore";

const ZONE_CLS: Record<ScoringZone, string> = {
  hot: "text-emerald-700 dark:text-emerald-300",
  watch: "text-amber-700 dark:text-amber-300",
  early: "text-slate-600 dark:text-slate-400",
  loss: "text-rose-700 dark:text-rose-300",
};

function scoreTone(score: number): string {
  if (score >= 55) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 40) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

export function CompositeScoreCell({
  score,
  zone,
  breakdown,
  dampened = false,
  zoneLabel,
  dampenedHint,
}: {
  score: number | null | undefined;
  zone: ScoringZone | null | undefined;
  breakdown?: Partial<Record<IndexId, number>>;
  dampened?: boolean;
  zoneLabel?: string;
  dampenedHint?: string;
}) {
  if (score == null || !Number.isFinite(score) || !zone) {
    return <span className="text-ink-muted">—</span>;
  }

  const drivers = breakdown ? topCompositeDrivers(breakdown as Record<string, number>) : "";
  const title = [drivers, dampened ? dampenedHint : null].filter(Boolean).join(" · ");

  return (
    <div className="leading-tight" title={title || undefined}>
      <p className={`font-bold tabular-nums text-[11px] ${scoreTone(score)}`}>
        {score}
        {dampened ? <span className="text-[9px] font-normal opacity-75">*</span> : null}
      </p>
      <p className={`text-[9px] uppercase tracking-wide font-semibold ${ZONE_CLS[zone]}`}>
        {zoneLabel ?? zone}
      </p>
    </div>
  );
}
