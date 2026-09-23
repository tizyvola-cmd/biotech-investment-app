import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { SheetTable } from "../types";
import {
  fetchLiveSignalsStatus,
  liveSignalRowsFromSimulation,
  loadSignalCalibration,
  rebuildSignalCalibration,
  type SignalCalibrationDoc,
  type SignalCohortStats,
  type SignalLiveRow,
} from "../data/signalCalibrationData";
import { api } from "../api/supernova";
import { formatPct } from "../sheet/accuracyMetrics";
import { PreCdSignalsLegendDrawer } from "./PreCdSignalsLegendDrawer";
import { PreCdSignalsNarrativeCard } from "./PreCdSignalsNarrativeCard";
import { PreCdSignalsTabIntro } from "./PreCdSignalsTabIntro";
import { PreCdSignalsScopeToggle } from "./PreCdSignalsScopeToggle";
import { PreCdCurveImpactChart } from "./PreCdCurveImpactChart";
import {
  filterLiveRowsByScope,
  type PreCdSignalsScope,
} from "../sheet/preCdSignalsScope";
import { useT } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

function CohortBadge({
  label,
  stats,
  filterHint,
}: {
  label: string;
  stats: SignalCohortStats | undefined;
  filterHint: string;
}) {
  const hit = stats?.hit_pct;
  const color =
    hit == null ? "text-ink-muted" : hit >= 60 ? "text-positive" : hit >= 52 ? "text-warn" : "text-negative";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 px-3 py-2 flex flex-col gap-0.5 min-w-[140px]">
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${color}`}>{formatPct(hit ?? null)}</span>
      <span className="text-[10px] text-ink-muted">
        n={stats?.n ?? 0} · {filterHint}
      </span>
      {stats?.avg_pred5 != null && stats?.avg_actual_5d != null && (
        <span className="text-[9px] text-ink-muted tabular-nums">
          avg pred5 {stats.avg_pred5 >= 0 ? "+" : ""}
          {stats.avg_pred5}% · actual {stats.avg_actual_5d >= 0 ? "+" : ""}
          {stats.avg_actual_5d}%
        </span>
      )}
    </div>
  );
}

function pctTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  if (v >= 0.05) return "text-[rgb(var(--signal-up))] font-semibold";
  if (v <= -0.05) return "text-[rgb(var(--signal-down))] font-semibold";
  return "text-ink-muted";
}

function affidTone(v: number | null | undefined): string {
  if (v == null) return "text-ink-muted";
  if (v >= 75) return "text-[rgb(var(--signal-up))] font-semibold";
  if (v >= 55) return "text-ink font-medium";
  return "text-[rgb(var(--warn))]";
}

function daysTone(days: number | null | undefined): string {
  if (days == null) return "text-ink-muted";
  if (days <= 3) return "text-[rgb(var(--signal-down))] font-bold";
  if (days <= 7) return "text-[rgb(var(--warn))] font-semibold";
  if (days <= 14) return "text-ink";
  return "text-ink-muted";
}

function DirBadge({ direction }: { direction: string }) {
  const dir = String(direction ?? "").toLowerCase();
  if (dir === "up") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-[rgb(var(--signal-up))]/45 bg-[rgb(var(--signal-up))]/12 px-1.5 py-0.5 text-[10px] font-bold text-[rgb(var(--signal-up))] whitespace-nowrap">
        ▲ Long
      </span>
    );
  }
  if (dir === "down") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/12 px-1.5 py-0.5 text-[10px] font-bold text-[rgb(var(--signal-down))] whitespace-nowrap">
        ▼ Short
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[rgb(var(--border))]/50 bg-surface/50 px-1.5 py-0.5 text-[10px] text-ink-muted">
      → —
    </span>
  );
}

function TierDot({ tier }: { tier?: string | null }) {
  if (tier === "strong") {
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-[rgb(var(--signal-up))] shrink-0"
        title="Strong tier"
      />
    );
  }
  if (tier === "useful") {
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-[rgb(var(--accent))] shrink-0"
        title="Useful tier"
      />
    );
  }
  return null;
}

function HitBadge({ hit, pending }: { hit: boolean | null | undefined; pending: boolean }) {
  if (pending || hit == null) {
    return <span className="text-ink-muted/45 text-sm font-medium">—</span>;
  }
  if (hit) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))] font-bold text-xs border border-[rgb(var(--signal-up))]/35">
        ✓
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[rgb(var(--signal-down))]/12 text-[rgb(var(--signal-down))] font-bold text-xs border border-[rgb(var(--signal-down))]/35">
      ✗
    </span>
  );
}

function LiveSignalsTable({
  rows,
  preview,
  showAllWithMetrics,
}: {
  rows: SignalLiveRow[] | undefined;
  preview?: boolean;
  /** In anteprima Simulation: mostra righe con pred5/affid anche se sotto soglia actionable. */
  showAllWithMetrics?: boolean;
}) {
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => (a.days_to_cd ?? 999) - (b.days_to_cd ?? 999));
    if (showAllWithMetrics) {
      return list.filter((r) => r.pred5_pp != null || (r.affid != null && r.affid > 0));
    }
    return list.filter((r) => r.signal_emitted);
  }, [rows, showAllWithMetrics]);

  if (!sorted.length) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">
        {preview
          ? "Nessuna riga Simulation con Pred +5 / Affidabilità — esegui prima «Refresh live signals» (o refresh Simulation)."
          : "Nessun segnale actionable in audit — attendi fine refresh o riesegui «Refresh live signals»."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-muted px-0.5">
        <span className="inline-flex items-center gap-1">
          <span className="text-[rgb(var(--signal-up))] font-bold">▲</span> Long
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-[rgb(var(--signal-down))] font-bold">▼</span> Short
        </span>
        <span>· CD ≤7d <span className="text-[rgb(var(--warn))] font-semibold">ambra</span></span>
        <span>· Affid ≥75 <span className="text-[rgb(var(--signal-up))]">verde</span></span>
        <span>· Hit <span className="text-[rgb(var(--signal-up))]">✓</span> / <span className="text-[rgb(var(--signal-down))]">✗</span></span>
      </div>
      <div className="overflow-auto max-h-[280px] border border-[rgb(var(--border))]/50 rounded-lg">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse`}>
        <SheetGridColgroup columnCount={7} />
        <thead className="sticky top-0 bg-surface-elevated z-10">
          <tr className="border-b border-[rgb(var(--border))] text-[10px] uppercase tracking-wide text-ink-muted">
            <th className={gridTh("left", "font-semibold")}>Ticker</th>
            <th className={gridTh("center", "font-semibold")}>Giorni CD</th>
            <th className={gridTh("left", "font-semibold")}>Dir</th>
            <th className={gridTh("center", "font-semibold")}>Pred5</th>
            <th className={gridTh("center", "font-semibold")}>Affid</th>
            <th className={gridTh("center", "font-semibold")}>Actual +5g</th>
            <th className={gridTh("center", "font-semibold")}>Hit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const dir = String(r.direction ?? "").toLowerCase();
            const pending = r.actual_5d_pct == null;
            const urgentCd = r.days_to_cd != null && r.days_to_cd <= 7;
            const rowBg =
              r.hit === true
                ? "bg-[rgb(var(--signal-up))]/[0.04]"
                : r.hit === false
                  ? "bg-[rgb(var(--signal-down))]/[0.04]"
                  : urgentCd
                    ? "bg-[rgb(var(--warn))]/[0.05]"
                    : "";
            return (
              <tr
                key={`${r.ticker}-${r.log_date}`}
                className={`border-b border-[rgb(var(--border))]/30 transition-colors hover:bg-[rgb(var(--surface-3))]/20 ${rowBg}`}
              >
                <td className={gridTd("left")}>
                  <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                    <TierDot tier={r.signal_tier} />
                    {r.ticker}
                  </span>
                </td>
                <td className={`${gridTd("center")} ${daysTone(r.days_to_cd)}`}>
                  {r.days_to_cd ?? "—"}
                  {r.days_to_cd != null && r.days_to_cd <= 7 && (
                    <span className="block text-[8px] font-normal opacity-80">
                      {r.days_to_cd <= 3 ? "⚡ urgente" : "finestra"}
                    </span>
                  )}
                </td>
                <td className={gridTd("left")}>
                  <DirBadge direction={dir} />
                </td>
                <td className={`${gridTd("center")} ${pctTone(r.pred5_pp)}`}>
                  {r.pred5_pp != null ? `${r.pred5_pp >= 0 ? "+" : ""}${r.pred5_pp}%` : "—"}
                </td>
                <td className={`${gridTd("center")} ${affidTone(r.affid)}`}>
                  {r.affid ?? "—"}
                </td>
                <td className={`${gridTd("center")} ${pending ? "text-ink-muted" : pctTone(r.actual_5d_pct)}`}>
                  {pending ? (
                    <span className="text-[10px] italic opacity-70">pending</span>
                  ) : (
                    `${r.actual_5d_pct! >= 0 ? "+" : ""}${r.actual_5d_pct}%`
                  )}
                </td>
                <td className={gridTd("center")}>
                  <HitBadge hit={r.hit} pending={pending} />
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

export function PreCdSignalsPanel({
  simTable,
}: {
  simTable?: SheetTable | null;
}) {
  const t = useT();
  const [scope, setScope] = useState<PreCdSignalsScope>("preCdRunup");
  const [doc, setDoc] = useState<SignalCalibrationDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const simPreview = useMemo(() => liveSignalRowsFromSimulation(simTable ?? null), [simTable]);

  const liveRows = useMemo(() => {
    const fromAudit = doc?.live_latest ?? [];
    if (fromAudit.length) return fromAudit;
    return simPreview;
  }, [doc?.live_latest, simPreview]);

  const usingSimPreview = !(doc?.live_latest?.length) && simPreview.length > 0;
  const auditEmpty = (doc?.log_rows ?? 0) === 0;

  const scopedLiveRows = useMemo(
    () => filterLiveRowsByScope(liveRows, scope),
    [liveRows, scope],
  );

  const scopeCounts = useMemo(
    () => ({
      runup: filterLiveRowsByScope(liveRows, "preCdRunup").length,
      near: filterLiveRowsByScope(liveRows, "nearCd").length,
    }),
    [liveRows],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await loadSignalCalibration();
    setDoc(res.doc);
    setError(res.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const weeklyChart = useMemo(() => {
    return (doc?.weekly_actionable ?? []).map((w) => ({
      week: w.week_key.replace(/^\d+-W/, "W"),
      hitPct: w.hit_pct,
      n: w.n,
    }));
  }, [doc?.weekly_actionable]);

  const scatterData = useMemo(() => {
    return (doc?.scatter_pred5_vs_actual ?? [])
      .filter((p) => p.pred5_pp != null && p.actual_5d_pct != null)
      .map((p) => ({
        x: Number(p.pred5_pp),
        y: Number(p.actual_5d_pct),
        ticker: p.ticker,
        hit: p.hit,
      }));
  }, [doc?.scatter_pred5_vs_actual]);

  const handleRebuild = async () => {
    setRebuilding(true);
    setMsg(null);
    const res = await rebuildSignalCalibration();
    if (res.ok) {
      setMsg(`Calibrazione aggiornata · ${res.closed ?? 0} outcome chiusi`);
      await reload();
    } else {
      setMsg(res.error ?? "Rebuild fallito");
    }
    setRebuilding(false);
  };

  const handleLiveRefresh = async () => {
    setLiveRunning(true);
    setMsg(null);
    try {
      await api("/api/refresh/live-signals?cd_horizon=90", { method: "POST" });
      setMsg("Refresh live signals in corso (~20–30s)…");
      const poll = async (attempt: number) => {
        const st = await fetchLiveSignalsStatus();
        if (st.running && attempt < 24) {
          window.setTimeout(() => void poll(attempt + 1), 2500);
          return;
        }
        await reload();
        if (st.message) {
          setMsg(st.ok ? `OK: ${st.message}` : st.message);
        } else if (st.running) {
          setMsg("Ancora in corso — clic ↻ JSON tra poco.");
        } else {
          setMsg("Refresh terminato. Se log=0, verifica ticker con CD ≤90gg in Simulation.");
        }
        setLiveRunning(false);
      };
      window.setTimeout(() => void poll(0), 3000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setLiveRunning(false);
    }
  };

  const filt = doc?.filters;
  const cohorts = doc?.cohorts;

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <PreCdSignalsTabIntro scope={scope} />

      <PreCdSignalsScopeToggle
        scope={scope}
        onScopeChange={setScope}
        runupCount={scopeCounts.runup}
        nearCount={scopeCounts.near}
      />

      <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted pt-1 shrink-0">
        {t("modelLab.learnings.todayHeading")}
      </h3>

      <PreCdSignalsNarrativeCard
        doc={doc}
        liveRows={scopedLiveRows}
        usingSimPreview={usingSimPreview}
        loading={loading}
        scope={scope}
      />

      <p className="text-[10px] text-ink-muted shrink-0 leading-snug">{t("preCd.scope.historicNote")}</p>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <p className="text-xs text-ink-muted flex-1 min-w-[220px]">
          Segnali pre-CD da <code className="text-[10px]">refresh_live_signals</code> — pred5, affid, direzione.
          Outcome a +5 sessioni in <code className="text-[10px]">signal_audit_log.jsonl</code>.
          {doc?.generated_at && (
            <span className="ml-1 opacity-70">
              · agg. {new Date(doc.generated_at).toLocaleString()}
            </span>
          )}
        </p>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setLegendOpen(true)}
          title={t("preCd.legend.openTitle")}
        >
          {t("preCd.legend.open")}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={liveRunning}
          onClick={() => void handleLiveRefresh()}
        >
          {liveRunning ? "Live…" : "Refresh live signals"}
        </button>
        <button
          type="button"
          className="btn-primary text-xs disabled:opacity-50"
          disabled={rebuilding}
          onClick={() => void handleRebuild()}
        >
          {rebuilding ? "Rebuild…" : "Rebuild calibration"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => void reload()}>
          ↻ JSON
        </button>
      </div>

      {msg && <p className="text-[11px] text-accent shrink-0">{msg}</p>}
      {error && auditEmpty && <p className="text-sm text-ink-muted shrink-0">{error}</p>}
      {auditEmpty && !loading && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100 shrink-0">
          <strong>Normale al primo utilizzo.</strong> KPI e grafici restano vuoti finché non esiste{" "}
          <code className="text-[10px]">signal_audit_log.jsonl</code> (dopo un refresh completato) e
          outcome chiusi a +5 giorni (grafici: ≥2 settimane di log, scatter: rebuild dopo ~6 giorni).
          {usingSimPreview && " Sotto: anteprima live da Simulation."}
        </div>
      )}
      {loading && <p className="text-sm text-ink-muted">Caricamento…</p>}

      {!loading && doc && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
            <CohortBadge
              label="Raw (direzionale)"
              stats={cohorts?.raw}
              filterHint="tutti con outcome"
            />
            <CohortBadge
              label="Useful"
              stats={cohorts?.useful}
              filterHint={`affid≥${filt?.useful?.affid_min ?? 50} · |pred5|≥${filt?.useful?.pred5_abs_min ?? 2}%`}
            />
            <CohortBadge
              label="Strong"
              stats={cohorts?.strong}
              filterHint={`affid≥${filt?.strong?.affid_min ?? 50} · |pred5|≥${filt?.strong?.pred5_abs_min ?? 3}%`}
            />
          </div>

          <p className="text-[10px] text-ink-muted shrink-0">
            Log {doc.log_rows ?? 0} righe · {doc.closed_rows ?? 0} con outcome ·{" "}
            {doc.pending_outcomes ?? 0} in attesa (+5g)
            {simTable?.rows?.length ? ` · Simulation ${simTable.rows.length} righe` : ""}
          </p>

          <PreCdCurveImpactChart impact={doc.curve_impact_cumulative} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 shrink-0">
            <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3 h-[220px]">
              <p className="text-xs font-semibold text-ink mb-2">Learning curve — Hit% segnali actionable / settimana</p>
              {weeklyChart.length < 2 ? (
                <p className="text-[11px] text-ink-muted py-8 text-center">
                  Servono ≥2 settimane di refresh live dopo outcome chiusi.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="85%">
                  <LineChart data={weeklyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis domain={[40, 80]} tick={{ fontSize: 10 }} unit="%" />
                    <ReferenceLine y={60} stroke="#16a34a" strokeDasharray="4 4" />
                    <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="2 2" />
                    <Tooltip formatter={(v: number) => [`${v?.toFixed(1)}%`, "Hit%"]} />
                    <Line type="monotone" dataKey="hitPct" stroke="#6d28d9" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3 h-[220px]">
              <p className="text-xs font-semibold text-ink mb-2">Pred5 calibration — previsto vs actual +5g</p>
              {scatterData.length < 3 ? (
                <p className="text-[11px] text-ink-muted py-8 text-center">
                  Servono outcome chiusi (Rebuild dopo ~6 giorni dal log).
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="85%">
                  <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" dataKey="x" name="Pred5" unit="%" tick={{ fontSize: 10 }} />
                    <YAxis type="number" dataKey="y" name="Actual" unit="%" tick={{ fontSize: 10 }} />
                    <ZAxis range={[40, 40]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v: number, name: string) => [`${v?.toFixed(1)}%`, name]}
                      labelFormatter={() => ""}
                      content={({ payload }) =>
                        payload?.[0] ? (
                          <div className="rounded bg-surface-elevated border px-2 py-1 text-[10px]">
                            <strong>{payload[0].payload.ticker}</strong>
                            <br />
                            pred5 {payload[0].payload.x}% · actual {payload[0].payload.y}%
                          </div>
                        ) : null
                      }
                    />
                    <ReferenceLine segment={[{ x: -15, y: -15 }, { x: 15, y: 15 }]} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Scatter data={scatterData} fill="#6d28d9" />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <p className="text-xs font-semibold text-ink mb-1">
              {usingSimPreview
                ? "Anteprima da Simulation (audit log ancora vuoto)"
                : "Live actionable signals (ultimo audit per ticker)"}
            </p>
            {usingSimPreview && (
              <p className="text-[10px] text-ink-muted mb-2">
                Tier useful = affid≥50 e |pred5|≥2% · strong ≥3%. Dopo refresh, i dati passano
                nell&apos;audit per learning curve e hit% storici.
              </p>
            )}
            <LiveSignalsTable
              rows={scopedLiveRows}
              preview={usingSimPreview}
              showAllWithMetrics={usingSimPreview}
            />
          </div>
          {scopedLiveRows.length === 0 && liveRows.length > 0 && (
            <p className="text-sm text-ink-muted shrink-0">
              {scope === "nearCd" ? t("preCd.scope.emptyNear") : t("preCd.scope.emptyRunup")}
            </p>
          )}
        </>
      )}
      <PreCdSignalsLegendDrawer open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
