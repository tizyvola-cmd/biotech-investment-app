import { useMemo, useState } from "react";
import { FeedPanel, SegToggle } from "./MobileUi";
import { MobileCurveChartsSheet } from "./MobileCurveChartsSheet";
import { MobileEisSheet } from "./MobileEisSheet";
import { MobileRecalibSparkline } from "./MobileRecalibSparkline";
import { MobileTargetDistanceDonut } from "./MobileTargetDistanceDonut";
import { useMobileLang } from "../hooks/useMobileLang";
import type { I18nKey } from "../i18n";
import type { MobileActionRow, ActionsProfileFilter } from "../mobileActionsTable";
import type { InvestSimInputs, SheetTable } from "../types";
import {
  filterRecommendationsByProfile,
  fmtCompactUsd,
  fmtReadingPct,
  fmtUsdPrice,
  formatCompanyDisplayName,
  formatEisBadge,
  readingToneClass,
  recActionToneClass,
  recommendationCounts,
} from "../mobileActionsTable";

type Props = {
  rows: MobileActionRow[];
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  onOpenDetail: (key: string) => void;
};

type EisDrawer = { ticker: string; eisScore: number | null; eisHint: string | null };

type CurveDrawer = {
  row: MobileActionRow;
};

function readingCellTitle(
  row: MobileActionRow,
  t: (key: I18nKey) => string,
): string | undefined {
  if (row.readingSource === "last_read") return t("dashboard.actions.lastReadLocalTip");
  if (row.readingSource === "market_close") return t("dashboard.actions.lastReadMarketCloseTip");
  return undefined;
}

export function MobileActionsTable({ rows, sheet, inputs, onOpenDetail }: Props) {
  const { t } = useMobileLang();
  const [profileFilter, setProfileFilter] = useState<ActionsProfileFilter>("all");
  const [eisDrawer, setEisDrawer] = useState<EisDrawer | null>(null);
  const [curveDrawer, setCurveDrawer] = useState<CurveDrawer | null>(null);
  const counts = useMemo(() => recommendationCounts(rows), [rows]);
  const filtered = useMemo(
    () => filterRecommendationsByProfile(rows, profileFilter),
    [rows, profileFilter],
  );

  const subtitle =
    counts.new > 0
      ? t("dashboard.actions.subWithNew", { n: counts.all, new: counts.new })
      : t("dashboard.actions.subCount", { n: counts.all });

  return (
    <FeedPanel title={t("dashboard.actions.title")} subtitle={subtitle}>
      <div className="actions-filter-row">
        <SegToggle
          value={profileFilter}
          onChange={setProfileFilter}
          options={[
            { id: "all", label: t("dashboard.actions.filterAll"), badge: counts.all },
            { id: "portfolio", label: t("dashboard.actions.filterPortfolio"), badge: counts.portfolio },
            { id: "opportunity", label: t("dashboard.actions.filterOpp"), badge: counts.opportunity },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="hint">{t("dashboard.actions.empty")}</p>
      ) : (
        <div className="actions-table-wrap">
          <table className="actions-table">
            <thead>
              <tr>
                <th>{t("dashboard.actions.colCompany")}</th>
                <th className="actions-curve-h">{t("dashboard.actions.colCurve")}</th>
                <th className="actions-rec-h">{t("dashboard.actions.colRec")}</th>
                <th>{t("dashboard.actions.colEis")}</th>
                <th>{t("dashboard.actions.colLastRead")}</th>
                <th>{t("dashboard.actions.colPrice")}</th>
                <th>{t("dashboard.actions.colTarget")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const eis = formatEisBadge(row.eisScore);
                return (
                <tr
                  key={row.key}
                  className={row.isNew ? "actions-row-new" : undefined}
                  onClick={() => onOpenDetail(row.key)}
                >
                  <td className="actions-company">
                    <span className="actions-company-name">
                      {formatCompanyDisplayName(row.companyName)}
                    </span>
                    <span className="actions-company-ticker">{row.ticker}</span>
                  </td>
                  <td className="actions-curve" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="actions-curve-btn"
                      aria-label={t("curve.openCharts", { ticker: row.ticker })}
                      onClick={() => setCurveDrawer({ row })}
                    >
                      <MobileRecalibSparkline
                        points={row.curvePoints}
                        completionDate={row.completionDate}
                        todayOffset={row.curveCharts?.todayOffset ?? null}
                        daysToCd={row.daysToCd}
                      />
                    </button>
                    <button
                      type="button"
                      className="actions-curve-link"
                      onClick={() => setCurveDrawer({ row })}
                    >
                      {t("curve.details")} →
                    </button>
                  </td>
                  <td className="actions-rec">
                    <span className={`actions-action ${recActionToneClass(row.action)}`}>{row.action}</span>
                    {row.scorePct != null ? (
                      <span className="actions-score">{Math.round(row.scorePct)}%</span>
                    ) : null}
                    {row.gainIdeaText && row.gainIdeaText !== "—" ? (
                      <span className="actions-gain">{row.gainIdeaText}</span>
                    ) : null}
                  </td>
                  <td
                    className="actions-eis"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={`actions-eis-badge-btn ${eis.hasScore ? "" : "actions-eis-badge-muted"}`}
                      style={
                        eis.hasScore
                          ? { color: eis.color, borderColor: `${eis.color}66`, background: `${eis.color}18` }
                          : undefined
                      }
                      onClick={() =>
                        setEisDrawer({
                          ticker: row.ticker,
                          eisScore: row.eisScore,
                          eisHint: row.eisHint,
                        })
                      }
                    >
                      {eis.label}
                    </button>
                    <button
                      type="button"
                      className="actions-eis-link"
                      onClick={() =>
                        setEisDrawer({
                          ticker: row.ticker,
                          eisScore: row.eisScore,
                          eisHint: row.eisHint,
                        })
                      }
                    >
                      {t("dashboard.actions.eisDetails")} →
                    </button>
                  </td>
                  <td
                    className={`actions-reading ${readingToneClass(row.readingPct)}`}
                    title={readingCellTitle(row, t)}
                  >
                    <span className="actions-reading-pct">{fmtReadingPct(row.readingPct)}</span>
                    {row.readingCurrentTs ? (
                      <span className="actions-reading-ts">
                        {new Date(row.readingCurrentTs).toLocaleString(undefined, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="actions-price">{fmtUsdPrice(row.currPriceUsd)}</td>
                  <td className="actions-target">
                    <span className="actions-target-inner">
                      {row.targetMode === "fall" ? (
                        <span className="actions-target-fall">↓</span>
                      ) : row.targetPriceUsd != null ? (
                        <span className="actions-target-price tone-up">
                          {fmtCompactUsd(row.targetPriceUsd)}
                        </span>
                      ) : (
                        <span className="actions-target-muted">~</span>
                      )}
                      {row.targetMode === "rise" && row.targetPriceUsd != null ? (
                        <MobileTargetDistanceDonut
                          ratio={row.targetProgressRatio}
                          tone={row.targetProgressTone}
                          size={20}
                        />
                      ) : null}
                      {row.daysToTarget != null && row.daysToTarget > 0 ? (
                        <span className="actions-target-days">{row.daysToTarget}d</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MobileCurveChartsSheet
        open={curveDrawer != null}
        ticker={curveDrawer?.row.ticker ?? null}
        companyName={curveDrawer?.row.companyName ?? null}
        rowKey={curveDrawer?.row.key ?? null}
        charts={curveDrawer?.row.curveCharts}
        sheet={sheet}
        inputs={inputs}
        daysToCd={curveDrawer?.row.daysToCd ?? null}
        planReturnPct={curveDrawer?.row.planReturnPct ?? null}
        hasPosition={curveDrawer?.row.profile === "portfolio"}
        completionDate={curveDrawer?.row.completionDate ?? null}
        onClose={() => setCurveDrawer(null)}
      />

      <MobileEisSheet
        open={eisDrawer != null}
        ticker={eisDrawer?.ticker ?? null}
        eisScore={eisDrawer?.eisScore ?? null}
        eisHint={eisDrawer?.eisHint ?? null}
        onClose={() => setEisDrawer(null)}
      />
    </FeedPanel>
  );
}
