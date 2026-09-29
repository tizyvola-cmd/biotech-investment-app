import { useT, type TranslationKey } from "../shared/i18n";

type GuideItem = { term: TranslationKey; body: TranslationKey };
type GuideSection = { title: TranslationKey; intro?: TranslationKey; items: GuideItem[] };

const SECTIONS: GuideSection[] = [
  {
    title: "accuracyGuide.section.kpi.title",
    intro: "accuracyGuide.section.kpi.intro",
    items: [
      { term: "accuracyGuide.kpi.raw.term", body: "accuracyGuide.kpi.raw.body" },
      { term: "accuracyGuide.kpi.useful.term", body: "accuracyGuide.kpi.useful.body" },
      { term: "accuracyGuide.kpi.strong.term", body: "accuracyGuide.kpi.strong.body" },
      { term: "accuracyGuide.kpi.edge.term", body: "accuracyGuide.kpi.edge.body" },
      { term: "accuracyGuide.kpi.noise.term", body: "accuracyGuide.kpi.noise.body" },
    ],
  },
  {
    title: "accuracyGuide.section.horizon.title",
    intro: "accuracyGuide.section.horizon.intro",
    items: [
      { term: "accuracyGuide.horizon.horizon.term", body: "accuracyGuide.horizon.horizon.body" },
      { term: "accuracyGuide.horizon.nRaw.term", body: "accuracyGuide.horizon.nRaw.body" },
      { term: "accuracyGuide.horizon.hitRaw.term", body: "accuracyGuide.horizon.hitRaw.body" },
      { term: "accuracyGuide.horizon.nUseful.term", body: "accuracyGuide.horizon.nUseful.body" },
      { term: "accuracyGuide.horizon.hitUseful.term", body: "accuracyGuide.horizon.hitUseful.body" },
    ],
  },
  {
    title: "accuracyGuide.section.aff.title",
    intro: "accuracyGuide.section.aff.intro",
    items: [
      { term: "accuracyGuide.aff.confidence.term", body: "accuracyGuide.aff.confidence.body" },
      { term: "accuracyGuide.aff.nTotal.term", body: "accuracyGuide.aff.nTotal.body" },
      { term: "accuracyGuide.aff.nDir.term", body: "accuracyGuide.aff.nDir.body" },
      { term: "accuracyGuide.aff.accDir.term", body: "accuracyGuide.aff.accDir.body" },
      { term: "accuracyGuide.aff.hitGlob.term", body: "accuracyGuide.aff.hitGlob.body" },
      { term: "accuracyGuide.aff.decisionLab.term", body: "accuracyGuide.aff.decisionLab.body" },
    ],
  },
  {
    title: "accuracyGuide.section.kpiSignal.title",
    intro: "accuracyGuide.section.kpiSignal.intro",
    items: [
      { term: "accuracyGuide.kpiSig.enriched.term", body: "accuracyGuide.kpiSig.enriched.body" },
      { term: "accuracyGuide.kpiSig.rich.term", body: "accuracyGuide.kpiSig.rich.body" },
      { term: "accuracyGuide.kpiSig.coverage.term", body: "accuracyGuide.kpiSig.coverage.body" },
      { term: "accuracyGuide.kpiSig.meanShift.term", body: "accuracyGuide.kpiSig.meanShift.body" },
      { term: "accuracyGuide.kpiSig.dist.term", body: "accuracyGuide.kpiSig.dist.body" },
      { term: "accuracyGuide.kpiSig.shiftOld.term", body: "accuracyGuide.kpiSig.shiftOld.body" },
      { term: "accuracyGuide.kpiSig.shiftNew.term", body: "accuracyGuide.kpiSig.shiftNew.body" },
      { term: "accuracyGuide.kpiSig.delta.term", body: "accuracyGuide.kpiSig.delta.body" },
      { term: "accuracyGuide.kpiSig.pvals.term", body: "accuracyGuide.kpiSig.pvals.body" },
      { term: "accuracyGuide.kpiSig.maturity.term", body: "accuracyGuide.kpiSig.maturity.body" },
      { term: "accuracyGuide.kpiSig.cd.term", body: "accuracyGuide.kpiSig.cd.body" },
    ],
  },
];

function GuideDefRow({ term, body }: { term: string; body: string }) {
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/35 bg-surface/40 px-3 py-2">
      <dt className="text-xs font-semibold text-ink">{term}</dt>
      <dd className="text-[11px] text-ink-muted leading-relaxed mt-1">{body}</dd>
    </div>
  );
}

export function AccuracyMetricsHelpButton({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-accent/35 text-accent hover:bg-accent/10 transition shrink-0 ${className}`.trim()}
      title={t("accuracyGuide.btn")}
    >
      <span className="text-sm leading-none" aria-hidden>
        ?
      </span>
      {t("accuracyGuide.btn")}
    </button>
  );
}

export function AccuracyMetricsGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-2xl max-h-[min(88vh,52rem)] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="accuracy-metrics-guide-title"
      >
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/60 flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 id="accuracy-metrics-guide-title" className="text-base font-semibold text-ink">
              {t("accuracyGuide.title")}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{t("accuracyGuide.intro")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink text-lg leading-none px-1"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="space-y-2">
              <h4 className="text-sm font-semibold text-ink border-b border-[rgb(var(--border))]/40 pb-1">
                {t(sec.title)}
              </h4>
              {sec.intro ? (
                <p className="text-[11px] text-ink-muted leading-relaxed">{t(sec.intro)}</p>
              ) : null}
              <dl className="space-y-2">
                {sec.items.map((item) => (
                  <GuideDefRow
                    key={item.term}
                    term={t(item.term)}
                    body={t(item.body)}
                  />
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-[rgb(var(--border))]/60 flex justify-end shrink-0">
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
