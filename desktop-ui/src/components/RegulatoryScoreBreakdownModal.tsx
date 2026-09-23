import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import {
  buildRegulatoryScoreBreakdown,
  formatRegulatoryImpactDisplay,
  formatRegulatoryScoreDisplay,
  regulatoryImpactColorClass,
  regulatoryScoreSummaryLabel,
  type RegulatoryRiskIndex,
  type RegulatoryScoreBreakdownItemId,
} from "../sheet/regulatoryRiskIndex";
import { eisColor } from "../sheet/eventImpactScore";
import { useT, type TranslationKey } from "../shared/i18n";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { RegulatoryBreakdownEventRow } from "./EisEventRichSnippet";

export type RegulatoryScoreBreakdownPayload = {
  ticker: string;
  riskScore: number;
  index: RegulatoryRiskIndex;
  clinicalPhase?: string | null;
  cleanScan?: boolean;
  isMedtech?: boolean;
  regulatoryEvents?: TickerEisEventDetail[];
};

function fmtContribution(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function RegulatoryScoreBreakdownModal({
  payload,
  it,
  onClose,
}: {
  payload: RegulatoryScoreBreakdownPayload | null;
  it: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const lang = it ? "it" : "en";

  if (!payload) return null;

  const breakdown = buildRegulatoryScoreBreakdown(payload.index, {
    clinicalPhase: payload.clinicalPhase,
    cleanScan: payload.cleanScan,
    isMedtech: payload.isMedtech,
  });
  const eventSum =
    payload.regulatoryEvents?.length
      ? Math.round(
          payload.regulatoryEvents.reduce((s, ev) => s + ev.breakdown.score, 0) * 10,
        ) / 10
      : null;

  const itemLabel = (id: RegulatoryScoreBreakdownItemId): string =>
    t(`regulatoryScore.breakdown.item.${id}`);

  const detailLine = (id: RegulatoryScoreBreakdownItemId, raw: string): string => {
    const key = `regulatoryScore.breakdown.detail.${id}.${raw}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : raw;
  };

  return (
    <AppModal
      open
      onClose={onClose}
      aria-label={t("regulatoryScore.breakdown.title")}
      panelClassName="w-[min(94vw,720px)]"
    >
      <div className="card w-full max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
              {t("regulatoryScore.breakdown.title")}
            </p>
            <h3 className="text-sm font-bold text-ink mt-0.5">{payload.ticker}</h3>
            <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
              {t("regulatoryScore.breakdown.subtitle")}
            </p>
          </div>
          <div className="flex items-start gap-2 shrink-0">
            <div className="text-right">
              <span
                className={`text-lg font-black tabular-nums ${regulatoryImpactColorClass(breakdown.riskScore)}`}
              >
                {formatRegulatoryImpactDisplay(breakdown.riskScore)}
              </span>
              <p className="text-[9px] text-ink-muted mt-0.5">
                {t("regulatoryScore.breakdown.impactLabel")}
              </p>
              <p className="text-[10px] text-ink-muted leading-snug max-w-[9rem]">
                {regulatoryScoreSummaryLabel(breakdown.riskScore, lang)}
              </p>
            </div>
            <AppModalCloseButton onClose={onClose} />
          </div>
        </header>

        <div className="px-4 py-3 space-y-3 overflow-y-auto min-h-0">
          <p className="text-[11px] text-ink-muted leading-relaxed">
            {t("regulatoryScore.breakdown.formulaHint")}
          </p>

          {breakdown.items.length > 0 ? (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold mb-1.5">
                {t("regulatoryScore.breakdown.componentsTitle")}
              </p>
              <div className="rounded border border-[rgb(var(--border))]/50 overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-[rgb(var(--surface-2))]/80 text-ink-muted">
                    <tr>
                      <th className="text-left font-semibold px-2 py-1.5">
                        {t("regulatoryScore.breakdown.colComponent")}
                      </th>
                      <th className="text-right font-semibold px-2 py-1.5 w-16">
                        {t("regulatoryScore.breakdown.colPts")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-[rgb(var(--border))]/30 align-top"
                      >
                        <td className="px-2 py-1.5">
                          <p className="font-semibold text-ink">{itemLabel(item.id)}</p>
                          {item.details.length > 0 ? (
                            <ul className="text-ink-muted mt-0.5 space-y-0.5">
                              {item.details.map((d, i) => (
                                <li key={i} className="line-clamp-3">
                                  {detailLine(item.id, d)}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right font-bold tabular-nums ${
                            item.contribution > 0
                              ? "text-[rgb(var(--signal-down))]"
                              : item.contribution < 0
                                ? "text-[rgb(var(--signal-up))]"
                                : "text-ink-muted"
                          }`}
                        >
                          {fmtContribution(item.contribution)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/40 font-semibold">
                      <td className="px-2 py-1.5 text-ink">
                        {t("regulatoryScore.breakdown.totalRisk")}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                        {formatRegulatoryScoreDisplay(breakdown.riskScore)}
                        {breakdown.clamped ? (
                          <span
                            className="block text-[9px] font-normal text-ink-muted"
                            title={t("regulatoryScore.breakdown.clampedHint")}
                          >
                            {t("regulatoryScore.breakdown.clamped")}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    <tr className="border-t border-[rgb(var(--border))]/30">
                      <td className="px-2 py-1.5 text-ink-muted">
                        {t("regulatoryScore.breakdown.impactRow")}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-bold tabular-nums ${regulatoryImpactColorClass(breakdown.riskScore)}`}
                      >
                        {formatRegulatoryImpactDisplay(breakdown.riskScore)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-ink-muted mt-1.5 leading-snug">
                {breakdown.path === "active_risk"
                  ? t("regulatoryScore.breakdown.pathActiveRisk")
                  : t("regulatoryScore.breakdown.pathFavorable")}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted">{t("regulatoryScore.breakdown.noComponents")}</p>
          )}

          {payload.regulatoryEvents && payload.regulatoryEvents.length > 0 ? (
            <div className="border-t border-[rgb(var(--border))]/40 pt-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                {t("regulatoryScore.breakdown.newsSectionTitle")}
              </p>
              <p className="text-[10px] text-ink-muted leading-snug">
                {t("regulatoryScore.breakdown.newsSectionHint")}
              </p>
              <p className="text-[10px] text-ink-muted/90 leading-snug">
                {t("regulatoryScore.breakdown.newsDetailHint")}
              </p>
              <ul className="space-y-1.5">
                {payload.regulatoryEvents.map((ev, i) => (
                  <RegulatoryBreakdownEventRow
                    key={`${ev.eventDate}-${ev.title}-${i}`}
                    ev={ev}
                    it={it}
                  />
                ))}
              </ul>
              {eventSum != null ? (
                <p className="text-[10px] text-ink-muted">
                  {t("decisionLab.pattern.eis.impactOverview.regEventSum")}{" "}
                  <span className="font-bold tabular-nums" style={{ color: eisColor(eventSum) }}>
                    {eventSum >= 0 ? "+" : ""}
                    {eventSum.toFixed(1)}
                  </span>
                  {" · "}
                  {t("regulatoryScore.breakdown.newsNotInIndex")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-[rgb(var(--border))]/40 px-4 py-2 flex justify-end shrink-0">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            {t("manualFeed.detail.close")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
