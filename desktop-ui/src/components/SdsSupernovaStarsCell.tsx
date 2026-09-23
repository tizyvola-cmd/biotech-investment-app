import {
  computeSdsSupernovaProximity,
  formatSdsSupernovaGap,
  SDS_SUPERNOVA_THRESHOLD,
} from "../sheet/sdsSupernovaProximity";
import { sdsSimulationTableScoreClass } from "../sheet/sdsZoneColors";

/** Compact 5★ SuperNova proximity for Top KPI (desktop). */
export function SdsSupernovaStarsCell({
  score,
  it = false,
}: {
  score: number | null | undefined;
  it?: boolean;
}) {
  const prox = computeSdsSupernovaProximity(score);
  if (!prox) {
    return <span className="text-ink-muted">—</span>;
  }

  const filled = "★".repeat(prox.stars);
  const empty = "★".repeat(5 - prox.stars);
  const tip = it
    ? `SDS ${prox.score.toFixed(1)} · soglia SuperNova ${SDS_SUPERNOVA_THRESHOLD}. ${
        prox.isSupernova
          ? "5★ = deal SuperNova."
          : `Mancano ${Math.abs(prox.gapPp).toFixed(1)} punti percentuali alla zona SuperNova.`
      }`
    : `SDS ${prox.score.toFixed(1)} · SuperNova threshold ${SDS_SUPERNOVA_THRESHOLD}. ${
        prox.isSupernova
          ? "5★ = SuperNova deal."
          : `${Math.abs(prox.gapPp).toFixed(1)} percentage points short of SuperNova zone.`
      }`;

  return (
    <div
      className={`flex flex-col items-center leading-tight gap-0.5 ${
        prox.isSupernova
          ? "rounded-md px-1 py-0.5 bg-emerald-500/15 ring-1 ring-emerald-500/40"
          : ""
      }`}
      title={tip}
    >
      <span className="text-[11px] leading-none tracking-tight" aria-label={`${prox.stars} of 5 stars`}>
        <span className={prox.isSupernova ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"}>
          {filled}
        </span>
        <span className="text-ink-muted/25">{empty}</span>
      </span>
      <span className={`tabular-nums text-[10px] ${sdsSimulationTableScoreClass(prox.score)}`}>
        {prox.score.toFixed(0)}
      </span>
      <span
        className={`text-[8px] font-semibold uppercase tracking-wide ${
          prox.isSupernova
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-ink-muted"
        }`}
      >
        {formatSdsSupernovaGap(prox, it)}
      </span>
    </div>
  );
}
