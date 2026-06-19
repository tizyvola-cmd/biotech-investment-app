import { useEffect } from "react";
import { HISTORY_CASES } from "../sheet/sdsHistoryCurve";
import { SDS_HISTORY_CASE_CARDS, SDS_HISTORY_PATTERN_BULLETS } from "../sheet/sdsHistoryCases";
import { useT, type TranslationKey } from "../shared/i18n";
import { SdsHistoryCaseCard } from "./SdsHistoryCaseCard";

const OBSERVATIONS: { title: TranslationKey; body: TranslationKey }[] = [
  {
    title: "decisionLab.sds.history.obs1.title",
    body: "decisionLab.sds.history.obs1.body",
  },
  {
    title: "decisionLab.sds.history.obs2.title",
    body: "decisionLab.sds.history.obs2.body",
  },
  {
    title: "decisionLab.sds.history.obs3.title",
    body: "decisionLab.sds.history.obs3.body",
  },
];

function PatternPanel({
  titleKey,
  bullets,
}: {
  titleKey: TranslationKey;
  bullets: TranslationKey[];
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-[#ddd6fe]/60 bg-[#faf5ff]/50 p-3 space-y-2">
      <h5 className="text-xs font-semibold text-[#5b21b6]">{t(titleKey)}</h5>
      <ul className="space-y-1.5">
        {bullets.map((key) => (
          <li key={key} className="text-[11px] text-ink-muted leading-snug flex gap-2">
            <span className="text-[#8bc34a] shrink-0">•</span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SdsHistoryPanel() {
  const t = useT();

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h3 className="text-base font-semibold text-ink">{t("decisionLab.sds.history.title")}</h3>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{t("decisionLab.sds.history.subtitle")}</p>
      </div>

      <p className="text-[11px] text-ink-muted leading-relaxed">{t("decisionLab.sds.history.intro")}</p>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("decisionLab.sds.history.cohortTitle")}
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-[#cfe8a8]/60 bg-[#f7fdf0] px-2 py-2 text-left text-[11px]">
            <span className="font-bold text-ink">μ SuperNova</span>
            <p className="text-[10px] text-ink-muted mt-0.5">ACRS · ANTX · CTMX · MDGL (N=4)</p>
          </div>
          {HISTORY_CASES.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-[rgb(var(--border))]/45 bg-white px-2 py-2 text-left text-[11px]"
            >
              <span className="font-bold" style={{ color: c.color }}>
                {c.ticker}
              </span>
              <p className="text-[10px] text-ink-muted mt-0.5 truncate">{c.company}</p>
              <p className="text-[10px] tabular-nums text-ink-muted">peak +{c.peakRoi.toFixed(0)}%</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("decisionLab.sds.history.casesTitle")}
        </h4>
        {SDS_HISTORY_CASE_CARDS.filter((s) => s.clusterRole === "member").map((spec) => (
          <SdsHistoryCaseCard key={spec.id} spec={spec} />
        ))}
      </section>

      {SDS_HISTORY_CASE_CARDS.some((s) => s.clusterRole === "candidate") ? (
        <section className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              {t("decisionLab.sds.history.candidatesTitle")}
            </h4>
            <p className="text-[10px] text-ink-muted mt-0.5 leading-relaxed">
              {t("decisionLab.sds.history.candidatesSubtitle")}
            </p>
          </div>
          {SDS_HISTORY_CASE_CARDS.filter((s) => s.clusterRole === "candidate").map((spec) => (
            <SdsHistoryCaseCard key={spec.id} spec={spec} />
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#5b21b6]">
          {t("decisionLab.sds.history.patternsTitle")}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PatternPanel
            titleKey="decisionLab.sds.history.patterns.amplifiers"
            bullets={SDS_HISTORY_PATTERN_BULLETS.amplifiers}
          />
          <PatternPanel
            titleKey="decisionLab.sds.history.patterns.preSurge"
            bullets={SDS_HISTORY_PATTERN_BULLETS.preSurge}
          />
        </div>
      </section>

      <section className="space-y-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("decisionLab.sds.history.observationsTitle")}
        </h4>
        {OBSERVATIONS.map(({ title, body }) => (
          <article
            key={title}
            className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/30 p-3 space-y-1"
          >
            <h5 className="text-xs font-semibold text-ink">{t(title)}</h5>
            <p className="text-[11px] text-ink-muted leading-relaxed">{t(body)}</p>
          </article>
        ))}
      </section>

      <p className="text-[10px] text-ink-muted rounded-lg border border-dashed border-[rgb(var(--border))]/45 px-3 py-2">
        {t("decisionLab.sds.history.taxonomyNote")}
      </p>
    </div>
  );
}

/** @deprecated Use SdsHistoryPanel inside tab navigation */
export function SdsHistoryHelpButton({
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
      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-[rgb(var(--border))]/55 text-ink-muted hover:text-ink hover:bg-surface/50 transition shrink-0 ${className}`.trim()}
      title={t("decisionLab.sds.history.btn")}
    >
      <span className="text-sm leading-none" aria-hidden>
        ⌁
      </span>
      {t("decisionLab.sds.history.btn")}
    </button>
  );
}

/** @deprecated Use SdsHistoryPanel inside tab navigation */
export function SdsHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-4xl max-h-[min(92vh,56rem)] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sds-history-title"
        aria-modal="true"
      >
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/60 flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 id="sds-history-title" className="text-base font-semibold text-ink">
              {t("decisionLab.sds.history.title")}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              {t("decisionLab.sds.history.subtitle")}
            </p>
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

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <SdsHistoryPanel />
        </div>

        <div className="px-4 py-2.5 border-t border-[rgb(var(--border))]/60 shrink-0 flex justify-end">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
