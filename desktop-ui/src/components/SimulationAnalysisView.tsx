import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import {
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
  findSimulationRow,
} from "../data/simulationCharts";
import {
  displayPredChartPoints,
  resolveDisplayRecalibPoints,
  snapshotSheetDrift,
} from "../sheet/predictionCurveGrid";
import { fetchDesktopManifest, type DesktopDataManifest } from "../data/projectData";
import {
  defaultVisibleRefs,
  loadChartComparePrefs,
  loadSimChartPrefs,
  MAX_CHART_COMPARE_SERIES,
  saveChartComparePrefs,
  saveSimChartPrefs,
  visibleRefsForPreset,
  type ChartComparePrefs,
  type RefComparePreset,
  type SimChartPrefs,
} from "../sheet/chartPrefs";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { rowHasActivePortfolio } from "../sheet/simulationPosition";
import { buildNowMarkersFromSimulationRows, completionDateToNowOffset } from "../sheet/chartNowOffset";
import {
  buildSecK8LinkIndex,
  extractAiFeedMarkers,
  extractPostK8Markers,
  type AiFeedChartMarker,
  type K8ChartMarker,
} from "../sheet/k8ChartLinks";
import {
  PREDICTION_CURVE_RECALIB_LABEL,
  predictionCurveRecalibChartTitle,
} from "../sheet/chartNodes";
import { hydrateClinicalPreCdRecords } from "../sheet/clinicalPreCdSnapshotCache";
import {
  formatEisPlusLegendShift,
  resolveEisPlusCurve,
} from "../sheet/eisPlusCurve";
import { DailyOpenRecalibBadge } from "./DailyOpenRecalibBadge";
import {
  PricePathChart,
  SimulationCurveChart,
  VariationHorizonChart,
  type ChartLineBundle,
  type CurveLineSpec,
  type PriceLineBundle,
} from "./SimulationCurveChart";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh, sheetGridAlignForLabel } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

const REF_COLORS: Record<string, string> = {
  "Cluster 0": "#9ca3af",
  "SuperNova (cl.1)": "#c8ff00",
  "μ SuperNova (cl.1)": "#c8ff00",
  "Post-CD rialzo": "#00c896",
  "μ Post-CD rialzo": "#00c896",
  "Post-CD ribasso": "#fb7185",
  "μ Post-CD ribasso": "#fb7185",
  "Post-CD neutro": "#a8b0bc",
  "μ Post-CD neutro": "#a8b0bc",
  "Globale primaria": "#94a3b8",
  "controllo negativo": "#64748b",
};
// Note: REF_COLORS keys above are dataset labels from the JSON snapshot; not translated.

const COMPANY_CURVA = ["#00dc96", "#00af78"] as const;
const COMPANY_STORICO = ["#78c8ff", "#af8cff"] as const;
const COMPANY_MODELLO = ["#ffa726", "#ff6b5a"] as const;
const COMPANY_EIS_PLUS = ["#d946ef", "#a855f7"] as const;

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


function seriesColor(slot: number): string {
  if (slot < 2) return COMPANY_STORICO[slot];
  return MULTI_PALETTE[slot % MULTI_PALETTE.length];
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

function appendControlRefLines(
  out: ChartLineBundle[],
  bundle: ChartBundle,
  controls: { id: string; label: string }[],
  visibleRefs: Record<string, boolean>
): void {
  for (const c of controls) {
    if (visibleRefs[c.id] === false) continue;
    const meta = bundle.series[c.id];
    if (!meta?.points) continue;
    out.push({
      spec: {
        id: c.id,
        label: `μ ${c.label}`,
        color: refColor(c.label),
        field: "pct_curva",
        strokeWidth: 1.35,
        strokeDasharray: "6 4",
      },
      points: meta.points,
    });
  }
}

function cdIsoFromSimRow(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const raw = String(row["Completion Date"] ?? row.completion_date ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return null;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return iso ? iso[0] : null;
}

function tickerFromSeriesKey(sid: string): string {
  const m = /^co:([^|]+)/.exec(sid);
  return (m?.[1] ?? sid.split("|")[0] ?? "").trim().toUpperCase();
}

function portfolioSeriesIdsFromTable(
  simTable: SheetTable | null,
  inputs: ReturnType<typeof useInvestSimInputs>,
): Set<string> {
  const s = new Set<string>();
  for (const row of simTable?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const k = simulationRowSeriesKey(row);
    if (k) s.add(k);
  }
  return s;
}

function portfolioSeriesKeysOrdered(
  simTable: SheetTable | null,
  inputs: ReturnType<typeof useInvestSimInputs>,
  bundle: ChartBundle | null,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of simTable?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
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

function companyOptionLabel(
  c: { id: string; label: string },
  portfolioSeriesIds: Set<string>,
  tableKeys: Set<string>,
): string {
  const mark = portfolioSeriesIds.has(c.id) ? "💼 " : "";
  const suffix = tableKeys.has(c.id) ? "" : " (JSON only)";
  return `${mark}${c.label}${suffix}`;
}

export function SimulationAnalysisView({
  simTable,
  simLoading,
  secK8Table = null,
  onOpenSecK8,
  focusSeriesKey,
  focusTicker,
  onFocusConsumed,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  /** Optional SEC K-8 sheet for EDGAR links on K-8 chart markers. */
  secK8Table?: SheetTable | null;
  onOpenSecK8?: (ticker: string) => void;
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
    loadChartComparePrefs(),
  );
  const [filter, setFilter] = useState("");
  const investSimInputs = useInvestSimInputs(simTable);
  const clinicalRecords = useMemo(() => hydrateClinicalPreCdRecords(), [bundle?.loaded_at]);

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
    setComparePrefs({ mode: "pair2", selectedIds: [] });
    saveChartComparePrefs({ mode: "pair2", selectedIds: [] });
    setPrefs((prev) => {
      const next = { ...prev, companyA: sid, companyB: null };
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

  const exitPortfolioOverlay = useCallback(() => {
    persistCompare({ mode: "pair2", selectedIds: [] });
  }, [persistCompare]);

  const applyRefPreset = useCallback(
    (preset: RefComparePreset) => {
      persist({
        ...prefs,
        showControls: preset !== "none",
        visibleRefs: visibleRefsForPreset(controls, preset),
      });
    },
    [prefs, controls, persist]
  );

  const portfolioSeriesIds = useMemo(
    () => portfolioSeriesIdsFromTable(simTable, investSimInputs),
    [simTable, investSimInputs],
  );

  const portfolioSeriesKeys = useMemo(
    () => portfolioSeriesKeysOrdered(simTable, investSimInputs, bundle),
    [simTable, investSimInputs, bundle],
  );

  const portfolioOverlayActive =
    comparePrefs.mode === "multi" && comparePrefs.selectedIds.length > 0;

  const companySlots = useMemo(() => {
    if (portfolioOverlayActive) {
      return comparePrefs.selectedIds
        .filter((sid) => bundle?.series[sid])
        .slice(0, MAX_CHART_COMPARE_SERIES)
        .map((sid, slot) => ({ sid, slot }));
    }
    const slots: { sid: string; slot: number }[] = [];
    if (prefs.companyA) slots.push({ sid: prefs.companyA, slot: 0 });
    if (prefs.companyB && prefs.companyB !== prefs.companyA) {
      slots.push({ sid: prefs.companyB, slot: 1 });
    }
    return slots;
  }, [
    portfolioOverlayActive,
    comparePrefs.selectedIds,
    bundle,
    prefs.companyA,
    prefs.companyB,
  ]);

  const compareTruncated =
    portfolioOverlayActive && portfolioSeriesKeys.length > MAX_CHART_COMPARE_SERIES;

  const showPortfolioCurves = useCallback(() => {
    const ids = portfolioSeriesKeys.filter((k) => bundle?.series[k]);
    if (ids.length === 0) return;
    const capped = ids.slice(0, MAX_CHART_COMPARE_SERIES);
    persistCompare({ mode: "multi", selectedIds: capped });
    persist({
      ...prefs,
      companyA: capped[0] ?? prefs.companyA,
      companyB: capped[1] ?? null,
    });
  }, [portfolioSeriesKeys, bundle, persistCompare, persist, prefs]);

  useEffect(() => {
    if (!portfolioOverlayActive) return;
    const fresh = portfolioSeriesKeys
      .filter((k) => bundle?.series[k])
      .slice(0, MAX_CHART_COMPARE_SERIES);
    if (fresh.length === 0) {
      exitPortfolioOverlay();
      return;
    }
    const cur = comparePrefs.selectedIds.join("\0");
    const next = fresh.join("\0");
    if (cur !== next) {
      persistCompare({ mode: "multi", selectedIds: fresh });
    }
  }, [
    portfolioOverlayActive,
    portfolioSeriesKeys,
    bundle,
    comparePrefs.selectedIds,
    exitPortfolioOverlay,
    persistCompare,
  ]);

  const filteredCompanies = useMemo(() => {
    const q = filter.trim().toUpperCase();
    let list = q
      ? companies.filter((c) => c.label.toUpperCase().includes(q))
      : companies;
    if (portfolioSeriesIds.size > 0) {
      list = [...list].sort((a, b) => {
        const ap = portfolioSeriesIds.has(a.id) ? 0 : 1;
        const bp = portfolioSeriesIds.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.label.localeCompare(b.label);
      });
    }
    return list;
  }, [companies, filter, portfolioSeriesIds]);

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
    const out: ChartLineBundle[] = [];

    const fields: {
      on: boolean;
      field: CurveLineSpec["field"];
      label: string;
      pickColor: (slot: number) => string;
    }[] = [
      {
        on: prefs.showCurva,
        field: "pct_foglio",
        label: PREDICTION_CURVE_RECALIB_LABEL,
        pickColor: (slot) =>
          slot < 2 ? COMPANY_CURVA[slot] : MULTI_PALETTE[slot % MULTI_PALETTE.length],
      },
      {
        on: prefs.showStorico,
        field: "pct_reale",
        label: "historical",
        pickColor: seriesColor,
      },
      {
        on: prefs.showModello,
        field: "pct_modello_raw",
        label: "model (raw poly)",
        pickColor: (slot) =>
          slot < 2 ? COMPANY_MODELLO[slot] : MULTI_PALETTE[(slot + 4) % MULTI_PALETTE.length],
      },
    ];

    for (const { sid, slot } of companySlots) {
      const meta = bundle.series[sid];
      if (!meta?.points) continue;
      const row = simTable?.rows?.length ? findSimulationRow(simTable.rows, sid) : null;
      const recalib = resolveDisplayRecalibPoints(meta.points, row);
      const nowOffset = row ? completionDateToNowOffset(row["Completion Date"]) : undefined;
      const extraNow =
        nowOffset != null && Number.isFinite(nowOffset) ? [nowOffset] : [];
      const tk = meta.label.slice(0, 36);
      const pfx = slot === 1 ? "B" : "";
      for (const f of fields) {
        if (!f.on) continue;
        const linePoints =
          f.field === "pct_foglio"
            ? displayPredChartPoints(recalib, row, extraNow)
            : recalib;
        out.push({
          spec: {
            id: `${sid}_${f.field}`,
            label: pfx ? `${pfx} ${tk} · ${f.label}` : `${tk} · ${f.label}`,
            color: f.pickColor(slot),
            field: f.field,
            strokeWidth: slot === 1 ? 2.5 : 2,
          },
          points: linePoints,
          nowOffset,
        });
      }

      if (prefs.showEisPlus) {
        const cdIso = cdIsoFromSimRow(row);
        const ticker = tickerFromSeriesKey(sid);
        const { points: eisPts, signal } = resolveEisPlusCurve(
          recalib,
          ticker,
          cdIso,
          clinicalRecords,
          row,
        );
        const eisLabel = formatEisPlusLegendShift(signal);
        out.push({
          spec: {
            id: `${sid}_pct_eis_plus`,
            label: pfx ? `${pfx} ${tk} · ${eisLabel}` : `${tk} · ${eisLabel}`,
            color:
              slot < 2
                ? COMPANY_EIS_PLUS[slot]
                : MULTI_PALETTE[(slot + 6) % MULTI_PALETTE.length],
            field: "pct_eis_plus",
            strokeWidth: slot === 1 ? 2.25 : 1.85,
            strokeDasharray: "6 4",
          },
          points: eisPts,
          nowOffset,
        });
      }
    }

    if (
      prefs.showControls &&
      (prefs.showCurva || prefs.showStorico || prefs.showModello || prefs.showEisPlus)
    ) {
      appendControlRefLines(out, bundle, controls, prefs.visibleRefs);
    }
    return out;
  }, [bundle, prefs, controls, simTable, companySlots, clinicalRecords]);

  const k8LinkIndex = useMemo(() => buildSecK8LinkIndex(secK8Table), [secK8Table]);

  const chartRecalibMarkers = useMemo(() => {
    const k8: K8ChartMarker[] = [];
    const aiFeed: AiFeedChartMarker[] = [];
    if (!bundle) return { k8, aiFeed };
    for (const { sid, slot } of companySlots) {
      const meta = bundle.series[sid];
      if (!meta?.points?.length) continue;
      const row = simTable?.rows?.length ? findSimulationRow(simTable.rows, sid) : null;
      const points = resolveDisplayRecalibPoints(meta.points, row);
      const tk = meta.label.split("|")[0].trim().slice(0, 12) || sid.split("|")[0];
      const color =
        slot < 2 ? COMPANY_CURVA[slot] : MULTI_PALETTE[slot % MULTI_PALETTE.length];
      k8.push(...extractPostK8Markers(points, tk, color, k8LinkIndex));
      aiFeed.push(...extractAiFeedMarkers(points, tk));
    }
    return { k8, aiFeed };
  }, [bundle, companySlots, simTable, k8LinkIndex]);

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
      const pfx = slot === 0 ? "" : "B ";
      out.push({
        id: `var_${sid}`,
        label: `${pfx}${m.label}`,
        color: seriesColor(slot),
        horizons: m.var_horizons,
      });
    }
    return out;
  }, [bundle, companySlots]);

  // Single source of lines for the unified historical + recalibrated chart.
  // Each entry carries the ticker's points; the chart extracts both
  // "price_storico_usd" (primary, solid) and "price_usd" (overlay, dashed)
  // from the same points, so we no longer build two parallel arrays.
  const priceStorLines = useMemo(() => {
    const stor: PriceLineBundle[] = [];
    if (!bundle) return stor;

    for (const { sid, slot } of companySlots) {
      const meta = bundle.series[sid];
      if (!meta) continue;
      const row = simTable?.rows?.length ? findSimulationRow(simTable.rows, sid) : null;
      const nowOffset = row ? completionDateToNowOffset(row["Completion Date"]) : undefined;
      const pfx = slot === 1 ? "B" : "";
      const short = meta.label.slice(0, 28);
      stor.push({
        id: `${sid}_stor`,
        label: pfx ? `${pfx} ${short}` : short,
        color: seriesColor(slot),
        points: resolveDisplayRecalibPoints(meta.points, row),
        nowOffset,
      });
    }
    return stor;
  }, [bundle, companySlots, simTable?.rows]);

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
      points: resolveDisplayRecalibPoints(tableMetaRaw.points ?? [], row),
    };
  }, [tableMetaRaw, tableSeriesId, simTable]);

  const snapshotAgeWarning = useMemo(() => {
    if (!bundle) return null;
    const chartDay = bundle.loaded_at?.slice(0, 10);
    const manifestDay = manifest?.updated_at?.slice(0, 10);
    if (chartDay && manifestDay && chartDay !== manifestDay) {
      return `Chart export (${chartDay}) ≠ desktop snapshot (${manifestDay}) — run Export_Desktop_Snapshots.bat.`;
    }
    if (tableMetaRaw?.points?.length && !tableMetaRaw.points.some((p) => p.pct_foglio != null)) {
      return "Chart JSON without pct_foglio (export prior to fix) — regenerate simulation_charts_snapshot.json.";
    }
    return null;
  }, [bundle, manifest, tableMetaRaw]);

  const tableMatchInfo = useMemo(() => {
    if (!tableMetaRaw?.points?.length || !tableSeriesId || !simTable?.rows?.length) return null;
    const row = findSimulationRow(simTable.rows, tableSeriesId);
    if (!row) {
      return { inTable: false, staleNodes: 0, compared: 0, maxDriftPp: 0, displaySynced: false };
    }
    const drift = snapshotSheetDrift(tableMetaRaw.points, row);
    return {
      inTable: true,
      staleNodes: drift.staleNodes,
      compared: drift.compared,
      maxDriftPp: drift.maxDriftPp,
      displaySynced: drift.staleNodes > 0,
    };
  }, [tableMetaRaw, tableSeriesId, simTable]);

  const recalibBadgeEntries = useMemo(() => {
    if (!bundle || !simTable?.rows?.length) return [];
    return companySlots
      .map(({ sid, slot }) => {
        const meta = bundle.series[sid];
        if (!meta?.points?.length) return null;
        const row = findSimulationRow(simTable.rows, sid);
        if (!row) return null;
        const tk =
          meta.label.split("|")[0]?.trim().slice(0, 12) ||
          String(row.Ticker ?? sid).slice(0, 12);
        const label = slot === 1 ? `B · ${tk}` : tk;
        return {
          key: sid,
          label,
          points: meta.points,
          row: {
            ...row,
            _manifest_updated_at: manifest?.updated_at ?? null,
          },
        };
      })
      .filter((e): e is NonNullable<typeof e> => e != null);
  }, [bundle, companySlots, simTable?.rows, manifest?.updated_at]);

  return (
    <section className="card sim-harmonize flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <p className="text-xs text-ink-muted">
            {loading || simLoading
              ? "Loading curves…"
              : `${companies.length} companies · ${controls.length} μ curves`}
            {source && ` · ${source}`}
            {bundle?.loaded_at && ` · data ${bundle.loaded_at}`}
            {manifest?.updated_at && ` · snapshot ${manifest.updated_at.slice(0, 10)}`}
            {tableMeta && (
              <>
                {" · "}
                {tableMeta.points.filter((p) => !p.nodo || p.nodo === "standard").length} nodes
                {companySlots.length > 1 && prefs.companyA ? " (A)" : ""}
              </>
            )}
            {companySlots.length > 1 && (
              <>
                {" · "}
                {companySlots.length} series
                {portfolioOverlayActive ? " · 💼 portfolio" : ""}
              </>
            )}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs ml-auto" onClick={() => void reloadCharts()}>
          Reload charts
        </button>
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-negative shrink-0">{error}</p>
      )}

      {!loading && !error && !bundle && (
        <p className="px-4 py-2 text-sm text-amber-600 dark:text-amber-400 shrink-0">
          Chart snapshot missing — run <strong>Export_Desktop_Snapshots.bat</strong> (includes
          simulation_charts) or Refresh tab, then Reload charts.
        </p>
      )}

      {controls.length === 0 && bundle && !loading && (
        <p className="px-4 py-2 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          No μ control curve in JSON — regenerate simulation_charts_snapshot.json.
        </p>
      )}

      {snapshotAgeWarning && (
        <p className="px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          {snapshotAgeWarning}
        </p>
      )}

      {compareTruncated && (
        <p className="px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 shrink-0">
          At most {MAX_CHART_COMPARE_SERIES} portfolio curves shown (
          {portfolioSeriesKeys.length} open positions).
        </p>
      )}

      {tableMatchInfo && tableSeriesId && (
        <p
          className={`px-4 py-1.5 text-xs shrink-0 ${
            !tableMatchInfo.inTable
              ? "text-ink-muted"
              : tableMatchInfo.staleNodes > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-ink-muted"
          }`}
        >
          {!tableMatchInfo.inTable
            ? "Company A not present in Simulation sheet (table)."
            : tableMatchInfo.compared === 0
              ? "No common node between Pred sheet and Δ% columns of Simulation sheet."
              : tableMatchInfo.staleNodes > 0
                ? `Snapshot JSON stale on ${tableMatchInfo.staleNodes}/${tableMatchInfo.compared} nodes (max Δ ${tableMatchInfo.maxDriftPp.toFixed(2)} pp) — chart uses Simulation sheet values (same grid as SuperNova). Regenerate simulation_charts_snapshot.json when convenient.`
                : `Pred aligned with Simulation sheet (${tableMatchInfo.compared} nodes · grid T−60…T+7).`}
        </p>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-[rgb(var(--border))]/60 overflow-y-auto p-3 space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Search</label>
            <input
              className="input w-full text-xs"
              placeholder="Ticker…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div>
            <button
              type="button"
              disabled={portfolioSeriesKeys.length === 0 || simLoading}
              onClick={() => showPortfolioCurves()}
              className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded border transition ${
                portfolioOverlayActive
                  ? "bg-accent/15 border-accent/50 text-accent font-medium"
                  : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink hover:border-accent/40"
              } disabled:opacity-45 disabled:cursor-not-allowed`}
              title={
                portfolioSeriesKeys.length === 0
                  ? "Nessuna posizione aperta in Simulation"
                  : "Mostra tutte le curve delle posizioni aperte"
              }
            >
              💼 Curve portfolio
              {portfolioSeriesKeys.length > 0 ? ` (${portfolioSeriesKeys.length})` : ""}
            </button>
            {portfolioOverlayActive && (
              <button
                type="button"
                onClick={exitPortfolioOverlay}
                className="mt-1 w-full text-[10px] text-ink-muted hover:text-ink underline"
              >
                Torna a confronto A/B
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Company A</label>
            <select
              className="input w-full text-xs"
              value={prefs.companyA ?? ""}
              onChange={(e) => {
                exitPortfolioOverlay();
                persist({ ...prefs, companyA: e.target.value || null });
              }}
            >
              {filteredCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {companyOptionLabel(c, portfolioSeriesIds, tableKeys)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Company B</label>
            <select
              className="input w-full text-xs"
              value={prefs.companyB ?? ""}
              onChange={(e) => {
                exitPortfolioOverlay();
                persist({ ...prefs, companyB: e.target.value || null });
              }}
            >
              <option value="">— none —</option>
              {filteredCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {companyOptionLabel(c, portfolioSeriesIds, tableKeys)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Curve visibili</label>
            <div className="flex flex-col gap-1">
              {(
                [
                  ["showCurva",    "Prediction + Recalib."],
                  ["showStorico",  "Price $ — real data"],
                  ["showModello",  "Modello (no recalib.)"],
                  ["showEisPlus",  "+EIS (shift feed)"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => persist({ ...prefs, [key]: !prefs[key] })}
                  className={`text-left text-[11px] px-2.5 py-1 rounded border transition ${
                    prefs[key]
                      ? "bg-accent/15 border-accent/50 text-accent font-medium"
                      : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Curve µ distribuzione</label>
            <select
              className="input w-full text-xs"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applyRefPreset(e.target.value as RefComparePreset);
                e.target.value = "";
              }}
            >
              <option value="" disabled>— seleziona preset —</option>
              <option value="supernova">SuperNova</option>
              <option value="postRialzo">Post + (rialzo)</option>
              <option value="postRibasso">Post − (ribasso)</option>
              <option value="postNeutro">Post ↔ (neutro)</option>
              <option value="postCd">Post-CD all</option>
              <option value="supernovaPostCd">SN + Post-CD</option>
              <option value="all">All µ</option>
              <option value="none">Off</option>
            </select>
          </div>
        </aside>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          <SimulationCurveChart
            title={predictionCurveRecalibChartTitle()}
            lines={explorerLines}
            k8Markers={chartRecalibMarkers.k8}
            aiFeedMarkers={chartRecalibMarkers.aiFeed}
            nowMarkers={chartNowMarkers}
            onOpenSecK8={onOpenSecK8}
          />

          {recalibBadgeEntries.length > 0 && (
            <div className={recalibBadgeEntries.length > 1 ? "grid sm:grid-cols-2 gap-2" : "space-y-2"}>
              {recalibBadgeEntries.map((e) => (
                <DailyOpenRecalibBadge
                  key={e.key}
                  ticker={e.label}
                  points={e.points}
                  row={e.row}
                  compact={recalibBadgeEntries.length > 1}
                />
              ))}
            </div>
          )}

          {prefs.showVarChart && (
            <VariationHorizonChart
              title="Variations % (6M · 3M · 1M · 1d)"
              series={varSeries}
            />
          )}

          {prefs.showPricePath && (
            <PricePathChart
              title="Price $ — real data"
              lines={priceStorLines}
              field="price_storico_usd"
              overlayField="price_usd"
              primaryLabel="historical close"
              overlayLabel={PREDICTION_CURVE_RECALIB_LABEL}
              aggregateByOffset
              nowMarkers={chartNowMarkers}
              primaryColorOverride={priceStorLines.length === 1 ? "#3b82f6" : undefined}
              overlayColorOverride={priceStorLines.length === 1 ? "#f97316" : undefined}
            />
          )}

          {prefs.showPointsTable && tableMeta && (
            <div className="rounded-lg border border-[rgb(var(--border))]/60 overflow-auto max-h-56">
              <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse`}>
                <SheetGridColgroup columnCount={10} />
                <thead className="bg-surface-elevated sticky top-0">
                  <tr>
                    {[
                      "Offset",
                      "Node",
                      "Type",
                      `% ${PREDICTION_CURVE_RECALIB_LABEL}`,
                      "% seq raw",
                      "% model",
                      "% historical",
                      "Price path $",
                      "Price historical $",
                      "Price model $",
                    ].map((h) => (
                      <th key={h} className={`${gridTh(sheetGridAlignForLabel(h), "py-1 font-medium")} border-b`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tableMeta.points ?? []).map((p, i) => (
                    <tr key={i} className="border-t border-[rgb(var(--border))]/40">
                      <td className={gridTd("center", "py-0.5")}>{p.offset}</td>
                      <td className={gridTd("left", "py-0.5")}>{p.nodo ?? "—"}</td>
                      <td className={gridTd("left", "py-0.5")}>{p.tipo ?? "—"}</td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmt(p.pct_foglio ?? p.pct_curva)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmt(p.pct_curva)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmt(p.pct_modello)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmt(p.pct_reale)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmtUsd(p.price_usd)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
                        {fmtUsd(p.price_storico_usd)}
                      </td>
                      <td className={gridTd("center", "py-0.5")}>
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
