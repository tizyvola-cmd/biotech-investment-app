import type { ExpectedMoveCalibration } from "../api/supernova";

/**
 * Expected Move (magnitude) calibration panel for the Model Calibration tab.
 *
 * Shows the calibrated magnitude buckets (Q1–Q5) derived from resolved
 * catalysts: median/mean realized |move|, probability of a >10pp move, and the
 * straddle-candidate flag. Direction-agnostic — it estimates the *size* of the
 * move, not its sign.
 */
export function ExpectedMoveSection({
  data,
  it,
}: {
  data?: ExpectedMoveCalibration;
  it: boolean;
}) {
  const title = it
    ? "Movimento atteso (segnale magnitudine)"
    : "Expected move (magnitude signal)";
  const note = it
    ? "Solo magnitudine: stima quanto si muove il titolo intorno al catalyst (sizing / straddle), NON la direzione."
    : "Magnitude only: estimates how much the stock moves around the catalyst (sizing / straddles), NOT direction.";

  const buckets = data?.buckets ?? [];
  const active = data?.status === "active" && buckets.length > 0;

  if (!active) {
    const msg =
      data?.status === "insufficient_data"
        ? it
          ? `Dati insufficienti per calibrare (n=${data?.n_samples ?? 0}).`
          : `Not enough data to calibrate (n=${data?.n_samples ?? 0}).`
        : it
          ? "Calibrazione assente. Esegui `python expected_move_calibrate.py --apply` e ricarica."
          : "Calibration missing. Run `python expected_move_calibrate.py --apply` and reload.";
    return (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-[11px] text-ink-muted leading-relaxed">{msg}</p>
        <p className="text-[10px] text-ink-muted/80 leading-snug">{note}</p>
      </div>
    );
  }

  const corr = data?.overall_corr;
  const lo = buckets[0]?.median_move_pp;
  const hi = buckets[buckets.length - 1]?.median_move_pp;
  const lift = lo != null && hi != null && lo > 0 ? hi / lo : null;
  const bigPp = data?.large_move_pp ?? 10;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? `Calibrato su n=${(data?.n_samples ?? 0).toLocaleString()} catalyst risolti · corr ${corr != null ? corr.toFixed(2) : "—"}${lift != null ? ` · lift Q1→Q5 ~${lift.toFixed(1)}×` : ""}`
            : `Calibrated on n=${(data?.n_samples ?? 0).toLocaleString()} resolved catalysts · corr ${corr != null ? corr.toFixed(2) : "—"}${lift != null ? ` · Q1→Q5 lift ~${lift.toFixed(1)}×` : ""}`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-ink-muted text-left">
              <th className="font-medium py-1 pr-2">{it ? "Bucket" : "Bucket"}</th>
              <th className="font-medium py-1 px-2 text-right">n</th>
              <th className="font-medium py-1 px-2 text-right">
                {it ? "Mov. mediano" : "Median move"}
              </th>
              <th className="font-medium py-1 px-2 text-right">
                {it ? "Mov. medio" : "Mean move"}
              </th>
              <th className="font-medium py-1 px-2 text-right">{`P(>${bigPp}pp)`}</th>
              <th className="font-medium py-1 pl-2 text-right">Straddle</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr
                key={b.bucket}
                className="border-t border-[rgb(var(--border))]/30"
              >
                <td className="py-1 pr-2 text-ink">
                  <span className="text-ink-muted">Q{b.bucket}</span> {b.label}
                </td>
                <td className="py-1 px-2 text-right text-ink-muted">
                  {b.n.toLocaleString()}
                </td>
                <td className="py-1 px-2 text-right text-ink">
                  {b.median_move_pp.toFixed(1)}pp
                </td>
                <td className="py-1 px-2 text-right text-ink-muted">
                  {b.mean_move_pp.toFixed(1)}pp
                </td>
                <td className="py-1 px-2 text-right text-ink-muted">
                  {(b.prob_gt_10pp * 100).toFixed(0)}%
                </td>
                <td className="py-1 pl-2 text-right">
                  {b.straddle_candidate ? (
                    <span className="rounded bg-[rgb(var(--accent))]/15 text-accent px-1.5 py-0.5 text-[10px] font-semibold">
                      ✓
                    </span>
                  ) : (
                    <span className="text-ink-muted/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink-muted/80 leading-snug">{note}</p>
    </div>
  );
}
