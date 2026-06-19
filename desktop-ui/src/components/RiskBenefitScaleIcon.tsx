/**
 * Risk & Benefit balance icon — a small scale with a skull on the left pan and
 * a heart on the right pan.
 *
 *  - Skull side ("loss"): the gray 💀 emoji is overlaid by a black-filled copy
 *    clipped from the bottom; the clip height grows with `riskScore` (0-100).
 *    Two white eye dots sit on top so the skull stays recognizable when full.
 *  - Heart side ("benefit"): the gray heart is overlaid by a red-filled copy
 *    clipped from the bottom; the clip height grows with `benefitFillPct`
 *    (0-100). Higher expected price growth per unit time ⇒ more red heart.
 *
 * Both halves use the same "fill the emoji from below" trick already used by
 * `LossRiskPoopCell`, so the visual metaphor stays consistent across the
 * Pick stocks table.
 *
 * The cell variant (`RiskBenefitScaleCell`) wraps the icon with the same
 * score chip / recommended-size caption / pattern label that the poop cell
 * shows, and opens the existing `LossRiskBreakdownModal` on click — so we
 * reuse the calibrated risk pipeline and only the visual representation
 * changes.
 */
import type { LossRiskEntry } from "./LossRiskPoopCell";
import { riskScoreTone } from "./LossRiskPoopCell";

/** Color band for the benefit (price growth per unit time) score.
 *  Mirrors `riskScoreTone` but in the rose family (heart-themed).
 */
export function benefitScoreTone(score: number): string {
  if (score >= 75) return "bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100";
  if (score >= 50) return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100";
  if (score >= 25) return "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-100";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200";
}

/**
 * Translate a forward-looking expected return rate into the 0-100 fill % used
 * by the heart side of the scale. The mapping is intentionally generous —
 * biotech catalysts can deliver multiple percent per day on average — so:
 *
 *   0.0 %/day  ⇒ 0   (heart empty, gray)
 *   1.5 %/day  ⇒ 100 (heart fully red)
 *
 * Negative or missing inputs ⇒ 0. The function is pure and exported for
 * tests and the cell's tooltip.
 */
export function deriveBenefitFillPct(args: {
  expectedReturnPct: number | null | undefined;
  daysToTarget: number | null | undefined;
  dailyChangePct: number | null | undefined;
}): number {
  const { expectedReturnPct, daysToTarget, dailyChangePct } = args;
  let perDayPct: number | null = null;
  if (
    expectedReturnPct != null &&
    Number.isFinite(expectedReturnPct) &&
    daysToTarget != null &&
    Number.isFinite(daysToTarget) &&
    daysToTarget > 0
  ) {
    perDayPct = expectedReturnPct / daysToTarget;
  } else if (dailyChangePct != null && Number.isFinite(dailyChangePct)) {
    // Fallback: recent realised 24h move — not the same semantics as a
    // forward-looking gain plan, but better than an empty heart on rows
    // where the gain plan is unavailable yet.
    perDayPct = dailyChangePct;
  }
  if (perDayPct == null || perDayPct <= 0) return 0;
  const scaled = (perDayPct / 1.5) * 100;
  return Math.max(0, Math.min(100, scaled));
}

/**
 * Pure visual: balance frame in SVG plus skull/heart emojis with vertical
 * clip-path fill. `riskScore` and `benefitFillPct` are both 0-100.
 *
 * Dimensions are tuned for a table cell — total footprint ~44×24 px so the
 * row height matches the previous poop cell.
 */
export function RiskBenefitScaleIcon({
  riskScore,
  benefitFillPct,
  size = 14,
}: {
  riskScore: number;
  benefitFillPct: number;
  size?: number;
}) {
  const r = Math.max(0, Math.min(100, riskScore));
  const b = Math.max(0, Math.min(100, benefitFillPct));
  const skullClip = `inset(${(100 - r).toFixed(1)}% 0 0 0)`;
  const heartClip = `inset(${(100 - b).toFixed(1)}% 0 0 0)`;
  // Tilt the beam slightly toward the heavier pan, like a real balance.
  // Range: -8° (skull heavier) to +8° (heart heavier).
  const tiltDeg = Math.max(-8, Math.min(8, (r - b) * 0.08));
  return (
    <span
      className="relative inline-block leading-none select-none"
      style={{ width: size * 3, height: size * 1.75 }}
      aria-hidden="true"
    >
      {/* Pivot + beam + pans, drawn as an SVG so the metaphor stays crisp at
          any size. Rotated around the central pivot to convey imbalance. */}
      <svg
        viewBox="0 0 30 14"
        width={size * 3}
        height={size * 1.4}
        className="absolute inset-x-0 top-0 text-ink-muted/75"
        preserveAspectRatio="none"
      >
        {/* Pivot triangle (top, fixed) */}
        <polygon points="15,0.5 12.5,3.5 17.5,3.5" fill="currentColor" />
        {/* Rotating beam group */}
        <g transform={`rotate(${tiltDeg.toFixed(2)} 15 3.5)`}>
          <line
            x1="3"
            y1="3.5"
            x2="27"
            y2="3.5"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
          {/* Pan strings */}
          <line x1="3" y1="3.5" x2="3" y2="7" stroke="currentColor" strokeWidth="0.6" />
          <line x1="27" y1="3.5" x2="27" y2="7" stroke="currentColor" strokeWidth="0.6" />
          {/* Pan cups */}
          <path
            d="M 0.5 7 Q 3 11 5.5 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
          <path
            d="M 24.5 7 Q 27 11 29.5 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        </g>
      </svg>

      {/* Skull on the left pan — 💀 at full emoji size (unchanged); white eyes on top */}
      <span
        className="absolute overflow-visible"
        style={{
          left: 0,
          top: size * 0.7,
          width: size,
          height: size,
        }}
      >
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size,
            opacity: 0.22,
            filter: "grayscale(1)",
            lineHeight: 1,
          }}
        >
          💀
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size,
            clipPath: skullClip,
            WebkitClipPath: skullClip,
            filter: "brightness(0) saturate(0)",
            lineHeight: 1,
          }}
        >
          💀
        </span>
        {/* White eye sockets — painted over the emoji, does not shrink it */}
        <span
          className="absolute inset-0 pointer-events-none z-[2]"
          aria-hidden="true"
        >
          <span
            className="absolute rounded-full bg-white"
            style={{
              width: size * 0.28,
              height: size * 0.32,
              left: size * 0.16,
              top: size * 0.22,
              boxShadow: "0 0 0 0.65px rgba(15,23,42,0.35)",
            }}
          />
          <span
            className="absolute rounded-full bg-white"
            style={{
              width: size * 0.28,
              height: size * 0.32,
              left: size * 0.52,
              top: size * 0.22,
              boxShadow: "0 0 0 0.65px rgba(15,23,42,0.35)",
            }}
          />
        </span>
      </span>

      {/* Heart on the right pan */}
      <span
        className="absolute"
        style={{
          right: 0,
          top: size * 0.7,
          width: size,
          height: size,
        }}
      >
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size,
            opacity: 0.22,
            filter: "grayscale(1)",
            lineHeight: 1,
          }}
        >
          ❤️
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size,
            clipPath: heartClip,
            WebkitClipPath: heartClip,
            // Native red, slightly punchier for visibility on dark themes.
            filter: "saturate(1.25)",
            lineHeight: 1,
          }}
        >
          ❤️
        </span>
      </span>
    </span>
  );
}

/**
 * Clickable cell — drop-in replacement for `LossRiskPoopCell` in the Pick
 * stocks (decisionLab) table. Reuses the same `LossRiskEntry` shape so the
 * underlying score, recommended size and approved-pattern bookkeeping are
 * shared with every other surface (Dashboard, Capital & Diversification).
 * Opens the existing `LossRiskBreakdownModal` on click via the parent's
 * `onClick` handler.
 */
export function RiskBenefitScaleCell({
  entry,
  benefitFillPct,
  perDayPct,
  onClick,
  it,
}: {
  entry: LossRiskEntry;
  /** 0-100. Use `deriveBenefitFillPct` to compute this from a gain plan. */
  benefitFillPct: number;
  /** Raw per-day expected % move — only used in the tooltip caption. */
  perDayPct: number | null;
  onClick: () => void;
  it: boolean;
}) {
  if (entry.riskScore == null && benefitFillPct <= 0) {
    return (
      <span
        className="text-[10px] text-ink-muted"
        title={
          it
            ? "Nessun segnale Phase A per questo deal — punteggio rischio/beneficio non disponibile."
            : "No Phase A signal for this deal — risk/benefit score not available."
        }
      >
        —
      </span>
    );
  }
  const riskUnknown = entry.riskScore == null;
  const r = Math.max(0, Math.min(100, entry.riskScore ?? 0));
  const b = Math.max(0, Math.min(100, benefitFillPct));
  // Slightly larger emojis for high risk / high benefit, same growth curve as
  // the poop cell so the column visually inherits its "the heavier, the
  // bigger" feel.
  const iconSize = 12 + (16 - 12) * (Math.max(r, b) / 100);
  const aria = it
    ? `Apri dettagli rischio & beneficio per ${entry.ticker} — rischio ${riskUnknown ? "n/d" : r.toFixed(0)} / 100, beneficio ${b.toFixed(0)} / 100`
    : `Open risk & benefit details for ${entry.ticker} — risk ${riskUnknown ? "n/a" : r.toFixed(0)} / 100, benefit ${b.toFixed(0)} / 100`;
  const iconTitle = it
    ? `Rischio ${riskUnknown ? "n/d" : `${r.toFixed(0)}/100`} · Beneficio ${b.toFixed(0)}/100${
        perDayPct != null && Number.isFinite(perDayPct)
          ? ` (~${perDayPct >= 0 ? "+" : ""}${perDayPct.toFixed(2)}%/giorno)`
          : ""
      }. Clicca per il dettaglio per-bucket.`
    : `Risk ${riskUnknown ? "n/a" : `${r.toFixed(0)}/100`} · Benefit ${b.toFixed(0)}/100${
        perDayPct != null && Number.isFinite(perDayPct)
          ? ` (~${perDayPct >= 0 ? "+" : ""}${perDayPct.toFixed(2)}%/day)`
          : ""
      }. Click for per-bucket details.`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex flex-col items-center gap-0.5 cursor-pointer rounded px-1 py-0.5 hover:bg-[rgb(var(--surface-3))]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 transition-colors"
      title={iconTitle}
      aria-label={aria}
    >
      <RiskBenefitScaleIcon riskScore={r} benefitFillPct={b} size={iconSize} />
      <span className="flex items-center gap-0.5 leading-none">
        <span
          className={`text-[9px] font-semibold px-1 rounded tabular-nums ${
            riskUnknown
              ? "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"
              : riskScoreTone(r)
          }`}
          title={
            riskUnknown
              ? it
                ? "Rischio non calibrato (Phase A) — solo beneficio atteso disponibile"
                : "Risk not calibrated (Phase A) — only expected benefit available"
              : it
                ? "Rischio (0=safe, 100=critico)"
                : "Risk (0=safe, 100=critical)"
          }
        >
          {riskUnknown ? "—" : r.toFixed(0)}
        </span>
        <span className="text-[8px] text-ink-muted/70">/</span>
        <span
          className={`text-[9px] font-semibold px-1 rounded ${benefitScoreTone(b)} tabular-nums`}
          title={
            it
              ? "Beneficio: tasso di crescita % per giorno verso il target"
              : "Benefit: expected % growth per day toward target"
          }
        >
          {b.toFixed(0)}
        </span>
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
      {entry.lossRisk?.matchedApprovedPattern ? (
        <span className="text-[7px] uppercase font-semibold text-rose-700 dark:text-rose-300 tracking-wider">
          pattern
        </span>
      ) : null}
    </button>
  );
}
