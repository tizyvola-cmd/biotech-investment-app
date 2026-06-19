/**
 * Shared "Risk" cell — clickable poop emoji that fills up with the deal's
 * investment-risk score (0 safe → 100 critical) and opens a modal with the
 * Phase A + Phase B loss-risk breakdown.
 *
 * Extracted from `ThreePortfolioCompareView` so the same cell can be reused
 * in the Dashboard recommendations table and the 24h Assessment view
 * without duplicating logic.
 *
 * The cell renders from a generic `LossRiskEntry` so the consumer does not
 * have to pass a full `ComparisonDeal`. Build entries via the companion
 * `useLossRiskCatalog` hook (which reuses `buildThreePortfolioComparison`
 * under the hood, so risk scores stay numerically identical across every
 * surface that shows them).
 */
import type { DealLossRisk } from "../sheet/portfolioSizingWidget";
import type { CalibrationDimension } from "../calibration/calibrationTypes";
import { AppModal, AppModalCloseButton } from "./AppModal";

export type LossRiskEntry = {
  ticker: string;
  /** Display label shown next to the ticker in the modal header. */
  phaseLabel: string;
  /** 0-100, combined investment-risk score. `null` ⇒ render dash placeholder. */
  riskScore: number | null;
  /** Full Phase A + Phase B breakdown — drives the modal contents. */
  lossRisk: DealLossRisk | null;
  /** Cell buckets used to derive the lossRisk — surfaced in the modal header. */
  cells?: Partial<Record<CalibrationDimension, string>>;
  /** Recommended capital to allocate to this deal given the portfolio budget
   *  used by `useLossRiskCatalog`. Computed via the same weighted-sizing
   *  module that powers the Step 3 "Risk-weighted portfolio sizing" chart, so
   *  every surface shows the same number. `null` when the deal has no usable
   *  signal (e.g. all-negative EV or missing payoff data). */
  recommendedSizeEur?: number | null;
  /** Recommended capital expressed as % of the portfolio budget. Same source
   *  as `recommendedSizeEur`. `null` when sizing is not available. */
  recommendedSizePct?: number | null;
  /** Portfolio budget used to compute the recommendation (in €). Exposed so
   *  the cell tooltip can cite the exact pot the percentage refers to. */
  recommendedSizeBudgetEur?: number | null;
};

/**
 * Color band for the combined investment-risk score.
 *   0-29  → green (safer than baseline; lift < ~0.5)
 *   30-49 → emerald-ish (mildly safe)
 *   50-65 → amber (neutral / mildly risky)
 *   66-84 → orange (clearly risky; lift > 1.5 or pattern proximity)
 *   85-100 → rose (pattern match or extreme lift)
 */
export function riskScoreTone(score: number): string {
  if (score >= 85) return "bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100";
  if (score >= 66) return "bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100";
  if (score >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100";
  if (score >= 30) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100";
  return "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100";
}

function confTone(c: "low" | "medium" | "high"): string {
  if (c === "high") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (c === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
}

function dimensionShort(d: CalibrationDimension): string {
  switch (d) {
    case "clinicalPhase":
      return "phase";
    case "clinicalIndication":
      return "ind";
    case "sdsBucket":
      return "sds";
    case "pplanBucket":
      return "P(plan)";
  }
}

/**
 * Clickable poop icon that "fills up" with the investment-risk score.
 * Two stacked emojis: faint grey background + colored foreground whose
 * vertical fill grows with the score via `clip-path`.
 */
export function LossRiskPoopCell({
  entry,
  onClick,
  it,
}: {
  entry: LossRiskEntry;
  onClick: () => void;
  it: boolean;
}) {
  if (entry.riskScore == null) {
    return (
      <span
        className="text-[10px] text-ink-muted"
        title={
          it
            ? "Nessun segnale Phase A per questo deal — punteggio di rischio non disponibile."
            : "No Phase A signal for this deal — risk score not available."
        }
      >
        —
      </span>
    );
  }
  const score = Math.max(0, Math.min(100, entry.riskScore));
  const fillPct = score;
  const size = 18 + (28 - 18) * (score / 100);
  const fgFilter = `saturate(${(0.6 + 0.9 * (score / 100)).toFixed(2)}) brightness(${(1.05 - 0.25 * (score / 100)).toFixed(2)})`;
  const lr = entry.lossRisk;
  const aria = it
    ? `Apri dettagli loss-risk per ${entry.ticker} — punteggio ${score.toFixed(0)} su 100`
    : `Open loss-risk details for ${entry.ticker} — score ${score.toFixed(0)} of 100`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex flex-col items-center gap-0.5 cursor-pointer rounded px-1 py-0.5 hover:bg-[rgb(var(--surface-3))]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 transition-colors"
      title={
        it
          ? "Clicca per vedere tutti gli indicatori che compongono il loss-risk"
          : "Click to see all indicators composing the loss-risk score"
      }
      aria-label={aria}
    >
      <span
        className="relative inline-block leading-none select-none"
        style={{ width: size, height: size, fontSize: size }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size,
            opacity: 0.18,
            filter: "grayscale(1)",
            lineHeight: 1,
          }}
        >
          💩
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center transition-all duration-200 group-hover:scale-110"
          style={{
            fontSize: size,
            clipPath: `inset(${(100 - fillPct).toFixed(1)}% 0 0 0)`,
            WebkitClipPath: `inset(${(100 - fillPct).toFixed(1)}% 0 0 0)`,
            filter: fgFilter,
            lineHeight: 1,
          }}
        >
          💩
        </span>
      </span>
      <span className={`text-[9px] font-semibold px-1 rounded ${riskScoreTone(score)} tabular-nums`}>
        {score.toFixed(0)}
      </span>
      {entry.recommendedSizeEur != null &&
      Number.isFinite(entry.recommendedSizeEur) &&
      entry.recommendedSizePct != null &&
      Number.isFinite(entry.recommendedSizePct) ? (
        <span
          className="text-[9px] tabular-nums leading-tight text-ink-muted font-semibold"
          title={
            it
              ? `Quota suggerita su un budget di ${Math.round(entry.recommendedSizeBudgetEur ?? 0).toLocaleString("it-IT")} € — pesata per EV, confidence e pattern di Step 2 (stessa logica del grafico Step 3).`
              : `Suggested allocation on a budget of €${Math.round(entry.recommendedSizeBudgetEur ?? 0).toLocaleString("it-IT")} — weighted by EV, confidence and Step 2 pattern (same logic as the Step 3 chart).`
          }
        >
          €{Math.round(entry.recommendedSizeEur).toLocaleString("it-IT")}{" "}
          <span className="text-ink-muted/80 font-normal">
            ({entry.recommendedSizePct.toFixed(1)}%)
          </span>
        </span>
      ) : null}
      {lr?.matchedApprovedPattern ? (
        <span className="text-[7px] uppercase font-semibold text-rose-700 dark:text-rose-300 tracking-wider">
          pattern
        </span>
      ) : null}
    </button>
  );
}

/**
 * Modal showing the full Phase A + Phase B loss-risk breakdown for a single
 * deal. Lists every contributing bucket (dimension · bucket · lift · loss
 * rate · n · confidence) sorted by absolute lift impact, plus the approved-
 * pattern match flag when applicable.
 */
export function LossRiskBreakdownModal({
  entry,
  onClose,
  it,
}: {
  entry: LossRiskEntry | null;
  onClose: () => void;
  it: boolean;
}) {
  if (!entry) return null;
  const score = entry.riskScore ?? null;
  const lr = entry.lossRisk;
  const contributions = lr
    ? [...lr.contributions].sort(
        (a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1),
      )
    : [];
  return (
    <AppModal
      open={!!entry}
      onClose={onClose}
      aria-label={it ? "Dettaglio loss-risk" : "Loss-risk breakdown"}
      panelClassName="w-[min(94vw,640px)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col"
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/60">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl leading-none select-none" aria-hidden="true">
            💩
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              {it ? "Dettaglio loss-risk" : "Loss-risk breakdown"}
            </p>
            <h3 className="text-sm font-semibold text-ink truncate">
              {entry.ticker}
              <span className="text-ink-muted font-normal text-[12px] ml-2">
                · {entry.phaseLabel || "—"}
              </span>
            </h3>
          </div>
          {score != null ? (
            <span
              className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded ${riskScoreTone(score)} tabular-nums`}
              title={it ? "Punteggio rischio investimento (0=safe, 100=critical)" : "Investment-risk score (0=safe, 100=critical)"}
            >
              {score.toFixed(0)} / 100
            </span>
          ) : null}
        </div>
        <AppModalCloseButton onClose={onClose} />
      </header>

      <div className="px-4 py-3 space-y-3 overflow-y-auto">
        <div className="text-[11px] text-ink-muted leading-relaxed">
          {it ? (
            <>
              Lift aggregato Phase A:{" "}
              <span className="font-semibold text-ink tabular-nums">
                ×{(lr?.aggregateLift ?? 1).toFixed(2)}
              </span>
              {lr ? (
                <>
                  {" "}
                  ({lr.hasSignal ? "segnale presente" : "nessun segnale"})
                </>
              ) : null}
              . Il punteggio è la media geometrica dei lift dei bucket eligible, pesata per
              confidence (HIGH=1, MED=0.5, LOW=0.25), normalizzata 0-100.
            </>
          ) : (
            <>
              Phase A aggregate lift:{" "}
              <span className="font-semibold text-ink tabular-nums">
                ×{(lr?.aggregateLift ?? 1).toFixed(2)}
              </span>
              {lr ? <> ({lr.hasSignal ? "signal present" : "no signal"})</> : null}
              . The score is the confidence-weighted geometric mean of eligible bucket
              lifts (HIGH=1, MED=0.5, LOW=0.25), normalized to 0-100.
            </>
          )}
        </div>

        {contributions.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
              {it ? "Indicatori che compongono il loss-rate" : "Indicators composing the loss-rate"}
            </p>
            <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
              <table className="w-full text-[11px] tabular-nums bg-white dark:bg-slate-900">
                <thead className="bg-slate-100 dark:bg-slate-800 text-ink-muted">
                  <tr>
                    <th className="text-left font-semibold px-2 py-1">
                      {it ? "Dimensione" : "Dimension"}
                    </th>
                    <th className="text-left font-semibold px-2 py-1">
                      {it ? "Bucket" : "Bucket"}
                    </th>
                    <th
                      className="text-right font-semibold px-2 py-1"
                      title={it ? "Lift: 1.0=neutro, >1=peggio del baseline" : "Lift: 1.0=neutral, >1=worse than baseline"}
                    >
                      Lift
                    </th>
                    <th
                      className="text-right font-semibold px-2 py-1"
                      title={it ? "Loss rate shrunk del bucket" : "Bucket's shrunk loss rate"}
                    >
                      {it ? "Loss%" : "Loss%"}
                    </th>
                    <th className="text-right font-semibold px-2 py-1">n</th>
                    <th className="text-center font-semibold px-2 py-1">{it ? "Conf" : "Conf"}</th>
                  </tr>
                </thead>
                <tbody>
                  {contributions.map((c, i) => {
                    const liftCls =
                      c.lift > 1.25
                        ? "text-rose-700 dark:text-rose-300 font-semibold"
                        : c.lift < 0.8
                          ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                          : "text-ink";
                    return (
                      <tr
                        key={`${c.dimension}-${c.bucket}-${i}`}
                        className="border-t border-[rgb(var(--border))]/40"
                      >
                        <td className="px-2 py-1 text-ink-muted">
                          {dimensionShort(c.dimension as CalibrationDimension)}
                        </td>
                        <td className="px-2 py-1 text-ink">{c.bucket}</td>
                        <td className={`px-2 py-1 text-right ${liftCls}`}>
                          ×{c.lift.toFixed(2)}
                        </td>
                        <td className="px-2 py-1 text-right text-ink">
                          {(c.shrunkLossRate * 100).toFixed(1)}%
                        </td>
                        <td className="px-2 py-1 text-right text-ink-muted">{c.n}</td>
                        <td className="px-2 py-1 text-center">
                          <span className={`text-[9px] px-1 rounded ${confTone(c.confidence)}`}>
                            {c.confidence.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-ink-muted italic">
            {it
              ? "Nessun bucket eligible: lo storico per le caratteristiche di questo deal è troppo scarso o assente."
              : "No eligible buckets: history for this deal's features is too sparse or absent."}
          </p>
        )}

        {lr?.matchedApprovedPattern ? (
          <div className="rounded border border-rose-300/60 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-[11px] text-rose-900 dark:text-rose-100">
            <p className="font-semibold">
              {it ? "⚠ Match pattern Phase B approvato (+20)" : "⚠ Approved Phase B pattern match (+20)"}
            </p>
            <p className="opacity-80 mt-0.5">
              {it
                ? "Questo deal soddisfa le condizioni del pattern di rischio approvato — bonus +20 punti al rischio."
                : "This deal meets the approved risk-pattern conditions — adds +20 points to the risk score."}
            </p>
          </div>
        ) : null}

        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
            {it ? "Legenda punteggio" : "Score legend"}
          </p>
          <div className="flex flex-wrap gap-1">
            {[
              { range: "0–29", label: it ? "molto safe" : "very safe", score: 15 },
              { range: "30–49", label: it ? "safe" : "safe", score: 40 },
              { range: "50–65", label: it ? "neutro" : "neutral", score: 58 },
              { range: "66–84", label: it ? "rischioso" : "risky", score: 75 },
              { range: "85–100", label: it ? "critico" : "critical", score: 92 },
            ].map((band) => (
              <span
                key={band.range}
                className={`text-[10px] px-1.5 py-0.5 rounded ${riskScoreTone(band.score)} tabular-nums`}
              >
                {band.range} · {band.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </AppModal>
  );
}
