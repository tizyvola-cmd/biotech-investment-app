export type CatalystRow = {
  id: string;
  ticker: string;
  completionDate: string;
  direction: string;
  confidence: number | null;
  dataQualityScore: number | null;
  stars: string;
  phase: string;
  sponsorMatch: string;
  datiScarsi: boolean;
  predIncomplete: boolean;
  runUp30d: number | null;
  modelD7Pct: number | null;
  v5Q05Pct: number | null;
  v5Q95Pct: number | null;
  raw: Record<string, unknown>;
};

export type PastPredDocument = {
  schema_version?: number;
  rows: Record<string, Record<string, unknown>>;
  built_at?: string;
  _error?: string;
};

export type ApiStatus = {
  workbook: string | null;
  workbook_path: string | null;
  workbook_mtime: string | null;
  orchestrator_running: boolean;
  refresh_running?: boolean;
  refresh_status?: Record<string, string>;
};

export type SheetTable = {
  sheet: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count?: number;
  error?: string;
  available?: string[];
  /** Clinical simulation: ticker presenti in Simulation. */
  tickers?: string[];
  simulation_error?: string;
  simulation_cd_by_ticker?: Record<string, unknown>;
  filter_note?: string;
};

export type ChartPoint = {
  offset: number;
  /** Ordine foglio (standard prima di K-8 allo stesso offset). */
  sort?: [number, number];
  label?: string;
  nodo?: string;
  tipo?: string;
  pct_curva?: number | null;
  /** Valori colonne Pred foglio Simulation (allineati alla tabella). */
  pct_foglio?: number | null;
  pct_modello?: number | null;
  pct_reale?: number | null;
  price_usd?: number | null;
  price_storico_usd?: number | null;
  price_model_usd?: number | null;
  /** Nodo SEC K-8 (snapshot grafici). */
  k8_filing_date?: string | null;
  k8_session?: number | null;
  offset_filing?: number | null;
  data_cal?: string | null;
};

export type ChartSeries = {
  id: string;
  label: string;
  kind: "company" | "control" | string;
  points: ChartPoint[];
  var_horizons?: { label: string; pct: number | null }[];
};

export type ChartBundle = {
  mode: string;
  offsets: number[];
  series: Record<string, ChartSeries>;
  note?: string;
  loaded_at?: string;
};

export type FinancialViewMode = "nodes" | "table";

export type AppScreen =
  | "main"
  | "catalyst"
  | "simulation"
  | "clinical"
  | "secK8"
  | "financial"
  | "models"
  | "modelli"
  | "decisionLab"
  | "system";
