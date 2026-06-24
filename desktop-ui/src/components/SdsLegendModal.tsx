import { useEffect } from "react";
import { useT, type TranslationKey } from "../shared/i18n";
import { SDS_LEGEND_SCORE_TABLES, type LegendScoreTable } from "../sheet/sdsLegendScoreRows";

type LegendMetric = {
  name: TranslationKey;
  desc: TranslationKey;
  source: TranslationKey;
  max: number;
  note?: TranslationKey;
};

type LegendCluster = {
  title: TranslationKey;
  weight: TranslationKey;
  intro: TranslationKey;
  metrics: LegendMetric[];
};

const CLUSTERS: LegendCluster[] = [
  {
    title: "decisionLab.sds.legend.clusterA.title",
    weight: "decisionLab.sds.legend.clusterA.weight",
    intro: "decisionLab.sds.legend.clusterA.intro",
    metrics: [
      {
        name: "decisionLab.sds.legend.a.phase.name",
        desc: "decisionLab.sds.legend.a.phase.desc",
        source: "decisionLab.sds.legend.a.phase.source",
        max: 14,
      },
      {
        name: "decisionLab.sds.legend.a.endpoint.name",
        desc: "decisionLab.sds.legend.a.endpoint.desc",
        source: "decisionLab.sds.legend.a.endpoint.source",
        max: 10,
      },
      {
        name: "decisionLab.sds.legend.a.unmet.name",
        desc: "decisionLab.sds.legend.a.unmet.desc",
        source: "decisionLab.sds.legend.a.unmet.source",
        max: 13,
      },
      {
        name: "decisionLab.sds.legend.a.market.name",
        desc: "decisionLab.sds.legend.a.market.desc",
        source: "decisionLab.sds.legend.a.market.source",
        max: 10,
      },
    ],
  },
  {
    title: "decisionLab.sds.legend.clusterB.title",
    weight: "decisionLab.sds.legend.clusterB.weight",
    intro: "decisionLab.sds.legend.clusterB.intro",
    metrics: [
      {
        name: "decisionLab.sds.legend.b.short.name",
        desc: "decisionLab.sds.legend.b.short.desc",
        source: "decisionLab.sds.legend.b.short.source",
        max: 10,
      },
      {
        name: "decisionLab.sds.legend.b.analyst.name",
        desc: "decisionLab.sds.legend.b.analyst.desc",
        source: "decisionLab.sds.legend.b.analyst.source",
        max: 8,
      },
      {
        name: "decisionLab.sds.legend.b.instOwn.name",
        desc: "decisionLab.sds.legend.b.instOwn.desc",
        source: "decisionLab.sds.legend.b.instOwn.source",
        max: 8,
      },
    ],
  },
  {
    title: "decisionLab.sds.legend.clusterC.title",
    weight: "decisionLab.sds.legend.clusterC.weight",
    intro: "decisionLab.sds.legend.clusterC.intro",
    metrics: [
      {
        name: "decisionLab.sds.legend.c.bb.name",
        desc: "decisionLab.sds.legend.c.bb.desc",
        source: "decisionLab.sds.legend.c.bb.source",
        max: 10,
      },
      {
        name: "decisionLab.sds.legend.c.obv.name",
        desc: "decisionLab.sds.legend.c.obv.desc",
        source: "decisionLab.sds.legend.c.obv.source",
        max: 8,
      },
      {
        name: "decisionLab.sds.legend.c.xbi.name",
        desc: "decisionLab.sds.legend.c.xbi.desc",
        source: "decisionLab.sds.legend.c.xbi.source",
        max: 5,
      },
      {
        name: "decisionLab.sds.legend.c.volRatio.name",
        desc: "decisionLab.sds.legend.c.volRatio.desc",
        source: "decisionLab.sds.legend.c.volRatio.source",
        max: 5,
      },
    ],
  },
  {
    title: "decisionLab.sds.legend.clusterD.title",
    weight: "decisionLab.sds.legend.clusterD.weight",
    intro: "decisionLab.sds.legend.clusterD.intro",
    metrics: [
      {
        name: "decisionLab.sds.legend.d.cash.name",
        desc: "decisionLab.sds.legend.d.cash.desc",
        source: "decisionLab.sds.legend.d.cash.source",
        max: 8,
      },
      {
        name: "decisionLab.sds.legend.d.pipeline.name",
        desc: "decisionLab.sds.legend.d.pipeline.desc",
        source: "decisionLab.sds.legend.d.pipeline.source",
        max: 8,
      },
      {
        name: "decisionLab.sds.legend.d.ma.name",
        desc: "decisionLab.sds.legend.d.ma.desc",
        source: "decisionLab.sds.legend.d.ma.source",
        max: 7,
      },
    ],
  },
  {
    title: "decisionLab.sds.legend.clusterE.title",
    weight: "decisionLab.sds.legend.clusterE.weight",
    intro: "decisionLab.sds.legend.clusterE.intro",
    metrics: [
      {
        name: "decisionLab.sds.legend.e.window.name",
        desc: "decisionLab.sds.legend.e.window.desc",
        source: "decisionLab.sds.legend.e.window.source",
        max: 6,
      },
      {
        name: "decisionLab.sds.legend.e.sequential.name",
        desc: "decisionLab.sds.legend.e.sequential.desc",
        source: "decisionLab.sds.legend.e.sequential.source",
        max: 4,
      },
    ],
  },
];

function LegendAcademicTable({ table }: { table: LegendScoreTable }) {
  const t = useT();
  return (
    <table className="sds-legend-table">
      <thead>
        <tr>
          <th scope="col">{t("decisionLab.sds.legend.colCriterion")}</th>
          <th scope="col">{t("decisionLab.sds.legend.colPoints")}</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.label}>
            <td>{t(row.label)}</td>
            <td className="sds-legend-table__points">{row.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MetricSection({ metric }: { metric: LegendMetric }) {
  const t = useT();
  const scoreTable = SDS_LEGEND_SCORE_TABLES[metric.name];

  return (
    <article className="sds-legend-metric space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink leading-snug">{t(metric.name)}</h4>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums border border-[rgb(var(--border))]/50 text-ink-muted shrink-0">
          max {metric.max}
        </span>
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed">{t(metric.desc)}</p>
      {scoreTable ? <LegendAcademicTable table={scoreTable} /> : null}
      {scoreTable?.bonus ? (
        <p className="text-[10px] text-ink-muted/85 leading-snug">{t(scoreTable.bonus)}</p>
      ) : null}
      {scoreTable?.example ? (
        <p className="text-[10px] text-ink-muted/75 leading-snug italic">{t(scoreTable.example)}</p>
      ) : null}
      {scoreTable?.footnote ? (
        <p className="text-[10px] text-ink-muted/75 leading-snug">{t(scoreTable.footnote)}</p>
      ) : null}
      <p className="text-[10px] text-ink-muted/80 leading-snug">
        <span className="font-medium text-ink-muted">{t("decisionLab.sds.legend.source")}: </span>
        {t(metric.source)}
      </p>
      {metric.note ? (
        <p className="text-[10px] text-ink-muted/70 leading-snug italic">{t(metric.note)}</p>
      ) : null}
    </article>
  );
}

export function SdsLegendPanel() {
  const t = useT();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-ink">{t("decisionLab.sds.legend.title")}</h3>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{t("decisionLab.sds.legend.subtitle")}</p>
      </div>

      <p className="text-[11px] text-ink-muted leading-relaxed rounded-lg border border-[rgb(var(--border))]/40 bg-surface/30 px-3 py-2 whitespace-pre-line">
        {t("decisionLab.sds.legend.intro")}
      </p>

      <section className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/25 px-3 py-2.5 space-y-2">
        <h4 className="text-xs font-semibold text-ink">{t("decisionLab.sds.legend.thresholdsTitle")}</h4>
        <p className="text-[11px] text-ink-muted leading-relaxed whitespace-pre-line">
          {t("decisionLab.sds.legend.thresholdsBody")}
        </p>
      </section>

      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
        <h4 className="text-xs font-semibold text-amber-900 dark:text-amber-100">{t("decisionLab.sds.legend.vetoTitle")}</h4>
        <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">{t("decisionLab.sds.legend.vetoBody")}</p>
      </section>

      {CLUSTERS.map((cluster) => (
        <section key={cluster.title} className="space-y-2.5">
          <div className="border-b border-[rgb(var(--border))]/40 pb-2 space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">{t(cluster.title)}</h4>
              <span className="text-[11px] font-medium text-accent tabular-nums">{t(cluster.weight)}</span>
            </div>
            <p className="text-[11px] text-ink-muted italic leading-snug">{t(cluster.intro)}</p>
          </div>
          <div className="space-y-5">
            {cluster.metrics.map((metric) => (
              <MetricSection key={metric.name} metric={metric} />
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/25 px-3 py-2.5 space-y-1">
        <h4 className="text-xs font-semibold text-ink">{t("decisionLab.sds.legend.formulaTitle")}</h4>
        <p className="text-[11px] text-ink-muted leading-relaxed whitespace-pre-line font-mono">
          {t("decisionLab.sds.legend.formulaBody")}
        </p>
        <p className="text-[10px] text-ink-muted/80 leading-relaxed">{t("decisionLab.sds.legend.confidenceNote")}</p>
      </section>
    </div>
  );
}

/** @deprecated Use SdsLegendPanel inside tab navigation */
export function SdsLegendHelpButton({
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
      title={t("decisionLab.sds.legend.btn")}
    >
      <span className="text-sm leading-none" aria-hidden>
        ⓘ
      </span>
      {t("decisionLab.sds.legend.btn")}
    </button>
  );
}

/** @deprecated Use SdsLegendPanel inside tab navigation */
export function SdsLegendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        className="card w-full max-w-3xl max-h-[min(92vh,56rem)] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sds-legend-title"
        aria-modal="true"
      >
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/60 flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 id="sds-legend-title" className="text-base font-semibold text-ink">
              {t("decisionLab.sds.legend.title")}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{t("decisionLab.sds.legend.subtitle")}</p>
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
          <SdsLegendPanel />
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
