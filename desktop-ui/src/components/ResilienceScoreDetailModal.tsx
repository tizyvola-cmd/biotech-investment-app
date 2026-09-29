/**
 * ResilienceScoreDetailModal — per-ticker breakdown of the Resilience Score.
 *
 * Shows the three intrinsic components computed on the ticker's own 5y
 * price history + XBI (see `prediction/resilience_score.py`):
 *   A. Historical drawdown-recovery (block A, max 45 pt)
 *   B. Asymmetric beta vs XBI       (block B, max 30 pt)
 *   C. Upside capacity              (block C, max 25 pt)
 *
 * Structurally independent from SDS (pre-CD price pattern) and Regulatory
 * (CRL / PDUFA / CMC): the score uses only long price history and market
 * benchmark returns.
 */

import { useMemo, useState } from "react";
import { AppModal, AppModalCloseButton } from "./AppModal";
import type { ResilienceEntryDoc } from "../sheet/resilienceScoreData";
import { resilienceScoreTone } from "../sheet/resilienceScoreData";

export type ResilienceScoreDetailModalProps = {
  open: boolean;
  onClose: () => void;
  /** Full snapshot index keyed by uppercased ticker. */
  index: Map<string, ResilienceEntryDoc>;
  /** Optional: pre-select this ticker on open. */
  initialTicker?: string | null;
  /** Snapshot metadata for the footer. */
  generatedAt?: string | null;
  skippedCount?: number;
};

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

function toneClass(tone: "up" | "flat" | "down"): string {
  if (tone === "up") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "down") return "text-rose-500 dark:text-rose-400";
  return "text-amber-600 dark:text-amber-400";
}

function StatusPill({ status }: { status: string }): JSX.Element {
  if (status === "ok") return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      ok
    </span>
  );
  if (status === "insufficient_history") return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      short history
    </span>
  );
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {status}
    </span>
  );
}

function ComponentCard({
  label,
  scoreText,
  scoreMax,
  status,
  rows,
}: {
  label: string;
  scoreText: string;
  scoreMax: number;
  status: string;
  rows: Array<{ k: string; v: string }>;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-2.5 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h5 className="text-[10px] font-bold uppercase tracking-wide text-ink">
          {label}
        </h5>
        <StatusPill status={status} />
      </div>
      <p className="text-lg font-black tabular-nums leading-none text-ink">
        {scoreText}
        <span className="ml-1 text-[10px] font-medium text-ink-muted">/ {scoreMax}</span>
      </p>
      <dl className="space-y-0.5 text-[10px]">
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2">
            <dt className="text-ink-muted">{r.k}</dt>
            <dd className="tabular-nums font-semibold text-ink">{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TickerBreakdown({ entry }: { entry: ResilienceEntryDoc }): JSX.Element {
  const rec = entry.components.historical_recovery as Record<string, unknown>;
  const beta = entry.components.asymmetric_beta as Record<string, unknown>;
  const upside = entry.components.upside_capacity as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-[rgb(var(--border))]/30">
        <div>
          <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">
            Ticker
          </p>
          <p className="text-lg font-black text-ink">{entry.ticker}</p>
          {entry.as_of && (
            <p className="text-[9px] text-ink-muted tabular-nums">as of {entry.as_of}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">
            Resilience Score
          </p>
          <p className={`text-3xl font-black tabular-nums leading-none ${toneClass(resilienceScoreTone(entry.resilience_score))}`}>
            {fmt(entry.resilience_score, 1)}
          </p>
          <p className="text-[9px] tabular-nums text-ink-muted mt-0.5">/ {entry.max_score}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ComponentCard
          label="A — Drawdown-Recovery"
          scoreText={fmt(Number(rec.score ?? 0), 1)}
          scoreMax={Number(rec.max ?? 45)}
          status={String(rec.status ?? "n/a")}
          rows={[
            { k: "Drawdown events", v: fmtInt(rec.drawdown_events as number | undefined) },
            { k: "Full recoveries", v: fmtInt(rec.full_recoveries as number | undefined) },
            { k: "Success rate", v: rec.success_rate_pct != null ? `${fmt(Number(rec.success_rate_pct), 1)}%` : "—" },
            { k: "Median recovery days", v: fmtInt(rec.median_recovery_days as number | undefined) },
          ]}
        />
        <ComponentCard
          label="B — Asymmetric β"
          scoreText={fmt(Number(beta.score ?? 0), 1)}
          scoreMax={Number(beta.max ?? 30)}
          status={String(beta.status ?? "n/a")}
          rows={[
            { k: "β on down days", v: fmt(Number(beta.beta_down ?? NaN), 3) },
            { k: "β on up days", v: fmt(Number(beta.beta_up ?? NaN), 3) },
            { k: "Asymmetry (up − down)", v: fmt(Number(beta.asymmetry ?? NaN), 3) },
            { k: "Down / up bars", v: `${fmtInt(beta.n_down as number | undefined)} / ${fmtInt(beta.n_up as number | undefined)}` },
          ]}
        />
        <ComponentCard
          label="C — Upside Capacity"
          scoreText={fmt(Number(upside.score ?? 0), 1)}
          scoreMax={Number(upside.max ?? 25)}
          status={String(upside.status ?? "n/a")}
          rows={[
            { k: "% below 52w high", v: upside.pct_from_52w_high != null ? `${fmt(Number(upside.pct_from_52w_high), 2)}%` : "—" },
            { k: "Positive quarters", v: upside.positive_quarters_frac != null && upside.positive_quarters_evaluated != null
                ? `${Math.round(Number(upside.positive_quarters_frac) * Number(upside.positive_quarters_evaluated))}/${fmtInt(upside.positive_quarters_evaluated as number)}`
                : "—" },
            { k: "C1 (dist. from high) pt", v: fmt(Number(upside.c1_pt ?? NaN), 1) },
            { k: "C2 (positive quarters) pt", v: fmt(Number(upside.c2_pt ?? NaN), 1) },
          ]}
        />
      </div>
    </div>
  );
}

export function ResilienceScoreDetailModal({
  open,
  onClose,
  index,
  initialTicker = null,
  generatedAt = null,
  skippedCount = 0,
}: ResilienceScoreDetailModalProps): JSX.Element | null {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(initialTicker);
  const [query, setQuery] = useState<string>("");

  const sortedEntries = useMemo(() => {
    const arr = Array.from(index.values()).filter((e) => e.status === "ok");
    arr.sort((a, b) => b.resilience_score - a.resilience_score);
    return arr;
  }, [index]);

  const filteredEntries = useMemo(() => {
    if (!query.trim()) return sortedEntries;
    const q = query.trim().toUpperCase();
    return sortedEntries.filter((e) => e.ticker.includes(q));
  }, [sortedEntries, query]);

  const stats = useMemo(() => {
    if (sortedEntries.length === 0) return null;
    const scores = sortedEntries.map((e) => e.resilience_score);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
    return {
      n: scores.length,
      mean,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }, [sortedEntries]);

  const currentEntry = selectedTicker ? index.get(selectedTicker.toUpperCase()) ?? null : null;

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label="Resilience Score detail"
      panelClassName="w-full max-w-4xl"
    >
      <div className="card w-full max-h-[92vh] shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border))]/40 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Model comparison · Resilience Score
            </p>
            <h3 className="text-sm font-bold text-ink leading-snug mt-0.5">
              Per-ticker breakdown (A + B + C)
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Recovery & growth capacity, computed from a ticker's own 5y closes and XBI.
              Independent from SDS and Regulatory.
            </p>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </div>

        <div className="px-4 py-3 space-y-3 min-h-0 overflow-y-auto">
          {stats && (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[10px] text-ink-muted border-b border-[rgb(var(--border))]/30 pb-2">
              <span>
                <span className="font-semibold">Scored:</span>{" "}
                <span className="tabular-nums font-bold text-ink">{stats.n}</span>
              </span>
              <span>
                <span className="font-semibold">Skipped:</span>{" "}
                <span className="tabular-nums font-bold text-ink">{skippedCount}</span>
              </span>
              <span>
                <span className="font-semibold">Mean:</span>{" "}
                <span className="tabular-nums font-bold text-ink">{fmt(stats.mean, 1)}</span>
              </span>
              <span>
                <span className="font-semibold">Median:</span>{" "}
                <span className="tabular-nums font-bold text-ink">{fmt(stats.median, 1)}</span>
              </span>
              <span>
                <span className="font-semibold">Range:</span>{" "}
                <span className="tabular-nums font-bold text-ink">
                  {fmt(stats.min, 1)} → {fmt(stats.max, 1)}
                </span>
              </span>
              {generatedAt && (
                <span>
                  <span className="font-semibold">Snapshot:</span>{" "}
                  <span className="tabular-nums">{generatedAt}</span>
                </span>
              )}
            </div>
          )}

          {currentEntry ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setSelectedTicker(null)}
                className="text-[10px] font-semibold text-sky-600 hover:underline dark:text-sky-400"
              >
                ← Back to ticker list
              </button>
              <TickerBreakdown entry={currentEntry} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Filter
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ticker prefix (e.g. VIR, MRN)…"
                  className="flex-1 rounded border border-[rgb(var(--border))]/50 bg-surface/30 px-2 py-1 text-[11px] font-mono text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <span className="text-[10px] tabular-nums text-ink-muted">
                  {filteredEntries.length} / {sortedEntries.length}
                </span>
              </div>

              {filteredEntries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 py-6 text-center text-[11px] text-ink-muted">
                  {sortedEntries.length === 0
                    ? "No resilience snapshot loaded — run the desktop-snapshots pipeline to populate data/resilience_scores_snapshot.json."
                    : "No ticker matches the filter."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-[rgb(var(--border))]/40 text-[9px] uppercase tracking-wide text-ink-muted">
                        <th className="px-2 py-1.5 text-left font-semibold">Ticker</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Score</th>
                        <th className="px-2 py-1.5 text-right font-semibold">A (recov.)</th>
                        <th className="px-2 py-1.5 text-right font-semibold">B (β asym.)</th>
                        <th className="px-2 py-1.5 text-right font-semibold">C (upside)</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Success</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Med. recov. d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((e) => {
                        const rec = e.components.historical_recovery as Record<string, unknown>;
                        const beta = e.components.asymmetric_beta as Record<string, unknown>;
                        const upside = e.components.upside_capacity as Record<string, unknown>;
                        const tone = resilienceScoreTone(e.resilience_score);
                        return (
                          <tr
                            key={e.ticker}
                            onClick={() => setSelectedTicker(e.ticker)}
                            className="border-b border-[rgb(var(--border))]/20 hover:bg-surface/40 cursor-pointer"
                          >
                            <td className="px-2 py-1.5 font-mono font-semibold text-ink">{e.ticker}</td>
                            <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${toneClass(tone)}`}>
                              {fmt(e.resilience_score, 1)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink">{fmt(Number(rec.score ?? 0), 1)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink">{fmt(Number(beta.score ?? 0), 1)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink">{fmt(Number(upside.score ?? 0), 1)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">
                              {rec.success_rate_pct != null ? `${fmt(Number(rec.success_rate_pct), 0)}%` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">
                              {fmtInt(rec.median_recovery_days as number | undefined)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div className="border-t border-[rgb(var(--border))]/30 pt-2 text-[9px] text-ink-muted leading-relaxed">
            <p className="font-semibold text-ink mb-0.5">Methodology</p>
            <p>
              <strong>A</strong> = drawdown-recovery pairs on 5y history (success rate 25 pt,
              median velocity 20 pt). <strong>B</strong> = asymmetric beta vs XBI on daily
              returns (β<sub>up</sub> − β<sub>down</sub>, 30 pt). <strong>C</strong> =
              distance from 52-week high (10 pt) + fraction of last-8 quarters with ≥+5%
              return (15 pt). Ticker-intrinsic; does not use SDS features, cash runway,
              volume anomaly, or regulatory events.
            </p>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
