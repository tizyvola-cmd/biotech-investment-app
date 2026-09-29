import type { SearchInterestLeg, SearchInterestRow } from "../api/supernova";

export type SearchInterestCell = {
  label: string;
  tone: "up" | "down" | "flat" | "none";
  deltaPct: number | null;
  /** 0..1 — how fat the arrow is (|%| 0 → 80+). */
  arrowFat: number;
};

const PCT_CAP = 999;

export function searchInterestDeltaPct(
  row: SearchInterestRow | null | undefined,
): number | null {
  const raw = row?.interest_delta_pct;
  if (raw != null && Number.isFinite(raw)) {
    return Math.max(-PCT_CAP, Math.min(PCT_CAP, raw));
  }
  const last = row?.interest_score;
  const prev = row?.prev_interest_score;
  if (last != null && prev != null && Number.isFinite(last) && Number.isFinite(prev)) {
    if (Math.abs(prev) < 1e-9) {
      if (Math.abs(last) < 1e-9) return 0;
      return last > 0 ? PCT_CAP : -PCT_CAP;
    }
    return Math.max(-PCT_CAP, Math.min(PCT_CAP, ((last - prev) / prev) * 100));
  }
  // Older / single-print cache: % vs 20d baseline so the cell is not blank.
  const bas = row?.rolling_baseline_20d;
  if (last != null && bas != null && Number.isFinite(last) && Number.isFinite(bas)) {
    if (Math.abs(bas) < 1e-9) {
      if (Math.abs(last) < 1e-9) return 0;
      return last > 0 ? PCT_CAP : -PCT_CAP;
    }
    return Math.max(-PCT_CAP, Math.min(PCT_CAP, ((last - bas) / bas) * 100));
  }
  return null;
}

/** 0 at a flat print, 1 at |%| ≥ 80. */
export function trendArrowFat(absPct: number): number {
  if (!Number.isFinite(absPct) || absPct <= 0) return 0;
  return Math.min(absPct, 80) / 80;
}

/** Compact Trend cell: % vs previous print, green up / red down. */
export function formatSearchInterestCell(
  row: SearchInterestRow | null | undefined,
  loading: boolean,
): SearchInterestCell {
  const pct = searchInterestDeltaPct(row);
  if (pct == null || !Number.isFinite(pct)) {
    const score = row?.interest_score;
    if (score != null && Number.isFinite(score)) {
      // Have a live/cached level but no prior print yet — show the 0–100 score.
      return {
        label: String(Math.round(score)),
        tone: "flat",
        deltaPct: 0,
        arrowFat: 0,
      };
    }
    return {
      label: loading ? "…" : "—",
      tone: "none",
      deltaPct: null,
      arrowFat: 0,
    };
  }
  const rounded = Math.round(pct);
  if (rounded === 0) {
    return { label: "=", tone: "flat", deltaPct: 0, arrowFat: 0 };
  }
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded}%`,
    tone: rounded > 0 ? "up" : "down",
    deltaPct: rounded,
    arrowFat: trendArrowFat(Math.abs(rounded)),
  };
}

export function searchInterestToneClass(tone: SearchInterestCell["tone"]): string {
  if (tone === "up") return "text-emerald-800 dark:text-emerald-300";
  if (tone === "down") return "text-rose-700 dark:text-rose-300";
  return "text-ink-muted";
}

export function searchInterestTooltip(
  row: SearchInterestRow | null | undefined,
  cell: SearchInterestCell,
  ticker: string,
  it: boolean,
  loading: boolean,
): string {
  if (cell.tone === "none") {
    if (loading) {
      return it ? "Google Trends in caricamento (ticker)." : "Google Trends loading (ticker).";
    }
    return it
      ? "Nessuna stampa Trends sul ticker (anche l’ultimo registrato manca)."
      : "No Trends print on the ticker (including last recorded).";
  }
  const last = row?.interest_score;
  const prev = row?.prev_interest_score;
  const lastTxt =
    last != null && Number.isFinite(last) ? String(Math.round(last)) : "—";
  const prevTxt =
    prev != null && Number.isFinite(prev) ? String(Math.round(prev)) : "—";
  const basis = row?.delta_basis;
  const weekend = basis === "weekend_vs_last_nasdaq" || Boolean(row?.stale);
  const vsBaseline = basis === "vs_baseline_20d";
  // Score-only cell (no % yet): absolute 0–100 interest.
  if (cell.deltaPct === 0 && cell.tone === "flat" && cell.label !== "=" && !/%$/.test(cell.label)) {
    return it
      ? `Google Trends su ${ticker}: interesse ${cell.label}/100${weekend ? " · ultimo registrato (weekend/chiusura)" : " (ancora senza stampa precedente per la %)"}. Non è Soft BUY/SELL.`
      : `Google Trends on ${ticker}: interest ${cell.label}/100${weekend ? " · last recorded (weekend/closed)" : " (no prior print for % yet)"}. Not Soft BUY/SELL.`;
  }
  if (it) {
    if (weekend) {
      return `Google Trends su ${ticker}: ${cell.label} · ultimo registrato (interesse ${lastTxt} vs ${prevTxt}). Weekend/chiusura — niente nuovo print. Non è Soft BUY/SELL.`;
    }
    if (vsBaseline) {
      return `Google Trends su ${ticker}: ${cell.label} vs baseline 20g (interesse ${lastTxt} vs ${prevTxt}). Non è Soft BUY/SELL.`;
    }
    return `Google Trends su ${ticker}: ${cell.label} vs la stampa precedente (interesse ${lastTxt} vs ${prevTxt}). Non è Soft BUY/SELL.`;
  }
  if (weekend) {
    return `Google Trends on ${ticker}: ${cell.label} vs the last NASDAQ-session print (interest ${lastTxt} vs ${prevTxt}). Weekend/closed. Not Soft BUY/SELL.`;
  }
  if (vsBaseline) {
    return `Google Trends on ${ticker}: ${cell.label} vs 20d baseline (interest ${lastTxt} vs ${prevTxt}). Not Soft BUY/SELL.`;
  }
  return `Google Trends on ${ticker}: ${cell.label} vs the previous print (interest ${lastTxt} vs ${prevTxt}). Not Soft BUY/SELL.`;
}

export type SearchInterestLegKind = "ticker" | "company" | "product";

export type SearchInterestLegLine = {
  kind: SearchInterestLegKind;
  term: string;
  shortLabel: string;
  cell: SearchInterestCell;
};

export function searchInterestLegLabel(kind: SearchInterestLegKind, it: boolean): string {
  if (kind === "company") return it ? "Nome" : "Name";
  if (kind === "product") return it ? "Prod" : "Prod";
  return "T";
}

function asLegRow(
  ticker: string,
  source: SearchInterestLeg | SearchInterestRow | null | undefined,
): SearchInterestRow | null {
  if (!source) return null;
  return {
    ticker,
    interest_score: source.interest_score,
    prev_interest_score: source.prev_interest_score,
    interest_delta_pct: source.interest_delta_pct,
    delta_basis: "delta_basis" in source ? source.delta_basis : undefined,
  };
}

export function formatSearchInterestLegCells(
  row: SearchInterestRow | null | undefined,
  loading: boolean,
  hints: { ticker: string; company?: string | null; product?: string | null },
  it: boolean,
): SearchInterestLegLine[] {
  const byKind = new Map<string, SearchInterestLeg>();
  for (const leg of row?.legs ?? []) {
    if (leg && typeof leg.kind === "string" && leg.kind) {
      byKind.set(leg.kind, leg);
    }
  }
  if (
    !byKind.has("ticker") &&
    row &&
    (row.interest_score != null || row.interest_delta_pct != null)
  ) {
    byKind.set("ticker", {
      kind: "ticker",
      term: row.query_term || hints.ticker,
      interest_score: row.interest_score,
      prev_interest_score: row.prev_interest_score,
      interest_delta_pct: row.interest_delta_pct,
    });
  }
  const ticker = hints.ticker.trim().toUpperCase();
  const company = (hints.company || "").trim();
  const product = (hints.product || "").trim();
  const wanted: { kind: SearchInterestLegKind; term: string }[] = [
    { kind: "ticker", term: byKind.get("ticker")?.term || ticker },
  ];
  if (company || byKind.has("company")) {
    wanted.push({ kind: "company", term: byKind.get("company")?.term || company });
  }
  if (product || byKind.has("product")) {
    wanted.push({ kind: "product", term: byKind.get("product")?.term || product });
  }
  const lines = wanted.map(({ kind, term }) => {
    const leg = byKind.get(kind);
    const source = kind === "ticker" && !leg ? row : asLegRow(ticker, leg);
    const hasScore =
      source != null &&
      (source.interest_delta_pct != null || source.interest_score != null);
    return {
      kind,
      term,
      shortLabel: searchInterestLegLabel(kind, it),
      cell: formatSearchInterestCell(source, loading && !hasScore),
    };
  });
  const scored = lines.filter((line) => line.cell.tone !== "none");
  return scored.length ? scored : lines.slice(0, 1);
}

export function searchInterestLegsTooltip(
  row: SearchInterestRow | null | undefined,
  lines: SearchInterestLegLine[],
  ticker: string,
  it: boolean,
  loading: boolean,
): string {
  const scored = lines.filter((line) => line.cell.tone !== "none");
  if (scored.length === 0) {
    if (loading) {
      return it
        ? "Google Trends in caricamento (ticker, nome, prodotto)."
        : "Google Trends loading (ticker, name, product).";
    }
    return it
      ? "Nessuna stampa Trends su ticker, nome o prodotto."
      : "No Trends print on ticker, name, or product.";
  }
  const weekend = row?.delta_basis === "weekend_vs_last_nasdaq";
  const parts = scored.map((line) => `${line.shortLabel} ${line.term}: ${line.cell.label}`);
  const head = it
    ? `Google Trends su ${ticker} — ${parts.join(" · ")}.`
    : `Google Trends on ${ticker} — ${parts.join(" · ")}.`;
  const tail = weekend
    ? it
      ? " Weekend/chiusura vs ultima stampa NASDAQ. Non è Soft BUY/SELL."
      : " Weekend/closed vs last NASDAQ-session print. Not Soft BUY/SELL."
    : it
      ? " Vs la stampa precedente. Non è Soft BUY/SELL."
      : " Vs the previous print. Not Soft BUY/SELL.";
  return `${head}${tail}`;
}

/** ~24h (`now 1-d`) Δ% — secondary to the 3-m daily baseline. */
export function searchInterest1dDeltaPct(
  row: SearchInterestRow | null | undefined,
): number | null {
  const raw = row?.interest_1d_delta_pct;
  if (raw != null && Number.isFinite(raw)) {
    return Math.max(-PCT_CAP, Math.min(PCT_CAP, raw));
  }
  const last = row?.interest_1d_score;
  const prev = row?.interest_1d_prev;
  if (last != null && prev != null && Number.isFinite(last) && Number.isFinite(prev)) {
    if (Math.abs(prev) < 1e-9) {
      if (Math.abs(last) < 1e-9) return 0;
      return last > 0 ? PCT_CAP : -PCT_CAP;
    }
    return Math.max(-PCT_CAP, Math.min(PCT_CAP, ((last - prev) / prev) * 100));
  }
  return null;
}

export function formatSearchInterest1dCell(
  row: SearchInterestRow | null | undefined,
  loading: boolean,
): SearchInterestCell {
  const pct = searchInterest1dDeltaPct(row);
  if (pct == null || !Number.isFinite(pct)) {
    const score = row?.interest_1d_score;
    if (score != null && Number.isFinite(score)) {
      return {
        label: String(Math.round(score)),
        tone: "flat",
        deltaPct: 0,
        arrowFat: 0,
      };
    }
    return {
      label: loading ? "…" : "—",
      tone: "none",
      deltaPct: null,
      arrowFat: 0,
    };
  }
  const rounded = Math.round(pct);
  if (rounded === 0) {
    return { label: "=", tone: "flat", deltaPct: 0, arrowFat: 0 };
  }
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded}%`,
    tone: rounded > 0 ? "up" : "down",
    deltaPct: rounded,
    arrowFat: trendArrowFat(Math.abs(rounded)),
  };
}

export function searchInterest1dTooltip(
  row: SearchInterestRow | null | undefined,
  cell: SearchInterestCell,
  ticker: string,
  it: boolean,
  loading: boolean,
): string {
  if (cell.tone === "none") {
    if (loading) {
      return it
        ? "Google Trends 24h in caricamento."
        : "Google Trends 24h loading.";
    }
    return it
      ? "Nessuna stampa Trends 24h (volume troppo basso o Google senza serie)."
      : "No 24h Trends print (too little volume or empty Google series).";
  }
  const last = row?.interest_1d_score;
  const prev = row?.interest_1d_prev;
  const lastTxt =
    last != null && Number.isFinite(last) ? String(Math.round(last)) : "—";
  const prevTxt =
    prev != null && Number.isFinite(prev) ? String(Math.round(prev)) : "—";
  const n = row?.interest_1d_samples;
  const nTxt = n != null && Number.isFinite(n) ? ` · ${n} campioni` : "";
  const nTxtEn = n != null && Number.isFinite(n) ? ` · ${n} samples` : "";
  if (it) {
    return `Google Trends 24h su ${ticker}: ${cell.label} vs il campione precedente (interesse ${lastTxt} vs ${prevTxt}${nTxt}). Finestra now 1-d — non è Soft BUY/SELL.`;
  }
  return `Google Trends 24h on ${ticker}: ${cell.label} vs the previous sample (interest ${lastTxt} vs ${prevTxt}${nTxtEn}). Window now 1-d — not Soft BUY/SELL.`;
}
