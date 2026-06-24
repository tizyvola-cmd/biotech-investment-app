import { useT } from "../shared/i18n";

export type CurveImpactSnippet = {
  built_at?: string;
  n_events?: number;
  n_enriched?: number;
  summary?: Record<string, number | null | undefined>;
  enrichment_summary?: Record<string, number | null | undefined>;
};

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}${suffix}`;
}

function DeltaChip({ label, value, invert }: { label: string; value: number | null | undefined; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
        <p className="text-[10px] text-ink-muted">{label}</p>
        <p className="font-semibold tabular-nums text-ink-muted">—</p>
      </div>
    );
  }
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const color = good ? "text-emerald-700 dark:text-emerald-400" : bad ? "text-red-600 dark:text-red-400" : "text-ink";
  return (
    <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className={`font-semibold tabular-nums ${color}`}>{fmt(value, " pp")}</p>
    </div>
  );
}

export function CurveImpactLearningSection({ data }: { data: CurveImpactSnippet | null | undefined }) {
  const t = useT();
  const s = data?.summary ?? {};
  const e = data?.enrichment_summary ?? {};

  if (!data?.n_events) {
    return <p className="text-[11px] text-ink-muted py-4">{t("learningLab.curveImpact.empty")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1">
        <p className="text-[11px] font-medium text-ink">{t("learningLab.curveImpact.introTitle")}</p>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("learningLab.curveImpact.introBody")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.curveImpact.kpiEvents")}</p>
          <p className="font-semibold tabular-nums text-ink">{data.n_events ?? 0}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.curveImpact.kpiMaeBase")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmt(s.mae_base_pp, " pp")}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.curveImpact.kpiMaeDaily")}</p>
          <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(s.mae_daily_pp, " pp")}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.curveImpact.kpiHitDaily")}</p>
          <p className="font-semibold tabular-nums text-ink">
            {s.hit_daily_pct != null ? `${s.hit_daily_pct.toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">{t("learningLab.curveImpact.layerTitle")}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <DeltaChip label={t("learningLab.curveImpact.deltaDaily")} value={s.delta_mae_daily_vs_base_pp} invert />
          <DeltaChip label={t("learningLab.curveImpact.deltaK8")} value={s.delta_mae_k8_vs_daily_pp} invert />
          <DeltaChip label={t("learningLab.curveImpact.deltaEis")} value={s.delta_mae_eis_vs_k8_pp} invert />
        </div>
      </div>

      {(e.mae_raw_pp != null || e.mae_raw_eis_pp != null) && (
        <div>
          <h3 className="text-sm font-semibold text-ink mb-2">{t("learningLab.curveImpact.enrichTitle")}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted">{t("learningLab.curveImpact.kpiMaeRaw")}</p>
              <p className="font-semibold tabular-nums text-ink">{fmt(e.mae_raw_pp, " pp")}</p>
            </div>
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted">{t("learningLab.curveImpact.kpiMaeEis")}</p>
              <p className="font-semibold tabular-nums text-ink">{fmt(e.mae_raw_eis_pp, " pp")}</p>
            </div>
            <DeltaChip label={t("learningLab.curveImpact.deltaEisEnrich")} value={e.delta_mae_eis_vs_pre_eis_pp} invert />
          </div>
        </div>
      )}
    </div>
  );
}
