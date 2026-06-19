import type { HistoryBadgeVariant, HistoryCaseCardSpec, HistoryCaseField } from "../sheet/sdsHistoryCases";
import { useT } from "../shared/i18n";

const BADGE_CLASS: Record<HistoryBadgeVariant, string> = {
  green: "bg-emerald-100 text-emerald-800 border-emerald-200/60",
  blue: "bg-sky-100 text-sky-800 border-sky-200/60",
  orange: "bg-amber-100 text-amber-900 border-amber-200/60",
};

function FieldColumn({ fields }: { fields: HistoryCaseField[] }) {
  const t = useT();
  return (
    <div className="space-y-2">
      {fields.map(({ labelKey, valueKey }) => (
        <div key={valueKey} className="text-[11px]">
          <p className="text-ink-muted">{t(labelKey)}</p>
          <p className="font-semibold text-ink leading-snug mt-0.5">{t(valueKey)}</p>
        </div>
      ))}
    </div>
  );
}

export function SdsHistoryCaseCard({ spec }: { spec: HistoryCaseCardSpec }) {
  const t = useT();
  const gainClass =
    spec.gainTone === "amber" ? "text-amber-700" : "text-emerald-700";

  return (
    <article className="rounded-xl border border-[rgb(var(--border))]/50 bg-white dark:bg-[rgb(var(--surface))]/95 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[rgb(var(--border))]/30 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-base font-bold text-ink">{spec.ticker}</span>
        <span className={`text-sm font-bold tabular-nums ${gainClass}`}>{t(spec.gainKey)}</span>
        {spec.clusterRole === "candidate" ? (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-amber-50 text-amber-900 border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/50">
            {t("decisionLab.sds.history.outsideClusterBadge")}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-[12rem]">
          {spec.badges.map(({ key, variant }) => (
            <span
              key={key}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${BADGE_CLASS[variant]}`}
            >
              {t(key)}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-ink-muted ml-auto shrink-0">{t(spec.dateKey)}</span>
      </div>

      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldColumn fields={spec.left} />
        <FieldColumn fields={spec.right} />
      </div>

      <div className="mx-4 mb-4 rounded-lg bg-[#f5f5f0] dark:bg-[rgb(var(--surface-3))]/40 px-3 py-2.5 space-y-1">
        <p className="text-[11px] font-semibold text-ink">{t(spec.noteTitleKey)}</p>
        <p className="text-[11px] text-ink-muted leading-relaxed">{t(spec.noteBodyKey)}</p>
      </div>
    </article>
  );
}
