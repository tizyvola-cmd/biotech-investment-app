/** Marker visivo «oggi» sul calendario CD (linea + pin). */

export const NOW_MARKER_STROKE = "var(--chart-today, rgb(var(--warn)))";
export const NOW_MARKER_FILL = "var(--chart-today, #f59e0b)";

type ViewBox = { x?: number; y?: number; width?: number; height?: number };

/** Posizionamento etichette pin senza sovrapposizioni (asse Y, «Oggi», Var. Giorn.). */
export function resolvePinLabelLayout(
  viewBox: ViewBox | undefined,
  hasSubText: boolean,
): {
  anchor: "start" | "middle" | "end";
  tx: number;
  tyMain: number;
  tySub: number;
} {
  const x = viewBox?.x ?? 0;
  const w = viewBox?.width ?? 400;
  const y = (viewBox?.y ?? 0) + 6;

  const leftZone = x < w * 0.28;
  const rightZone = x > w * 0.72;

  if (leftZone) {
    return {
      anchor: "start",
      tx: x + 8,
      tyMain: y + 4,
      tySub: y + 16,
    };
  }
  if (rightZone) {
    return {
      anchor: "end",
      tx: x - 8,
      tyMain: y + 4,
      tySub: y + 16,
    };
  }
  if (hasSubText) {
    return {
      anchor: "middle",
      tx: x,
      tyMain: y - 16,
      tySub: y - 5,
    };
  }
  return {
    anchor: "middle",
    tx: x,
    tyMain: y - 8,
    tySub: y + 16,
  };
}

/** Pin compatto per sparkline (tabella). */
export function SparklineNowMarker({
  x,
  y,
  height,
}: {
  x: number;
  y: number;
  height: number;
}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const top = 1;
  const bottom = height - 1;
  return (
    <g aria-hidden>
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={bottom}
        stroke={NOW_MARKER_STROKE}
        strokeWidth={1}
        strokeDasharray="2 1.5"
        opacity={0.75}
      />
      <circle cx={x} cy={y} r={2.2} fill={NOW_MARKER_FILL} stroke="#fff" strokeWidth={0.9} />
      <circle cx={x} cy={y - 5} r={2.8} fill={NOW_MARKER_FILL} opacity={0.35} />
      <path
        d={`M${x} ${y - 8.5} L${x + 2.2} ${y - 4.2} L${x - 2.2} ${y - 4.2} Z`}
        fill={NOW_MARKER_FILL}
        stroke="#fff"
        strokeWidth={0.6}
      />
    </g>
  );
}

/** Etichetta pin per Recharts ReferenceLine. */
export function ChartNowPinLabel(props: {
  viewBox?: ViewBox;
  /** Etichetta breve (es. «Oggi · ANIK»). */
  text?: string;
  /** Seconda riga (es. Var. Giorn. % / 24h move). */
  subText?: string;
  subColor?: string;
  /** @deprecated Usa posizionamento automatico da viewBox. */
  textAlign?: "left" | "right";
}) {
  const x = props.viewBox?.x;
  if (x == null || !Number.isFinite(x)) return null;
  const y = (props.viewBox?.y ?? 0) + 6;
  const hasSubText = Boolean(props.subText);
  const layout = resolvePinLabelLayout(props.viewBox, hasSubText);
  const anchor = layout.anchor;

  return (
    <g aria-hidden>
      <line
        x1={x}
        x2={x}
        y1={y + 12}
        y2={(props.viewBox?.height ?? 200) - 4}
        stroke={NOW_MARKER_STROKE}
        strokeWidth={1.75}
        strokeDasharray="5 3"
        opacity={0.9}
      />
      <circle cx={x} cy={y + 6} r={7} fill={NOW_MARKER_FILL} opacity={0.18} />
      <circle cx={x} cy={y + 6} r={4.5} fill={NOW_MARKER_FILL} opacity={0.32} />
      <path
        d={`M${x} ${y} L${x + 5} ${y + 8} L${x - 5} ${y + 8} Z`}
        fill={NOW_MARKER_FILL}
        stroke="#fff"
        strokeWidth={1.2}
      />
      <circle cx={x} cy={y + 5.5} r={1.7} fill="#fff" />
      {props.text ? (
        <text
          x={layout.tx}
          y={layout.tyMain}
          fill={NOW_MARKER_STROKE}
          fontSize={10}
          fontWeight={700}
          textAnchor={anchor}
          paintOrder="stroke"
          stroke="#fff"
          strokeWidth={3}
        >
          {props.text}
        </text>
      ) : null}
      {props.subText ? (
        <text
          x={layout.tx}
          y={layout.tySub}
          fill={props.subColor ?? "#64748b"}
          fontSize={8.5}
          fontWeight={700}
          textAnchor={anchor}
          paintOrder="stroke"
          stroke="#fff"
          strokeWidth={2.5}
        >
          {props.subText}
        </text>
      ) : null}
    </g>
  );
}

/** Cerchio target (verde) o stop (rosso) sulla mini-curva. */
export function SparklineLevelMarker({
  x,
  y,
  kind,
}: {
  x: number;
  y: number;
  kind: "target" | "stop";
}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const fill =
    kind === "target" ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";
  return (
    <g aria-hidden>
      <circle cx={x} cy={y} r={2.4} fill={fill} stroke="#fff" strokeWidth={0.85} />
    </g>
  );
}

/** Punto «oggi» sulla curva (Scatter Recharts). */
export function NowCurvePinShape(props: {
  cx?: number;
  cy?: number;
}) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g aria-hidden>
      <circle cx={cx} cy={cy} r={7} fill={NOW_MARKER_FILL} opacity={0.22} />
      <path
        d={`M${cx} ${cy - 5} L${cx + 4.5} ${cy + 2} L${cx - 4.5} ${cy + 2} Z`}
        fill={NOW_MARKER_FILL}
        stroke="#fff"
        strokeWidth={1.2}
      />
      <circle cx={cx} cy={cy + 0.5} r={2} fill="#fff" />
    </g>
  );
}
