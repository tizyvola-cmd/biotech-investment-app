/**
 * Pendenza tabella Simulation (vista Variazioni) — stessa logica tab Slope errors.
 */
import { extractCurveInputs } from "./precatCurve";
import {
  classifySlopeEventKind,
  slopeDeltaPpPerDay,
  type SlopeEventKindClassified,
} from "./slopeThresholds";
import {
  fmtSlopePp,
  slopesFromFeedRow,
  SLOPE_KIND_META,
  summarizeSlopeFeedRow,
  type SlopeEventSummary,
} from "./slopeEventSummary";
import type { UnifiedSlopeFeedRow } from "./slopeEventsFeed";

export type SimRowSlopeDisplay = {
  slope5d: number | null;
  slope20d: number | null;
  delta: number | null;
  kind: SlopeEventKindClassified | null;
  shiftLine: string;
  subLine: string;
  toneCls: string;
  /** Allineato a evento in tab Slope errors (se presente). */
  hasSlopeFeedEvent: boolean;
  feedSummary: SlopeEventSummary | null;
};

function ppUnit(lang: "it" | "en"): string {
  return lang === "it" ? "pp/g" : "pp/d";
}

function liveShiftLines(
  kind: SlopeEventKindClassified | null,
  slope5d: number | null,
  slope20d: number | null,
  delta: number | null,
  lang: "it" | "en",
): { shiftLine: string; subLine: string; toneCls: string } {
  const u = ppUnit(lang);
  if (slope5d == null && slope20d == null) {
    return { shiftLine: "—", subLine: "", toneCls: "text-ink-muted" };
  }
  if (kind === "slope_rev") {
    return {
      shiftLine: `${fmtSlopePp(slope20d)} → ${fmtSlopePp(slope5d)} ${u}`,
      subLine: lang === "it" ? "Inversione" : "Reversal",
      toneCls: "text-[rgb(var(--signal-down))]",
    };
  }
  if (kind === "slope_dec" || kind === "slope_acc") {
    const meta = SLOPE_KIND_META[kind];
    return {
      shiftLine: `Δ ${fmtSlopePp(delta)} ${u}`,
      subLine: `${fmtSlopePp(slope20d)} → ${fmtSlopePp(slope5d)} ${u}`,
      toneCls: meta?.cls ?? "text-ink",
    };
  }
  return {
    shiftLine: `Δ ${fmtSlopePp(delta)} ${u}`,
    subLine: `${fmtSlopePp(slope20d)} vs ${fmtSlopePp(slope5d)} ${u}`,
    toneCls: "text-ink-muted",
  };
}

export function resolveSimRowSlopeDisplay(
  simRow: Record<string, unknown> | null | undefined,
  feedRow: UnifiedSlopeFeedRow | null | undefined,
  lang: "it" | "en",
): SimRowSlopeDisplay | null {
  if (!simRow) return null;

  if (feedRow) {
    const summary = summarizeSlopeFeedRow(feedRow, lang);
    const { slope5d, slope20d, delta } = slopesFromFeedRow(feedRow);
    return {
      slope5d,
      slope20d,
      delta,
      kind:
        feedRow.kind === "contrarian"
          ? null
          : (feedRow.kind as SlopeEventKindClassified),
      shiftLine: summary.shiftLine,
      subLine: summary.subLine,
      toneCls: summary.shiftCls,
      hasSlopeFeedEvent: true,
      feedSummary: summary,
    };
  }

  const { slope5d, slope20d } = extractCurveInputs(simRow);
  if (slope5d == null && slope20d == null) return null;

  const s5 = slope5d ?? 0;
  const s20 = slope20d ?? s5;
  const delta = slopeDeltaPpPerDay(s5, s20);
  const kind = classifySlopeEventKind(s5, s20);
  const { shiftLine, subLine, toneCls } = liveShiftLines(kind, s5, s20, delta, lang);

  return {
    slope5d: s5,
    slope20d: s20,
    delta,
    kind,
    shiftLine,
    subLine,
    toneCls,
    hasSlopeFeedEvent: kind != null,
    feedSummary: null,
  };
}
