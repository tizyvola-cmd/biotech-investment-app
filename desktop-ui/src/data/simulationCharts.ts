import type { ChartBundle, ChartPoint } from "../types";
import { api, probeApiReachable } from "../api/supernova";
import { desktopDataDirHint, fetchProjectJson } from "./projectData";
import { isSecK8Node } from "../sheet/chartNodes";

const CHARTS_FILE = "simulation_charts_snapshot.json";

let _chartsCache: ChartBundle | null = null;
let _chartsInflight: Promise<{
  bundle: ChartBundle | null;
  source: string;
  error?: string;
}> | null = null;

/** Bundle già in memoria (evita flash UI in attesa del fetch). */
export function peekSimulationChartsBundle(): ChartBundle | null {
  return _chartsCache;
}

/** Mappa serie → punti curva (stessa logica Dashboard Top Opps publish). */
export function chartPointsMapFromBundle(
  bundle: ChartBundle | null | undefined,
): Map<string, ChartPoint[]> {
  const m = new Map<string, ChartPoint[]>();
  if (!bundle?.series) return m;
  for (const [key, series] of Object.entries(bundle.series)) {
    if (series.points?.length) m.set(key, series.points);
  }
  return m;
}

export function invalidateSimulationChartsCache(): void {
  _chartsCache = null;
  _chartsInflight = null;
}

async function fetchSimulationChartsBundle(): Promise<{
  bundle: ChartBundle | null;
  source: string;
  error?: string;
}> {
  const { data, detail } = await fetchProjectJson<ChartBundle>(CHARTS_FILE);
  if (data?.series && Object.keys(data.series).length > 0) {
    return { bundle: data, source: `locale (${CHARTS_FILE})` };
  }

  if (!(await probeApiReachable())) {
    return {
      bundle: null,
      source: "",
      error:
        detail ||
        `Dati grafici assenti (${CHARTS_FILE}) e API offline.`,
    };
  }

  try {
    const bundle = await api<ChartBundle>("/api/charts/simulation", undefined, {
      timeoutMs: 8_000,
    });
    if (bundle?.series && Object.keys(bundle.series).length > 0) {
      return { bundle, source: "API /api/charts/simulation" };
    }
    if (bundle?.note) {
      return { bundle: null, source: "", error: bundle.note };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      bundle: null,
      source: "",
      error:
        `${msg} — esegui Export_Desktop_Snapshots.bat (include grafici) ` +
        `o avvia API su :8765. Cartella: ${desktopDataDirHint()}`,
    };
  }

  return {
    bundle: null,
    source: "",
    error:
      detail ||
      `Dati grafici assenti (${CHARTS_FILE}). Export snapshot o refresh Simulation.`,
  };
}

export async function loadSimulationChartsBundle(): Promise<{
  bundle: ChartBundle | null;
  source: string;
  error?: string;
}> {
  if (_chartsCache?.series && Object.keys(_chartsCache.series).length > 0) {
    return { bundle: _chartsCache, source: "cache" };
  }
  if (_chartsInflight) {
    return _chartsInflight;
  }
  _chartsInflight = fetchSimulationChartsBundle().then((res) => {
    if (res.bundle?.series && Object.keys(res.bundle.series).length > 0) {
      _chartsCache = res.bundle;
    }
    _chartsInflight = null;
    return res;
  });
  return _chartsInflight;
}

export function chartSeriesReady(
  bundle: ChartBundle | null | undefined,
  seriesKey: string | null | undefined,
): boolean {
  if (!seriesKey) return true;
  const pts = bundle?.series?.[seriesKey]?.points;
  return Array.isArray(pts) && pts.length > 0;
}

export function lossAlertsChartsReady(
  alerts: { seriesKey: string | null }[],
  bundle: ChartBundle | null | undefined,
): boolean {
  return alerts.every((a) => chartSeriesReady(bundle, a.seriesKey));
}

/** Chiave serie ``co:TICKER|YYYY-MM-DD`` da riga foglio Simulation. */
export function simulationRowSeriesKey(row: Record<string, unknown>): string | null {
  const tk = String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
  const cdRaw = String(row["Completion Date"] ?? row.completion_date ?? "").trim();
  if (!tk || !cdRaw || cdRaw === "—" || cdRaw === "-") return null;
  const iso = parseSheetDateToIso(cdRaw);
  if (!iso) return null;
  return `co:${tk}|${iso}`;
}

const SIM_PRED_COL: Record<number, string> = {
  [-60]: "Δ% vs Pred−60\nPred\n−60",
  [-30]: "Δ% vs Pred−60\nPred\n−30",
  [-10]: "Δ% vs Pred−60\nPred\n−10",
  [-7]: "Δ% vs Pred−60\nPred\n−7",
  [-5]: "Δ% vs Pred−60\nPred\n−5",
  [-3]: "Δ% vs Pred−60\nPred\n−3",
  4: "Δ% vs Pred−60\nPred\n+4",
  7: "Δ% vs Pred−60\nPred\n+7",
};

function parseSheetPct(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—" || raw === "-") return null;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw).replace(/%/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const scaled =
    Math.abs(n) <= 1.5 && !String(raw).includes("%") ? n * 100 : n;
  return Math.round(scaled * 100) / 100;
}

/** Valore colonna Pred foglio Simulation (pp) per offset calendario. */
export function simulationRowPredAtOffset(
  row: Record<string, unknown>,
  offset: number
): number | null {
  const col = SIM_PRED_COL[offset];
  if (!col) return null;
  return parseSheetPct(row[col]);
}

/** Applica valori Pred dal foglio Simulation; su nodi K-8 / AI feed usa % ricalibrata come foglio. */
export function overlaySheetPredOnPoints(
  points: ChartPoint[],
  row: Record<string, unknown> | null
): ChartPoint[] {
  if (!row) return points;
  return points.map((p) => {
    const nodo = p.nodo ?? "standard";
    if (nodo === "standard") {
      const sheetPred = simulationRowPredAtOffset(row, p.offset);
      if (sheetPred == null) return p;
      return { ...p, pct_foglio: sheetPred };
    }
    if (isSecK8Node(p) || nodo === "AI feed") {
      const rec = p.pct_curva ?? p.pct_reale;
      if (rec == null || rec !== rec) return p;
      return { ...p, pct_foglio: rec };
    }
    return p;
  });
}

export function findSimulationRow(
  rows: Record<string, unknown>[],
  seriesKey: string
): Record<string, unknown> | null {
  for (const row of rows) {
    if (simulationRowSeriesKey(row) === seriesKey) return row;
  }
  return null;
}

/** Normalizza Completion Date per match log slope ↔ foglio Simulation. */
export function normalizeSheetCompletionDate(cd: string): string {
  const raw = String(cd ?? "").trim();
  if (!raw) return "";
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (slash) {
    return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }
  const iso = new Date(raw);
  if (!Number.isFinite(iso.getTime())) return raw.toUpperCase();
  return iso.toISOString().slice(0, 10);
}

/** Chiave serie ``co:TICKER|YYYY-MM-DD`` da ticker + CD (log slope, feed). */
export function simulationSeriesKeyFromTickerCd(ticker: string, cd: string): string | null {
  const tUp = ticker.trim().toUpperCase();
  const iso = normalizeSheetCompletionDate(cd);
  if (!tUp || !iso) return null;
  return `co:${tUp}|${iso}`;
}

/** Punti curva dallo snapshot quando la riga Simulation non c’è più (o CD diverso). */
export function findChartSeriesByTickerCd(
  bundle: ChartBundle | null | undefined,
  ticker: string,
  cd: string,
): { seriesKey: string; points: ChartPoint[] } | null {
  const series = bundle?.series;
  if (!series) return null;
  const preferred = simulationSeriesKeyFromTickerCd(ticker, cd);
  if (preferred && series[preferred]?.points?.length) {
    return { seriesKey: preferred, points: series[preferred].points! };
  }
  const tUp = ticker.trim().toUpperCase();
  const prefix = `co:${tUp}|`;
  for (const [k, s] of Object.entries(series)) {
    if (!k.startsWith(prefix) || !s?.points?.length) continue;
    return { seriesKey: k, points: s.points };
  }
  return null;
}

/** Riga Simulation per ticker + CD (fallback: prima riga del ticker). */
export function findSimulationRowByTickerCd(
  rows: Record<string, unknown>[],
  ticker: string,
  cd: string,
): Record<string, unknown> | null {
  const tUp = ticker.trim().toUpperCase();
  const cdKey = cd.trim() ? normalizeSheetCompletionDate(cd) : "";
  let fallback: Record<string, unknown> | null = null;
  for (const row of rows) {
    const rt = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (rt !== tUp) continue;
    if (!fallback) fallback = row;
    const rcd = String(row["CD"] ?? row["Data CD"] ?? row["Completion Date"] ?? "").trim();
    if (!cdKey || normalizeSheetCompletionDate(rcd) === cdKey || rcd === cd.trim()) {
      return row;
    }
  }
  return fallback;
}

function parseSheetDateToIso(s: string): string | null {
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (iso) return iso[0];
  return null;
}
