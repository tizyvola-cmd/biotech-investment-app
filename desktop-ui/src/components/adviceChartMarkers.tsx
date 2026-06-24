import type { AdviceActionKind, AdviceOutcomeClass } from "../sheet/investDecisionSimAdviceCalibration";

const OUTCOME_FILL: Record<AdviceOutcomeClass, string> = {
  good: "#22c55e",
  bad: "#ef4444",
  pending: "#94a3b8",
};

export function adviceOutcomeFill(outcome: AdviceOutcomeClass): string {
  return OUTCOME_FILL[outcome];
}

/** Recharts scatter marker — circle for BUY / HOLD, triangle for SELL. */
export function AdviceCalibScatterDot({
  cx = 0,
  cy = 0,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: {
    outcome?: AdviceOutcomeClass;
    suggestedAction?: AdviceActionKind;
  };
}) {
  const outcome = payload?.outcome ?? "pending";
  const fill = adviceOutcomeFill(outcome);
  const isSell = payload?.suggestedAction === "sell";
  if (isSell) {
    return <AdviceTriangleMarker cx={cx} cy={cy} fill={fill} direction="down" size={8} />;
  }
  return <circle cx={cx} cy={cy} r={5.5} fill={fill} fillOpacity={0.92} stroke="none" />;
}

export function AdviceTriangleMarker({
  cx,
  cy,
  fill,
  direction = "down",
  size = 7,
}: {
  cx: number;
  cy: number;
  fill: string;
  direction?: "up" | "down";
  size?: number;
}) {
  const h = size;
  const w = size * 1.15;
  const points =
    direction === "down"
      ? `${cx},${cy + h * 0.45} ${cx - w * 0.55},${cy - h * 0.45} ${cx + w * 0.55},${cy - h * 0.45}`
      : `${cx},${cy - h * 0.45} ${cx - w * 0.55},${cy + h * 0.45} ${cx + w * 0.55},${cy + h * 0.45}`;
  return <polygon points={points} fill={fill} fillOpacity={0.92} stroke="none" />;
}

export function SellOutcomeTriangle({
  cx = 0,
  cy = 0,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: { adviceOutcome?: AdviceOutcomeClass | null; sellAdviceOutcome?: AdviceOutcomeClass | null };
}) {
  const outcome = payload?.sellAdviceOutcome ?? payload?.adviceOutcome ?? "pending";
  return (
    <AdviceTriangleMarker
      cx={cx}
      cy={cy}
      fill={adviceOutcomeFill(outcome)}
      direction="down"
      size={9}
    />
  );
}
