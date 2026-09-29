import type { AdviceActionKind, AdviceOutcomeClass } from "../sheet/investDecisionSimAdviceCalibration";
import type {
  AdviceBuySellErrorKind,
  AdviceErrorVisualClass,
  MissSellLossTier,
  SecondaryErrorPalette,
} from "../sheet/adviceErrorTimelineCharts";

const OUTCOME_FILL: Record<AdviceOutcomeClass, string> = {
  good: "#22c55e",
  bad: "#ef4444",
  pending: "#94a3b8",
};

const ERROR_YELLOW = "#eab308";
const ERROR_BLUE = "#2563eb";
const ERROR_RED = "#dc2626";

export function adviceOutcomeFill(outcome: AdviceOutcomeClass): string {
  return OUTCOME_FILL[outcome];
}

function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

function criticalMissSellTriangleSize(tier: MissSellLossTier): number {
  switch (tier) {
    case 1:
      return 6;
    case 2:
      return 8;
    case 3:
      return 10;
    case 4:
    default:
      return 12;
  }
}

function paletteColors(palette: SecondaryErrorPalette): { fill: string; stroke: string } {
  return palette === "yellowBlue"
    ? { fill: ERROR_YELLOW, stroke: ERROR_BLUE }
    : { fill: ERROR_BLUE, stroke: ERROR_YELLOW };
}

export type BuySellErrorDotPayload = {
  errorKind?: AdviceBuySellErrorKind;
  signedErrorPct?: number;
  suggestedAction?: AdviceActionKind;
  visualClass?: AdviceErrorVisualClass;
  missSellLossTier?: MissSellLossTier;
  secondaryPalette?: SecondaryErrorPalette;
};

function resolveErrorKind(payload?: BuySellErrorDotPayload): AdviceBuySellErrorKind {
  if (payload?.errorKind) return payload.errorKind;
  const action = payload?.suggestedAction;
  return action === "sell" ? "wrongSell" : "wrongBuy";
}

/** BUY/SELL error chart — critical miss-sell (red, sized) vs secondary (yellow/blue). */
export function BuySellErrorScatterDot({
  cx = 0,
  cy = 0,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: BuySellErrorDotPayload;
}) {
  const kind = resolveErrorKind(payload);

  if (payload?.visualClass === "criticalMissSell") {
    const size = criticalMissSellTriangleSize(payload.missSellLossTier ?? 1);
    return (
      <AdviceTriangleMarker
        cx={cx}
        cy={cy}
        fill={ERROR_RED}
        direction="down"
        size={size}
        stroke={ERROR_RED}
        strokeWidth={1.4}
      />
    );
  }

  const palette =
    payload?.secondaryPalette ??
    (kind === "missBuy" || kind === "wrongSell" ? "yellowBlue" : "blueYellow");
  const { fill, stroke } = paletteColors(palette);
  const strokeW = 1.35;

  switch (kind) {
    case "missBuy":
      return (
        <circle cx={cx} cy={cy} r={5.5} fill={fill} fillOpacity={0.95} stroke={stroke} strokeWidth={strokeW} />
      );
    case "wrongBuy":
      return (
        <polygon
          points={diamondPoints(cx, cy, 5.5)}
          fill={fill}
          fillOpacity={0.88}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    case "wrongSell":
      return (
        <AdviceTriangleMarker
          cx={cx}
          cy={cy}
          fill={fill}
          direction="up"
          size={8}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    default:
      return (
        <circle cx={cx} cy={cy} r={5.5} fill={fill} fillOpacity={0.95} stroke={stroke} strokeWidth={strokeW} />
      );
  }
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
  stroke,
  strokeWidth = 0,
}: {
  cx: number;
  cy: number;
  fill: string;
  direction?: "up" | "down";
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}) {
  const h = size;
  const w = size * 1.15;
  const points =
    direction === "down"
      ? `${cx},${cy + h * 0.45} ${cx - w * 0.55},${cy - h * 0.45} ${cx + w * 0.55},${cy - h * 0.45}`
      : `${cx},${cy - h * 0.45} ${cx - w * 0.55},${cy + h * 0.45} ${cx + w * 0.55},${cy + h * 0.45}`;
  return (
    <polygon
      points={points}
      fill={fill}
      fillOpacity={0.95}
      stroke={stroke ?? "none"}
      strokeWidth={strokeWidth}
    />
  );
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

/** Legend preview for critical miss-sell tiers. */
export function CriticalMissSellLegendDot({
  cx = 7,
  cy = 7,
  tier,
}: {
  cx?: number;
  cy?: number;
  tier: MissSellLossTier;
}) {
  return (
    <BuySellErrorScatterDot
      cx={cx}
      cy={cy}
      payload={{ visualClass: "criticalMissSell", missSellLossTier: tier, errorKind: "wrongSell" }}
    />
  );
}

/** Legend preview for secondary palette + shape. */
export function SecondaryErrorLegendDot({
  cx = 7,
  cy = 7,
  kind,
  palette,
}: {
  cx?: number;
  cy?: number;
  kind: AdviceBuySellErrorKind;
  palette: SecondaryErrorPalette;
}) {
  return (
    <BuySellErrorScatterDot
      cx={cx}
      cy={cy}
      payload={{ visualClass: "secondary", errorKind: kind, secondaryPalette: palette }}
    />
  );
}
