export type SheetTable = {
  sheet: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count?: number;
  error?: string;
  source?: string;
  workbook_note?: string;
};

export type InvestSimInputEntry = {
  buyPrice: number;
  capital: number;
  ignoreSheet?: boolean;
  investedAt?: string;
  purchaseDate?: string;
  soldAt?: string;
  closedPnlEur?: number;
};

export type InvestSimInputs = Record<string, InvestSimInputEntry>;

export type InvestSimPersistedPayload = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
};

export type InvestSimHistoryPoint = {
  ts: string;
  capital: number;
  value: number;
  pnl: number;
  pnlPct: number;
  byTicker: Record<string, { value: number; pnl: number; pnlPct: number }>;
};

export type InvestSimHistoryPayload = {
  version: number;
  updated_at: string | null;
  points: InvestSimHistoryPoint[];
};

export type ChartPoint = {
  offset: number;
  nodo?: string;
  pct_curva?: number | null;
  pct_foglio?: number | null;
  pct_modello?: number | null;
  pct_reale?: number | null;
  price_usd?: number | null;
  price_storico_usd?: number | null;
};

export type ChartBundle = {
  series?: Record<
    string,
    { points?: ChartPoint[]; kind?: string; label?: string }
  >;
  note?: string;
};
