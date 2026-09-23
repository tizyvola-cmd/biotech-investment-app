import { useMemo } from "react";
import type { EisSuperScoreState } from "../api/eisSuperScore";
import {
  resolveNearestEisForTicker,
  type CdPatternTickerRecommendation,
} from "../sheet/cdPatternRecommendation";
import { useT } from "../shared/i18n";
import { eisBarPercent, eisColor } from "../sheet/eventImpactScore";
import { buildTickerEisDetail } from "../sheet/tickerEisSummary";
import { ClinicalIndicatorSummaryBlock } from "./ClinicalIndicatorSummary";

export function CdPatternEisPanel({
  ticker,
  completionDate = null,
  sheetClinicalKpi,
  lang = "it",
  eisSuperScoreState,
  onOpenFeed,
  onOpenDetail,
  /** @deprecated Prefer `ticker` + `completionDate`; kept for call sites that still pass `rec`. */
  rec,
}: {
  ticker?: string;
  completionDate?: string | null;
  sheetClinicalKpi?: number | null;
  lang?: "it" | "en";
  eisSuperScoreState?: EisSuperScoreState | null;
  onOpenFeed?: (ticker: string) => void;
  onOpenDetail: () => void;
  rec?: CdPatternTickerRecommendation;
}) {
  const t = useT();
  const it = lang === "it";
  const resolvedTicker = (ticker ?? rec?.ticker ?? "").trim().toUpperCase();
  const resolvedCd = completionDate ?? rec?.completionDate ?? null;

  const eis = useMemo(
    () =>
      resolveNearestEisForTicker({
        patternRec: rec ?? null,
        ticker: resolvedTicker,
        completionDate: resolvedCd,
        lang,
        eisSuperScoreState,
        clinicalKpi: sheetClinicalKpi,
      }),
    [rec, resolvedTicker, resolvedCd, lang, eisSuperScoreState, sheetClinicalKpi],
  );

  const eisDetail = useMemo(
    () => buildTickerEisDetail(resolvedTicker, lang, sheetClinicalKpi),
    [resolvedTicker, lang, sheetClinicalKpi],
  );

  if (!resolvedTicker) return null;

  if (!eis) {
    if (eisDetail.clinicalIndicators.length > 0) {
      return (
        <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/60 p-3 space-y-2 h-full">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("decisionLab.pattern.eis.title")}
          </p>
          <p className="text-[11px] text-ink-muted leading-snug">
            {t("decisionLab.pattern.eis.noEvent")}
          </p>
          <ClinicalIndicatorSummaryBlock
            title={t("decisionLab.pattern.eis.clinicalIndicators")}
            indicators={eisDetail.clinicalIndicators}
            it={it}
            maxShown={4}
          />
          <button
            type="button"
            className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50"
            onClick={onOpenDetail}
          >
            {t("decisionLab.pattern.eis.openDetail")}
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/60 p-3 h-full flex flex-col justify-center">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
          {t("decisionLab.pattern.eis.title")}
        </p>
        <p className="text-[11px] text-ink-muted">{t("decisionLab.pattern.eis.noEvent")}</p>
        <p className="text-[10px] text-ink-muted/80 mt-2 leading-snug">
          {t("decisionLab.pattern.eis.noEventHint")}
        </p>
        <button
          type="button"
          className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50 mt-3 self-start"
          onClick={onOpenDetail}
        >
          {t("decisionLab.pattern.eis.openDetail")}
        </button>
      </div>
    );
  }

  const color = eisColor(eis.score);
  const barW = eisBarPercent(eis.score);
  const sheetOnly = eisDetail.sheetFallback && !eisDetail.events.length;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/60 p-3 space-y-2 h-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("decisionLab.pattern.eis.title")}
          </p>
          <h4 className="text-sm font-semibold text-ink leading-snug mt-0.5">{eis.title}</h4>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {eis.sourceLabel}
            {eis.eventDate ? ` · ${eis.eventDate.slice(0, 10)}` : ""}
            {sheetOnly ? (
              <span className="ml-1 text-amber-700 dark:text-amber-400 font-semibold">
                · {t("decisionLab.pattern.eis.sheetBadge")}
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold tabular-nums" style={{ color: eisColor(eis.superScore ?? eis.score) }}>
            {(eis.superScore ?? eis.score) >= 0 ? "+" : ""}
            {(eis.superScore ?? eis.score).toFixed(0)}
          </p>
          {eis.superScore != null ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              super · EIS {eis.score >= 0 ? "+" : ""}
              {eis.score.toFixed(0)}
            </p>
          ) : null}
          <div className="h-1.5 w-16 rounded-full bg-[rgb(var(--surface-3))] overflow-hidden mt-1 ml-auto">
            <div className="h-full rounded-full" style={{ width: `${barW}%`, background: color }} />
          </div>
        </div>
      </div>

      {eis.summary ? (
        <p className="text-[11px] text-ink-muted leading-snug line-clamp-3">{eis.summary}</p>
      ) : null}

      {eisDetail.clinicalIndicators.length > 0 ? (
        <ClinicalIndicatorSummaryBlock
          title={t("decisionLab.pattern.eis.clinicalIndicators")}
          indicators={eisDetail.clinicalIndicators}
          it={it}
          maxShown={4}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-[10px] tabular-nums">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted/80">{t("decisionLab.pattern.eis.cdDistance")}</p>
          <p className="font-semibold text-ink">{eis.cdDistanceLabel}</p>
          {eis.daysBeforeCd != null ? (
            <p className="text-[9px] text-ink-muted">
              {eis.daysBeforeCd}d {t("decisionLab.pattern.eis.beforeCd")}
            </p>
          ) : null}
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted/80">{t("decisionLab.pattern.eis.moderatedImpact")}</p>
          <p className="font-semibold text-ink">
            {eis.moderatedExpectedPp != null
              ? `${eis.moderatedExpectedPp >= 0 ? "+" : ""}${eis.moderatedExpectedPp.toFixed(1)} pp`
              : "—"}
          </p>
          <p className="text-[9px] text-ink-muted">
            {t("decisionLab.pattern.eis.baseImpact")}{" "}
            {eis.baseExpectedPp != null ? `${eis.baseExpectedPp.toFixed(1)} pp` : "—"} ×{" "}
            {(eis.cdDistanceFactor * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <p className="text-[10px] text-ink-muted leading-snug">{t("decisionLab.pattern.eis.windowHint")}</p>
      <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
        {t("decisionLab.pattern.eis.superScoreTemporal")}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {onOpenFeed ? (
          <button
            type="button"
            className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50"
            onClick={() => onOpenFeed(resolvedTicker)}
          >
            {t("decisionLab.pattern.eis.openFeed")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50"
          onClick={onOpenDetail}
        >
          {t("decisionLab.pattern.eis.openDetail")}
        </button>
        {eis.link ? (
          <a
            href={eis.link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50 inline-flex items-center"
          >
            {t("decisionLab.pattern.eis.openSource")}
          </a>
        ) : null}
      </div>
    </div>
  );
}
