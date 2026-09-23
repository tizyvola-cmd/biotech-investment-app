import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/supernova";
import type { EvaluationResults } from "../data/evaluationModelData";
import { fetchProjectJson } from "../data/projectData";
import { deltaMaeTone, formatDeltaMae, toneClass } from "../data/evaluationModelData";
import { useT, type TranslationKey } from "../shared/i18n";

export type BlendAbSummary = {
  n?: number;
  rmse_off_mean_pp?: number | null;
  rmse_on_mean_pp?: number | null;
  delta_rmse_mean_pp?: number | null;
  mae_off_mean_pp?: number | null;
  mae_on_mean_pp?: number | null;
  delta_mae_mean_pp?: number | null;
  wins_on?: number;
  wins_off?: number;
  ties?: number;
  hit_off_pct?: number | null;
  hit_on_pct?: number | null;
  n_hit?: number;
  n_proxy_raw?: number;
};

export type BlendAbPayload = {
  metric?: string;
  generated_at?: string;
  verdict?: "improved" | "worse" | "neutral";
  summary?: BlendAbSummary;
  by_source?: Record<string, BlendAbSummary>;
  top_improvements?: Array<{
    key?: string;
    ticker?: string;
    cd?: string;
    delta_rmse_pp?: number;
    rmse_off_pp?: number;
    rmse_on_pp?: number;
    source?: string;
  }>;
  top_regressions?: Array<{
    key?: string;
    ticker?: string;
    cd?: string;
    delta_rmse_pp?: number;
    source?: string;
  }>;
  error?: string;
};

const LAYER_LABEL_KEYS: Record<string, string> = {
  raw_polynomial: "modelLab.qc.layer.raw",
  emp_precat_blend: "modelLab.qc.layer.empBlend",
  base_polynomial: "modelLab.qc.layer.base",
  seq_calib: "modelLab.qc.layer.seq",
  eis_shift: "modelLab.qc.layer.eis",
  daily_open_anchor: "modelLab.qc.layer.daily",
  full_model: "modelLab.qc.layer.full",
};

export function formatQcLayerLabel(
  layer: string,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const key = LAYER_LABEL_KEYS[layer];
  return key ? t(key as TranslationKey) : layer;
}

export function blendAbFromLayerDeltas(data: EvaluationResults | null): BlendAbPayload | null {
  const layers = data?.layer_deltas?.nodes?.["T-5"];
  if (!layers?.length) return null;
  const raw = layers.find((l) => l.layer === "raw_polynomial");
  const emp = layers.find((l) => l.layer === "emp_precat_blend");
  if (!raw || raw.mae == null || !emp) return null;
  const deltaMae = emp.delta_mae_vs_base;
  let verdict: BlendAbPayload["verdict"] = "neutral";
  if (deltaMae != null) {
    if (deltaMae < -0.05) verdict = "improved";
    else if (deltaMae > 0.05) verdict = "worse";
  }
  return {
    metric: "emp_precat_blend_validation_t5",
    generated_at: data?.generated_at,
    verdict,
    summary: {
      n: emp.n_samples ?? raw?.n_samples,
      rmse_off_mean_pp: null,
      rmse_on_mean_pp: null,
      delta_rmse_mean_pp: null,
      mae_off_mean_pp: raw?.mae ?? null,
      mae_on_mean_pp: emp.mae ?? null,
      delta_mae_mean_pp: deltaMae ?? null,
    },
  };
}

export function resolveBlendAbPayload(data: EvaluationResults | null): BlendAbPayload | null {
  return blendAbFromEvaluation(data) ?? blendAbFromLayerDeltas(data);
}

export async function fetchBlendAbRefresh(): Promise<BlendAbPayload> {
  const { data: local } = await fetchProjectJson<EvaluationResults>("evaluation_results.json");
  const fromLocal = resolveBlendAbPayload(local);
  if (fromLocal) return fromLocal;

  try {
    const ev = await api<EvaluationResults>("/api/evaluation/results");
    const fromEv = resolveBlendAbPayload(ev);
    if (fromEv) return fromEv;
  } catch {
    /* continue */
  }

  try {
    return await api<BlendAbPayload>("/api/evaluation/blend-ab");
  } catch (primary) {
    if (fromLocal) return fromLocal;
    throw primary;
  }
}

type Props = {
  embedded?: BlendAbPayload | null;
  /** Full Validation document — used before remote blend-ab (offline-safe). */
  evaluation?: EvaluationResults | null;
  /** Skip GET /api/evaluation/blend-ab (Validation tab). */
  preferLocal?: boolean;
  compact?: boolean;
  showLayerHint?: boolean;
};

function payloadFromProps(
  embedded?: BlendAbPayload | null,
  evaluation?: EvaluationResults | null,
): BlendAbPayload | null {
  return embedded ?? resolveBlendAbPayload(evaluation ?? null);
}

function fmtPp(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)} pp`;
}

export function ModelQcBlendPanel({
  embedded,
  evaluation,
  preferLocal = false,
  compact,
  showLayerHint = true,
}: Props) {
  const t = useT();
  const fromProps = useMemo(
    () => payloadFromProps(embedded, evaluation),
    [embedded, evaluation],
  );
  const [data, setData] = useState<BlendAbPayload | null>(fromProps);
  const [loading, setLoading] = useState(!fromProps && evaluation === undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchBlendAbRefresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fromProps) {
      setData(fromProps);
      setLoading(false);
      setError(null);
      return;
    }
    if (evaluation !== undefined) {
      if (evaluation === null) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }
      if (preferLocal) {
        setLoading(true);
        setError(null);
        void (async () => {
          try {
            const { data: local } = await fetchProjectJson<EvaluationResults>(
              "evaluation_results.json",
            );
            setData(resolveBlendAbPayload(local) ?? resolveBlendAbPayload(evaluation));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setLoading(false);
          }
        })();
        return;
      }
    }
    void refresh();
  }, [fromProps, evaluation, preferLocal, refresh]);

  const s = data?.summary;
  const n = s?.n ?? 0;

  if (loading && !s) {
    return (
      <p className="text-xs text-ink-muted rounded-lg border border-dashed border-[rgb(var(--border))]/50 p-3">
        {t("modelLab.qc.blend.loading")}
      </p>
    );
  }

  if (error && !s) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300 space-y-2">
        <p>{error}</p>
        <button type="button" className="rounded border px-2 py-1 text-[11px]" onClick={() => void refresh()}>
          {t("modelLab.qc.blend.retry")}
        </button>
      </div>
    );
  }

  if (!n) {
    if (evaluation && !error) {
      return (
        <div className="rounded-lg border border-amber-200/50 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-[11px] text-amber-900 dark:text-amber-100">
          {t("modelLab.qc.blend.runTest")}
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-amber-200/50 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-[11px] text-amber-900 dark:text-amber-100">
        {data?.error ?? t("modelLab.qc.blend.empty")}
      </div>
    );
  }

  const delta = s?.delta_rmse_mean_pp ?? s?.delta_mae_mean_pp;
  const useMae = s?.delta_rmse_mean_pp == null && s?.delta_mae_mean_pp != null;
  const verdict =
    data?.verdict === "improved"
      ? t("modelLab.qc.blend.verdictImproved")
      : data?.verdict === "worse"
        ? t("modelLab.qc.blend.verdictWorse")
        : t("modelLab.qc.blend.verdictNeutral");

  return (
    <section
      className={`rounded-xl border border-[rgb(var(--border))]/55 bg-surface/35 space-y-3 ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t("modelLab.qc.blend.title")}</h3>
          {showLayerHint ? (
            <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">{t("modelLab.qc.blend.lead")}</p>
          ) : null}
        </div>
        {!embedded && !fromProps ? (
          <button
            type="button"
            className="rounded-md border border-[rgb(var(--border))]/60 px-2 py-1 text-[11px] hover:bg-surface/80"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : t("modelLab.qc.blend.refresh")}
          </button>
        ) : null}
      </div>

      <p className={`text-xs font-medium ${toneClass(deltaMaeTone(delta != null ? -delta : null))}`}>{verdict}</p>

      <div className="flex flex-wrap gap-2">
        {useMae ? (
          <>
            <MetricChip
              label={t("modelLab.qc.blend.maeOff")}
              value={s?.mae_off_mean_pp != null ? `${s.mae_off_mean_pp.toFixed(2)}%` : "—"}
            />
            <MetricChip
              label={t("modelLab.qc.blend.maeOn")}
              value={s?.mae_on_mean_pp != null ? `${s.mae_on_mean_pp.toFixed(2)}%` : "—"}
            />
            <MetricChip
              label="Δ MAE T−5"
              value={formatDeltaMae(s?.delta_mae_mean_pp)}
              tone={deltaMaeTone(s?.delta_mae_mean_pp != null ? -s.delta_mae_mean_pp : null)}
            />
          </>
        ) : (
          <>
            <MetricChip label={t("modelLab.qc.blend.rmseOff")} value={fmtPp(s?.rmse_off_mean_pp)} />
            <MetricChip label={t("modelLab.qc.blend.rmseOn")} value={fmtPp(s?.rmse_on_mean_pp)} />
            <MetricChip
              label="Δ RMSE"
              value={formatDeltaMae(s?.delta_rmse_mean_pp)}
              tone={deltaMaeTone(s?.delta_rmse_mean_pp != null ? -s.delta_rmse_mean_pp : null)}
            />
          </>
        )}
        <MetricChip
          label={t("modelLab.qc.blend.wins")}
          value={`ON ${s?.wins_on ?? 0} · OFF ${s?.wins_off ?? 0}`}
        />
        {s?.hit_on_pct != null ? (
          <MetricChip label={t("modelLab.qc.blend.hitT5")} value={`${s.hit_off_pct}% → ${s.hit_on_pct}%`} />
        ) : null}
        <MetricChip label="n" value={String(n)} sub={s?.n_proxy_raw ? t("modelLab.qc.blend.proxyNote") : undefined} />
      </div>

      {data?.by_source && Object.keys(data.by_source).length > 1 && !compact ? (
        <div className="text-[10px] text-ink-muted space-y-1">
          {Object.entries(data.by_source).map(([src, sub]) => (
            <p key={src}>
              <span className="font-medium text-ink">{src}</span>: n={sub.n ?? 0}, Δ RMSE{" "}
              {formatDeltaMae(sub.delta_rmse_mean_pp)}
            </p>
          ))}
        </div>
      ) : null}

      {!compact && (data?.top_improvements?.length || data?.top_regressions?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
          {data.top_improvements?.length ? (
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                {t("modelLab.qc.blend.topBetter")}
              </p>
              <ul className="space-y-0.5 text-ink-muted">
                {data.top_improvements.slice(0, 3).map((r) => (
                  <li key={r.key}>
                    {r.ticker} {r.cd}: Δ {formatDeltaMae(r.delta_rmse_pp)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.top_regressions?.length ? (
            <div>
              <p className="font-semibold text-red-600 dark:text-red-400 mb-1">
                {t("modelLab.qc.blend.topWorse")}
              </p>
              <ul className="space-y-0.5 text-ink-muted">
                {data.top_regressions.slice(0, 3).map((r) => (
                  <li key={r.key}>
                    {r.ticker} {r.cd}: Δ {formatDeltaMae(r.delta_rmse_pp)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MetricChip({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red" | "muted";
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 px-2.5 py-1.5 min-w-[100px]">
      <div className="text-[9px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone ? toneClass(tone) : "text-ink"}`}>{value}</div>
      {sub ? <div className="text-[9px] text-ink-muted mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function blendAbFromEvaluation(data: EvaluationResults | null): BlendAbPayload | null {
  if (!data?.blend_ab) return null;
  return data.blend_ab as BlendAbPayload;
}
