import { useT } from "../shared/i18n";
import {
  buildEisSuperScoreChartRows,
  buildEisSuperScoreLearningTrend,
  EIS_SUPER_MIN_N,
  isLikelyMonotoneCalibrationByLift,
  isMonotoneCalibrationBlend,
  type EisSuperScoreOverview,
} from "../sheet/eisSuperScoreLearningView";
import { EisSuperScoreTripleChart } from "./EisSuperScoreTripleChart";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtLift(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}`;
}

function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp`;
}

export function EisSuperScoreLearningSection({
  overview,
}: {
  overview: EisSuperScoreOverview | null | undefined;
  it?: boolean;
}) {
  const t = useT();
  const timelineRows = buildEisSuperScoreChartRows(overview);
  const trendRows = buildEisSuperScoreLearningTrend(overview);
  const eff = overview?.effectiveness;
  const monotoneBlend = isMonotoneCalibrationBlend(overview);
  const likelyMonotoneBlend =
    !monotoneBlend && isLikelyMonotoneCalibrationByLift(overview);

  if (!timelineRows.length) {
    return (
      <p className="text-[11px] text-ink-muted py-4">{t("learningLab.eisSuper.empty")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1">
        <p className="text-[11px] font-medium text-ink">{t("learningLab.eisSuper.introTitle")}</p>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("learningLab.eisSuper.introBody")}</p>
        <p className="text-[10px] tabular-nums text-ink-muted">
          {t("learningLab.eisSuper.blendNote", {
            learned: String(Math.round((overview?.global_score_blend ?? 0.6) * 100)),
            cycle: String(Math.round((overview?.learned_blend ?? 0.65) * 100)),
          })}
        </p>
      </div>

      {monotoneBlend ? (
        <p className="text-[10px] rounded border border-amber-300/50 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-700/40 px-2.5 py-2 text-amber-950 dark:text-amber-100 leading-relaxed">
          {t("learningLab.eisSuper.diagnosticMonotoneWarning")}
        </p>
      ) : likelyMonotoneBlend ? (
        <p className="text-[10px] rounded border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-700/30 px-2.5 py-2 text-amber-950 dark:text-amber-100 leading-relaxed">
          {t("learningLab.eisSuper.diagnosticLikelyMonotoneWarning")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiRaw7d")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtRho(eff?.mean_corr_raw_7d)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiSuper7d")}</p>
          <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {fmtRho(eff?.mean_corr_super_7d)}
          </p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiLift")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtLift(eff?.mean_lift_7d)}</p>
        </div>
        <div className="rounded border border-violet-300/40 bg-violet-50/50 dark:bg-violet-950/20 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiMaeLift")}</p>
          <p className="font-semibold tabular-nums text-violet-900 dark:text-violet-200">
            {fmtPp(eff?.mean_mae_lift_7d)}
          </p>
        </div>
        <div className="rounded border border-sky-300/40 bg-sky-50/50 dark:bg-sky-950/20 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiLsLift")}</p>
          <p className="font-semibold tabular-nums text-sky-900 dark:text-sky-200">
            {fmtPp(eff?.mean_long_short_lift_7d)}
          </p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiMonoSpearman")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtRho(eff?.mean_mono_spearman_raw_super_7d)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiEvents")}</p>
          <p className="font-semibold tabular-nums text-ink">{overview?.n_events_scored ?? 0}</p>
        </div>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
        <p className="text-[9px] text-ink-muted/80">
          {t("learningLab.eisSuper.diagnosticGateNote", { minN: String(EIS_SUPER_MIN_N) })}
        </p>
        <EisSuperScoreTripleChart rows={timelineRows} />
        <p className="text-[9px] text-ink-muted italic border-t border-[rgb(var(--border))]/30 pt-2">
          {t("learningLab.eisSuper.horizonFootnote")}
        </p>
      </div>

      {trendRows.length >= 2 ? (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("learningLab.eisSuper.trendTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("learningLab.eisSuper.trendSubtitle")}</p>
          </div>
          <div style={{ height: 200 }} className="w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendRows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[-0.2, 1]} />
                <Tooltip formatter={(v: number) => fmtRho(v)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="raw7d"
                  name={t("learningLab.eisSuper.lineRaw7d")}
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="super7d"
                  name={t("learningLab.eisSuper.lineSuper7d")}
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="lift"
                  name={t("learningLab.eisSuper.kpiLift")}
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-x-auto">
        <table className="w-full text-[10px] min-w-[640px]">
          <thead className="bg-[rgb(var(--surface-3))]/40 text-ink-muted">
            <tr>
              <th className="text-left px-2 py-1.5">{t("learningLab.eisSuper.colWindow")}</th>
              <th className="text-right px-2 py-1.5">n T+7</th>
              <th className="text-right px-2 py-1.5">ρ raw</th>
              <th className="text-right px-2 py-1.5">ρ super</th>
              <th className="text-right px-2 py-1.5">Δρ</th>
              <th className="text-right px-2 py-1.5">Δ MAE</th>
              <th className="text-right px-2 py-1.5">Δ L-S</th>
              <th className="text-right px-2 py-1.5">mono ρ</th>
              <th className="text-right px-2 py-1.5">cal</th>
            </tr>
          </thead>
          <tbody>
            {timelineRows.map((r) => (
              <tr
                key={r.window}
                className={`border-t border-[rgb(var(--border))]/30 tabular-nums ${r.nGated ? "opacity-50" : ""}`}
              >
                <td className="px-2 py-1 text-ink">
                  {r.window}
                  {r.nGated ? (
                    <span className="text-[8px] text-amber-700 dark:text-amber-400 ml-1">gated</span>
                  ) : null}
                </td>
                <td className="text-right px-2 py-1 text-ink-muted">{r.nPrice7d}</td>
                <td className="text-right px-2 py-1">{fmtRho(r.corrRaw7dGated ?? r.corrRaw7d)}</td>
                <td className="text-right px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                  {fmtRho(r.corrSuper7dGated ?? r.corrSuper7d)}
                </td>
                <td className="text-right px-2 py-1">{fmtLift(r.lift7d)}</td>
                <td className="text-right px-2 py-1">{fmtPp(r.maeLift7d)}</td>
                <td className="text-right px-2 py-1">{fmtPp(r.longShortLift7d)}</td>
                <td className="text-right px-2 py-1">{fmtRho(r.monoSpearman)}</td>
                <td className="text-right px-2 py-1">{r.calFactor != null ? r.calFactor.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}