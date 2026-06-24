import type { ExpectedMoveBucket, ExpectedMoveCalibration } from "../api/supernova";

/** Calm → volatile colour ramp for the expected-move buckets (Q1 … Q5). */
const BUCKET_COLORS = ["#34d399", "#a3e635", "#fbbf24", "#fb923c", "#ef4444"];

function piePolar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function pieArcPath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
): string {
  const [sx, sy] = piePolar(cx, cy, r, start);
  const [ex, ey] = piePolar(cx, cy, r, end);
  const large = end - start <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`;
}

/** Pie sized by the big-move probability P(>bigPp) of each expected-move class:
 *  bigger slice = higher probability the stock makes a large move. */
function ExpectedMovePie({
  buckets,
  it,
  bigPp,
}: {
  buckets: ExpectedMoveBucket[];
  it: boolean;
  bigPp: number;
}) {
  // Slice weight = probability of a big move; fall back to count if the
  // calibration carries no usable probabilities (keeps the pie non-empty).
  const probTotal = buckets.reduce((s, b) => s + (b.prob_gt_10pp || 0), 0);
  const useProb = probTotal > 0;
  const total = useProb
    ? probTotal
    : buckets.reduce((s, b) => s + (b.n || 0), 0);
  if (total <= 0) return null;
  const size = 132;
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  let angle = 0;
  const slices = buckets.map((b, i) => {
    const weight = useProb ? b.prob_gt_10pp || 0 : b.n || 0;
    const frac = weight / total;
    const start = angle;
    const end = buckets.length === 1 ? 359.999 : angle + frac * 360;
    angle = end;
    return { b, start, end, frac, color: BUCKET_COLORS[i % BUCKET_COLORS.length] };
  });
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        role="img"
        aria-label={it ? "Probabilità di movimento ampio per classe" : "Big-move probability by class"}
      >
        {slices.map((s) => (
          <path
            key={s.b.bucket}
            d={pieArcPath(cx, cy, r, s.start, s.end)}
            fill={s.color}
            stroke="rgb(var(--surface))"
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <ul className="text-[11px] space-y-1 min-w-0">
        {slices.map((s) => (
          <li key={s.b.bucket} className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-ink">
              <span className="text-ink-muted">Q{s.b.bucket}</span> {s.b.label}
            </span>
            <span className="text-ink-muted tabular-nums">
              {`P(>${bigPp}pp) ${(s.b.prob_gt_10pp * 100).toFixed(0)}%`} · ~
              {s.b.median_move_pp.toFixed(1)}pp
            </span>
            {s.b.straddle_candidate ? (
              <span className="text-accent font-semibold">✓</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
        <p className="text-[10px] text-ink-muted/90 leading-snug mt-0.5">
          {it
            ? "Q1–Q5 = quintili del movimento atteso: i catalyst storici ordinati per ampiezza prevista e divisi in 5 gruppi da ~20%. Q1 = movimento più piccolo, Q5 = più grande (candidato straddle)."
            : "Q1–Q5 = expected-move quintiles: resolved catalysts ranked by predicted size and split into 5 groups of ~20%. Q1 = smallest move, Q5 = largest (straddle candidate)."}
        </p>
      </div>
      <ExpectedMovePie buckets={buckets} it={it} bigPp={bigPp} />
      <p className="text-[10px] text-ink-muted/80 leading-snug">
        {it
          ? `Ogni fetta è proporzionale alla probabilità di un movimento ampio (>${bigPp}pp) di quella classe: fetta più grande = probabilità più alta. Le classi (Q1–Q5) restano ~20% dei titoli ciascuna; ciò che cambia è quanto è probabile il movimento grande (da ${((buckets[0]?.prob_gt_10pp ?? 0) * 100).toFixed(0)}% in Q1 a ${((buckets[buckets.length - 1]?.prob_gt_10pp ?? 0) * 100).toFixed(0)}% in Q5).`
          : `Each slice is proportional to that class's probability of a big move (>${bigPp}pp): larger slice = higher probability. The classes (Q1–Q5) each still hold ~20% of stocks; what differs is how likely the big move is (from ${((buckets[0]?.prob_gt_10pp ?? 0) * 100).toFixed(0)}% in Q1 to ${((buckets[buckets.length - 1]?.prob_gt_10pp ?? 0) * 100).toFixed(0)}% in Q5).`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-ink-muted text-left">
              <th className="font-medium py-1 pr-2">
                {it ? "Gruppo (Q1→Q5)" : "Group (Q1→Q5)"}
              </th>
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
