/**
 * Automatic EIS (last 10d) vs stock 24h price move — correlation strength for KPI table.
 */
import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import { pearsonR } from "./statSignificance";

export const EIS_AUTO_LOOKBACK_DAYS = 10;

export type EisAutoPriceCorrelation = {
  /** 0–5 signal bars (|ρ| or sign-agreement when n < 3). */
  bars: 0 | 1 | 2 | 3 | 4 | 5;
  pearsonR: number | null;
  nEvents: number;
  /** Recent net EIS sign matches 24h price direction. */
  aligned24h: boolean | null;
};

const MS_DAY = 86_400_000;

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isAutoEvent(ev: ClinicalPublicationEvent): boolean {
  const st = String(ev.source_type ?? "").trim().toLowerCase();
  return st !== "manual" && st !== "";
}

function eventPriceMove(ev: ClinicalPublicationEvent): number | null {
  const d = ev.price?.delta_p_1d ?? ev.eis?.delta_p_1d ?? null;
  return d != null && Number.isFinite(d) ? d : null;
}

function eventEisScore(ev: ClinicalPublicationEvent): number | null {
  const s = ev.eis?.score;
  return s != null && Number.isFinite(s) ? s : null;
}

function eventsForTicker(
  records: ClinicalPreCdRecord[] | null | undefined,
  ticker: string,
  lookbackDays: number,
  nowMs: number,
): ClinicalPublicationEvent[] {
  const tk = normalizeTicker(ticker);
  if (!tk || !records?.length) return [];
  const cutoff = nowMs - lookbackDays * MS_DAY;
  const out: ClinicalPublicationEvent[] = [];
  for (const rec of records) {
    if (normalizeTicker(rec.ticker ?? "") !== tk) continue;
    for (const ev of rec.clinical_events ?? rec.timeline_events ?? []) {
      if (!isAutoEvent(ev)) continue;
      const ds = String(ev.event_date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
      const ms = Date.parse(`${ds}T12:00:00`);
      if (!Number.isFinite(ms) || ms < cutoff) continue;
      out.push(ev);
    }
  }
  return out;
}

function signAgreementRate(pairs: { eis: number; move: number }[]): number | null {
  if (!pairs.length) return null;
  let agree = 0;
  for (const p of pairs) {
    const se = Math.sign(p.eis);
    const sm = Math.sign(p.move);
    if (se === 0 || sm === 0) continue;
    if (se === sm) agree += 1;
  }
  const usable = pairs.filter((p) => Math.sign(p.eis) !== 0 && Math.sign(p.move) !== 0).length;
  if (!usable) return null;
  return agree / usable;
}

function barsFromAbsR(absR: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (absR >= 0.85) return 5;
  if (absR >= 0.65) return 4;
  if (absR >= 0.45) return 3;
  if (absR >= 0.25) return 2;
  if (absR >= 0.1) return 1;
  return 0;
}

function netEisSign(pairs: { eis: number }[]): number {
  let sum = 0;
  for (const p of pairs) sum += p.eis;
  return Math.sign(sum);
}

function alignedWith24h(netSign: number, change24hPct: number | null): boolean | null {
  if (change24hPct == null || !Number.isFinite(change24hPct)) return null;
  if (Math.abs(change24hPct) < 0.25) return null;
  const priceSign = Math.sign(change24hPct);
  if (netSign === 0 || priceSign === 0) return null;
  return netSign === priceSign;
}

/** Score automatic EIS vs historical event-day moves and today's 24h direction. */
export function computeEisAutoPriceCorrelation(
  ticker: string,
  clinicalRecords: ClinicalPreCdRecord[] | null | undefined,
  change24hPct: number | null,
  opts?: { lookbackDays?: number; nowMs?: number },
): EisAutoPriceCorrelation {
  const lookback = opts?.lookbackDays ?? EIS_AUTO_LOOKBACK_DAYS;
  const nowMs = opts?.nowMs ?? Date.now();
  const events = eventsForTicker(clinicalRecords, ticker, lookback, nowMs);

  const pairs: { eis: number; move: number }[] = [];
  for (const ev of events) {
    const eis = eventEisScore(ev);
    const move = eventPriceMove(ev);
    if (eis == null || move == null) continue;
    pairs.push({ eis, move });
  }

  const nEvents = pairs.length;
  if (!nEvents) {
    return { bars: 0, pearsonR: null, nEvents: 0, aligned24h: null };
  }

  let r: number | null = null;
  if (nEvents >= 3) {
    r = pearsonR(
      pairs.map((p) => p.eis),
      pairs.map((p) => p.move),
    );
  }

  let bars: 0 | 1 | 2 | 3 | 4 | 5;
  if (r != null) {
    bars = barsFromAbsR(Math.abs(r));
  } else {
    const agree = signAgreementRate(pairs);
    bars = agree != null ? barsFromAbsR(agree) : nEvents >= 1 ? 1 : 0;
  }

  const aligned24h = alignedWith24h(netEisSign(pairs), change24hPct);
  if (aligned24h === true && bars < 5) {
    bars = (bars + 1) as 0 | 1 | 2 | 3 | 4 | 5;
  }

  return { bars, pearsonR: r, nEvents, aligned24h };
}

export function formatEisAutoPriceCorrelationTip(
  corr: EisAutoPriceCorrelation,
  change24hPct: number | null,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  const rStr =
    corr.pearsonR != null
      ? `ρ ${corr.pearsonR >= 0 ? "+" : ""}${corr.pearsonR.toFixed(2)}`
      : it
        ? "ρ n/d (<3 eventi)"
        : "ρ n/a (<3 events)";
  const ch =
    change24hPct != null && Number.isFinite(change24hPct)
      ? `${change24hPct >= 0 ? "+" : ""}${change24hPct.toFixed(1)}%`
      : "—";
  const align =
    corr.aligned24h === true
      ? it
        ? "EIS netto allineato al movimento 24h"
        : "Net EIS aligned with 24h move"
      : corr.aligned24h === false
        ? it
          ? "EIS netto non allineato al movimento 24h"
          : "Net EIS not aligned with 24h move"
        : "";
  return [
    it
      ? `EIS automatiche (${EIS_AUTO_LOOKBACK_DAYS}g) vs Δ prezzo evento`
      : `Auto EIS (${EIS_AUTO_LOOKBACK_DAYS}d) vs event-day price Δ`,
    `${rStr} · n=${corr.nEvents}`,
    it ? `Var. 24h: ${ch}` : `24h chg: ${ch}`,
    align,
  ]
    .filter(Boolean)
    .join(" · ");
}
