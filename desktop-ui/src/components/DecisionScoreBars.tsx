import type { DecisionChartTickerRow } from "../sheet/decisionChartLogic";
import { decisionAxisToScoreSection } from "../sheet/decisionChartLogic";
import { DECISION_CHART_AXES, type DecisionChartAxisId } from "../sheet/decisionChartIndices";
import { axisZoneMarkers } from "../sheet/decisionChartAxisZones";
import type { LossAnalysisScoreSection } from "../sheet/investSimKeys";
import { useT } from "../shared/i18n";

type AxisId = DecisionChartAxisId;
type AxisDef = (typeof DECISION_CHART_AXES)[number];

const SETUP_AXES = DECISION_CHART_AXES.filter((ax) => !ax.invert);
const RISK_AXES = DECISION_CHART_AXES.filter((ax) => ax.invert);

/** Pastel bar stops — a notch more saturated, still not neon. */
const STOP_BAD = "rgb(214, 108, 128)";
const STOP_MID = "rgb(232, 234, 232)";
const STOP_GOOD = "rgb(92, 168, 132)";

const BAR_BAD = { r: 214, g: 108, b: 128 };
const BAR_MID = { r: 232, g: 234, b: 232 };
const BAR_GOOD = { r: 92, g: 168, b: 132 };

/** Darker pastel for numeric labels (mid must stay readable on white). */
const LABEL_BAD = { r: 190, g: 55, b: 85 };
const LABEL_MID = { r: 100, g: 116, b: 139 }; // slate-500
const LABEL_GOOD = { r: 35, g: 130, b: 95 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): string {
  const u = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(lerp(a.r, b.r, u))}, ${Math.round(lerp(a.g, b.g, u))}, ${Math.round(lerp(a.b, b.b, u))})`;
}

function samplePolarity(
  score0to100: number,
  higherIsBetter: boolean,
  bad: { r: number; g: number; b: number },
  mid: { r: number; g: number; b: number },
  good: { r: number; g: number; b: number },
): string {
  const t = Math.max(0, Math.min(1, score0to100 / 100));
  if (higherIsBetter) {
    if (t < 0.5) return mixRgb(bad, mid, t * 2);
    return mixRgb(mid, good, (t - 0.5) * 2);
  }
  if (t < 0.5) return mixRgb(good, mid, t * 2);
  return mixRgb(mid, bad, (t - 0.5) * 2);
}

/** Tip color on the bar gradient (pastel). */
export function polarityScoreBarColor(
  score0to100: number | null | undefined,
  higherIsBetter: boolean,
): string {
  if (score0to100 == null || !Number.isFinite(score0to100)) return "#94a3b8";
  return samplePolarity(score0to100, higherIsBetter, BAR_BAD, BAR_MID, BAR_GOOD);
}

/** Numeric label — same polarity, darker so mid scores stay visible. */
export function polarityScoreLabelColor(
  score0to100: number | null | undefined,
  higherIsBetter: boolean,
): string {
  if (score0to100 == null || !Number.isFinite(score0to100)) return "#64748b";
  return samplePolarity(score0to100, higherIsBetter, LABEL_BAD, LABEL_MID, LABEL_GOOD);
}

/** Full-scale gradient; fill width + background-size so tip matches score color. */
export function polarityBarFillStyle(
  score0to100: number,
  higherIsBetter: boolean,
): { width: string; backgroundImage: string; backgroundSize: string; backgroundRepeat: string } {
  const score = Math.max(0, Math.min(100, score0to100));
  const widthPct = score < 4 ? 4 : score;
  const gradient = higherIsBetter
    ? `linear-gradient(to right, ${STOP_BAD}, ${STOP_MID} 50%, ${STOP_GOOD})`
    : `linear-gradient(to right, ${STOP_GOOD}, ${STOP_MID} 50%, ${STOP_BAD})`;
  return {
    width: `${widthPct}%`,
    backgroundImage: gradient,
    // Stretch gradient to the full track so the tip = color at `score`.
    backgroundSize: `${(100 / widthPct) * 100}% 100%`,
    backgroundRepeat: "no-repeat",
  };
}

function fmtEisRaw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${Math.round(n)}`;
}

function barVal(row: DecisionChartTickerRow, id: AxisId): number | null {
  const s = row.scores;
  switch (id) {
    case "pplan":
      return s.pplan;
    case "sds":
      return s.sds;
    case "eis":
      return s.eis;
    case "riskV2":
      return s.riskV2;
    case "regRisk":
      return s.regRisk;
    case "mcs":
      return s.mcs;
    default:
      return null;
  }
}

function AxisBarRow({
  ax,
  row,
  it,
  onScrollToCard,
}: {
  ax: AxisDef;
  row: DecisionChartTickerRow;
  it: boolean;
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
}) {
  const t = useT();
  const higherIsBetter = !ax.invert;
  const bar = ax.id === "eis" ? row.scores.eis : barVal(row, ax.id);
  const labelColor = polarityScoreLabelColor(bar, higherIsBetter);
  const fillStyle =
    bar != null && Number.isFinite(bar) ? polarityBarFillStyle(bar, higherIsBetter) : null;
  const label =
    ax.id === "eis"
      ? fmtEisRaw(row.scores.eisRaw)
      : bar != null
        ? String(Math.round(bar))
        : "—";
  const axisTitle = ax.label;
  const section = decisionAxisToScoreSection(ax.id);
  const zones = axisZoneMarkers(ax.id, row);

  return (
    <div className="decision-bar-row">
      <span
        className={`decision-bar-label${ax.longLabel ? " decision-bar-label--long" : ""}`}
        title={axisTitle}
      >
        {axisTitle}
      </span>
      <div className="decision-bar-track">
        {zones.map((z) => (
          <div
            key={`${ax.id}-${z.pct}-${z.letter}`}
            className={`decision-bar-zone-line decision-bar-zone-line--${z.letter.toLowerCase()}`}
            style={{ left: `${z.pct}%` }}
            title={it ? z.titleIt : z.titleEn}
          >
            <span className="decision-bar-zone-letter">{z.letter}</span>
          </div>
        ))}
        {fillStyle != null ? (
          <div className="decision-bar-fill decision-bar-fill--polarity" style={fillStyle} />
        ) : null}
      </div>
      <span
        className="decision-bar-val"
        style={bar != null ? { color: labelColor } : undefined}
      >
        {label}
      </span>
      {section && onScrollToCard ? (
        <button
          type="button"
          className="decision-bar-link"
          onClick={() => onScrollToCard(row.key, section)}
          title={t("sim.lossAnalysis.decisionChart.jumpSection")}
        >
          →
        </button>
      ) : (
        <span className="w-[1.25rem] shrink-0" aria-hidden />
      )}
    </div>
  );
}

function AxisGroup({
  title,
  hint,
  axes,
  row,
  it,
  onScrollToCard,
}: {
  title: string;
  hint: string;
  axes: readonly AxisDef[];
  row: DecisionChartTickerRow;
  it: boolean;
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{title}</p>
        <p className="text-[8px] text-ink-muted/90 italic">{hint}</p>
      </div>
      <div className="decision-bars flex-1 min-w-0 w-full">
        {axes.map((ax) => (
          <AxisBarRow
            key={ax.id}
            ax={ax}
            row={row}
            it={it}
            onScrollToCard={onScrollToCard}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Score bars split by polarity — gradient fill changes along the scale.
 * Setup: red → white → green · Risk: green → white → red.
 */
export function DecisionScoreBars({
  row,
  it = false,
  onScrollToCard,
}: {
  row: DecisionChartTickerRow;
  it?: boolean;
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
}) {
  return (
    <div className="decision-score-bars space-y-3">
      <AxisGroup
        title={it ? "Setup" : "Setup"}
        hint={it ? "alto = meglio · rosso→bianco→verde" : "higher = better · red→white→green"}
        axes={SETUP_AXES}
        row={row}
        it={it}
        onScrollToCard={onScrollToCard}
      />
      <AxisGroup
        title={it ? "Rischio" : "Risk"}
        hint={it ? "alto = peggio · verde→bianco→rosso" : "higher = worse · green→white→red"}
        axes={RISK_AXES}
        row={row}
        it={it}
        onScrollToCard={onScrollToCard}
      />
    </div>
  );
}
