/**

 * Financial sheet — stile allineato a Simulation: frecce verdi/rosse, niente blocchi arancio/blu.

 */

import type { CSSProperties, ReactNode } from "react";

import { toSheetNum } from "./sharedTableCellStyle";
import { columnWidthStyle, type TableViewPrefs } from "./tableViewPrefs";



const POS = "rgb(var(--positive))";

const NEG = "rgb(var(--negative))";

const ACCENT = "rgb(var(--accent))";

const MUTED = "rgb(var(--ink-muted))";

const INK = "rgb(var(--panel-mint-ink))";

const PRICE_THRESHOLD_PCT = 5;



/** Colonne senza conditional-format Excel (evita gradienti arancio/blu sovrapposti). */

export const FIN_CF_SKIP_COLUMNS = new Set<string>([

  "dailyChange_%",

  "variation_1m_%_variations",

  "variation_3m_%_variations",

  "variation_6m_%_variations",

  "variation_9m_%_variations",

  "marketCap",

  "enterpriseValue",

  "currentPrice",

  "last_close",

  "highPrice",

  "lowPrice",

  "avg_1m_close",

  "avg_3m_close",

  "avg_6m_close",

  "beta",

  "liquidita_fy",

  "liquidity_score",

  "current_ratio",

  "quick_ratio",

  "cash_ratio",

]);



export const FIN_KEY_COLUMNS = [

  "symbol",

  "companyName",

  "sector",

  "industry",

  "marketCap",

  "liquidita_fy",

  "liquidity_score",

  "beta",

  "currentPrice",

  "last_close",

  "dailyChange_%",

  "variation_1m_%_variations",

  "variation_3m_%_variations",

  "variation_6m_%_variations",

  "highPrice",

  "lowPrice",

  "avg_1m_close",

  "avg_3m_close",

  "avg_6m_close",

] as const;



export const FIN_VAR_COLUMNS = [

  "variation_6m_%_variations",

  "variation_3m_%_variations",

  "variation_1m_%_variations",

  "dailyChange_%",

] as const;



const FIN_VAR_SET = new Set<string>(FIN_VAR_COLUMNS);



/** Colonne USD con barra gradiente proporzionale al valore (min–max tabella). */
export const FIN_DATA_BAR_COLUMNS = ["marketCap", "enterpriseValue", "currentPrice"] as const;

const FIN_DATA_BAR_SET = new Set<string>(FIN_DATA_BAR_COLUMNS);

export const FIN_RATIO_COLUMNS = ["current_ratio", "quick_ratio", "cash_ratio"] as const;

const FIN_RATIO_SET = new Set<string>(FIN_RATIO_COLUMNS);

const PRICE_COMPARE_COLS = new Set([

  "highPrice",

  "lowPrice",

  "last_close",

  "avg_1m_close",

  "avg_3m_close",

  "avg_6m_close",

]);



const VAR_MAX_ABS: Record<string, number> = {

  "dailyChange_%": 5,

  "variation_1m_%_variations": 15,

  "variation_3m_%_variations": 25,

  "variation_6m_%_variations": 40,

};



const COLUMN_LABELS: Record<string, string> = {

  symbol: "Ticker",

  companyName: "Company",

  sector: "Sector",

  industry: "Industry",

  marketCap: "Mkt cap",
  enterpriseValue: "Enterprise value",

  liquidita_fy: "Liquidity FY",

  liquidity_score: "Liq score",

  beta: "Beta",

  currentPrice: "Price",

  last_close: "Last close",

  "dailyChange_%": "Day %",

  "variation_1m_%_variations": "1M %",

  "variation_3m_%_variations": "3M %",

  "variation_6m_%_variations": "6M %",

  highPrice: "High",

  lowPrice: "Low",

  avg_1m_close: "Avg 1M",

  avg_3m_close: "Avg 3M",

  avg_6m_close: "Avg 6M",

  current_ratio: "Current ratio",

  quick_ratio: "Quick ratio",

  cash_ratio: "Cash ratio",

  liquidity_fy_date: "Liq FY date",

};



export const FIN_LEGEND = [

  { label: "Var. %", hint: "green ▲ rise · red ▼ decline (no fill blocks)" },

  { label: "Mkt cap · EV · Price", hint: "$ + log bar (EV/cap) vs column min–max" },

  { label: "Last close · High/Low", hint: "★ if current ≥+5% vs last close · ⚡ if ≤−5% · High/Low vs price" },

  { label: "CR · QR · Cash FY", hint: "CR · QR · Cash FY" },

  { label: "Liq score · Beta", hint: "0–1 bar: green high · amber mid · navy low · beta ⚡ if >2" },

  { label: "Ticker", hint: "P portfolio · W watchlist" },

] as const;



export function orderFinancialColumns(columns: string[]): string[] {

  const keyList = FIN_KEY_COLUMNS as readonly string[];

  const keys = keyList.filter((c) => columns.includes(c));

  const rest = columns.filter((c) => !keys.includes(c));

  return [...keys, ...rest];

}

/** Min-width per colonna Financial (rem) — tabella scrollabile orizzontalmente. */
const FIN_COL_MIN_REM: Record<string, number> = {
  symbol: 4.5,
  companyName: 11,
  sector: 7.5,
  industry: 8.5,
  marketCap: 6.5,
  enterpriseValue: 6.5,
  liquidita_fy: 5.5,
  liquidity_score: 5.5,
  beta: 4.5,
  currentPrice: 5.5,
  last_close: 5.5,
  cik: 7,
};

export function financialColumnWidthStyle(
  column: string,
  prefs: TableViewPrefs,
): { maxWidth: string; width?: string; minWidth?: string } {
  const base = columnWidthStyle(column, prefs);
  if (base.width) return base;
  const minRem = FIN_COL_MIN_REM[column] ?? 5.25;
  return { ...base, minWidth: `${minRem}rem` };
}



export function formatFinancialColumnHeader(column: string): string {

  return COLUMN_LABELS[column] ?? column.replace(/_/g, " ").replace(/%_variations/g, "%");

}



export function financialHeaderCellClass(column: string): string | undefined {

  if (FIN_VAR_SET.has(column)) return "fin-col-var";

  if (

    FIN_DATA_BAR_SET.has(column) ||

    PRICE_COMPARE_COLS.has(column) ||

    column === "liquidita_fy" ||

    column === "liquidity_score" ||

    column === "beta" ||

    FIN_RATIO_SET.has(column)

  ) {

    return "fin-col-metric";

  }

  return undefined;

}



export function fmtFinancialMktCap(v: unknown): string {

  const n = Number(v);

  if (!n || !Number.isFinite(n)) return "—";

  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;

  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;

  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;

  return `$${n.toFixed(0)}`;

}



export type FinancialStyleContext = {

  dataBarByColumn: Map<string, { min: number; max: number }>;

  portfolioTickers?: Set<string>;

  watchTickers?: Set<string>;

};



/** Legge valori USD numerici o stringhe tipo 1.2B / 388M. */
export function parseFinancialUsd(raw: unknown): number | null {
  const direct = toSheetNum(raw);
  if (direct != null && direct > 0) return direct;
  const s = String(raw ?? "")
    .trim()
    .replace(/[$,\s]/g, "");
  if (!s || s === "—") return null;
  const m = /^([\d.]+)\s*([KMBT])?$/i.exec(s);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toUpperCase();
  const mult =
    suffix === "K"
      ? 1e3
      : suffix === "M"
        ? 1e6
        : suffix === "B"
          ? 1e9
          : suffix === "T"
            ? 1e12
            : 1;
  return base * mult;
}

function rowFinancialUsd(row: Record<string, unknown>, col: string): number | null {
  return parseFinancialUsd(row[col]) ?? parseFinancialUsd(row[normalizeFinancialColumn(col)]);
}

export function normalizeFinancialColumn(column: string): string {
  const k = column.trim();
  const compact = k.toLowerCase().replace(/[\s_]+/g, "");
  if (compact === "enterprisevalue") return "enterpriseValue";
  if (compact === "marketcap") return "marketCap";
  if (compact === "currentprice") return "currentPrice";
  return k;
}

export function buildFinancialStyleContext(
  rows: Record<string, unknown>[],
): Pick<FinancialStyleContext, "dataBarByColumn"> {
  const map = new Map<string, { min: number; max: number }>();
  for (const col of FIN_DATA_BAR_COLUMNS) {
    const vals: number[] = [];
    for (const row of rows) {
      const n = rowFinancialUsd(row, col);
      if (n != null && n > 0) vals.push(n);
    }
    if (vals.length) map.set(col, { min: Math.min(...vals), max: Math.max(...vals) });
  }
  return { dataBarByColumn: map };
}



function trendIcon(pct: number): { icon: string; iconColor: string } {

  if (Math.abs(pct) < 0.05) return { icon: "●", iconColor: MUTED };

  if (pct > 0) return { icon: "▲", iconColor: POS };

  return { icon: "▼", iconColor: NEG };

}



function signedPctStyleTextOnly(n: number, maxAbs: number): CSSProperties {

  if (Math.abs(n) < 0.05) return { color: MUTED };

  const bold = Math.abs(n) >= maxAbs * 0.35;

  if (n > 0) return { color: POS, fontWeight: bold ? "700" : "500" };

  return { color: NEG, fontWeight: bold ? "700" : "500" };

}



function normalizeVariationPct(raw: unknown): number | null {

  const n = toSheetNum(raw);

  if (n === null) return null;

  return Math.abs(n) <= 1.5 ? n * 100 : n;

}



/** Prezzo di riferimento per ★/⚡: sempre il prezzo corrente (last close non vs sé stesso). */
function refPriceForColumn(column: string, row: Record<string, unknown>): number | null {
  const current = toSheetNum(row.currentPrice);
  if (column === "last_close") return current;
  return current ?? toSheetNum(row.last_close);
}



function priceCompareIcons(
  price: number,
  ref: number,
): { icon?: string; iconColor?: string } {
  if (ref <= 0) return {};
  const pct = ((price - ref) / ref) * 100;
  if (pct >= PRICE_THRESHOLD_PCT) return { icon: "★", iconColor: POS };
  if (pct <= -PRICE_THRESHOLD_PCT) return { icon: "⚡", iconColor: "rgb(var(--warn))" };
  return {};
}

/** Last close: ★ se prezzo attuale ≥+5% vs chiusura, ⚡ se ≤−5%. */
function lastCloseOscillation(
  lastClose: number,
  row: Record<string, unknown>,
): { icon?: string; iconColor?: string; pctVsCurrent: number | null } {
  const current = toSheetNum(row.currentPrice);
  if (current == null || current <= 0 || lastClose <= 0) {
    return { pctVsCurrent: null };
  }
  const pct = ((current - lastClose) / lastClose) * 100;
  const icons = priceCompareIcons(current, lastClose);
  return { ...icons, pctVsCurrent: pct };
}



function dataBarPct(value: number, min: number, max: number, useLog: boolean): number {
  if (max <= min) return 50;
  if (useLog && min > 0 && max > 0 && value > 0) {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    const v = Math.log10(value);
    if (hi <= lo) return 50;
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
  }
  return Math.max(0, Math.min(1, (value - min) / (max - min))) * 100;
}

/** Barra orizzontale: fill 0→pct% (lineare o log per cap/EV). */
function dataBarGradientStyle(
  value: number,
  min: number,
  max: number,
  kind: "cap" | "ev" | "price",
): CSSProperties {
  const useLog = kind === "cap" || kind === "ev";
  const pct = Math.max(1, Math.min(100, Math.round(dataBarPct(value, min, max, useLog))));
  const axis = "rgba(var(--panel-feed-border-soft) / 0.45)";
  const base: CSSProperties = {
    fontVariantNumeric: "tabular-nums",
    boxShadow: `inset 0 -1px 0 0 ${axis}`,
  };
  if (kind === "price") {
    return {
      ...base,
      color: ACCENT,
      fontWeight: "700",
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(to right, rgba(var(--accent) / 0.22) 0%, rgba(var(--accent) / 0.22) ${pct}%, transparent ${pct}%)`,
    };
  }
  if (kind === "ev") {
    return {
      ...base,
      color: INK,
      fontWeight: "600",
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(to right, rgba(var(--accent) / 0.32) 0%, rgba(var(--accent) / 0.32) ${pct}%, transparent ${pct}%)`,
    };
  }
  return {
    ...base,
    color: INK,
    fontWeight: "600",
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(to right, rgba(var(--positive) / 0.28) 0%, rgba(var(--positive) / 0.28) ${pct}%, transparent ${pct}%)`,
  };
}

function usdMetricCell(
  column: (typeof FIN_DATA_BAR_COLUMNS)[number],
  raw: unknown,
  dataBars: Map<string, { min: number; max: number }> | undefined,
  it: boolean,
): FinancialCellExtras {
  const n = parseFinancialUsd(raw);
  if (n === null || n <= 0) return { text: "—", style: { color: MUTED } };
  const kind =
    column === "currentPrice" ? "price" : column === "enterpriseValue" ? "ev" : "cap";
  const range = dataBars?.get(column);
  const style = range
    ? dataBarGradientStyle(n, range.min, range.max, kind)
    : {
        color: kind === "price" ? ACCENT : INK,
        fontWeight: kind === "price" ? "700" : "600",
        fontVariantNumeric: "tabular-nums" as const,
      };
  const text = column === "currentPrice" ? fmtPriceUsd(n) : fmtFinancialMktCap(n);
  const pctBar =
    range && range.max > range.min
      ? Math.round(dataBarPct(n, range.min, range.max, kind !== "price"))
      : null;
  const title =
    range && pctBar != null
      ? column === "enterpriseValue"
        ? it
          ? `EV ${text} — barra ~${pctBar}% (scala log min–max tabella)`
          : `EV ${text} — bar ~${pctBar}% (log scale vs column min–max)`
        : undefined
      : undefined;
  return {
    text,
    style,
    title,
    cellClassName: range ? "fin-has-databar" : undefined,
  };
}



function fmtPriceUsd(n: number): string {

  const decimals = n < 1 ? 4 : n < 10 ? 3 : 2;

  return `$${n.toFixed(decimals)}`;

}



type LiqMetric = { key: string; label: string; value: string; tone: "ok" | "warn" | "risk" | "muted" };



function parseLiquidityMetrics(raw: string): LiqMetric[] {

  const s = raw.trim();

  if (!s || s === "—") return [];

  const out: LiqMetric[] = [];

  const cr = /CR\s*([\d.]+)/i.exec(s);

  const qr = /QR\s*([\d.]+)/i.exec(s);

  const cash = /Cash[^|]*?([\d.]+)\s*M/i.exec(s) ?? /Cash\s*([\d.]+)/i.exec(s);

  if (cr) {

    const n = Number(cr[1]);

    out.push({

      key: "cr",

      label: "CR",

      value: Number.isFinite(n) ? n.toFixed(2) : cr[1],

      tone: !Number.isFinite(n) || n >= 1.5 ? "ok" : n >= 1 ? "warn" : "risk",

    });

  }

  if (qr) {

    const n = Number(qr[1]);

    out.push({

      key: "qr",

      label: "QR",

      value: Number.isFinite(n) ? n.toFixed(2) : qr[1],

      tone: !Number.isFinite(n) || n >= 1 ? "ok" : n >= 0.8 ? "warn" : "risk",

    });

  }

  if (cash) {

    out.push({ key: "cash", label: "Cash", value: `${cash[1]}M`, tone: "muted" });

  }

  if (out.length === 0) {

    return [{ key: "raw", label: "", value: s.length > 48 ? `${s.slice(0, 45)}…` : s, tone: "muted" }];

  }

  return out;

}



const LIQ_TONE_CLS: Record<LiqMetric["tone"], string> = {

  ok: "bg-[rgb(var(--positive)/0.12)] text-[rgb(var(--positive))] border-[rgb(var(--positive)/0.35)]",

  warn: "bg-[rgb(var(--warn)/0.12)] text-[rgb(var(--warn))] border-[rgb(var(--warn)/0.35)]",

  risk: "bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))] border-[rgb(var(--accent)/0.35)]",

  muted: "bg-slate-100/80 text-slate-600 border-slate-200/80",

};



function liquidityCellContent(raw: unknown): ReactNode {

  const metrics = parseLiquidityMetrics(String(raw ?? ""));

  if (!metrics.length) return "—";

  return (

    <span className="inline-flex flex-wrap items-center gap-1 max-w-[14rem]">

      {metrics.map((m) => (

        <span

          key={m.key}

          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold tabular-nums ${LIQ_TONE_CLS[m.tone]}`}

          title={String(raw ?? "")}

        >

          {m.label ? <span className="opacity-80">{m.label}</span> : null}

          <span>{m.value}</span>

        </span>

      ))}

    </span>

  );

}



/** Scala 0–1 (prediction/financial_liquidity): più alto = liquidità migliore. */
function normalizeLiquidityScore(raw: number): number {
  if (raw > 1.5) return Math.max(0, Math.min(1, raw / 100));
  if (raw > 1) return Math.max(0, Math.min(1, raw / 10));
  return Math.max(0, Math.min(1, raw));
}

type RatioColumn = (typeof FIN_RATIO_COLUMNS)[number];

function liquidityRatioBands(
  column: RatioColumn,
  value: number,
): { fill: string; color: string; weight: CSSProperties["fontWeight"] } {
  if (column === "current_ratio") {
    if (value < 1) {
      return { fill: "rgba(var(--negative) / 0.22)", color: NEG, weight: "700" };
    }
    if (value < 1.5) {
      return { fill: "rgba(var(--warn) / 0.22)", color: "rgb(var(--warn))", weight: "600" };
    }
    if (value < 3) {
      return { fill: "rgba(var(--positive) / 0.14)", color: POS, weight: "600" };
    }
    return { fill: "rgba(var(--positive) / 0.28)", color: POS, weight: "700" };
  }
  if (column === "quick_ratio") {
    if (value < 0.8) {
      return { fill: "rgba(var(--negative) / 0.22)", color: NEG, weight: "700" };
    }
    if (value < 1) {
      return { fill: "rgba(var(--warn) / 0.22)", color: "rgb(var(--warn))", weight: "600" };
    }
    if (value < 2) {
      return { fill: "rgba(var(--positive) / 0.14)", color: POS, weight: "600" };
    }
    return { fill: "rgba(var(--positive) / 0.28)", color: POS, weight: "700" };
  }
  if (value < 0.25) {
    return { fill: "rgba(var(--negative) / 0.22)", color: NEG, weight: "700" };
  }
  if (value < 0.5) {
    return { fill: "rgba(var(--warn) / 0.22)", color: "rgb(var(--warn))", weight: "600" };
  }
  if (value < 1) {
    return { fill: "rgba(var(--positive) / 0.14)", color: POS, weight: "600" };
  }
  return { fill: "rgba(var(--positive) / 0.28)", color: POS, weight: "700" };
}

function liquidityRatioCellStyle(column: RatioColumn, value: number): CSSProperties {
  const visualCap = column === "cash_ratio" ? 15 : column === "quick_ratio" ? 12 : 20;
  const barPct = Math.max(
    1,
    Math.min(100, Math.round((Math.min(Math.max(value, 0), visualCap) / visualCap) * 100)),
  );
  const { fill, color, weight } = liquidityRatioBands(column, value);
  return {
    color,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
    boxShadow: "inset 0 -1px 0 0 rgba(var(--panel-feed-border-soft) / 0.45)",
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(to right, ${fill} 0%, ${fill} ${barPct}%, transparent ${barPct}%)`,
  };
}

function liquidityRatioTitle(column: RatioColumn, value: number, it: boolean): string {
  const v = value.toFixed(2);
  if (column === "current_ratio") {
    return it
      ? `Current ratio ${v} (attivo corrente ÷ passivo corrente). <1 rosso · 1–1,5 ambra · ≥1,5 verde`
      : `Current ratio ${v} (current assets ÷ current liabilities). <1 red · 1–1.5 amber · ≥1.5 green`;
  }
  if (column === "quick_ratio") {
    return it
      ? `Quick ratio ${v}. <0,8 rosso · 0,8–1 ambra · ≥1 verde`
      : `Quick ratio ${v}. <0.8 red · 0.8–1 amber · ≥1 green`;
  }
  return it
    ? `Cash ratio ${v}. <0,25 rosso · 0,25–0,5 ambra · ≥0,5 verde`
    : `Cash ratio ${v}. <0.25 red · 0.25–0.5 amber · ≥0.5 green`;
}

function liquidityScoreCellStyle(score01: number): CSSProperties {
  const pct = Math.max(1, Math.min(100, Math.round(score01 * 100)));
  let fill = "rgba(var(--accent) / 0.2)";
  let color: string = ACCENT;
  let weight: CSSProperties["fontWeight"] = "700";
  if (score01 >= 0.75) {
    fill = "rgba(var(--positive) / 0.3)";
    color = POS;
    weight = "700";
  } else if (score01 >= 0.55) {
    fill = "rgba(var(--positive) / 0.17)";
    color = POS;
    weight = "600";
  } else if (score01 >= 0.4) {
    fill = "rgba(var(--warn) / 0.22)";
    color = "rgb(var(--warn))";
    weight = "600";
  }
  return {
    color,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
    boxShadow: "inset 0 -1px 0 0 rgba(var(--panel-feed-border-soft) / 0.45)",
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, transparent ${pct}%)`,
  };
}

function variationCell(

  column: string,

  raw: unknown,

): { text: string; style?: CSSProperties; icon?: string; iconColor?: string } {

  const pct = normalizeVariationPct(raw);

  if (pct === null) return { text: "—", style: { color: MUTED } };

  const sign = pct > 0 ? "+" : "";

  const maxAbs = VAR_MAX_ABS[column] ?? 20;

  const { icon, iconColor } = trendIcon(pct);

  return {

    text: `${sign}${pct.toFixed(column === "dailyChange_%" ? 2 : 1)}%`,

    style: signedPctStyleTextOnly(pct, maxAbs),

    icon,

    iconColor,

  };

}



export type FinancialCellExtras = {
  text: string;
  content?: ReactNode;
  style?: CSSProperties;
  title?: string;
  icon?: string;
  iconColor?: string;
  cellClassName?: string;
};



export function financialMetricCell(
  column: string,
  raw: unknown,
  row: Record<string, unknown>,
  ctx?: FinancialStyleContext,
  lang: "it" | "en" = "it",
): FinancialCellExtras | null {
  const it = lang === "it";
  column = normalizeFinancialColumn(column);

  const portfolio = ctx?.portfolioTickers;

  const watch = ctx?.watchTickers;

  const dataBars = ctx?.dataBarByColumn;



  if (column === "symbol") {

    const tk = String(raw ?? "").trim().toUpperCase();

    if (portfolio?.has(tk)) {

      return {

        text: tk,

        content: (

          <span className="flex items-center gap-1.5">

            <span

              className="text-[9px] px-1 py-0.5 rounded font-bold uppercase tracking-wider border border-[rgb(var(--positive)/0.35)]"

              style={{ background: "rgb(var(--positive) / 0.12)", color: POS }}

            >

              P

            </span>

            <span className="font-bold" style={{ color: INK }}>

              {tk}

            </span>

          </span>

        ) as ReactNode,

      };

    }

    if (watch?.has(tk)) {

      return {

        text: tk,

        content: (

          <span className="flex items-center gap-1.5">

            <span

              className="text-[9px] px-1 py-0.5 rounded font-bold uppercase tracking-wider border border-[rgb(var(--accent)/0.35)]"

              style={{ background: "rgb(var(--accent) / 0.12)", color: ACCENT }}

            >

              W

            </span>

            <span className="font-semibold" style={{ color: INK }}>

              {tk}

            </span>

          </span>

        ) as ReactNode,

      };

    }

    return { text: tk, style: { color: MUTED, fontWeight: "500" } };

  }



  if (column === "companyName") {

    const s = String(raw ?? "").trim();

    return { text: s || "—", style: { color: MUTED, maxWidth: "12rem" } };

  }



  if (FIN_DATA_BAR_SET.has(column)) {
    return usdMetricCell(column as (typeof FIN_DATA_BAR_COLUMNS)[number], raw, dataBars, it);
  }

  if (column === "liquidita_fy") {

    return {

      text: String(raw ?? "—"),

      content: liquidityCellContent(raw),

      title: String(raw ?? ""),

    };

  }



  if (column === "liquidity_score") {
    const n = toSheetNum(raw);
    if (n === null) return { text: "—", style: { color: MUTED } };
    const score01 = normalizeLiquidityScore(n);
    const display = score01 <= 1 ? score01.toFixed(2) : score01.toFixed(0);
    const pct = Math.round(score01 * 100);
    return {
      text: display,
      style: liquidityScoreCellStyle(score01),
      title: `Liquidità ${display} (0–1, ${pct}% barra · più alto = migliore)`,
      cellClassName: "fin-has-databar",
    };
  }

  if (FIN_RATIO_SET.has(column)) {
    const n = toSheetNum(raw);
    if (n === null) return { text: "—", style: { color: MUTED } };
    const col = column as RatioColumn;
    return {
      text: n.toFixed(2),
      style: liquidityRatioCellStyle(col, n),
      title: liquidityRatioTitle(col, n, it),
      cellClassName: "fin-has-databar",
    };
  }

  if (PRICE_COMPARE_COLS.has(column)) {

    const n = toSheetNum(raw);

    if (n === null || n === 0) return { text: "—", style: { color: MUTED } };

    const lastOsc = column === "last_close" ? lastCloseOscillation(n, row) : null;
    const ref = refPriceForColumn(column, row);
    const icons =
      column === "last_close"
        ? { icon: lastOsc?.icon, iconColor: lastOsc?.iconColor }
        : ref != null && ref > 0
          ? priceCompareIcons(n, ref)
          : {};

    const vsCurrentPct =
      column === "last_close"
        ? lastOsc?.pctVsCurrent ?? null
        : ref != null && ref > 0
          ? ((n - ref) / ref) * 100
          : null;

    const daily = normalizeVariationPct(row["dailyChange_%"]);

    const textColor =
      column === "last_close" && vsCurrentPct != null && Math.abs(vsCurrentPct) >= PRICE_THRESHOLD_PCT
        ? vsCurrentPct > 0
          ? POS
          : NEG
        : column === "last_close" && daily != null && Math.abs(daily) >= 0.05
          ? daily > 0
            ? POS
            : NEG
          : INK;

    const title =
      column === "last_close" && vsCurrentPct != null
        ? `Prezzo attuale ${vsCurrentPct >= 0 ? "+" : ""}${vsCurrentPct.toFixed(1)}% vs ultima chiusura (★ ≥+5% · ⚡ ≤−5%)`
        : vsCurrentPct != null
          ? `${vsCurrentPct >= 0 ? "+" : ""}${vsCurrentPct.toFixed(1)}% vs price`
          : column === "last_close"
            ? "Ultima chiusura — prezzo attuale non disponibile"
            : undefined;

    return {

      text: fmtPriceUsd(n),

      style: {

        color: textColor,

        fontWeight: column === "last_close" ? "600" : "500",

        fontVariantNumeric: "tabular-nums",

      },

      title,

      icon: icons.icon,

      iconColor: icons.iconColor,

    };

  }



  if (FIN_VAR_SET.has(column)) {

    return variationCell(column, raw);

  }



  if (column === "beta") {

    const n = toSheetNum(raw);

    if (n === null) return { text: "—", style: { color: MUTED } };

    let color = INK;

    let weight: CSSProperties["fontWeight"] = "500";

    let icon: string | undefined;

    let iconColor: string | undefined;

    if (n > 2) {

      color = "rgb(var(--warn))";

      weight = "700";

      icon = "⚡";

      iconColor = "rgb(var(--warn))";

    } else if (n > 1.35) {

      color = POS;

      weight = "600";

    } else if (n < 0.85) {

      color = ACCENT;

      weight = "600";

    }

    return {

      text: n.toFixed(2),

      style: { color, fontWeight: weight, fontVariantNumeric: "tabular-nums" },

      icon,

      iconColor,

      title: n > 2 ? "High volatility (β > 2)" : undefined,

    };

  }



  return null;

}


