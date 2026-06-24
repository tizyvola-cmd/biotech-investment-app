import { useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EisExpectedMoveHorizonCurve } from "../data/signalCalibrationData";
import type { EisExpectedMoveCurveView } from "../sheet/eisExpectedMoveCurve";
import {
  classifyPearsonR,
  EIS_CORRELATION_STRENGTH_BG,
  EIS_CORRELATION_STRENGTH_COLORS,
  pearsonVarianceExplainedPct,
  type EisCorrelationStrengthTier,
} from "../sheet/eisCorrelationVisual";
import { useT, type TranslationKey } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp`;
}

function fmtSlope(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp/EIS`;
}

const STRENGTH_LABEL_KEYS: Record<EisCorrelationStrengthTier, TranslationKey> = {
  strong: "modelLab.qc.eisMagnitude.calibrationStrengthStrong",
  moderate: "modelLab.qc.eisMagnitude.calibrationStrengthModerate",
  weak: "modelLab.qc.eisMagnitude.calibrationStrengthWeak",
  none: "modelLab.qc.eisMagnitude.calibrationStrengthWeak",
};

function EisHorizonStrengthCard({
  horizonLabel,
  curve,
  observedN,
  toneClass,
}: {
  horizonLabel: string;
  curve: EisExpectedMoveHorizonCurve;
  observedN: number;
  toneClass: string;
}) {
  const t = useT();
  const tier = classifyPearsonR(curve.pearson_r);
  const strengthColor = EIS_CORRELATION_STRENGTH_COLORS[tier];
  const fillPct = curve.pearson_r != null ? Math.min(100, Math.abs(curve.pearson_r) * 100) : 0;
  const r2Pct = pearsonVarianceExplainedPct(curve.pearson_r);

  return (
    <div className={`rounded border px-2 py-1.5 tabular-nums space-y-1.5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{horizonLabel}</p>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
          style={{ color: strengthColor, background: `${strengthColor}18` }}
        >
          {t(STRENGTH_LABEL_KEYS[tier])} · ρ {(curve.pearson_r ?? 0).toFixed(2)}
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-black/5 overflow-hidden"
        role="img"
        aria-label={`ρ ${(curve.pearson_r ?? 0).toFixed(2)}`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, backgroundColor: strengthColor }}
        />
      </div>
      {r2Pct != null ? (
        <p className="text-[9px] text-ink-muted">
          {t("modelLab.qc.eisMagnitude.calibrationStrengthR2", { pct: String(r2Pct) })}
        </p>
      ) : null}
      <p className="text-ink-muted">{curve.formula}</p>
      <p className="text-[9px] text-ink-muted">
        {fmtSlope(curve.slope_pp_per_eis)} · n={curve.n}
        {observedN > 0
          ? ` · ${t("modelLab.qc.eisMagnitude.calibrationObservedCount", { n: String(observedN) })}`
          : ""}
      </p>
    </div>
  );
}

export function EisExpectedMoveCurveChart({ view }: { view: EisExpectedMoveCurveView }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { t1, t7, chartRows, anchorRows, observedT1, observedT7 } = view;
  if (!t1 && !t7) return null;

  const showObservedT1 = observedT1.length >= 4;
  const showObservedT7 = observedT7.length >= 4;
  const showScatterHint = showObservedT1 || showObservedT7;

  return (
    <div className="space-y-2 rounded-lg border border-indigo-300/40 bg-indigo-50/30 px-2.5 py-2.5">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left rounded-md hover:bg-indigo-100/40 transition px-1 py-0.5 -mx-1"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="text-[10px] text-indigo-700/80 shrink-0 pt-0.5" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[11px] font-semibold text-ink">
            {t("modelLab.qc.eisMagnitude.calibrationTitle")}
          </span>
          <span className="block text-[9px] text-ink-muted leading-snug">
            {expanded
              ? t("modelLab.qc.eisMagnitude.calibrationCollapse")
              : t("modelLab.qc.eisMagnitude.calibrationExpand")}
          </span>
        </span>
        {!expanded && (t1?.pearson_r != null || t7?.pearson_r != null) ? (
          <span className="flex shrink-0 flex-col items-end gap-0.5 text-[9px] tabular-nums">
            {t1?.pearson_r != null ? (
              <span style={{ color: EIS_CORRELATION_STRENGTH_COLORS[classifyPearsonR(t1.pearson_r)] }}>
                T+1 ρ {t1.pearson_r.toFixed(2)}
              </span>
            ) : null}
            {t7?.pearson_r != null ? (
              <span style={{ color: EIS_CORRELATION_STRENGTH_COLORS[classifyPearsonR(t7.pearson_r)] }}>
                T+7 ρ {t7.pearson_r.toFixed(2)}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <>
          <p className="text-[9px] text-ink-muted leading-snug -mt-1">
            {t("modelLab.qc.eisMagnitude.calibrationBody")}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[10px]">
            {t1 ? (
              <EisHorizonStrengthCard
                horizonLabel={t("modelLab.qc.eisMagnitude.horizonT1")}
                curve={t1}
                observedN={observedT1.length}
                toneClass={`${EIS_CORRELATION_STRENGTH_BG[classifyPearsonR(t1.pearson_r)]} text-blue-900`}
              />
            ) : null}
            {t7 ? (
              <EisHorizonStrengthCard
                horizonLabel={t("modelLab.qc.eisMagnitude.horizonT7")}
                curve={t7}
                observedN={observedT7.length}
                toneClass={`${EIS_CORRELATION_STRENGTH_BG[classifyPearsonR(t7.pearson_r)]} text-emerald-900`}
              />
            ) : null}
          </div>

          {showScatterHint ? (
            <p className="text-[9px] text-indigo-900/80 leading-snug px-1">
              {t("modelLab.qc.eisMagnitude.calibrationScatterHint")}
            </p>
          ) : null}

          <div className="w-full space-y-1">
            <div className="h-[280px] w-full min-h-0">
              <ViewErrorBoundary label="EIS expected move curve">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartRows} margin={{ top: 12, right: 14, left: 4, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis
                      type="number"
                      dataKey="eis"
                      tick={{ fontSize: 9 }}
                      height={32}
                      label={{
                        value: t("modelLab.qc.eisMagnitude.calibrationXAxis"),
                        position: "bottom",
                        offset: 4,
                        style: { fontSize: 8, fill: "#64748b" },
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      width={48}
                      unit=" pp"
                      label={{
                        value: t("modelLab.qc.eisMagnitude.calibrationYAxis"),
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 8, fill: "#64748b" },
                      }}
                    />
                    <ReferenceLine x={0} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.7} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.5} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as {
                          eis?: number;
                          deltaPp?: number;
                          expectedPpT1?: number | null;
                          expectedPpT7?: number | null;
                          ticker?: string;
                        };
                        return (
                          <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md space-y-0.5">
                            {row.ticker ? (
                              <p className="font-semibold">
                                {row.ticker} · EIS {row.eis?.toFixed(2)}
                              </p>
                            ) : (
                              <p className="font-semibold">EIS {row.eis?.toFixed(2)}</p>
                            )}
                            {row.deltaPp != null ? (
                              <p className="text-slate-700">
                                ΔP: {fmtPp(row.deltaPp)}
                              </p>
                            ) : null}
                            {row.expectedPpT1 != null ? (
                              <p className="text-blue-800">
                                {t("modelLab.qc.eisMagnitude.calibrationExpectedT1")}: {fmtPp(row.expectedPpT1)}
                              </p>
                            ) : null}
                            {row.expectedPpT7 != null ? (
                              <p className="text-emerald-800">
                                {t("modelLab.qc.eisMagnitude.calibrationExpectedT7")}: {fmtPp(row.expectedPpT7)}
                              </p>
                            ) : null}
                          </div>
                        );
                      }}
                    />
                    {showObservedT7 ? (
                      <Scatter
                        data={observedT7}
                        dataKey="deltaPp"
                        name={t("modelLab.qc.eisMagnitude.calibrationObservedT7")}
                        fill="#059669"
                        fillOpacity={0.22}
                        legendType="none"
                      />
                    ) : null}
                    {showObservedT1 ? (
                      <Scatter
                        data={observedT1}
                        dataKey="deltaPp"
                        name={t("modelLab.qc.eisMagnitude.calibrationObservedT1")}
                        fill="#2563eb"
                        fillOpacity={0.32}
                        legendType="none"
                      />
                    ) : null}
                    {t1 ? (
                      <Line
                        type="monotone"
                        dataKey="expectedPpT1"
                        name={t("modelLab.qc.eisMagnitude.calibrationLineT1")}
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                        legendType="none"
                      />
                    ) : null}
                    {t7 ? (
                      <Line
                        type="monotone"
                        dataKey="expectedPpT7"
                        name={t("modelLab.qc.eisMagnitude.calibrationLineT7")}
                        stroke="#059669"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        dot={false}
                        connectNulls
                        legendType="none"
                      />
                    ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </ViewErrorBoundary>
            </div>
            <div
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[9px] text-ink-muted"
              aria-label="Chart legend"
            >
              {showObservedT1 ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#2563eb]/35" />
                  {t("modelLab.qc.eisMagnitude.calibrationObservedT1")}
                </span>
              ) : null}
              {showObservedT7 ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#059669]/30" />
                  {t("modelLab.qc.eisMagnitude.calibrationObservedT7")}
                </span>
              ) : null}
              {t1 ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-0 w-4 border-t-2 border-[#2563eb]" />
                  {t("modelLab.qc.eisMagnitude.calibrationLineT1")}
                </span>
              ) : null}
              {t7 ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-0 w-4 border-t-2 border-dashed border-[#059669]" />
                  {t("modelLab.qc.eisMagnitude.calibrationLineT7")}
                </span>
              ) : null}
            </div>
          </div>

          {anchorRows.length ? (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40">
                    <th className="text-left py-1 pr-2 font-medium">
                      {t("modelLab.qc.eisMagnitude.calibrationTableEis")}
                    </th>
                    <th className="text-right py-1 px-2 font-medium">
                      {t("modelLab.qc.eisMagnitude.calibrationTableT1")}
                    </th>
                    <th className="text-right py-1 pl-2 font-medium">
                      {t("modelLab.qc.eisMagnitude.calibrationTableT7")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {anchorRows.map((row) => (
                    <tr key={row.eis} className="border-b border-[rgb(var(--border))]/20 tabular-nums">
                      <td className="py-1 pr-2 font-medium">{row.label}</td>
                      <td
                        className={`py-1 px-2 text-right ${
                          (row.expectedPpT1 ?? 0) >= 0 ? "text-emerald-800" : "text-rose-700"
                        }`}
                      >
                        {fmtPp(row.expectedPpT1)}
                      </td>
                      <td
                        className={`py-1 pl-2 text-right ${
                          (row.expectedPpT7 ?? 0) >= 0 ? "text-emerald-800" : "text-rose-700"
                        }`}
                      >
                        {fmtPp(row.expectedPpT7)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {t1 ? (
            <p className="text-[9px] text-ink-muted italic">
              {t("modelLab.qc.eisMagnitude.calibrationExample", {
                eis: "5",
                pp: fmtPp((t1.intercept_pp ?? 0) + (t1.slope_pp_per_eis ?? 0) * 5),
                horizon: t("modelLab.qc.eisMagnitude.horizonT1"),
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
