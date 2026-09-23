import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deltaDirTone,
  deltaMaeTone,
  dirAccTone,
  EVAL_LOOKBACK_OPTIONS,
  formatDeltaMae,
  formatDeltaPp,
  loadEvalLookbackPreference,
  loadEvaluationBaseline,
  loadEvaluationCompare,
  loadEvaluationResults,
  maeTone,
  runEvaluation,
  saveEvalLookbackPreference,
  saveEvaluationBaseline,
  toneClass,
  type EvalComparison,
  type EvalLookbackOption,
  type EvaluationResults,
} from "../data/evaluationModelData";
import { ModelValidationTabIntro } from "./ModelValidationTabIntro";
import { ModelValidationResultsSummary } from "./ModelValidationResultsSummary";
import { ModelHealthPanel } from "./ModelHealthPanel";
import { ModelQcBlendPanel, resolveBlendAbPayload, formatQcLayerLabel } from "./ModelQcBlendPanel";
import { useT } from "../shared/i18n";

function pctFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function MetricCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "muted";
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2 min-w-[120px]">
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass(tone)}`}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-muted mt-0.5">{sub}</div> : null}
    </div>
  );
}

function DeltaCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "muted";
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/70 bg-[rgb(var(--surface-2))]/40 px-3 py-2 min-w-[130px]">
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">Δ {label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass(tone)}`}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-muted mt-0.5">{sub}</div> : null}
    </div>
  );
}

function AdvancedSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/15 group"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink list-none flex items-center gap-2">
        <span className="text-[10px] transition group-open:rotate-90" aria-hidden>
          ▶
        </span>
        {title}
      </summary>
      <div className="px-3 pb-3 pt-0">{children}</div>
    </details>
  );
}

export function ModelValidationDashboard() {
  const t = useT();
  const [data, setData] = useState<EvaluationResults | null>(null);
  const [baseline, setBaseline] = useState<EvaluationResults | null>(null);
  const [comparison, setComparison] = useState<EvalComparison | null>(null);
  const [lookback, setLookback] = useState<EvalLookbackOption>(() => loadEvalLookbackPreference());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCompare = useCallback(async () => {
    const cmp = await loadEvaluationCompare();
    if (cmp) {
      setBaseline(cmp.baseline);
      setComparison(cmp.comparison);
    } else {
      setComparison(null);
      setBaseline(await loadEvaluationBaseline());
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadEvaluationResults());
      await refreshCompare();
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshCompare]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      setData(await runEvaluation(lookback, false));
      await refreshCompare();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleSaveBaseline = async () => {
    setSavingBaseline(true);
    setError(null);
    try {
      const saved = await saveEvaluationBaseline(
        lookback === 0 ? "Tutti CD" : `${lookback} CD/ticker`,
      );
      setBaseline(saved);
      await refreshCompare();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBaseline(false);
    }
  };

  const handleLookbackChange = (v: EvalLookbackOption) => {
    setLookback(v);
    saveEvalLookbackPreference(v);
  };

  const nodes = data?.node_accuracy?.nodes ?? [];
  const baseNodes = baseline?.node_accuracy?.nodes ?? [];
  const t5 = nodes.find((n) => n.node === "T-5");
  const t3 = nodes.find((n) => n.node === "T-3");

  const chartData = useMemo(() => {
    const baseMap = new Map(baseNodes.map((n) => [n.node, n.mae]));
    return nodes.map((n) => ({
      node: n.node,
      mae: n.mae ?? null,
      maeBaseline: baseMap.get(n.node) ?? null,
      dir: n.direction_accuracy != null ? n.direction_accuracy * 100 : null,
      n: n.n_samples,
    }));
  }, [nodes, baseNodes]);

  const layerT5 = data?.layer_deltas?.nodes?.["T-5"] ?? [];
  const slopeSignals = data?.slope_signals?.signals ?? [];
  const upFilter = data?.up_filter;
  const worst = data?.worst_cases ?? [];
  const summary = comparison?.summary;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <ModelValidationTabIntro />
        <p className="text-sm text-ink-muted p-2">{t("modelLab.validation.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <ModelValidationTabIntro />
      {!loading ? (
        <ModelQcBlendPanel evaluation={data} preferLocal embedded={resolveBlendAbPayload(data)} />
      ) : null}
      {data ? <ModelValidationResultsSummary data={data} comparison={comparison} /> : null}
      <ModelHealthPanel
        validationT5Mae={t5?.mae ?? null}
        validationT5Dir={t5?.direction_accuracy ?? null}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">
          {t("modelLab.validation.lookback")}
        </span>
        {EVAL_LOOKBACK_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.hint}
            className={`rounded-md px-2.5 py-1 text-xs border ${
              lookback === opt.value
                ? "bg-accent text-white border-accent"
                : "border-[rgb(var(--border))]/60 hover:bg-surface/80"
            }`}
            onClick={() => handleLookbackChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
          disabled={running}
          onClick={() => void handleRun()}
        >
          {running ? t("modelLab.validation.running") : t("modelLab.validation.run")}
        </button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => void refresh()}>
          {t("modelLab.validation.reloadCache")}
        </button>
        <button
          type="button"
          className="rounded-md border border-emerald-600/40 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-400 disabled:opacity-50"
          disabled={savingBaseline || !data}
          title={t("modelLab.validation.overviewStep3")}
          onClick={() => void handleSaveBaseline()}
        >
          {savingBaseline ? t("modelLab.validation.savingBaseline") : t("modelLab.validation.saveBaseline")}
        </button>
        {data?.generated_at ? (
          <span className="text-[10px] text-ink-muted ml-auto">
            {data.generated_at}
            {data.node_accuracy?.mock_fallback ? " · mock U-shape" : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-red-600 rounded border border-red-500/30 bg-red-500/5 p-2">{error}</p>
      ) : null}

      {baseline ? (
        <p className="text-[10px] text-ink-muted border-l-2 border-emerald-500/50 pl-2">
          {t("modelLab.validation.baselineLine", {
            label: baseline.baseline_label ?? "—",
            date: baseline.saved_as_baseline_at ?? baseline.generated_at ?? "—",
            lookback:
              baseline.lookback_cds != null
                ? ` · lookback ${baseline.lookback_cds}`
                : "",
          })}
        </p>
      ) : (
        <p className="text-[10px] text-ink-muted border-l-2 border-amber-500/40 pl-2">
          {t("modelLab.validation.noBaseline")}
        </p>
      )}

      {comparison?.warning ? (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded p-2">
          {comparison.warning}
          <span className="block mt-1.5 text-[11px] opacity-90">{t("modelLab.validation.metricLookback")}</span>
        </p>
      ) : null}

      {comparison && summary ? (
        <AdvancedSection title={t("modelLab.validation.compareTitle")} defaultOpen>
          <div className="space-y-2 pt-1">
          <p className="text-[10px] text-ink-muted">{t("modelLab.validation.compareLegend")}</p>
          {summary.mae_t5_delta != null &&
          summary.mae_t5_delta > 0 &&
          summary.dir_t5_delta_pp != null &&
          summary.dir_t5_delta_pp > 0 ? (
            <p className="text-[11px] text-ink/90 rounded-md border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/8 px-2.5 py-2 leading-snug">
              {t("modelLab.validation.tradeoffNotice", {
                dir: summary.dir_t5_delta_pp.toFixed(1),
                mae: summary.mae_t5_delta.toFixed(2),
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <DeltaCard
              label="MAE T-5"
              value={formatDeltaMae(summary.mae_t5_delta)}
              tone={deltaMaeTone(summary.mae_t5_delta)}
              sub="↓ = meno errore"
            />
            <DeltaCard
              label="Dir T-5"
              value={formatDeltaPp(summary.dir_t5_delta_pp)}
              tone={deltaDirTone(summary.dir_t5_delta_pp)}
              sub="↑ = più direzione giusta"
            />
            <DeltaCard
              label="Slope5 dir"
              value={formatDeltaPp(summary.slope5_dir_delta_pp)}
              tone={deltaDirTone(summary.slope5_dir_delta_pp)}
            />
            <DeltaCard
              label="Seq ΔMAE vs base"
              value={formatDeltaMae(summary.seq_delta_mae_vs_base_change ?? null)}
              tone={deltaMaeTone(summary.seq_delta_mae_vs_base_change ?? null)}
              sub="↓ = seq aiuta di più"
            />
          </div>
          {comparison.layers_t5 && comparison.layers_t5.length > 0 ? (
            <table className="w-full text-[10px] mt-2">
              <thead>
                <tr className="text-ink-muted text-left border-b border-[rgb(var(--border))]/30">
                  <th className="pb-1 pr-2">Layer T-5</th>
                  <th className="pb-1">Δ(ΔMAE vs base)</th>
                  <th className="pb-1">Δ dir</th>
                </tr>
              </thead>
              <tbody>
                {comparison.layers_t5.map((r) => (
                  <tr key={r.layer} className="border-b border-[rgb(var(--border))]/10">
                    <td className="py-0.5 pr-2">{r.layer}</td>
                    <td className={`py-0.5 tabular-nums ${toneClass(deltaMaeTone(r.delta_mae_vs_base_change))}`}>
                      {formatDeltaMae(r.delta_mae_vs_base_change)}
                    </td>
                    <td className={`py-0.5 tabular-nums ${toneClass(deltaDirTone(r.delta_dir_change_pp))}`}>
                      {formatDeltaPp(r.delta_dir_change_pp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          </div>
        </AdvancedSection>
      ) : null}

      {data?.node_accuracy?.methodology_note ? (
        <p className="text-[10px] text-ink-muted italic">{data.node_accuracy.methodology_note}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <MetricCard
          label="MAE T-5"
          value={t5?.mae != null ? `${t5.mae.toFixed(1)}%` : "—"}
          tone={maeTone(t5?.mae)}
          sub={`n=${t5?.n_samples ?? 0}`}
        />
        <MetricCard
          label="Dir acc T-5"
          value={t5?.direction_accuracy != null ? `${(t5.direction_accuracy * 100).toFixed(0)}%` : "—"}
          tone={dirAccTone(t5?.direction_accuracy)}
        />
        <MetricCard
          label="MAE T-3"
          value={t3?.mae != null ? `${t3.mae.toFixed(1)}%` : "—"}
          tone={maeTone(t3?.mae)}
        />
        <MetricCard
          label="Ticker"
          value={String(data?.node_accuracy?.total_tickers ?? "—")}
          tone="muted"
          sub={`lookback ${data?.lookback_cds === 0 ? "tutti" : (data?.lookback_cds ?? "?")} CD`}
        />
        <MetricCard
          label="Slope5 @ 5d"
          value={
            slopeSignals.find((s) => s.signal === "slope5")?.direction_accuracy != null
              ? `${((slopeSignals.find((s) => s.signal === "slope5")!.direction_accuracy ?? 0) * 100).toFixed(0)}%`
              : "—"
          }
          tone={dirAccTone(slopeSignals.find((s) => s.signal === "slope5")?.direction_accuracy)}
        />
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 bg-surface/20">
        <h3 className="text-xs font-semibold mb-1">{t("modelLab.validation.chartTitle")}</h3>
        <p className="text-[10px] text-ink-muted mb-2">{t("modelLab.validation.chartHint")}</p>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="node" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line
                type="monotone"
                dataKey="mae"
                name="Corrente"
                stroke="rgb(var(--accent))"
                strokeWidth={2}
                dot
              />
              {baseline ? (
                <Line
                  type="monotone"
                  dataKey="maeBaseline"
                  name="Baseline"
                  stroke="rgb(var(--ink-muted))"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]/40 text-ink-muted text-left">
              <th className="p-2">Nodo</th>
              <th className="p-2">MAE</th>
              <th className="p-2">RMSE</th>
              <th className="p-2">Dir acc</th>
              <th className="p-2">Bias</th>
              <th className="p-2">Coverage</th>
              <th className="p-2">n</th>
              {comparison ? <th className="p-2">Δ MAE</th> : null}
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => {
              const cmpNode = comparison?.nodes?.find((c) => c.node === n.node);
              return (
                <tr key={n.node} className="border-b border-[rgb(var(--border))]/20">
                  <td className="p-2 font-medium">{n.node}</td>
                  <td className={`p-2 tabular-nums ${toneClass(maeTone(n.mae))}`}>
                    {n.mae != null ? `${n.mae.toFixed(2)}%` : "—"}
                  </td>
                  <td className="p-2 tabular-nums">{n.rmse != null ? `${n.rmse.toFixed(2)}%` : "—"}</td>
                  <td className={`p-2 tabular-nums ${toneClass(dirAccTone(n.direction_accuracy))}`}>
                    {n.direction_accuracy != null ? `${(n.direction_accuracy * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="p-2 tabular-nums">{n.bias != null ? `${n.bias > 0 ? "+" : ""}${n.bias.toFixed(2)}%` : "—"}</td>
                  <td className="p-2 tabular-nums">{n.coverage != null ? `${(n.coverage * 100).toFixed(0)}%` : "—"}</td>
                  <td className="p-2 tabular-nums">{n.n_samples}</td>
                  {comparison ? (
                    <td className={`p-2 tabular-nums ${toneClass(deltaMaeTone(cmpNode?.mae_delta))}`}>
                      {formatDeltaMae(cmpNode?.mae_delta)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {layerT5.length > 0 ? (
        <AdvancedSection title={t("modelLab.validation.detailsLayers")}>
          <table className="w-full text-xs mt-1">
            <thead>
              <tr className="text-ink-muted text-left border-b border-[rgb(var(--border))]/30">
                <th className="pb-1">Layer</th>
                <th className="pb-1">MAE</th>
                <th className="pb-1">Δ MAE</th>
                <th className="pb-1">Δ Dir</th>
                <th className="pb-1">n</th>
              </tr>
            </thead>
            <tbody>
              {layerT5.map((r) => (
                <tr key={r.layer} className="border-b border-[rgb(var(--border))]/15">
                  <td className="py-1 pr-2">{formatQcLayerLabel(r.layer, t)}</td>
                  <td className="py-1 tabular-nums">{r.mae != null ? `${r.mae.toFixed(2)}%` : "—"}</td>
                  <td
                    className={`py-1 tabular-nums ${r.delta_mae_vs_base != null && r.delta_mae_vs_base < 0 ? "text-emerald-600" : ""}`}
                  >
                    {r.delta_mae_vs_base != null ? `${r.delta_mae_vs_base > 0 ? "+" : ""}${r.delta_mae_vs_base.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-1 tabular-nums">
                    {r.delta_dir_acc_vs_base != null
                      ? `${r.delta_dir_acc_vs_base > 0 ? "+" : ""}${(r.delta_dir_acc_vs_base * 100).toFixed(1)}pp`
                      : "—"}
                  </td>
                  <td className="py-1 tabular-nums">{r.n_samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdvancedSection>
      ) : null}

      {slopeSignals.length > 0 ? (
        <AdvancedSection title={t("modelLab.validation.detailsSlopes")}>
          <table className="w-full text-xs mt-1">
            <thead>
              <tr className="text-ink-muted text-left">
                <th className="pb-1">Signal</th>
                <th className="pb-1">Horizon</th>
                <th className="pb-1">Dir acc</th>
                <th className="pb-1">MAE</th>
                <th className="pb-1">FP</th>
                <th className="pb-1">FN</th>
                {comparison ? <th className="pb-1">Δ dir</th> : null}
              </tr>
            </thead>
            <tbody>
              {slopeSignals.map((s) => {
                const cmp = comparison?.slopes?.find((x) => x.signal === s.signal);
                return (
                  <tr key={s.signal}>
                    <td className="py-1">{s.signal}</td>
                    <td className="py-1">{s.horizon_trading_days}d</td>
                    <td className={`py-1 ${toneClass(dirAccTone(s.direction_accuracy))}`}>
                      {s.direction_accuracy != null ? `${(s.direction_accuracy * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-1">{s.mae_pct != null ? `${s.mae_pct.toFixed(1)}%` : "—"}</td>
                    <td className="py-1">{pctFmt(s.false_positive_rate)}</td>
                    <td className="py-1">{pctFmt(s.false_negative_rate)}</td>
                    {comparison ? (
                      <td className={`py-1 tabular-nums ${toneClass(deltaDirTone(cmp?.dir_acc_delta_pp))}`}>
                        {formatDeltaPp(cmp?.dir_acc_delta_pp)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data?.slope_signals?.rotation_veto ? (
            <p className="text-[10px] text-ink-muted mt-2">
              Rotation veto: {JSON.stringify(data.slope_signals.rotation_veto)}
            </p>
          ) : null}
        </AdvancedSection>
      ) : null}

      {upFilter ? (
        <AdvancedSection title={t("modelLab.validation.detailsUpFilter")}>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
          <div>
            <h3 className="text-xs font-semibold mb-1">UP filter — prima</h3>
            <p>
              Segnali: {upFilter.before.up_signals} · Acc:{" "}
              {upFilter.before.direction_accuracy != null
                ? `${(upFilter.before.direction_accuracy * 100).toFixed(0)}%`
                : "—"}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold mb-1">UP filter — dopo</h3>
            <p>
              Segnali: {upFilter.after_filter.up_signals} · Soppressi: {upFilter.after_filter.suppressed} · Acc:{" "}
              {upFilter.after_filter.direction_accuracy != null
                ? `${(upFilter.after_filter.direction_accuracy * 100).toFixed(0)}%`
                : "—"}
            </p>
          </div>
          {upFilter.subset_note ? <p className="text-[10px] text-ink-muted sm:col-span-2">{upFilter.subset_note}</p> : null}
          </div>
        </AdvancedSection>
      ) : null}

      {worst.length > 0 ? (
        <AdvancedSection title={t("modelLab.validation.detailsWorst")}>
          <table className="w-full text-xs mt-1">
            <thead>
              <tr className="text-ink-muted text-left">
                <th>Ticker</th>
                <th>CD</th>
                <th>Mean |err|</th>
                <th>Nodi</th>
              </tr>
            </thead>
            <tbody>
              {worst.slice(0, 10).map((w) => (
                <tr key={`${w.ticker}-${w.cd_date}`}>
                  <td className="py-0.5 font-medium">{w.ticker}</td>
                  <td className="py-0.5">{w.cd_date}</td>
                  <td className="py-0.5 text-red-600 tabular-nums">{w.mean_abs_error.toFixed(1)}%</td>
                  <td className="py-0.5">{w.nodes_evaluated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdvancedSection>
      ) : null}
    </div>
  );
}
