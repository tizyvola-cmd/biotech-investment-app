import type { LearningTrendVisual } from "../sheet/learningTrendVisual";

export function TrendStatusBadge({
  visual,
  it,
  title,
}: {
  visual: LearningTrendVisual;
  it: boolean;
  title?: string;
}) {
  const label = it ? visual.shortIt : visual.shortEn;
  return (
    <span
      className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border tabular-nums ${visual.badgeCls}`}
      title={title ?? (it ? visual.explainIt : visual.explainEn)}
    >
      {visual.icon} {label}
    </span>
  );
}

export function TrendNarrativeSummaryBox({
  headline,
  whatHappened,
  modelImpact,
  visual,
  it,
  impactHeading,
}: {
  headline: string;
  whatHappened: string[];
  modelImpact: string[];
  visual: LearningTrendVisual;
  it: boolean;
  impactHeading?: string;
}) {
  const statusExplain = it ? visual.explainIt : visual.explainEn;
  const impactTitle = impactHeading ?? (it ? "Cosa significa per te" : "What it means for you");

  return (
    <div
      className={`rounded-xl border p-4 space-y-4 ${visual.panelBorderCls} ${visual.panelBgCls}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="text-3xl leading-none shrink-0 select-none" role="img" aria-hidden>
          {visual.icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <TrendStatusBadge visual={visual} it={it} />
          <p className="text-[12px] leading-snug text-ink-muted">{statusExplain}</p>
        </div>
      </div>
      <p className={`text-[15px] font-semibold leading-snug ${visual.headlineAccentCls}`}>
        {headline}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {it ? "Cosa sta succedendo" : "What's going on"}
          </h4>
          <ul className="space-y-1.5 text-[13px] leading-snug text-ink/90 list-none">
            {whatHappened.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {impactTitle}
          </h4>
          <ul className="space-y-1.5 text-[13px] leading-snug text-ink/90 list-none">
            {modelImpact.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-positive shrink-0">→</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
