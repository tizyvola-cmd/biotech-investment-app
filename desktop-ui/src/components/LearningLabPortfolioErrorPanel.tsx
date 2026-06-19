import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  applyPortfolioErrorLoop,
  fetchPortfolioErrorLoopStatus,
  previewPortfolioErrorLoop,
  resetPortfolioErrorLoop,
  type PortfolioErrorLoopStatus,
  type PortfolioErrorPreview,
} from "../api/learningBus";
import { useLang } from "../shared/i18n";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} €`;
}

export function LearningLabPortfolioErrorPanel({ reloadToken = 0 }: { reloadToken?: number }) {
  const { lang } = useLang();
  const it = lang === "it";
  const [status, setStatus] = useState<PortfolioErrorLoopStatus | null>(null);
  const [preview, setPreview] = useState<PortfolioErrorPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const doc = await fetchPortfolioErrorLoopStatus();
      setStatus(doc);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const historyChart = useMemo(() => {
    const hist = (status?.doc?.history ?? []) as Array<Record<string, unknown>>;
    return hist.slice(-24).map((h) => ({
      label: String(h.run_at ?? "").slice(5, 10),
      delta: h.weighted_vs_equal_delta_eur as number | null,
      weighted: (h.scenarios as Record<string, number> | undefined)?.weighted,
      equal: (h.scenarios as Record<string, number> | undefined)?.equal,
    }));
  }, [status]);

  const runPreview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const p = await previewPortfolioErrorLoop();
      setPreview(p);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!window.confirm(it ? "Applicare proposta parametri sizing?" : "Apply sizing parameter proposal?")) return;
    setBusy(true);
    try {
      await applyPortfolioErrorLoop();
      setPreview(null);
      await load();
      setMsg(it ? "Parametri applicati." : "Parameters applied.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runReset = async () => {
    if (!window.confirm(it ? "Reset parametri default?" : "Reset to default parameters?")) return;
    setBusy(true);
    try {
      await resetPortfolioErrorLoop();
      setPreview(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const snap = (preview?.snapshot ?? status?.latest) as Record<string, unknown> | undefined;
  const scenarios = (snap?.scenarios ?? {}) as Record<string, number | null>;

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-sm font-semibold text-ink">
            {it ? "Loop errore portafoglio (Fase 3)" : "Portfolio error loop (Phase 3)"}
          </h4>
          <p className="text-[10px] text-ink-muted mt-0.5 leading-relaxed">
            {it
              ? "Confronto controfattuale mine / equal / weighted su trade chiusi · propone Δ ai 4 parametri sizing."
              : "Counterfactual mine / equal / weighted on closed trades · proposes Δ to 4 sizing params."}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void runPreview()}>
            Preview
          </button>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void runApply()}>
            {it ? "Applica" : "Apply"}
          </button>
          <button type="button" className="btn-ghost text-xs text-negative" disabled={busy} onClick={() => void runReset()}>
            Reset
          </button>
        </div>
      </div>

      {loading && !status ? (
        <p className="text-[11px] text-ink-muted">{it ? "Caricamento…" : "Loading…"}</p>
      ) : null}
      {msg ? <p className="text-[10px] text-ink-muted">{msg}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{it ? "Trade chiusi" : "Closed trades"}</p>
          <p className="font-semibold tabular-nums">
            {status?.n_closed ?? (typeof snap?.n_closed === "number" ? snap.n_closed : "—")}
          </p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">Weighted − Equal</p>
          <p className="font-semibold tabular-nums">{fmtEur(status?.weighted_vs_equal_delta_eur ?? (snap?.weighted_vs_equal_delta_eur as number))}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">Equal</p>
          <p className="font-semibold tabular-nums">{fmtEur(scenarios.equal)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">Weighted</p>
          <p className="font-semibold tabular-nums">{fmtEur(scenarios.weighted)}</p>
        </div>
      </div>

      {status?.params ? (
        <p className="text-[10px] text-ink-muted font-mono">
          conf low={status.params.confidence_multipliers.low} med={status.params.confidence_multipliers.medium} high=
          {status.params.confidence_multipliers.high} · patternPenalty={status.params.pattern_penalty}
        </p>
      ) : null}

      {(preview?.pending_proposal ?? status?.pending_proposal)?.reason ? (
        <p className="text-[10px] text-amber-800 dark:text-amber-200 bg-amber-500/10 rounded px-2 py-1.5">
          {(preview?.pending_proposal ?? status?.pending_proposal)?.reason}
        </p>
      ) : null}

      {historyChart.length >= 2 ? (
        <div className="h-[120px] w-full">
          <p className="text-[10px] text-ink-muted mb-1">{it ? "Δ weighted−equal nel tempo" : "Weighted−equal Δ over time"}</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyChart}>
              <XAxis dataKey="label" tick={{ fontSize: 8 }} />
              <YAxis tick={{ fontSize: 8 }} width={36} unit="€" />
              <Tooltip contentStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="delta" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
