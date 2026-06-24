import type { MobileCurveChartsPayload, MobileDashboardRecRow } from "./dashboardTypes";
import {
  computeMobileGainIdea,
  formatMobileGainIdeaShort,
} from "./mobileCurvePeakOutlook";
import { extractRecalibCurvePoints, type RecalibCurvePoint } from "./mobileRecalibCurve";
import { computeMobileTargetProgress, type MobileTargetProgressTone } from "./mobileTargetProgress";
import { resolveReadingDelta, type ReadingDelta } from "./priceReadingCache";
import { buildSimRowByKeyMap, computeSimulationPosition, currentPriceFromRow, parseNum } from "./simLogic";
import type { InvestSimInputs, SheetTable, ChartPoint } from "./types";

export type ActionsProfileFilter = "all" | "portfolio" | "opportunity";

export type MobileActionRow = MobileDashboardRecRow & {
  companyName: string | null;
  currPriceUsd: number | null;
  gainIdeaText: string | null;
  scorePct: number | null;
  isNew: boolean;
  eisScore: number | null;
  eisHint: string | null;
  curvePoints: RecalibCurvePoint[];
  completionDate: string | null;
  curveCharts: MobileCurveChartsPayload | null;
  targetProgressRatio: number | null;
  targetProgressTone: MobileTargetProgressTone;
  readingSource: ReadingDelta["source"] | null;
  readingCurrentTs: string | null;
};

function companyFromRow(r: Record<string, unknown>): string | null {
  const name = String(r.Nome ?? r.Company ?? r.Società ?? r["Company Name"] ?? "").trim();
  return name || null;
}

function resolveGainIdeaText(
  rec: MobileDashboardRecRow,
  row: Record<string, unknown> | null,
  chartPoints: ChartPoint[] | null,
  inputs: InvestSimInputs,
  lang: "it" | "en" = "it",
): string | null {
  if (rec.gainIdeaText && rec.gainIdeaText !== "—") {
    const idea = computeMobileGainIdea({
      row: row ?? undefined,
      chartPoints,
      curvePoints: rec.curvePoints,
      capitalEur:
        inputs[rec.key]?.capital && inputs[rec.key]!.capital > 0
          ? inputs[rec.key]!.capital
          : undefined,
      planReturnPct: rec.planReturnPct,
      daysToTarget: rec.daysToTarget,
    });
    const recomputed = formatMobileGainIdeaShort(idea, lang);
    if (recomputed && idea.source === "curve_peak") return recomputed;
    return rec.gainIdeaText;
  }

  const idea = computeMobileGainIdea({
    row: row ?? undefined,
    chartPoints,
    curvePoints: rec.curvePoints,
    capitalEur:
      inputs[rec.key]?.capital && inputs[rec.key]!.capital > 0
        ? inputs[rec.key]!.capital
        : undefined,
    planReturnPct: rec.planReturnPct,
    daysToTarget: rec.daysToTarget,
  });
  return formatMobileGainIdeaShort(idea, lang);
}

export function enrichRecommendationRows(
  recs: MobileDashboardRecRow[],
  sheet: SheetTable | null,
  inputs: InvestSimInputs = {},
  opts?: {
    simTableVersion?: string | null;
    chartPointsByKey?: Map<string, ChartPoint[]>;
    lang?: "it" | "en";
  },
): MobileActionRow[] {
  const byKey = buildSimRowByKeyMap(sheet?.rows ?? []);
  return recs.map((rec) => {
    const row = byKey.get(rec.key);
    const currPriceUsd = rec.currPriceUsd ?? (row ? currentPriceFromRow(row) : null);
    let targetPriceUsd = rec.targetPriceUsd ?? null;
    let targetMode = rec.targetMode ?? null;
    let planReturnPct = rec.planReturnPct ?? null;
    if (
      targetPriceUsd == null &&
      currPriceUsd != null &&
      planReturnPct != null &&
      planReturnPct > 0
    ) {
      targetPriceUsd = currPriceUsd * (1 + planReturnPct / 100);
      targetMode = targetMode ?? "rise";
    }
    const curvePoints =
      rec.curvePoints?.length && rec.curvePoints.length >= 2
        ? rec.curvePoints
        : row
          ? extractRecalibCurvePoints(row)
          : [];
    const completionDate = row ? String(row["Completion Date"] ?? "").trim() || null : null;
    const pos = row ? computeSimulationPosition(row, inputs) : null;
    const targetProgress = computeMobileTargetProgress({
      targetMode,
      targetPriceUsd,
      currPriceUsd,
      planReturnPct,
      buyPriceUsd: pos?.buyPrice ?? null,
      inPortfolio: rec.profile === "portfolio",
    });
    const reading = resolveReadingDelta(rec.key, currPriceUsd);
    const chartPts = opts?.chartPointsByKey?.get(rec.key) ?? null;
    const gainIdea = computeMobileGainIdea({
      row: row ?? undefined,
      chartPoints: chartPts,
      curvePoints: rec.curvePoints,
      capitalEur: pos?.capital && pos.capital > 0 ? pos.capital : undefined,
      planReturnPct: rec.planReturnPct,
      daysToTarget: rec.daysToTarget,
    });
    const gainIdeaText =
      resolveGainIdeaText(rec, row ?? null, chartPts, inputs, opts?.lang ?? "it") ??
      formatMobileGainIdeaShort(gainIdea, opts?.lang ?? "it");
    return {
      ...rec,
      companyName: rec.companyName ?? (row ? companyFromRow(row) : null),
      currPriceUsd,
      gainIdeaText,
      scorePct: rec.scorePct ?? rec.probPct,
      isNew: rec.isNew ?? false,
      eisScore: rec.eisScore ?? null,
      eisHint: rec.eisHint ?? null,
      readingPct: reading.pct ?? rec.readingPct ?? null,
      readingCurrentTs: reading.currentTs ?? null,
      readingSource: reading.source ?? null,
      targetPriceUsd,
      targetMode,
      daysToTarget: gainIdea.days ?? rec.daysToTarget ?? null,
      curvePoints,
      completionDate,
      curveCharts: rec.curveCharts ?? null,
      targetProgressRatio: targetProgress.ratio,
      targetProgressTone: targetProgress.tone,
    };
  });
}

export function filterRecommendationsByProfile(
  rows: MobileActionRow[],
  filter: ActionsProfileFilter,
): MobileActionRow[] {
  if (filter === "all") return rows;
  const profile = filter === "portfolio" ? "portfolio" : "opportunity";
  return rows.filter((r) => r.profile === profile);
}

export function recommendationCounts(rows: MobileActionRow[]) {
  return {
    all: rows.length,
    portfolio: rows.filter((r) => r.profile === "portfolio").length,
    opportunity: rows.filter((r) => r.profile === "opportunity").length,
    new: rows.filter((r) => r.isNew).length,
  };
}

export function recActionToneClass(action: string): string {
  const a = action.toUpperCase();
  if (a === "BUY") return "tone-up";
  if (a === "SELL") return "tone-down";
  if (a === "HOLD" || a === "MANTIENI") return "tone-warn";
  return "";
}

export function fmtUsdPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(v >= 10 ? 2 : 2)}`;
}

export function fmtCompactUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtReadingPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function readingToneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "tone-muted";
  if (pct > 0.05) return "tone-up";
  if (pct < -0.05) return "tone-down";
  return "tone-muted";
}

/** Short company label for narrow mobile columns. */
export function formatCompanyDisplayName(name: string | null | undefined): string {
  if (!name?.trim()) return "—";
  return name
    .trim()
    .replace(/\bTherapeutics\b/gi, "Ther.")
    .replace(/\bPharmaceuticals\b/gi, "")
    .replace(/\bIncorporated\b/gi, "")
    .replace(/,\s*Inc\.?\b/gi, "")
    .replace(/\bInc\.?\b/gi, "")
    .replace(/,\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function eisScoreColor(score: number): string {
  if (score >= 8) return "#16a34a";
  if (score >= 2) return "#65a30d";
  if (score <= -8) return "#dc2626";
  if (score <= -2) return "#ea580c";
  return "#64748b";
}

export function formatEisBadge(score: number | null | undefined): {
  label: string;
  color: string;
  hasScore: boolean;
} {
  if (score == null || !Number.isFinite(score)) {
    return { label: "EIS —", color: "#64748b", hasScore: false };
  }
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";
  return {
    label: `${arrow} EIS ${score >= 0 ? "+" : ""}${score.toFixed(1)}`,
    color: eisScoreColor(score),
    hasScore: true,
  };
}
