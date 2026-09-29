/**
 * CapitalDrilldownPanel — per-experiment capital allocation details.
 *
 * Three sections:
 *  1. Per-position breakdown table (read-only)
 *  2. Piggy bank balance (portfolio = closed P&L ledger; sim/synth = informational note)
 *  3. "Sana esubero" action — ONLY shown when availableCash < 0, requires explicit confirm
 *
 * No automatismo. Nessuna modifica senza conferma esplicita dell'utente.
 */
import { useState, useMemo } from "react";
import {
  buildCapitalDrilldown,
  type ExperimentCash,
  type ExperimentId,
} from "../sheet/experimentCash";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  appendPiggyReallocation,
  loadPiggyReallocationLog,
} from "../sheet/piggyBankReallocationLog";

type Props = {
  experiment: ExperimentId;
  experimentLabel: string;
  cash: ExperimentCash;
  inputs: InvestSimInputs;
  /** Portfolio only: realized closed P&L from ledger (null for sim/synth). */
  closedPiggyEur: number | null;
  onCover: (amountEur: number) => void;
  onClose: () => void;
  lang?: "it" | "en";
};

function fmtEur(n: number): string {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " $";
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

export function CapitalDrilldownPanel({
  experiment,
  experimentLabel,
  cash,
  inputs,
  closedPiggyEur,
  onCover,
  onClose,
  lang = "it",
}: Props) {
  const it = lang === "it";
  const rows = useMemo(() => buildCapitalDrilldown(inputs, experiment), [inputs, experiment]);

  const reallocated = useMemo(
    () =>
      loadPiggyReallocationLog()
        .filter((e) => e.experiment === experiment)
        .reduce((s, e) => s + e.amountEur, 0),
    [experiment],
  );

  const excess = -cash.availableCash; // positive when over-budget
  const hasExcess = excess > 0.01;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [coverAmount, setCoverAmount] = useState(() => Math.ceil(excess));

  function handleConfirmCover() {
    const amt = Math.max(0.01, coverAmount);
    appendPiggyReallocation({
      experiment,
      amountEur: amt,
      note: `Copertura esubero manuale — ${experimentLabel} — ${new Date().toLocaleDateString("it-IT")}`,
    });
    onCover(amt);
    setConfirmOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-[rgb(var(--border))]/60 bg-white dark:bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border))]/40 bg-slate-50/60 dark:bg-slate-900/30">
          <div>
            <p className="text-[13px] font-bold text-ink">
              {it ? "Allocazione capitale" : "Capital allocation"} — {experimentLabel}
            </p>
            <p className="text-[10px] text-ink-muted mt-0.5">
              {it ? "Solo posizioni aperte" : "Open positions only"} · {rows.length} ticker
            </p>
          </div>
          <button
            type="button"
            className="text-[11px] text-ink-muted hover:text-ink transition"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* ── Section 1: per-position table ── */}
          {rows.length === 0 ? (
            <p className="text-[11px] text-ink-muted italic text-center py-4">
              {it ? "Nessuna posizione aperta in questo canale." : "No open positions in this channel."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-ink-muted/70 uppercase text-[9px] tracking-wide border-b border-[rgb(var(--border))]/30">
                    <th className="text-left pb-1.5">Ticker</th>
                    <th className="text-right pb-1.5">Capitale $</th>
                    <th className="text-right pb-1.5">% tot. inv.</th>
                    <th className="text-right pb-1.5">Entry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]/20">
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/20">
                      <td className="py-1.5 font-semibold text-ink">{r.ticker}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtEur(r.capital)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{fmtPct(r.pctOfOpen)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">
                        {r.buyPrice != null ? `$${r.buyPrice.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Totals bar ── */}
          <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-slate-50/50 dark:bg-slate-900/20 px-3 py-2 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="text-[9px] text-ink-muted uppercase tracking-wide">Budget</p>
              <p className="font-semibold tabular-nums">{fmtEur(cash.startingCapital)}</p>
            </div>
            <div>
              <p className="text-[9px] text-ink-muted uppercase tracking-wide">{it ? "Investito" : "Invested"}</p>
              <p className="font-semibold tabular-nums">{fmtEur(cash.openCapital)}</p>
            </div>
            <div>
              <p className="text-[9px] text-ink-muted uppercase tracking-wide">{it ? "Cassa" : "Cash"}</p>
              <p className={`font-semibold tabular-nums ${cash.availableCash < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {cash.availableCash >= 0 ? "+" : ""}{fmtEur(cash.availableCash)}
              </p>
            </div>
          </div>

          {/* ── Section 2: piggy bank balance ── */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">
              {it ? "Piggy Bank — " : "Piggy Bank — "}{experimentLabel}
            </p>
            {closedPiggyEur !== null ? (
              <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-amber-50/30 dark:bg-amber-950/10 px-3 py-2 text-[11px] space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-ink-muted">{it ? "P&L realizzato totale" : "Total realized P&L"}</span>
                  <span className={`tabular-nums font-semibold ${closedPiggyEur >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {closedPiggyEur >= 0 ? "+" : ""}{fmtEur(closedPiggyEur)}
                  </span>
                </div>
                {reallocated > 0 && (
                  <div className="flex justify-between text-ink-muted">
                    <span>{it ? "Già riallocato" : "Already reallocated"}</span>
                    <span className="tabular-nums">−{fmtEur(reallocated)}</span>
                  </div>
                )}
                {reallocated > 0 && (
                  <div className="flex justify-between border-t border-[rgb(var(--border))]/30 pt-0.5 mt-0.5">
                    <span className="font-semibold">{it ? "Libero" : "Available"}</span>
                    <span className={`tabular-nums font-semibold ${(closedPiggyEur - reallocated) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {fmtEur(closedPiggyEur - reallocated)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-ink-muted italic rounded-lg border border-[rgb(var(--border))]/30 px-3 py-2">
                {it
                  ? "Il saldo Piggy Bank del Sim Loop è visibile nel pannello Decision Lab (sezione Monitor). Il bilancio reallocato è registrato qui sotto."
                  : "Sim Loop Piggy Bank balance is visible in the Decision Lab panel (Monitor section). Reallocated amount is tracked below."}
                {reallocated > 0 && (
                  <span className="block mt-1 font-semibold text-ink">
                    {it ? "Già riallocato:" : "Already reallocated:"} {fmtEur(reallocated)}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* ── Section 3: cover excess (manual, requires confirmation) ── */}
          {hasExcess && !confirmOpen && (
            <div className="rounded-lg border border-red-300/60 dark:border-red-800/40 bg-red-50/40 dark:bg-red-950/10 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-red-600 dark:text-red-400 text-[11px] font-semibold">
                  ⚠ {it ? "Esubero:" : "Excess:"} {fmtEur(excess)}
                </span>
                <span className="text-[10px] text-ink-muted">
                  ({it ? "sopra budget" : "over budget"})
                </span>
              </div>
              <button
                type="button"
                className="w-full text-[11px] font-semibold px-3 py-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 border border-amber-400/50 text-amber-800 dark:text-amber-200 hover:bg-amber-200/60 transition"
                onClick={() => { setConfirmOpen(true); setCoverAmount(Math.ceil(excess)); }}
              >
                {it ? "Sana esubero con Piggy Bank…" : "Cover excess from Piggy Bank…"}
              </button>
            </div>
          )}

          {hasExcess && confirmOpen && (
            <div className="rounded-lg border border-amber-400/60 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-3 space-y-3">
              <p className="text-[11px] font-semibold text-ink">
                {it ? "Conferma riallocazione — azione manuale" : "Confirm reallocation — manual action"}
              </p>
              <p className="text-[10px] text-ink-muted">
                {it
                  ? `Stai aumentando il budget ${experimentLabel} per coprire l'esubero. Il P&L esistente non cambia. Questa azione verrà registrata nel log.`
                  : `You are increasing the ${experimentLabel} budget to cover the excess. Existing P&L is unchanged. This action will be logged.`}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-ink-muted shrink-0">
                  {it ? "Importo $" : "Amount $"}
                </label>
                <input
                  type="number"
                  className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px] tabular-nums"
                  value={coverAmount}
                  min={0.01}
                  step={1}
                  onChange={(e) => setCoverAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                />
                <span className="text-[10px] text-ink-muted shrink-0">
                  ({it ? "esubero:" : "excess:"} {fmtEur(excess)})
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 text-[11px] font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition"
                  onClick={handleConfirmCover}
                >
                  {it ? "Conferma riallocazione" : "Confirm reallocation"}
                </button>
                <button
                  type="button"
                  className="text-[11px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  onClick={() => setConfirmOpen(false)}
                >
                  {it ? "Annulla" : "Cancel"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer disclaimer */}
        <div className="px-4 py-2 border-t border-[rgb(var(--border))]/30 bg-slate-50/40 dark:bg-slate-900/20">
          <p className="text-[9px] text-ink-muted/60 italic">
            {it
              ? "Nessun automatismo — solo azioni confermate esplicitamente modificano il budget. I tre canali sono indipendenti, senza trasferimenti incrociati."
              : "No automatism — only explicitly confirmed actions modify the budget. The three channels are independent, no cross-transfers."}
          </p>
        </div>
      </div>
    </div>
  );
}
