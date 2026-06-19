import { useId } from "react";
import type { MIGModelCalibration, ModelSlopeCalibrationTier } from "../sheet/marketInterestGate";

export const PRE_COLOR = "#7c3aed";
export const PRE_COLOR_SOFT = "#a78bfa";
export const POST_COLOR = "#2563eb";
export const POST_COLOR_SOFT = "#60a5fa";
export const GAP_ARC_COLOR = "#d97706";

export function miiColors(angleDeg: number) {
  const up = angleDeg >= 0;
  return {
    stroke: up ? "#059669" : "#dc2626",
    soft: up ? "#10b981" : "#ef4444",
    fill: up ? "#047857" : "#b91c1c",
  };
}

function tierPieColor(tier: ModelSlopeCalibrationTier, score: number | null): string {
  if (score == null || tier === "unknown") return "#94a3b8";
  if (tier === "contrarian" || score < 40) return "#dc2626";
  if (tier === "diverge" || score < 55) return "#d97706";
  if (tier === "drift" || score < 72) return "#ca8a04";
  return "#059669";
}

export function armEnd(cx: number, cy: number, arm: number, angleDeg: number): { x: number; y: number } {
  const clamped = Math.max(-42, Math.min(42, angleDeg));
  const rad = (clamped * Math.PI) / 180;
  return { x: cx + arm * Math.cos(-rad), y: cy + arm * Math.sin(-rad) };
}

export function fmtDeg(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}°`;
}

/** Pre/post model arms collapse when daily open recalib did not move the slope. */
export function migPrePostSlopesSame(
  preAngleDeg: number | null | undefined,
  postAngleDeg: number | null | undefined,
  toleranceDeg = 0.6,
): boolean {
  if (preAngleDeg == null || postAngleDeg == null) return preAngleDeg === postAngleDeg;
  return Math.abs(preAngleDeg - postAngleDeg) < toleranceDeg;
}

type TripleLayout = {
  vbW: number;
  vbH: number;
  cx: number;
  cy: number;
  arm: number;
  legendX: number;
  legendY: number;
  fontLabel: number;
  fontLegend: number;
  legendLineLen: number;
  legendTextX: number;
  legendRowStep: number;
  preArmScale: number;
  postArmScale: number;
  miiArmScale: number;
};

function layoutForVariant(variant: "compact" | "large" | "tile"): TripleLayout {
  if (variant === "large") {
    return {
      vbW: 420,
      vbH: 268,
      cx: 72,
      cy: 134,
      arm: 248,
      legendX: 0,
      legendY: 0,
      fontLabel: 14,
      fontLegend: 11,
      legendLineLen: 14,
      legendTextX: 18,
      legendRowStep: 22,
      preArmScale: 0.98,
      postArmScale: 0.88,
      miiArmScale: 1,
    };
  }
  if (variant === "tile") {
    return {
      vbW: 400,
      vbH: 256,
      cx: 56,
      cy: 132,
      arm: 248,
      legendX: 0,
      legendY: 0,
      fontLabel: 10,
      fontLegend: 7,
      legendLineLen: 6,
      legendTextX: 8,
      legendRowStep: 11,
      preArmScale: 0.98,
      postArmScale: 0.88,
      miiArmScale: 1,
    };
  }
  return {
    vbW: 132,
    vbH: 78,
    cx: 22,
    cy: 41,
    arm: 82,
    legendX: 94,
    legendY: 8,
    fontLabel: 7,
    fontLegend: 7,
    legendLineLen: 6,
    legendTextX: 8,
    legendRowStep: 11,
    preArmScale: 1,
    postArmScale: 0.92,
    miiArmScale: 0.98,
  };
}

function gapArcPath(
  cx: number,
  cy: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
): string {
  const a = armEnd(cx, cy, radius, fromDeg);
  const b = armEnd(cx, cy, radius, toDeg);
  const sweep = toDeg >= fromDeg ? 1 : 0;
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} ${sweep} ${b.x} ${b.y}`;
}

function labelOffset(
  angleDeg: number,
  variant: "compact" | "large" | "tile" = "compact",
): { dx: number; dy: number } {
  const tile = variant === "tile";
  if (angleDeg >= 15) return { dx: tile ? 8 : 10, dy: tile ? -8 : -10 };
  if (angleDeg <= -15) return { dx: tile ? 8 : 10, dy: tile ? 8 : 16 };
  if (angleDeg >= 0) return { dx: tile ? 8 : 10, dy: tile ? -5 : -6 };
  return { dx: tile ? 8 : 10, dy: tile ? 2 : 12 };
}

function clampLabelPos(
  x: number,
  y: number,
  vbW: number,
  vbH: number,
  fontSize: number,
): { x: number; y: number } {
  const padX = 6;
  const padTop = fontSize + 2;
  const padBottom = 5;
  return {
    x: Math.min(Math.max(x, padX), vbW - padX - 64),
    y: Math.min(Math.max(y, padTop), vbH - padBottom),
  };
}

/** Shorten tile arms so endpoints + labels stay inside the SVG viewBox (±42° MII). */
function fittedTileArm(
  L: TripleLayout,
  miiAngleDeg: number,
  preAngleDeg: number | null,
  postAngleDeg: number | null,
  samePrePost: boolean,
  showAngleLabels: boolean,
): number {
  const { cx, cy, vbW, vbH, arm } = L;
  const padTop = showAngleLabels ? 16 : 10;
  const padBottom = 14;
  const padRight = showAngleLabels ? 88 : 24;
  const padLeft = 10;

  const segments: { deg: number; scale: number }[] = [{ deg: miiAngleDeg, scale: L.miiArmScale }];
  if (preAngleDeg != null) segments.push({ deg: preAngleDeg, scale: L.preArmScale });
  if (!samePrePost && postAngleDeg != null) segments.push({ deg: postAngleDeg, scale: L.postArmScale });

  let fitted = arm;
  for (const { deg, scale } of segments) {
    const clamped = Math.max(-42, Math.min(42, deg));
    const rad = (clamped * Math.PI) / 180;
    const cosA = Math.cos(-rad);
    const sinA = Math.sin(-rad);

    if (cosA > 0.05) {
      fitted = Math.min(fitted, (vbW - padRight - cx) / (scale * cosA));
    }
    if (sinA < -0.05) {
      fitted = Math.min(fitted, (cy - padTop) / (scale * -sinA));
    }
    if (sinA > 0.05) {
      fitted = Math.min(fitted, (vbH - padBottom - cy) / (scale * sinA));
    }
    if (cosA < -0.05) {
      fitted = Math.min(fitted, (cx - padLeft) / (scale * -cosA));
    }
  }
  return Math.max(72, Math.min(arm, fitted));
}

/** Tre pendenze: pre (viola), post (blu), MII (verde/rosso). */
export function MigTripleSlopeGlyph({
  miiAngleDeg,
  preAngleDeg,
  postAngleDeg,
  size = 108,
  variant = "compact",
  showAngleLabels = false,
  showInlineLegend = true,
  showGapArc = false,
  gapPctPre = null,
  fitContainer = false,
}: {
  miiAngleDeg: number;
  preAngleDeg: number | null;
  postAngleDeg: number | null;
  size?: number;
  variant?: "compact" | "large" | "tile";
  showAngleLabels?: boolean;
  showInlineLegend?: boolean;
  showGapArc?: boolean;
  gapPctPre?: number | null;
  /** Riempie il contenitore padre (tile 200px assessment). */
  fitContainer?: boolean;
}) {
  const L = layoutForVariant(variant);
  const { vbW, vbH, cx, cy } = L;
  const samePrePost = migPrePostSlopesSame(preAngleDeg, postAngleDeg);
  const arm =
    variant === "tile"
      ? fittedTileArm(L, miiAngleDeg, preAngleDeg, postAngleDeg, samePrePost, showAngleLabels)
      : L.arm;
  const mii = miiColors(miiAngleDeg);
  const preArm = arm * L.preArmScale;
  const postArm = arm * L.postArmScale;
  const miiArm = arm * L.miiArmScale;
  const preEnd = preAngleDeg != null ? armEnd(cx, cy, preArm, preAngleDeg) : null;
  const postEnd = postAngleDeg != null ? armEnd(cx, cy, postArm, postAngleDeg) : null;
  const miiEnd = armEnd(cx, cy, miiArm, miiAngleDeg);
  const uid = useId().replace(/:/g, "");
  const displayH = Math.round(size * (vbH / vbW));
  const isWide = variant === "large" || variant === "tile";
  const swMii = isWide ? 2.75 : 2;
  const swModel = isWide ? 2 : 1.45;
  const swGlow = isWide ? 4 : 2.75;
  const dotR = isWide ? 4.5 : 2.75;
  const pad = isWide ? 16 : 8;
  const showInnerBg = variant !== "tile";
  const bgX = isWide ? 10 : 2;
  const bgY = isWide ? 8 : 3;
  const bgW = vbW - (isWide ? 20 : 4);
  const bgH = vbH - (isWide ? 16 : 6);
  const bgRx = isWide ? 12 : 6;
  const samePrePostLabelDy =
    samePrePost && showAngleLabels ? (variant === "tile" ? 4 : variant === "large" ? 12 : 0) : 0;

  const gapArc =
    showGapArc && preAngleDeg != null
      ? gapArcPath(cx, cy, arm * 0.38, preAngleDeg, miiAngleDeg)
      : null;
  const gapMid =
    preAngleDeg != null
      ? armEnd(cx, cy, arm * 0.38, (preAngleDeg + miiAngleDeg) / 2)
      : null;

  return (
    <svg
      width={fitContainer ? "100%" : size}
      height={fitContainer ? "100%" : displayH}
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio={fitContainer ? "xMidYMid meet" : undefined}
      className={fitContainer ? "block w-full h-full" : "shrink-0 block mx-auto w-full max-w-full"}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <defs>
        <linearGradient id={`mig-slope-bg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="42%" stopColor="#ffffff" />
          <stop offset="58%" stopColor="#f8fafc" />
          <stop offset="78%" stopColor="#eff6ff" />
          <stop offset="92%" stopColor="#fefce8" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
      </defs>
      {showInnerBg ? (
        <rect
          x={bgX}
          y={bgY}
          width={bgW}
          height={bgH}
          rx={bgRx}
          fill={`url(#mig-slope-bg-${uid})`}
          stroke="rgba(147, 197, 253, 0.42)"
          strokeWidth={isWide ? 1 : 0.65}
        />
      ) : null}
      <line
        x1={pad}
        y1={cy}
        x2={vbW - pad}
        y2={cy}
        stroke="#94a3b8"
        strokeWidth={isWide ? 0.9 : 0.65}
        strokeDasharray="5 4"
        opacity={0.45}
      />
      {isWide ? (
        <text
          x={pad + 2}
          y={cy - (variant === "tile" ? 6 : 8)}
          fontSize={variant === "tile" ? 9 : 11}
          fill="#94a3b8"
          fontFamily="ui-monospace, monospace"
        >
          0°
        </text>
      ) : null}
      {gapArc ? (
        <path
          d={gapArc}
          fill="none"
          stroke={GAP_ARC_COLOR}
          strokeWidth={1.65}
          strokeDasharray="5 3.5"
          strokeLinecap="round"
          opacity={0.8}
        />
      ) : null}
      {preEnd ? (
        <>
          <line x1={cx} y1={cy} x2={preEnd.x} y2={preEnd.y} stroke={PRE_COLOR_SOFT} strokeWidth={swGlow} strokeLinecap="round" opacity={0.16} />
          <line x1={cx} y1={cy} x2={preEnd.x} y2={preEnd.y} stroke={PRE_COLOR} strokeWidth={swModel} strokeLinecap="round" strokeDasharray={isWide ? "8 5" : "4 2.5"} />
          <circle cx={preEnd.x} cy={preEnd.y} r={dotR - 0.75} fill={PRE_COLOR} />
          {showAngleLabels && preAngleDeg != null
            ? (() => {
                const pos = clampLabelPos(
                  preEnd.x + labelOffset(preAngleDeg, variant).dx,
                  preEnd.y + labelOffset(preAngleDeg, variant).dy,
                  vbW,
                  vbH,
                  L.fontLabel,
                );
                return (
                  <text
                    x={pos.x}
                    y={pos.y}
                    fontSize={L.fontLabel}
                    fill={PRE_COLOR}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {samePrePost ? `pre/post ${fmtDeg(preAngleDeg)}` : `pre ${fmtDeg(preAngleDeg)}`}
                  </text>
                );
              })()
            : null}
        </>
      ) : null}
      {postEnd && !samePrePost ? (
        <>
          <line x1={cx} y1={cy} x2={postEnd.x} y2={postEnd.y} stroke={POST_COLOR_SOFT} strokeWidth={swGlow} strokeLinecap="round" opacity={0.14} />
          <line x1={cx} y1={cy} x2={postEnd.x} y2={postEnd.y} stroke={POST_COLOR} strokeWidth={swModel} strokeLinecap="round" />
          <circle cx={postEnd.x} cy={postEnd.y} r={dotR - 0.75} fill={POST_COLOR} />
          {showAngleLabels && postAngleDeg != null
            ? (() => {
                const pos = clampLabelPos(
                  postEnd.x + labelOffset(postAngleDeg, variant).dx,
                  postEnd.y + labelOffset(postAngleDeg, variant).dy,
                  vbW,
                  vbH,
                  L.fontLabel,
                );
                return (
                  <text
                    x={pos.x}
                    y={pos.y}
                    fontSize={L.fontLabel}
                    fill={POST_COLOR}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    post {fmtDeg(postAngleDeg)}
                  </text>
                );
              })()
            : null}
        </>
      ) : null}
      <line x1={cx} y1={cy} x2={miiEnd.x} y2={miiEnd.y} stroke={mii.soft} strokeWidth={swGlow} strokeLinecap="round" opacity={0.14} />
      <line x1={cx} y1={cy} x2={miiEnd.x} y2={miiEnd.y} stroke={mii.stroke} strokeWidth={swMii} strokeLinecap="round" />
      <circle cx={miiEnd.x} cy={miiEnd.y} r={dotR} fill={mii.fill} stroke={mii.soft} strokeWidth={1} />
      {showAngleLabels
        ? (() => {
            const pos = clampLabelPos(
              miiEnd.x + labelOffset(miiAngleDeg, variant).dx,
              miiEnd.y + labelOffset(miiAngleDeg, variant).dy + samePrePostLabelDy,
              vbW,
              vbH,
              L.fontLabel + 1,
            );
            return (
              <text
                x={pos.x}
                y={pos.y}
                fontSize={L.fontLabel + 1}
                fill={mii.stroke}
                fontWeight={800}
                fontFamily="ui-monospace, monospace"
              >
                MII {fmtDeg(miiAngleDeg)}
              </text>
            );
          })()
        : null}
      {showGapArc && gapPctPre != null && gapMid
        ? (() => {
            const gapFont = variant === "tile" ? 10 : 12;
            const pos = clampLabelPos(gapMid.x, gapMid.y, vbW, vbH, gapFont);
            return (
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                fontSize={gapFont}
                fontWeight={700}
                fill={GAP_ARC_COLOR}
                fontFamily="ui-monospace, monospace"
              >
                Δ {gapPctPre.toFixed(0)}%
              </text>
            );
          })()
        : null}
      <circle cx={cx} cy={cy} r={isWide ? 3.25 : 2.25} fill="#64748b" opacity={0.85} />
      {showInlineLegend && variant === "compact" ? (
        <g transform={`translate(${L.legendX}, ${L.legendY})`}>
          <LegendRow y={0} color={PRE_COLOR} dash lineLen={L.legendLineLen} textX={L.legendTextX} label="pre" fontSize={L.fontLegend} sub={preAngleDeg != null ? fmtDeg(preAngleDeg) : undefined} />
          <LegendRow y={L.legendRowStep} color={POST_COLOR} lineLen={L.legendLineLen} textX={L.legendTextX} label="post" fontSize={L.fontLegend} sub={postAngleDeg != null ? fmtDeg(postAngleDeg) : undefined} />
          <LegendRow y={L.legendRowStep * 2} color={mii.stroke} lineLen={L.legendLineLen} textX={L.legendTextX} label="MII" fontSize={L.fontLegend} sub={fmtDeg(miiAngleDeg)} />
        </g>
      ) : null}
    </svg>
  );
}

function LegendRow({
  y,
  color,
  dash,
  lineLen,
  textX,
  label,
  fontSize,
  sub,
}: {
  y: number;
  color: string;
  dash?: boolean;
  lineLen: number;
  textX: number;
  label: string;
  fontSize: number;
  sub?: string;
}) {
  return (
    <g transform={`translate(0, ${y})`}>
      <line x1={0} y1={0} x2={lineLen} y2={0} stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeDasharray={dash ? "3 2" : undefined} />
      <text x={textX} y={4} fontSize={fontSize} fill="#64748b" fontFamily="system-ui,sans-serif" fontWeight={600}>
        {label}
        {sub ? ` · ${sub}` : ""}
      </text>
    </g>
  );
}

/** Didascalia HTML sotto il grafico (modal). */
export function MigSlopeLegendBar({
  lang,
  samePrePost = false,
}: {
  lang: "it" | "en";
  samePrePost?: boolean;
}) {
  const it = lang === "it";
  const items = samePrePost
    ? [
        {
          color: PRE_COLOR,
          dash: true,
          title: it ? "modello" : "model",
          desc: it
            ? "Pred+5 ricalibrato (pre/post identici oggi)"
            : "recalibrated Pred+5 (pre/post identical today)",
        },
        { color: "#64748b", dash: false, title: "MII", desc: it ? "mercato (ΔP × vol)" : "market (ΔP × vol)" },
        { color: GAP_ARC_COLOR, dash: true, title: "Δ", desc: it ? "gap % modello → MII" : "gap % model → MII" },
      ]
    : [
        { color: PRE_COLOR, dash: true, title: "pre", desc: it ? "modello prima daily open" : "model before daily open" },
        { color: POST_COLOR, dash: false, title: "post", desc: it ? "dopo ricalib giornaliera" : "after daily recalib" },
        { color: "#64748b", dash: false, title: "MII", desc: it ? "mercato (ΔP × vol)" : "market (ΔP × vol)" },
        { color: GAP_ARC_COLOR, dash: true, title: "Δ", desc: it ? "gap % pre → MII" : "gap % pre → MII" },
      ];
  return (
    <div className="flex flex-col gap-2 text-[11px] leading-snug">
      {items.map((item) => (
        <div key={item.title} className="flex items-start gap-2.5 rounded-lg border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-3))]/20 px-2.5 py-2">
          <svg width={22} height={10} className="mt-0.5 shrink-0" aria-hidden>
            <line
              x1={1}
              y1={5}
              x2={21}
              y2={5}
              stroke={item.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={item.dash ? "5 3" : undefined}
            />
          </svg>
          <span>
            <span className="font-bold text-ink">{item.title}</span>
            <span className="text-ink-muted"> — {item.desc}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function MigCalibPie({
  score,
  tier,
  size = 40,
  ariaLabel,
  onClick,
  className = "",
}: {
  score: number | null;
  tier: ModelSlopeCalibrationTier;
  size?: number;
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(3.5, size * 0.16);
  const r = (size - stroke) / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const filled = (pct / 100) * c;
  const color = tierPieColor(tier, score);

  const svg = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 block" role="img" aria-label={ariaLabel ?? (score != null ? `Calib pre ${Math.round(pct)}/100` : "Calib n/d")}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--border) / 0.45)" strokeWidth={stroke} opacity={0.35} />
      {score != null && filled > 0.5 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${filled} ${c}`} transform={`rotate(-90 ${cx} ${cy})`} />
      ) : null}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight={700} fill={score != null ? color : "#94a3b8"} fontFamily="ui-monospace, monospace">
        {score != null ? Math.round(pct) : "—"}
      </text>
    </svg>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`inline-flex flex-col items-center gap-0.5 rounded-md border border-transparent p-0.5 cursor-pointer hover:border-[rgb(var(--accent))]/40 hover:bg-[rgb(var(--surface-3))]/45 transition ${className}`}
        title={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {svg}
      </button>
    );
  }

  return svg;
}

/** Colonna tabella: solo torta cliccabile → apre modal grafico. */
export function MigCalibVisual({
  calibPre,
  calibPost,
  tip,
  onOpenDetail,
  clickHint,
}: {
  miiAngleDeg: number;
  calibPre: MIGModelCalibration;
  calibPost: MIGModelCalibration;
  tip: string;
  onOpenDetail?: () => void;
  clickHint?: string;
}) {
  const hasAny =
    calibPre.modelSlopeAngleDeg != null ||
    calibPost.modelSlopeAngleDeg != null ||
    calibPre.calibrationScore != null;

  if (!hasAny) {
    return <span className="text-[10px] text-ink-muted/50">—</span>;
  }

  const postScore = calibPost.calibrationScore;
  const showPost =
    postScore != null &&
    calibPre.calibrationScore != null &&
    Math.abs(postScore - calibPre.calibrationScore) >= 1;

  return (
    <div className="inline-flex flex-col items-center justify-center gap-0.5 max-w-full mx-auto">
      <MigCalibPie
        score={calibPre.calibrationScore}
        tier={calibPre.calibrationTier}
        size={52}
        ariaLabel={clickHint ? `${tip} · ${clickHint}` : tip}
        onClick={onOpenDetail}
      />
      <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted leading-none pointer-events-none">
        Calib pre≈MII
      </span>
      {showPost ? (
        <span className="text-[9px] tabular-nums text-ink-muted/80 leading-none pointer-events-none">
          post {Math.round(postScore!)}/100
        </span>
      ) : null}
    </div>
  );
}
