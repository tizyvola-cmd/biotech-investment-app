/**
 * Mini SVG: slope segments scaled from measured pp/d (and pred5 % for contrarian).
 */

import type { ContrarianDivType } from "../sheet/contrarianLog";

const MAX_PP = 1.8;

function clampPp(v: number, max = MAX_PP): number {
  return Math.max(-max, Math.min(max, v));
}

/** Map pp/d → vertical delta in px (positive slope = line rises toward the right). */
function ppToDy(s: number | null | undefined, height: number, max = MAX_PP): number {
  if (s == null || !Number.isFinite(s)) return 0;
  const maxPx = height / 2 - 2;
  let dy = (clampPp(s, max) / max) * maxPx;
  if (Math.abs(s) > 0.06 && Math.abs(dy) < 1.25) {
    dy = Math.sign(s) * 1.25;
  }
  return dy;
}

/** Pred +5 (%) → approximate daily pp/d for comparable scaling on the mini chart. */
function pred5ToPpPerDay(pred5: number): number {
  return pred5 / 5;
}

function strokeForMag(mag: number): number {
  return 1.25 + Math.min(1.5, Math.abs(mag) / MAX_PP) * 1.25;
}

export function ContrarianMiniDiagram({
  slope5d,
  pred5,
  slope20d = null,
  divergenceType,
  title,
}: {
  slope5d: number;
  pred5: number;
  slope20d?: number | null;
  divergenceType: ContrarianDivType;
  title?: string;
}) {
  const W = 58;
  const H = 22;
  const cy = H / 2;
  const mid = W / 2;

  const s5 = Number.isFinite(slope5d) ? slope5d : 0;
  const p5 = Number.isFinite(pred5) ? pred5 : 0;
  const s5dy = ppToDy(s5, H);
  const s20dy = slope20d != null && Number.isFinite(slope20d) ? ppToDy(slope20d, H) : null;
  const predPp = pred5ToPpPerDay(p5);
  const predDy = ppToDy(predPp, H);

  const curveColor = s5 >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";
  const predColor = p5 >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";
  const curveW = strokeForMag(s5);
  const predW = strokeForMag(predPp);

  const opposite =
    (s5 > 0.04 && p5 < -0.04) ||
    (s5 < -0.04 && p5 > 0.04) ||
    divergenceType === "model_up" ||
    divergenceType === "model_down";

  return (
    <div className="shrink-0" title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" role="img">
        {title ? <title>{title}</title> : null}
        {s20dy != null ? (
          <line
            x1={2}
            y1={cy + s20dy}
            x2={mid}
            y2={cy}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={0.85}
          />
        ) : null}
        <line
          x1={s20dy != null ? mid : 4}
          y1={s20dy != null ? cy : cy + s5dy * 0.5}
          x2={W - 4}
          y2={cy - s5dy * (s20dy != null ? 1 : 0.5)}
          stroke={curveColor}
          strokeWidth={curveW}
          strokeLinecap="round"
        />
        <line
          x1={mid - 10}
          y1={cy + predDy * 0.55}
          x2={mid + 10}
          y2={cy - predDy * 0.55}
          stroke={predColor}
          strokeWidth={predW}
          strokeLinecap="round"
          strokeDasharray="2.5 1.5"
        />
        {opposite ? (
          <circle
            cx={mid}
            cy={cy}
            r={1.75}
            fill={curveColor}
            opacity={0.55}
          />
        ) : null}
        <text x={2} y={6} fontSize={4.5} fill={curveColor} fontWeight="700">
          c
        </text>
        <text x={W - 10} y={6} fontSize={4.5} fill={predColor} fontWeight="700">
          p
        </text>
      </svg>
    </div>
  );
}

export function SlopeTrendDiagram({
  slope5d,
  slope20d,
  variant = "default",
  title,
  errorKind,
}: {
  slope5d: number | null;
  slope20d: number | null;
  /** `mini` = solo grafico (banner compatto). */
  variant?: "default" | "mini";
  title?: string;
  /** Allinea colori mini-grafico al tipo errore (non solo segno slope5d). */
  errorKind?: "slope_rev" | "slope_dec" | "slope_acc" | "contrarian";
}) {
  const mini = variant === "mini";
  const W = mini ? 58 : 72;
  const H = mini ? 22 : 30;
  const cy = H / 2;

  const s5 = ppToDy(slope5d, H);
  const s20 = ppToDy(slope20d, H);
  const color5d = (() => {
    if (errorKind === "slope_rev") return "rgb(var(--signal-down))";
    if (errorKind === "slope_dec") return "rgb(var(--warn))";
    if (errorKind === "slope_acc") return "rgb(var(--signal-up))";
    return (slope5d ?? 0) >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";
  })();
  const fmtS = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  const sameSign =
    slope5d != null &&
    slope20d != null &&
    slope5d * slope20d > 0;
  const oppositeSign =
    slope5d != null &&
    slope20d != null &&
    slope5d * slope20d < 0;
  const decel =
    sameSign &&
    slope5d != null &&
    slope20d != null &&
    Math.abs(slope5d) < Math.abs(slope20d);

  const color20d = oppositeSign ? "rgb(var(--signal-down))" : "#94a3b8";
  const w5 = strokeForMag(slope5d ?? 0);
  const w20 = strokeForMag(slope20d ?? 0);

  return (
    <div
      className={`flex flex-col items-start ${mini ? "shrink-0" : "gap-0.5"}`}
      title={title}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="overflow-visible flex-shrink-0"
        role="img"
        aria-hidden={!title}
      >
        {title ? <title>{title}</title> : null}
        <line
          x1={2}
          y1={cy + s20}
          x2={W / 2}
          y2={cy}
          stroke={color20d}
          strokeWidth={mini ? Math.min(w20, 2) : w20}
          strokeLinecap="round"
          strokeDasharray={oppositeSign ? "2 1.5" : undefined}
          opacity={oppositeSign ? 0.85 : 1}
        />
        <line
          x1={W / 2}
          y1={cy}
          x2={W - 2}
          y2={cy - s5}
          stroke={
            oppositeSign || errorKind === "slope_rev"
              ? "rgb(var(--signal-down))"
              : color5d
          }
          strokeWidth={mini ? Math.min(w5, 2.5) : w5}
          strokeLinecap="round"
          strokeDasharray={decel ? "3 2" : undefined}
        />
        <circle
          cx={W / 2}
          cy={cy}
          r={mini ? 2 : 2.5}
          fill={oppositeSign ? "rgb(var(--signal-down))" : "#64748b"}
        />
        {mini ? (
          <>
            <text x={2} y={5} fontSize={5} fill="#94a3b8" fontWeight="600">
              20d
            </text>
            <text x={W - 14} y={5} fontSize={5} fill={color5d} fontWeight="600">
              5d
            </text>
          </>
        ) : null}
      </svg>
      {!mini ? (
        <p className="text-[9px] tabular-nums text-ink-muted leading-none">
          <span className="opacity-70">20d </span>
          <span>{fmtS(slope20d)}</span>
          <span className="mx-1 opacity-50">→</span>
          <span style={{ color: color5d }}>5d {fmtS(slope5d)}</span>
        </p>
      ) : null}
    </div>
  );
}
