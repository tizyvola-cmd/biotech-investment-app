import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hydrateClinicalPreCdRecords } from "../sheet/clinicalPreCdSnapshotCache";
import {
  buildEisFeedEventPoints,
  buildWeeklyEisCorrelationTrend,
  summarizeEisFeedCorrelation,
} from "../sheet/readoutForwardMoveValidation";
import { useT } from "../shared/i18n";

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3);
}

export function EisReadoutPnlRecap() {
  const t = useT();
  const points = useMemo(() => buildEisFeedEventPoints(hydrateClinicalPreCdRecords()), []);
  const summary = useMemo(() => summarizeEisFeedCorrelation(points), [points]);
  const weekly = useMemo(() => buildWeeklyEisCorrelationTrend(points), [points]);
  const chartRows = useMemo(
    () => weekly.filter((w) => w.rho != null).slice(-12),
    [weekly],
  );
  const latest = weekly.length ? weekly[weekly.length - 1]! : null;
  const prev = weekly.length >= 2 ? weekly[weekly.length - 2]! : null;
  const rhoDelta =
    latest?.rho != null && prev?.rho != null ? latest.rho - prev.rho : null;

  if (!points.length) {
    return (
      <p className="text-[11px] text-ink-muted py-2">{t("modelLab.qc.eisEvolution.pnlRecapEmpty")}</p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t("modelLab.qc.eisEvolution.pnlRecapTitle")}</h3>
        <p className="text-[10px] text-ink-muted leading-snug">{t("modelLab.qc.eisEvolution.pnlRecapBody")}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("modelLab.qc.eisEvolution.pnlRecapRho")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtRho(summary.rho)}</p>
          <p className="text-[9px] text-ink-muted">n={summary.nNonZero}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("modelLab.qc.eisEvolution.pnlRecapEvents")}</p>
          <p className="font-semibold tabular-nums text-ink">{summary.n}</p>
          <p className="text-[9px] text-ink-muted">
            {summary.nManual > 0 ? `${summary.nManual} manual ✍` : "feed auto"}
          </p>
        </div>
        <div className="rounded border border-emerald-300/40 bg-emerald-50/50 px-2 py-1.5">
          <p className="text-ink-muted">{t("modelLab.qc.eisEvolution.pnlRecapWeekRho")}</p>
          <p className="font-semibold tabular-nums text-emerald-800">{fmtRho(latest?.rho)}</p>
          <p className="text-[9px] text-ink-muted">n={latest?.n ?? 0}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("modelLab.qc.eisEvolution.pnlRecapWeekDelta")}</p>
          <p
            className={`font-semibold tabular-nums ${
              rhoDelta != null && rhoDelta > 0
                ? "text-emerald-700"
                : rhoDelta != null && rhoDelta < 0
                  ? "text-rose-600"
                  : "text-ink"
            }`}
          >
            {rhoDelta != null ? fmtRho(rhoDelta) : "—"}
          </p>
          <p className="text-[9px] text-ink-muted">{latest?.weekKey?.slice(5) ?? "—"}</p>
        </div>
      </div>
      {chartRows.length >= 2 ? (
        <div style={{ height: 160 }} className="w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 6, right: 8, left: 44, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 9 }} />
              <YAxis
                tick={{ fontSize: 9 }}
                domain={[-1, 1]}
                width={44}
                label={{
                  value: "ρ (Pearson)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 4,
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <ReferenceLine
                y={0}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                label={{
                  value: "no coupling",
                  position: "insideBottomRight",
                  fontSize: 8,
                  fill: "#94a3b8",
                }}
              />
              <ReferenceLine
                y={0.5}
                stroke="#94a3b8"
                strokeDasharray="1 3"
                strokeOpacity={0.5}
              />
              <Tooltip
                formatter={(v: number) => [fmtRho(v), "ρ Pearson"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { weekKey?: string; n?: number };
                  return `${row?.weekKey ?? ""} · n=${row?.n ?? 0}`;
                }}
              />
              <Line
                type="monotone"
                dataKey="rho"
                name="ρ Pearson"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-[10px] text-ink-muted">{t("modelLab.qc.eisEvolution.pnlRecapTrendEmpty")}</p>
      )}
    </div>
  );
}
