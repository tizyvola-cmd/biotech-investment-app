/**
 * Inclinometro MII — linea inclinata all'angolo (°) con riferimento orizzontale e soglia PASS.
 * ViewBox normalizzato per rendering nitido a qualsiasi dimensione display.
 */
export function SlopeAngleGlyph({
  angleDeg,
  thresholdDeg,
  size = 88,
  showLabel = true,
}: {
  angleDeg: number;
  /** Soglia PASS (±) — linee tratteggiate di riferimento. */
  thresholdDeg?: number;
  size?: number;
  showLabel?: boolean;
}) {
  const vbW = 120;
  const vbPlotH = 72;
  const vbLabelH = showLabel ? 18 : 0;
  const vbH = vbPlotH + vbLabelH;

  const cx = vbW / 2;
  const cy = vbPlotH / 2 + 2;
  /** Braccio esteso — usa quasi tutta la metà larghezza del plot. */
  const arm = vbW * 0.46;
  const padX = 8;
  const padY = 6;

  const clamped = Math.max(-45, Math.min(45, angleDeg));
  const rad = (clamped * Math.PI) / 180;
  const x2 = cx + arm * Math.cos(-rad);
  const y2 = cy + arm * Math.sin(-rad);

  const up = angleDeg >= 0;
  const stroke = up ? "#059669" : "#dc2626";
  const strokeSoft = up ? "#10b981" : "#ef4444";
  const fill = up ? "#047857" : "#b91c1c";
  const sign = angleDeg >= 0 ? "+" : "";

  function thresholdEnd(deg: number): { x: number; y: number } {
    const r = (deg * Math.PI) / 180;
    return { x: cx + arm * 0.94 * Math.cos(-r), y: cy + arm * 0.94 * Math.sin(-r) };
  }

  const thPos = thresholdDeg != null ? thresholdEnd(thresholdDeg) : null;
  const thNeg = thresholdDeg != null ? thresholdEnd(-thresholdDeg) : null;

  const displayH = Math.round(size * (vbH / vbW) * 0.95);

  return (
    <svg
      width={size}
      height={displayH}
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="slope-angle-glyph shrink-0 block mx-auto"
      role="img"
      aria-label={`${sign}${angleDeg.toFixed(1)}°`}
      shapeRendering="geometricPrecision"
    >
      <rect
        x={padX * 0.5}
        y={padY * 0.5}
        width={vbW - padX}
        height={vbPlotH - padY}
        rx={7}
        className="slope-angle-glyph-bg"
        stroke="rgb(var(--border) / 0.35)"
        strokeWidth={0.75}
      />
      {/* Orizzonte 0° */}
      <line
        x1={padX}
        y1={cy}
        x2={vbW - padX}
        y2={cy}
        stroke="#94a3b8"
        strokeWidth={0.85}
        strokeDasharray="4 3.5"
        opacity={0.55}
      />
      {/* Soglia ± PASS */}
      {thPos ? (
        <line
          x1={cx}
          y1={cy}
          x2={thPos.x}
          y2={thPos.y}
          stroke="#d97706"
          strokeWidth={1}
          strokeDasharray="2.5 3"
          opacity={0.5}
        />
      ) : null}
      {thNeg ? (
        <line
          x1={cx}
          y1={cy}
          x2={thNeg.x}
          y2={thNeg.y}
          stroke="#d97706"
          strokeWidth={1}
          strokeDasharray="2.5 3"
          opacity={0.5}
        />
      ) : null}
      {/* Ombra leggera sulla pendenza */}
      <line
        x1={cx}
        y1={cy}
        x2={x2}
        y2={y2}
        stroke={strokeSoft}
        strokeWidth={4.5}
        strokeLinecap="round"
        opacity={0.22}
      />
      {/* Pendenza MII */}
      <line
        x1={cx}
        y1={cy}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={3.25}
        strokeLinecap="round"
      />
      {/* Punta estesa oltre il centro per enfatizzare la direzione */}
      <circle cx={x2} cy={y2} r={4.25} fill={fill} stroke={strokeSoft} strokeWidth={1.25} />
      <circle cx={cx} cy={cy} r={3.25} fill="#64748b" stroke="#f1f5f9" strokeWidth={0.75} opacity={0.9} />
      {showLabel ? (
        <text
          x={cx}
          y={vbPlotH + vbLabelH * 0.68}
          textAnchor="middle"
          fill={stroke}
          fontSize={13}
          fontWeight={700}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {sign}
          {angleDeg.toFixed(1)}°
        </text>
      ) : null}
    </svg>
  );
}
