import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useT } from "../shared/i18n";
import {
  buildEisSuperScoreChartRows,
  buildEisSuperScoreLearningTrend,
  type EisSuperScoreOverview,
} from "../sheet/eisSuperScoreLearningView";

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtLift(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}`;
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

  if (!timelineRows.length) {
    return (
      <p className="text-[11px] text-ink-muted py-4">
        {t("learningLab.eisSuper.empty")}
      </p>
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiRaw7d")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtRho(eff?.mean_corr_raw_7d)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiSuper7d")}</p>
          <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtRho(eff?.mean_corr_super_7d)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiLift")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtLift(eff?.mean_lift_7d)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.eisSuper.kpiEvents")}</p>
          <p className="font-semibold tabular-nums text-ink">{overview?.n_events_scored ?? 0}</p>
        </div>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t("learningLab.eisSuper.timelineTitle")}</h3>
          <p className="text-[10px] text-ink-muted">{t("learningLab.eisSuper.timelineSubtitle")}</p>
        </div>
        <div style={{ height: 280 }} className="w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timelineRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis
                dataKey="daysMid"
                type="number"
                reversed
                domain={[0, "dataMax"]}
                tick={{ fontSize: 9 }}
                label={{
                  value: t("learningLab.eisSuper.xAxis"),
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 9, fill: "#64748b" },
                }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={[-0.2, 1]}
                label={{
                  value: "ρ",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 9, fill: "#64748b" },
                }}
              />
              <ReferenceLine x={0} stroke="#059669" strokeDasharray="4 3" label={{ value: "CD", fontSize: 8, fill: "#059669" }} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
              <Tooltip
                formatter={(v: number) => fmtRho(v)}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { daysLabel?: string; window?: string; nPrice7d?: number };
                  return `${row?.window ?? ""} · ${row?.daysLabel ?? ""} · n=${row?.nPrice7d ?? 0}`;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="corrRaw7d" name={t("learningLab.eisSuper.lineRaw7d")} stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="corrSuper7d" name={t("learningLab.eisSuper.lineSuper7d")} stroke="#059669" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="corrRaw1d" name={t("learningLab.eisSuper.lineRaw1d")} stroke="#cbd5e1" strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="corrSuper1d" name={t("learningLab.eisSuper.lineSuper1d")} stroke="#6366f1" strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
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
                <Line type="monotone" dataKey="raw7d" name={t("learningLab.eisSuper.lineRaw7d")} stroke="#94a3b8" strokeWidth={1.5} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="super7d" name={t("learningLab.eisSuper.lineSuper7d")} stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="lift" name={t("learningLab.eisSuper.kpiLift")} stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden">
        <table className="w-full text-[10px]">
          <thead className="bg-[rgb(var(--surface-3))]/40 text-ink-muted">
            <tr>
              <th className="text-left px-2 py-1.5">{t("learningLab.eisSuper.colWindow")}</th>
              <th className="text-right px-2 py-1.5">ρ raw T+7</th>
              <th className="text-right px-2 py-1.5">ρ super T+7</th>
              <th className="text-right px-2 py-1.5">Δρ</th>
              <th className="text-right px-2 py-1.5">cal</th>
              <th className="text-right px-2 py-1.5">n</th>
            </tr>
          </thead>
          <tbody>
            {timelineRows.map((r) => (
              <tr key={r.window} className="border-t border-[rgb(var(--border))]/30 tabular-nums">
                <td className="px-2 py-1 text-ink">{r.window}</td>
                <td className="text-right px-2 py-1">{fmtRho(r.corrRaw7d)}</td>
                <td className="text-right px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">{fmtRho(r.corrSuper7d)}</td>
                <td className="text-right px-2 py-1">{fmtLift(r.lift7d)}</td>
                <td className="text-right px-2 py-1">{r.calFactor != null ? r.calFactor.toFixed(2) : "—"}</td>
                <td className="text-right px-2 py-1 text-ink-muted">{r.nPrice7d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
