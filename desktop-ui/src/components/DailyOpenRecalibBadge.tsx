import type { ChartPoint } from "../types";
import {
  computeDailyRecalibSummary,
  dailyRecalibAnchorSourceLabel,
  type DailyRecalibSummary,
} from "../sheet/predictionCurveDailyRecalib";
import { useLang, useT } from "../shared/i18n";

function fmtShift(pp: number | null): string {
  if (pp == null || !Number.isFinite(pp)) return "—";
  const sign = pp >= 0 ? "+" : "";
  return `${sign}${pp.toFixed(2)} pp`;
}

function fmtRefresh(iso: string | null, lang: "it" | "en"): string {
  if (!iso?.trim()) return lang === "it" ? "non disponibile" : "n/a";
  const d = iso.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-");
    return lang === "it" ? `${day}/${m}/${y}` : d;
  }
  return iso.trim();
}

function badgeTone(summary: DailyRecalibSummary): string {
  if (summary.anchorSource === "none") {
    return "border-[rgb(var(--border))]/50 text-ink-muted bg-surface-elevated/40";
  }
  if (summary.applied) {
    return "border-[rgb(var(--accent))]/45 text-accent bg-[rgb(var(--accent))]/[0.07]";
  }
  return "border-[rgb(var(--border))]/50 text-ink-muted bg-surface-elevated/40";
}

export function DailyOpenRecalibBadge({
  ticker,
  points,
  row,
  compact,
}: {
  ticker: string;
  points: ChartPoint[] | null | undefined;
  row: Record<string, unknown> | null | undefined;
  compact?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();

  const summary = computeDailyRecalibSummary(points, row);
  if (!row || !points?.length) return null;

  const sourceLabel = dailyRecalibAnchorSourceLabel(summary.anchorSource, lang);
  const refreshLabel = fmtRefresh(summary.refreshAt, lang);
  const tone = badgeTone(summary);

  if (compact) {
    return (
      <p
        className={`text-[10px] px-2 py-1 rounded-md border tabular-nums ${tone}`}
        title={t("charts.recalib.badgeTip")}
      >
        <span className="font-semibold">{ticker}</span>
        {" · "}
        {summary.applied ? fmtShift(summary.shiftPp) : t("charts.recalib.noShift")}
        {" · "}
        {sourceLabel}
        {" · "}
        {refreshLabel}
      </p>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-[11px] leading-snug ${tone}`}
      title={t("charts.recalib.badgeTip")}
    >
      <p className="font-semibold">
        {t("charts.recalib.title")}
        {summary.applied ? (
          <>
            {" "}
            <span className="tabular-nums">{fmtShift(summary.shiftPp)}</span>
          </>
        ) : (
          <span className="font-normal text-ink-muted">
            {" "}
            — {t("charts.recalib.noShift")}
          </span>
        )}
      </p>
      <p className="text-[10px] mt-0.5 opacity-90 tabular-nums">
        {t("charts.recalib.anchor")}: {sourceLabel}
        {summary.anchorPriceUsd != null && (
          <>
            {" "}
            · ${summary.anchorPriceUsd.toFixed(2)}
          </>
        )}
        {summary.liveTodayPct != null && (
          <>
            {" "}
            · {t("charts.recalib.livePct")}{" "}
            {summary.liveTodayPct >= 0 ? "+" : ""}
            {summary.liveTodayPct.toFixed(2)}%
          </>
        )}
        {summary.modelTodayPct != null && (
          <>
            {" "}
            · {t("charts.recalib.modelPct")}{" "}
            {summary.modelTodayPct >= 0 ? "+" : ""}
            {summary.modelTodayPct.toFixed(2)}%
          </>
        )}
      </p>
      <p className="text-[10px] mt-0.5 opacity-75">
        {t("charts.recalib.refresh")}: {refreshLabel}
      </p>
    </div>
  );
}
