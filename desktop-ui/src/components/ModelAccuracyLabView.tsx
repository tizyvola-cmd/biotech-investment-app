import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { SheetTable } from "../types";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import {
  loadAccuracyMonitorDocument,
  loadAccuracySummaryDocument,
} from "../data/accuracyModelData";
import {
  ACCURACY_OFFSETS,
  aggregateFromAccuracySheet,
  buildTemporalRowsFromSummary,
  formatPct,
  formatPp,
  horizonLabel,
  loadModelLabParams,
  parseMonitorEntries,
  sortTemporalModelRows,
  isMonitorEntryValid,
  type MonitorEntry,
  type TemporalModelRow,
} from "../sheet/accuracyMetrics";
import { PredictionGuidePanel } from "./PredictionGuidePanel";
import {
  buildTemporalMetricRanges,
  buildModelAggRanges,
  cellStyleToCss,
  hitCellStyle,
  maeCellStyle,
  signedPpCellStyle,
} from "../sheet/modelLabTableStyles";

type ModelsTab = "temporal" | "overTime" | "guide";

function tabBtn(active: boolean) {
  return `rounded-md px-3 py-1.5 text-sm transition ${
    active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
  }`;
}

function formatRunLabel(iso: string): string {
  if (!iso || iso === "latest") return iso;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  }
  return iso.slice(0, 16);
}

function TemporalSummaryTable({ rows }: { rows: TemporalModelRow[] }) {
  const ranges = useMemo(() => buildTemporalMetricRanges(rows), [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        Nessun run in <code className="text-[10px]">accuracy_v4_v5_summary.json</code>. Esegui un
        refresh Accuracy dopo eventi con CD passata.
      </p>
    );
  }

  return (
    <div className="overflow-auto flex-1 min-h-0 border border-[rgb(var(--border))] rounded-lg">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-surface-elevated z-10">
          <tr className="border-b border-[rgb(var(--border))]">
            <th className="text-left px-2 py-1.5 font-medium">Run</th>
            <th className="text-left px-2 py-1.5 font-medium">Modello</th>
            <th className="text-right px-2 py-1.5 font-medium">N</th>
            {ACCURACY_OFFSETS.map((off) => (
              <th
                key={`mae-${off}`}
                className={`text-right px-2 py-1.5 font-medium ${
                  TABLE_COLORS_ENABLED ? "text-accent/90" : "text-ink-muted"
                }`}
              >
                MAE {horizonLabel(off)}
              </th>
            ))}
            <th className="text-right px-2 py-1.5 font-medium">MAE glob.</th>
            {ACCURACY_OFFSETS.map((off) => (
              <th
                key={`hit-${off}`}
                className={`text-right px-2 py-1.5 font-medium ${
                  TABLE_COLORS_ENABLED ? "text-positive/90" : "text-ink-muted"
                }`}
              >
                Hit {horizonLabel(off)}
              </th>
            ))}
            <th className="text-right px-2 py-1.5 font-medium">Hit glob.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.runIso}-${r.model}-${i}`}
              className="border-b border-[rgb(var(--border))]/50 hover:bg-surface-elevated/50"
            >
              <td className="px-2 py-1 whitespace-nowrap">{formatRunLabel(r.runIso)}</td>
              <td className="px-2 py-1 font-medium">{r.model}</td>
              <td className="px-2 py-1 text-right tabular-nums">{r.nRows ?? "—"}</td>
              {r.horizons.map((h) => (
                <td
                  key={`mae-${h.offset}`}
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(
                    maeCellStyle(h.mae, ranges.maeByOffset.get(h.offset))
                  )}
                >
                  {formatPp(h.mae)}
                </td>
              ))}
              <td
                className="px-2 py-1 text-right tabular-nums font-medium"
                style={cellStyleToCss(maeCellStyle(r.maeGlobal, ranges.maeGlobal))}
              >
                {formatPp(r.maeGlobal)}
              </td>
              {r.horizons.map((h) => (
                <td
                  key={`hit-${h.offset}`}
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(
                    hitCellStyle(h.hitPct, ranges.hitByOffset.get(h.offset))
                  )}
                >
                  {formatPct(h.hitPct)}
                </td>
              ))}
              <td
                className="px-2 py-1 text-right tabular-nums font-medium"
                style={cellStyleToCss(hitCellStyle(r.hitGlobal, ranges.hitGlobal))}
              >
                {formatPct(r.hitGlobal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetHorizonFallback({
  accTable,
  loading,
}: {
  accTable: SheetTable | null;
  loading: boolean;
}) {
  const params = useMemo(() => loadModelLabParams(), []);
  const aggs = useMemo(() => {
    if (!accTable?.rows?.length) return [];
    return aggregateFromAccuracySheet(
      accTable.rows as Record<string, unknown>[],
      params
    );
  }, [accTable, params]);

  const ranges = useMemo(() => buildModelAggRanges(aggs), [aggs]);

  if (loading) {
    return <p className="text-sm text-ink-muted py-4">Caricamento foglio Accuracy…</p>;
  }
  if (aggs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 shrink-0">
      <p className="text-xs text-ink-muted">
        Fallback da foglio Accuracy (snapshot) — il riepilogo run JSON non è ancora disponibile.
      </p>
      <div className="overflow-auto max-h-48 border border-[rgb(var(--border))] rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]">
              <th className="text-left px-2 py-1">Modello</th>
              {params.horizons.map((off) => (
                <th key={off} className="text-right px-2 py-1">
                  {horizonLabel(off)} MAE
                </th>
              ))}
              <th className="text-right px-2 py-1">Globale MAE</th>
              <th className="text-right px-2 py-1">Globale Hit</th>
            </tr>
          </thead>
          <tbody>
            {aggs.map((m) => (
              <tr key={m.model} className="border-b border-[rgb(var(--border))]/40">
                <td className="px-2 py-1 font-medium">{m.model}</td>
                {m.horizons.map((h) => (
                  <td
                    key={h.offset}
                    className="px-2 py-1 text-right tabular-nums"
                    style={cellStyleToCss(
                      maeCellStyle(h.mae, ranges.maeByOffset.get(h.offset))
                    )}
                  >
                    {formatPp(h.mae)}
                  </td>
                ))}
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(maeCellStyle(m.global.mae, ranges.maeGlobal))}
                >
                  {formatPp(m.global.mae)}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(hitCellStyle(m.global.hitPct, ranges.hitGlobal))}
                >
                  {formatPct(m.global.hitPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonitorOverTimePanel({
  entries,
  source,
  error,
}: {
  entries: MonitorEntry[];
  source: string;
  error: string | null;
}) {
  const validEntries = useMemo(
    () => entries.filter((e) => isMonitorEntryValid(e)),
    [entries]
  );
  const invalidCount = entries.length - validEntries.length;

  const monitorRanges = useMemo(() => {
    const acc: number[] = [];
    const mae7: number[] = [];
    const hit5: number[] = [];
    const bias7: number[] = [];
    const aff: number[] = [];
    const gap: number[] = [];
    for (const e of validEntries) {
      if (e.accV4Pct != null && Number.isFinite(e.accV4Pct)) acc.push(e.accV4Pct);
      if (e.m2Mae7 != null && Number.isFinite(e.m2Mae7)) mae7.push(e.m2Mae7);
      if (e.m2HitD5 != null && Number.isFinite(e.m2HitD5)) hit5.push(e.m2HitD5);
      if (e.m2Bias7 != null && Number.isFinite(e.m2Bias7)) bias7.push(Math.abs(e.m2Bias7));
      if (e.affMisurata != null && Number.isFinite(e.affMisurata)) aff.push(e.affMisurata);
      if (e.gapAff != null && Number.isFinite(e.gapAff)) gap.push(Math.abs(e.gapAff));
    }
    const r = (vals: number[]) =>
      vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
    return {
      acc: r(acc),
      mae7: r(mae7),
      hit5: r(hit5),
    };
  }, [validEntries]);

  const chartData = useMemo(
    () =>
      validEntries.map((e) => {
        const ts = Date.parse(e.runIso);
        return {
          runTs: Number.isNaN(ts) ? 0 : ts,
          run: formatRunLabel(e.runIso),
          accV4: e.accV4Pct,
          mae7: e.m2Mae7,
        };
      }),
    [validEntries]
  );

  if (error) {
    return <p className="text-sm text-negative px-1">{error}</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        Nessuno snapshot in{" "}
        <code className="text-[10px]">model_accuracy_monitor_history.json</code>. Dopo
        ricalibrazione o con <code className="text-[10px]">ACCURACY_MONITOR_EVERY_RUN=1</code>{" "}
        verrà accodata una riga per run.
      </p>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {source && (
        <p className="text-[10px] text-ink-muted shrink-0">Fonte: {source}</p>
      )}
      {invalidCount > 0 && (
        <p className="text-xs text-ink-muted shrink-0 rounded-lg border border-[rgb(var(--border))]/50 px-3 py-2 bg-surface/50">
          {invalidCount} run con coorte vuota (N ok_v4 = 0) — esclusi dal grafico. Riesegui{" "}
          <code className="text-[10px]">scripts/accuracy_monitor_snapshot.py</code> dopo un refresh
          Accuracy completo.
        </p>
      )}
      {validEntries.length === 0 ? (
        <p className="text-sm text-ink-muted py-4 text-center">
          Nessuno snapshot valido — tutte le righe hanno N ok_v4 = 0.
        </p>
      ) : (
        <div className="h-[220px] shrink-0">
          <p className="text-xs text-ink-muted mb-1">
            Acc % v4 (strict) e MAE T+7 nel tempo
            {validEntries.length === 1 ? " — un solo run valido" : ""}
          </p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
              <XAxis
                type="number"
                dataKey="runTs"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 9 }}
                tickFormatter={(ts) =>
                  new Date(Number(ts)).toLocaleString("it-IT", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                }
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} unit="%" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit=" pp" />
              <Tooltip
                labelFormatter={(ts) =>
                  new Date(Number(ts)).toLocaleString("it-IT", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                }
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="accV4"
                name="Acc % v4"
                stroke="rgb(var(--accent))"
                dot={{ r: 4 }}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="mae7"
                name="MAE T+7"
                stroke="rgb(var(--warn))"
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="overflow-auto flex-1 min-h-0 border border-[rgb(var(--border))] rounded-lg">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-surface-elevated z-10">
            <tr className="border-b border-[rgb(var(--border))]">
              <th className="text-left px-2 py-1.5">Run</th>
              <th className="text-left px-2 py-1.5">Trigger</th>
              <th className="text-right px-2 py-1.5">Acc % v4</th>
              <th className="text-right px-2 py-1.5">N ok_v4</th>
              <th className="text-right px-2 py-1.5">MAE T+7</th>
              <th className="text-right px-2 py-1.5">Hit dir. T+5</th>
              <th className="text-right px-2 py-1.5">Bias T+7</th>
              <th className="text-right px-2 py-1.5">Aff. misurata</th>
              <th className="text-right px-2 py-1.5">Gap aff.</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.runIso}
                className={`border-b border-[rgb(var(--border))]/50 hover:bg-surface-elevated/50 ${
                  e.invalid ? "opacity-50" : ""
                }`}
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  {formatRunLabel(e.runIso)}
                  {e.invalid && (
                    <span className="ml-1 text-[10px] text-ink-muted">(vuoto)</span>
                  )}
                </td>
                <td className="px-2 py-1 text-ink-muted whitespace-nowrap">
                  {e.trigger ?? "—"}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums font-medium"
                  style={cellStyleToCss(hitCellStyle(e.accV4Pct, monitorRanges.acc))}
                >
                  {formatPct(e.accV4Pct)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {e.nEval != null ? Math.round(e.nEval) : "—"}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(maeCellStyle(e.m2Mae7, monitorRanges.mae7))}
                >
                  {formatPp(e.m2Mae7)}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(hitCellStyle(e.m2HitD5, monitorRanges.hit5))}
                >
                  {formatPct(e.m2HitD5)}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(signedPpCellStyle(e.m2Bias7, 8))}
                >
                  {formatPp(e.m2Bias7)}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(hitCellStyle(e.affMisurata, monitorRanges.acc))}
                >
                  {formatPp(e.affMisurata)}
                </td>
                <td
                  className="px-2 py-1 text-right tabular-nums"
                  style={cellStyleToCss(signedPpCellStyle(e.gapAff, 15))}
                >
                  {formatPp(e.gapAff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Analisi modelli — accuratezza temporale (summary) vs nel tempo (monitor). */
export function ModelAccuracyLabView({
  accTable,
  loading: sheetLoading,
  error: sheetError,
  onReload,
  accuracyDataStale,
  manifestUpdatedAt,
  initialTab = "temporal",
}: {
  accTable: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  accuracyDataStale?: boolean;
  manifestUpdatedAt?: string | null;
  /** Tab iniziale (es. da sidebar «Distribuzione & curve»). */
  initialTab?: ModelsTab;
}) {
  const [tab, setTab] = useState<ModelsTab>(initialTab);
  const [summaryRows, setSummaryRows] = useState<TemporalModelRow[]>([]);
  const [summarySource, setSummarySource] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [monitorEntries, setMonitorEntries] = useState<MonitorEntry[]>([]);
  const [monitorSource, setMonitorSource] = useState("");
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(true);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const reloadJson = useCallback(async () => {
    setSummaryLoading(true);
    setMonitorLoading(true);
    setSummaryError(null);
    setMonitorError(null);

    const [sumRes, monRes] = await Promise.all([
      loadAccuracySummaryDocument(),
      loadAccuracyMonitorDocument(),
    ]);

    if (sumRes.doc) {
      setSummaryRows(buildTemporalRowsFromSummary(sumRes.doc));
      setSummarySource(sumRes.source);
      setSummaryError(null);
    } else {
      setSummaryRows([]);
      setSummarySource("");
      setSummaryError(sumRes.error ?? "Riepilogo assente");
    }
    setSummaryLoading(false);

    if (monRes.doc) {
      setMonitorEntries(parseMonitorEntries(monRes.doc));
      setMonitorSource(monRes.source);
      setMonitorError(null);
    } else {
      setMonitorEntries([]);
      setMonitorSource("");
      setMonitorError(monRes.error ?? "Monitor assente");
    }
    setMonitorLoading(false);
  }, []);

  useEffect(() => {
    void reloadJson();
  }, [reloadJson]);

  const handleReload = useCallback(() => {
    onReload();
    void reloadJson();
  }, [onReload, reloadJson]);

  const hasSummary = summaryRows.length > 0;
  const temporalDisplayRows = useMemo(
    () => sortTemporalModelRows(summaryRows, true),
    [summaryRows]
  );

  return (
    <section className="card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Analisi modelli</h2>
          <p className="text-xs text-ink-muted">
            Confronto v4/v5 · evoluzione run · distribuzione CD e curve μ
          </p>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap items-center">
          <button type="button" className={tabBtn(tab === "temporal")} onClick={() => setTab("temporal")}>
            Accuratezza temporale
          </button>
          <button type="button" className={tabBtn(tab === "overTime")} onClick={() => setTab("overTime")}>
            Accuratezza nel tempo
          </button>
          <button type="button" className={tabBtn(tab === "guide")} onClick={() => setTab("guide")}>
            Distribuzione &amp; curve
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={handleReload}>
            Ricarica
          </button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 p-4 gap-3 overflow-hidden">
        {tab === "temporal" && (
          <>
            <p className="text-xs text-ink-muted shrink-0">
              MAE e Hit % per orizzonte (T−60…T+7) per ogni run di refresh — come il foglio Excel{" "}
              <strong>Accuratezza temporale</strong> (
              <code className="text-[10px]">accuracy_v4_v5_summary.json</code>).
              {summarySource && ` · ${summarySource}`}
            </p>
            {summaryLoading ? (
              <p className="text-sm text-ink-muted">Caricamento riepilogo…</p>
            ) : (
              <>
                {summaryError && !hasSummary && (
                  <p className="text-sm text-negative shrink-0">{summaryError}</p>
                )}
                {!hasSummary && (
                  <SheetHorizonFallback accTable={accTable} loading={sheetLoading} />
                )}
                {sheetError && !accTable?.rows?.length && (
                  <p className="text-sm text-negative shrink-0">{sheetError}</p>
                )}
                <TemporalSummaryTable rows={temporalDisplayRows} />
              </>
            )}
          </>
        )}

        {tab === "overTime" && (
          <>
            <p className="text-xs text-ink-muted shrink-0">
              Snapshot pooled strict per run — come il foglio{" "}
              <strong>📈 Accuratezza nel tempo</strong> (
              <code className="text-[10px]">model_accuracy_monitor_history.json</code>). Ogni riga è
              un run aggregato, non un singolo titolo.
            </p>
            {monitorLoading ? (
              <p className="text-sm text-ink-muted">Caricamento monitor…</p>
            ) : (
              <MonitorOverTimePanel
                entries={monitorEntries}
                source={monitorSource}
                error={monitorError}
              />
            )}
          </>
        )}

        {tab === "guide" && (
          <>
            <p className="text-xs text-ink-muted shrink-0">
              Distribuzione % attorno al CD, fitting curve μ per macro-gruppo e confronto
              settimanale — come il foglio Excel <strong>Predizione — guida</strong>.
            </p>
            {sheetError && !accTable?.rows?.length && (
              <p className="text-sm text-negative shrink-0">{sheetError}</p>
            )}
            <div className="flex flex-1 min-h-0 overflow-auto">
              <PredictionGuidePanel
                accTable={accTable}
                sheetLoading={sheetLoading}
                accuracyDataStale={accuracyDataStale}
                manifestUpdatedAt={manifestUpdatedAt}
                onReloadAccuracy={onReload}
              />
            </div>
          </>
        )}

      </div>
    </section>
  );
}
