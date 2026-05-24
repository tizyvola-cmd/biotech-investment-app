import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, ChartSeries, SheetTable } from "../types";
import {
  loadSimulationChartsBundle,
  simulationRowPredAtOffset,
  simulationRowSeriesKey,
  findSimulationRow,
  overlaySheetPredOnPoints,
} from "../data/simulationCharts";
import { fetchDesktopManifest, type DesktopDataManifest } from "../data/projectData";
import {
  defaultVisibleRefs,
  loadChartComparePrefs,
  loadSimChartPrefs,
  MAX_CHART_COMPARE_SERIES,
  saveChartComparePrefs,
  saveSimChartPrefs,
  type ChartCompareMode,
  type ChartComparePrefs,
  type SimChartPrefs,
} from "../sheet/chartPrefs";
import { buildNowMarkersFromSimulationRows } from "../sheet/chartNowOffset";
import {
  PricePathChart,
  SimulationCurveChart,
  VariationHorizonChart,
  type CurveLineSpec,
} from "./SimulationCurveChart";

const REF_COLORS: Record<string, string> = {
  "Cluster 0": "#9ca3af",
  "SuperNova (cl.1)": "#c8ff00",
  "μ SuperNova (cl.1)": "#c8ff00",
  "Post-CD rialzo": "#00c896",
  "μ Post-CD rialzo": "#00c896",
  "Post-CD ribasso": "#fb7185",
  "μ Post-CD ribasso": "#fb7185",
  "Globale primaria": "#94a3b8",
  "controllo negativo": "#64748b",
};

const COMPANY_CURVA = ["#00dc96", "#00af78"] as const;
const COMPANY_STORICO = ["#78c8ff", "#af8cff"] as const;
const COMPANY_MODELLO = ["#ffa726", "#ff6b5a"] as const;

const MULTI_PALETTE = [
  "#00dc96",
  "#78c8ff",
  "#ffa726",
  "#af8cff",
  "#fb7185",
  "#00c896",
  "#c8ff00",
  "#94a3b8",
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#e879f9",
] as const;

const COMPARE_MODE_LABELS: Record<ChartCompareMode, string> = {
  single: "Singola",
  pair2: "Confronto 2",
  all: "Tutte Simulation",
  multi: "Selezione multipla",
};

function seriesColor(slot: number): string {
  if (slot < 2) return COMPANY_STORICO[slot];
  return MULTI_PALETTE[slot % MULTI_PALETTE.length];
}

function simTableSeriesKeys(
  simTable: SheetTable | null,
  bundle: ChartBundle | null
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of simTable?.rows ?? []) {
    const k = simulationRowSeriesKey(row);
    if (!k || seen.has(k) || !bundle?.series[k]) continue;
    seen.add(k);
    keys.push(k);
  }
  return keys.sort((a, b) => {
    const la = bundle?.series[a]?.label ?? a;
    const lb = bundle?.series[b]?.label ?? b;
    return la.localeCompare(lb);
  });
}

function refColor(label: string): string {
  for (const [k, c] of Object.entries(REF_COLORS)) {
    if (label.includes(k) || k.includes(label)) return c;
  }
  return "#a8b0bc";
}

function listCompanies(bundle: ChartBundle | null): { id: string; label: string }[] {
  if (!bundle?.series) return [];
  return Object.entries(bundle.series)
    .filter(([, s]) => s.kind === "company")
    .map(([id, s]) => ({ id, label: s.label || id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function listControls(bundle: ChartBundle | null): { id: string; label: string }[] {
  if (!bundle?.series) return [];
  return Object.entries(bundle.series)
    .filter(([, s]) => s.kind === "control")
    .map(([id, s]) => ({ id, label: s.label || id.replace(/^ref:/, "") }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function SimulationAnalysisView({
  simTable,
  simLoading,
  focusSeriesKey,
  focusTicker,
  onFocusConsumed,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  focusSeriesKey?: string | null;
  focusTicker?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [bundle, setBundle] = useState<ChartBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<DesktopDataManifest | null>(null);
  const [prefs, setPrefs] = useState<SimChartPrefs>(() => loadSimChartPrefs());
  const [comparePrefs, setComparePrefs] = useState<ChartComparePrefs>(() =>
    loadChartComparePrefs()
  );
  const [filter, setFilter] = useState("");

  const companies = useMemo(() => listCompanies(bundle), [bundle]);
  const controls = useMemo(() => listControls(bundle), [bundle]);

  const reloadCharts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await loadSimulationChartsBundle();
    setBundle(res.bundle);
    setSource(res.source);
    if (res.error) setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reloadCharts();
  }, [reloadCharts]);

  useEffect(() => {
    void fetchDesktopManifest().then(setManifest);
  }, [bundle?.loaded_at]);

  const appliedChartsFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!focusSeriesKey && !focusTicker) {
      appliedChartsFocus.current = null;
      return;
    }
    if (!bundle?.series || companies.length === 0) return;

    const tag = focusSeriesKey ?? `tk:${focusTicker ?? ""}`;
    if (appliedChartsFocus.current === tag) return;

    let sid: string | null = null;
    if (focusSeriesKey && bundle.series[focusSeriesKey]) {
      sid = focusSeriesKey;
    } else if (focusTicker) {
      const tk = focusTicker.trim().toUpperCase();
      sid =
        companies.find((c) => c.id.toUpperCase().includes(`:${tk}|`))?.id ??
        companies.find((c) => c.label.toUpperCase().startsWith(tk))?.id ??
        null;
    }
    if (!sid) return;

    appliedChartsFocus.current = tag;
    setPrefs((prev) => {
      const next = { ...prev, companyA: sid };
      saveSimChartPrefs(next);
      return next;
    });
    setFilter(focusTicker ?? "");
    onFocusConsumed?.();
  }, [focusSeriesKey, focusTicker, bundle, companies, onFocusConsumed]);

  useEffect(() => {
    if (!bundle || companies.length === 0) return;
    setPrefs((prev) => {
      const controlIds = controls.map((c) => c.id);
      const vis =
        Object.keys(prev.visibleRefs).length > 0
          ? prev.visibleRefs
          : defaultVisibleRefs(controlIds);
      let companyA = prev.companyA;
      if (!companyA || !bundle.series[companyA]) {
        companyA = companies[0]?.id ?? null;
      }
      return { ...prev, companyA, visibleRefs: vis };
    });
  }, [bundle, companies, controls]);

  const persist = useCallback((next: SimChartPrefs) => {
    setPrefs(next);
    saveSimChartPrefs(next);
  }, []);

  const persistCompare = useCallback((next: ChartComparePrefs) => {
    setComparePrefs(next);
    saveChartComparePrefs(next);
  }, []);

  const simSeriesKeys = useMemo(
    () => simTableSeriesKeys(simTable, bundle),
    [simTable, bundle]
  );

  const companySlots = useMemo(() => {
    const mode = comparePrefs.mode;
    if (mode === "single") {
      return prefs.companyA ? [{ sid: prefs.companyA, slot: 0 }] : [];
    }
    if (mode === "pair2") {
      const slots: { sid: string; slot: number }[] = [];
      if (prefs.companyA) slots.push({ sid: prefs.companyA, slot: 0 });
      if (prefs.companyB && prefs.companyB !== prefs.companyA) {
        slots.push({ sid: prefs.companyB, slot: 1 });
      }
      return slots;
    }
    if (mode === "all") {
      return simSeriesKeys
        .slice(0, MAX_CHART_COMPARE_SERIES)
        .map((sid, slot) => ({ sid, slot }));
    }
    const ids =
      comparePrefs.selectedIds.length > 0
        ? comparePrefs.selectedIds
        : simSeriesKeys.slice(0, 3);
    return ids
      .filter((sid) => bundle?.series[sid])
      .slice(0, MAX_CHART_COMPARE_SERIES)
      .map((sid, slot) => ({ sid, slot }));
  }, [comparePrefs, prefs.companyA, prefs.companyB, simSeriesKeys, bundle]);

  const compareTruncated =
    (comparePrefs.mode === "all" && simSeriesKeys.length > MAX_CHART_COMPARE_SERIES) ||
    (comparePrefs.mode === "multi" &&
      (comparePrefs.selectedIds.length > MAX_CHART_COMPARE_SERIES ||
        (comparePrefs.selectedIds.length === 0 &&
          simSeriesKeys.length > MAX_CHART_COMPARE_SERIES)));

  const filteredCompanies = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return companies;
    return companies.filter((c) => c.label.toUpperCase().includes(q));
  }, [companies, filter]);

  const tableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of simTable?.rows ?? []) {
      const k = simulationRowSeriesKey(row);
      if (k) keys.add(k);
    }
    return keys;
  }, [simTable]);

  const chartNowMarkers = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    const rows: Record<string, unknown>[] = [];
    for (const { sid } of companySlots) {
      const row = findSimulationRow(simTable.rows, sid);
      if (row) rows.push(row);
    }
    return buildNowMarkersFromSimulationRows(rows);
  }, [simTable, companySlots]);

  const explorerLines = useMemo(() => {
    if (!bundle) return [];
    const out: { spec: CurveLineSpec; points: ChartSeries["points"] }[] = [];

    const fields: {
      on: boolean;
      field: CurveLineSpec["field"];
      label: string;
      pickColor: (slot: number) => string;
    }[] = [
      {
        on: prefs.showCurva,
        field: "pct_foglio",
        label: "Pred foglio",
        pickColor: (slot) =>
          slot < 2 ? COMPANY_CURVA[slot] : MULTI_PALETTE[slot % MULTI_PALETTE.length],
      },
      {
        on: prefs.showStorico,
        field: "pct_reale",
        label: "storico",
        pickColor: seriesColor,
      },
      {
        on: prefs.showModello,
        field: "pct_modello",
        label: "modello",
        pickColor: (slot) =>
          slot < 2 ? COMPANY_MODELLO[slot] : MULTI_PALETTE[(slot + 4) % MULTI_PALETTE.length],
      },
    ];

    for (const { sid, slot } of companySlots) {
      const meta = bundle.series[sid];
      if (!meta?.points) continue;
      const row = simTable?.rows?.length ? findSimulationRow(simTable.rows, sid) : null;
      const points = overlaySheetPredOnPoints(meta.points, row);
      const tk = meta.label.slice(0, 36);
      const pfx =
        comparePrefs.mode === "pair2"
          ? slot === 0
            ? "A"
            : "B"
          : comparePrefs.mode === "single"
            ? ""
            : `${slot + 1}`;
      for (const f of fields) {
        if (!f.on) continue;
        out.push({
          spec: {
            id: `${sid}_${f.field}`,
            label: pfx ? `${pfx} ${tk} · ${f.label}` : `${tk} · ${f.label}`,
            color: f.pickColor(slot),
            field: f.field,
            strokeWidth: comparePrefs.mode === "pair2" && slot === 1 ? 2.5 : 2,
          },
          points,
        });
      }
    }

    if (prefs.showControls && prefs.showCurva) {
      for (const c of controls) {
        if (prefs.visibleRefs[c.id] === false) continue;
        const meta = bundle.series[c.id];
        if (!meta?.points) continue;
        out.push({
          spec: {
            id: c.id,
            label: `μ ${c.label}`,
            color: refColor(c.label),
            field: "pct_curva",
            strokeWidth: 1.25,
            strokeDasharray: "6 4",
          },
          points: meta.points,
        });
      }
    }
    return out;
  }, [bundle, prefs, controls, simTable, companySlots, comparePrefs.mode]);

  const varSeries = useMemo(() => {
    if (!bundle) return [];
    const out: {
      id: string;
      label: string;
      color: string;
      horizons: { label: string; pct: number | null }[];
    }[] = [];
    for (const { sid, slot } of companySlots) {
      const m = bundle.series[sid];
      if (!m?.var_horizons?.length) continue;
      const pfx =
        comparePrefs.mode === "pair2"
          ? slot === 0
            ? "A "
            : "B "
          : comparePrefs.mode === "single"
            ? ""
            : `${slot + 1} `;
      out.push({
        id: `var_${sid}`,
        label: `${pfx}${m.label}`,
        color: seriesColor(slot),
        horizons: m.var_horizons,
      });
    }
    return out;
  }, [bundle, companySlots, comparePrefs.mode]);

  const { priceStorLines, priceRecalLines } = useMemo(() => {
    const stor: {
      id: string;
      label: string;
      color: string;
      points: ChartSeries["points"];
    }[] = [];
    const recal: typeof stor = [];
    if (!bundle) return { priceStorLines: stor, priceRecalLines: recal };

    for (const { sid, slot } of companySlots) {
      const meta = bundle.series[sid];
      if (!meta) continue;
      const pfx =
        comparePrefs.mode === "pair2"
          ? slot === 0
            ? "A"
            : "B"
          : comparePrefs.mode === "single"
            ? ""
            : String(slot + 1);
      const short = meta.label.slice(0, 28);
      stor.push({
        id: `${sid}_stor`,
        label: pfx ? `${pfx} ${short} · storico` : `${short} · storico`,
        color: seriesColor(slot),
        points: meta.points,
      });
      recal.push({
        id: `${sid}_path`,
        label: pfx ? `${pfx} ${short} · path` : `${short} · path`,
        color:
          slot < 2 ? COMPANY_CURVA[slot] : MULTI_PALETTE[slot % MULTI_PALETTE.length],
        points: meta.points,
      });
    }
    return { priceStorLines: stor, priceRecalLines: recal };
  }, [bundle, companySlots, comparePrefs.mode]);

  const tableSeriesId = companySlots[0]?.sid ?? prefs.companyA;
  const tableMetaRaw = tableSeriesId ? bundle?.series[tableSeriesId] : null;

  const tableMeta = useMemo(() => {
    if (!tableMetaRaw || !tableSeriesId) return null;
    const row =
      simTable?.rows?.length
        ? findSimulationRow(simTable.rows, tableSeriesId)
        : null;
    return {
      ...tableMetaRaw,
      points: overlaySheetPredOnPoints(tableMetaRaw.points ?? [], row),
    };
  }, [tableMetaRaw, tableSeriesId, simTable]);

  const snapshotAgeWarning = useMemo(() => {
    if (!bundle) return null;
    const chartDay = bundle.loaded_at?.slice(0, 10);
    const manifestDay = manifest?.updated_at?.slice(0, 10);
    if (chartDay && manifestDay && chartDay !== manifestDay) {
      return `Export grafici (${chartDay}) ≠ snapshot desktop (${manifestDay}) — esegui Export_Desktop_Snapshots.bat.`;
    }
    if (tableMetaRaw?.points?.length && !tableMetaRaw.points.some((p) => p.pct_foglio != null)) {
      return "JSON grafici senza pct_foglio (export precedente al fix) — rigenera simulation_charts_snapshot.json.";
    }
    return null;
  }, [bundle, manifest, tableMetaRaw]);

  const tableMatchInfo = useMemo(() => {
    if (!tableMeta?.points?.length || !tableSeriesId || !simTable?.rows?.length) return null;
    const row = findSimulationRow(simTable.rows, tableSeriesId);
    if (!row) {
      return { inTable: false, mismatches: 0, compared: 0, nChart: tableMeta.points.length };
    }
    let mismatches = 0;
    let compared = 0;
    for (const p of tableMeta.points) {
      if (p.nodo && p.nodo !== "standard") continue;
      const sheetPred = simulationRowPredAtOffset(row, p.offset);
      const chartPred = p.pct_foglio ?? p.pct_curva;
      if (sheetPred == null || chartPred == null || chartPred !== chartPred) continue;
      compared += 1;
      if (Math.abs(sheetPred - chartPred) > 0.6) mismatches += 1;
    }
    return {
      inTable: true,
      mismatches,
      compared,
      nChart: tableMeta.points.filter((p) => !p.nodo || p.nodo === "standard").length,
    };
  }, [tableMeta, tableSeriesId, simTable]);

  function setPreset(curva: boolean, storico: boolean, modello: boolean) {
    persist({ ...prefs, showCurva: curva, showStorico: storico, showModello: modello });
  }

  return (
    <section className="card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <p className="text-xs text-ink-muted">
            {loading || simLoading
              ? "Caricamento curve…"
              : `${companies.length} società · ${controls.length} curve μ`}
            {source && ` · ${source}`}
            {bundle?.loaded_at && ` · dati ${bundle.loaded_at}`}
            {manifest?.updated_at && ` · snapshot ${manifest.updated_at.slice(0, 10)}`}
            {tableMeta && comparePrefs.mode !== "all" && comparePrefs.mode !== "multi" && (
              <>
                {" · "}
                {tableMeta.points.filter((p) => !p.nodo || p.nodo === "standard").length} nodi
                {comparePrefs.mode === "pair2" && prefs.companyA ? " (A)" : ""}
              </>
            )}
            {companySlots.length > 1 && (
              <>
                {" · "}
                {companySlots.length} serie
              </>
            )}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs ml-auto" onClick={() => void reloadCharts()}>
          Ricarica grafici
        </button>
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-negative shrink-0">{error}</p>
      )}

      {!loading && !error && !bundle && (
        <p className="px-4 py-2 text-sm text-amber-600 dark:text-amber-400 shrink-0">
          Snapshot grafici assente — esegui <strong>Export_Desktop_Snapshots.bat</strong> (include
          simulation_charts) o tab Refresh, poi Ricarica grafici.
        </p>
      )}

      {controls.length === 0 && bundle && !loading && (
        <p className="px-4 py-2 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          Nessuna curva μ di controllo nel JSON — rigenera simulation_charts_snapshot.json.
        </p>
      )}

      {snapshotAgeWarning && (
        <p className="px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          {snapshotAgeWarning}
        </p>
      )}

      {compareTruncated && (
        <p className="px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          Mostrate al massimo {MAX_CHART_COMPARE_SERIES} serie (
          {simSeriesKeys.length} nel foglio Simulation) — usa Selezione multipla per scegliere
          quali confrontare.
        </p>
      )}

      {tableMatchInfo && tableSeriesId && comparePrefs.mode !== "all" && comparePrefs.mode !== "multi" && (
        <p
          className={`px-4 py-1.5 text-xs shrink-0 ${
            !tableMatchInfo.inTable
              ? "text-ink-muted"
              : tableMatchInfo.mismatches > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-ink-muted"
          }`}
        >
          {!tableMatchInfo.inTable
            ? "Società A non presente nel foglio Simulation (tabella)."
            : tableMatchInfo.compared === 0
              ? "Nessun nodo comune tra Pred foglio e colonne Δ% del foglio Simulation."
              : tableMatchInfo.mismatches > 0
                ? `Attenzione: ${tableMatchInfo.mismatches}/${tableMatchInfo.compared} nodi con Δ>0.6 pp vs foglio Simulation — ricarica tabella o rigenera snapshot grafici.`
                : `Pred foglio allineata al foglio Simulation (${tableMatchInfo.compared} nodi).`}
        </p>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-72 shrink-0 border-r border-[rgb(var(--border))]/60 overflow-y-auto p-3 space-y-4 text-sm">
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Cerca società</label>
            <input
              className="input w-full text-xs"
              placeholder="Ticker…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-ink-muted mb-1">Modalità confronto</p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(COMPARE_MODE_LABELS) as ChartCompareMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-md px-2 py-0.5 text-[10px] transition ${
                    comparePrefs.mode === mode
                      ? "bg-accent text-white"
                      : "text-ink-muted hover:text-ink border border-[rgb(var(--border))]/60"
                  }`}
                  onClick={() => persistCompare({ ...comparePrefs, mode })}
                >
                  {COMPARE_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          {(comparePrefs.mode === "single" || comparePrefs.mode === "pair2") && (
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Società A</label>
            <select
              className="input w-full text-xs"
              value={prefs.companyA ?? ""}
              onChange={(e) =>
                persist({ ...prefs, companyA: e.target.value || null })
              }
            >
              {filteredCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {tableKeys.has(c.id) ? "" : " (solo JSON)"}
                </option>
              ))}
            </select>
          </div>
          )}

          {comparePrefs.mode === "pair2" && (
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">
              Società B (confronto)
            </label>
            <select
              className="input w-full text-xs"
              value={prefs.companyB ?? ""}
              onChange={(e) =>
                persist({
                  ...prefs,
                  companyB: e.target.value || null,
                })
              }
            >
              <option value="">— nessuna —</option>
              {filteredCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          )}

          {comparePrefs.mode === "multi" && simSeriesKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink-muted mb-1">
                Seleziona società ({comparePrefs.selectedIds.length || "nessuna"})
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5 border border-[rgb(var(--border))]/40 rounded-md p-1">
                {simSeriesKeys.map((sid) => {
                  const label = bundle?.series[sid]?.label ?? sid;
                  const checked = comparePrefs.selectedIds.includes(sid);
                  return (
                    <label
                      key={sid}
                      className="flex items-center gap-1.5 text-[10px] cursor-pointer px-1 py-0.5 rounded hover:bg-surface-elevated"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...comparePrefs.selectedIds, sid]
                            : comparePrefs.selectedIds.filter((id) => id !== sid);
                          persistCompare({ ...comparePrefs, selectedIds: next });
                        }}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn-ghost text-[10px] mt-1 w-full"
                onClick={() =>
                  persistCompare({
                    ...comparePrefs,
                    selectedIds: simSeriesKeys.slice(0, MAX_CHART_COMPARE_SERIES),
                  })
                }
              >
                Seleziona tutte (max {MAX_CHART_COMPARE_SERIES})
              </button>
            </div>
          )}

          {comparePrefs.mode === "all" && (
            <p className="text-[10px] text-ink-muted">
              Overlay di tutte le righe Simulation con grafico JSON (
              {Math.min(simSeriesKeys.length, MAX_CHART_COMPARE_SERIES)}/
              {simSeriesKeys.length}).
            </p>
          )}

          {simTable && simTable.rows.length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink-muted mb-1">Da foglio Simulation</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {simTable.rows.map((row, i) => {
                  const key = simulationRowSeriesKey(row);
                  if (!key || !bundle?.series[key]) return null;
                  return (
                    <button
                      key={i}
                      type="button"
                      className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-surface-elevated truncate"
                      onClick={() => persist({ ...prefs, companyA: key })}
                    >
                      {String(row.Ticker)} · {String(row["Completion Date"] ?? "")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-accent">Curve società</p>
            {(
              [
                ["showCurva", "Pred foglio (Δ% Simulation)"],
                ["showStorico", "Storico (dato vero)"],
                ["showModello", "Modello T−60"],
                ["showControls", "μ controllo su grafico %"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => persist({ ...prefs, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn-ghost text-[10px] px-2 py-0.5"
              onClick={() => setPreset(true, false, false)}
            >
              Solo curva
            </button>
            <button
              type="button"
              className="btn-ghost text-[10px] px-2 py-0.5"
              onClick={() => setPreset(false, true, false)}
            >
              Solo storico
            </button>
            <button
              type="button"
              className="btn-ghost text-[10px] px-2 py-0.5"
              onClick={() => setPreset(false, false, true)}
            >
              Solo modello
            </button>
            <button
              type="button"
              className="btn-ghost text-[10px] px-2 py-0.5"
              onClick={() => setPreset(true, true, true)}
            >
              Tutte e 3
            </button>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-accent">Curve μ di riferimento</p>
            {controls.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.visibleRefs[c.id] !== false}
                  onChange={(e) =>
                    persist({
                      ...prefs,
                      visibleRefs: { ...prefs.visibleRefs, [c.id]: e.target.checked },
                    })
                  }
                />
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: refColor(c.label) }}
                />
                {c.label}
              </label>
            ))}
            {controls.length === 0 && (
              <p className="text-[10px] text-ink-muted">Nessun μ caricato.</p>
            )}
          </div>

          <div className="space-y-1 border-t border-[rgb(var(--border))]/40 pt-2">
            <p className="text-xs font-medium text-ink-muted">Pannelli</p>
            {(
              [
                ["showVarChart", "Variazioni 6M·3M·1M·1g"],
                ["showPricePath", "Prezzo $ path"],
                ["showPriceModel", "Prezzo $ modello"],
                ["showPointsTable", "Tabella punti"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => persist({ ...prefs, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </aside>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          <SimulationCurveChart
            title="% vs T−60 — società e curve μ selezionate"
            lines={explorerLines}
            nowMarkers={chartNowMarkers}
          />

          {prefs.showVarChart && (
            <VariationHorizonChart
              title="Variazioni % (6M · 3M · 1M · 1g)"
              series={varSeries}
            />
          )}

          {prefs.showPricePath && (
            <>
              <PricePathChart
                title="Prezzo $ — storico (close reali)"
                lines={priceStorLines}
                field="price_storico_usd"
                nowMarkers={chartNowMarkers}
              />
              <PricePathChart
                title="Prezzo $ — path ricalibrato (+ K-8)"
                lines={priceRecalLines}
                field="price_usd"
                aggregateByOffset
                nowMarkers={chartNowMarkers}
              />
            </>
          )}

          {prefs.showPriceModel && bundle && (
            <PricePathChart
              title="Prezzo $ — solo modello T−60"
              lines={companySlots
                .map(({ sid, slot }) => {
                  const meta = bundle.series[sid];
                  if (!meta) return null;
                  return {
                    id: `pm_${sid}`,
                    label: meta.label.slice(0, 32),
                    color:
                      slot < 2
                        ? COMPANY_MODELLO[slot]
                        : MULTI_PALETTE[(slot + 4) % MULTI_PALETTE.length],
                    points: meta.points,
                  };
                })
                .filter(Boolean) as {
                id: string;
                label: string;
                color: string;
                points: ChartSeries["points"];
              }[]}
              field="price_model_usd"
              nowMarkers={chartNowMarkers}
            />
          )}

          {prefs.showPointsTable && tableMeta && (
            <div className="rounded-lg border border-[rgb(var(--border))]/60 overflow-auto max-h-56">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-surface-elevated sticky top-0">
                  <tr>
                    {[
                      "Offset",
                      "Nodo",
                      "Tipo",
                      "% Pred foglio",
                      "% seq raw",
                      "% modello",
                      "% storico",
                      "Prezzo path $",
                      "Prezzo storico $",
                      "Prezzo modello $",
                    ].map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-medium border-b">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tableMeta.points ?? []).map((p, i) => (
                    <tr key={i} className="border-t border-[rgb(var(--border))]/40">
                      <td className="px-2 py-0.5">{p.offset}</td>
                      <td className="px-2 py-0.5">{p.nodo ?? "—"}</td>
                      <td className="px-2 py-0.5">{p.tipo ?? "—"}</td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmt(p.pct_foglio ?? p.pct_curva)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmt(p.pct_curva)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmt(p.pct_modello)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmt(p.pct_reale)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmtUsd(p.price_usd)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmtUsd(p.price_storico_usd)}
                      </td>
                      <td className="px-2 py-0.5 tabular-nums">
                        {fmtUsd(p.price_model_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function fmt(v: number | null | undefined): string {
  if (v == null || v !== v) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || v !== v) return "—";
  return `$${Number(v).toFixed(2)}`;
}
