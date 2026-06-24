import type { LearningEffectivenessRow } from "../api/supernova";
import { useT } from "../shared/i18n";

const VERDICT_STYLE: Record<string, string> = {
  improving: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  learning: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  neutral: "bg-surface/60 text-ink-muted",
  not_helping: "bg-red-500/15 text-red-700 dark:text-red-400",
  collecting_data: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
};

function fmtDelta(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}${unit}`;
}

function liftClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  if (v <= -0.5) return "text-emerald-600 dark:text-emerald-400";
  if (v >= 0.5) return "text-red-600 dark:text-red-400";
  return "text-ink-muted";
}

export function LearningEffectivenessStrip({ rows }: { rows: LearningEffectivenessRow[] }) {
  const t = useT();
  if (!rows.length) return null;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t("learningLab.effectiveness.title")}</h3>
        <p className="text-[10px] text-ink-muted">{t("learningLab.effectiveness.subtitle")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse min-w-[520px]">
          <thead>
            <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40">
              <th className="text-left py-1 pr-2 font-medium">{t("learningLab.effectiveness.colMechanism")}</th>
              <th className="text-right py-1 px-1 font-medium">{t("learningLab.effectiveness.colLift")}</th>
              <th className="text-right py-1 px-1 font-medium">{t("learningLab.effectiveness.colMae")}</th>
              <th className="text-right py-1 px-1 font-medium">{t("learningLab.effectiveness.colDir")}</th>
              <th className="text-right py-1 pl-1 font-medium">{t("learningLab.effectiveness.colVerdict")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const verdictKey = r.verdict || "collecting_data";
              const verdictLabel = t(`learningLab.effectiveness.verdict.${verdictKey}` as never);
              const maeUsesCorr = r.mae_before == null && r.mae_after == null;
              return (
                <tr key={r.mechanism} className="border-b border-[rgb(var(--border))]/20 last:border-0">
                  <td className="py-1.5 pr-2 text-ink">{r.label}</td>
                  <td className={`py-1.5 px-1 text-right tabular-nums font-medium ${liftClass(r.abs_lift_pp)}`}>
                    {maeUsesCorr ? "—" : fmtDelta(r.abs_lift_pp, " pp")}
                  </td>
                  <td className="py-1.5 px-1 text-right tabular-nums text-ink-muted">
                    {maeUsesCorr ? "—" : fmtDelta(r.mae_delta_pp, " pp")}
                  </td>
                  <td className="py-1.5 px-1 text-right tabular-nums text-ink-muted">
                    {fmtDelta(r.dir_delta_pp, " pp")}
                  </td>
                  <td className="py-1.5 pl-1 text-right">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-medium ${VERDICT_STYLE[verdictKey] ?? VERDICT_STYLE.neutral}`}
                    >
                      {verdictLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
