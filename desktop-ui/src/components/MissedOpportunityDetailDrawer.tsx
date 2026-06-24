import { useMemo } from "react";
import type { CdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import type { MissedOppRow } from "../sheet/missedOpportunityAudit";
import {
  buildAxisGapsFromPattern,
  type MissedOppAxisGap,
} from "../sheet/missedOpportunityCalibration";
import {
  FWD_ENTRY_MIN,
  isForwardBelowEntryThreshold,
} from "../sheet/recoveryProbability";
import { CdPatternWithEisSection } from "./CdPatternWithEisSection";
import { useT } from "../shared/i18n";

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function AxisGapTable({ gaps }: { gaps: MissedOppAxisGap[] }) {
  const t = useT();
  if (!gaps.length) return null;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden">
      <div className="px-3 py-2 bg-surface/40 border-b border-[rgb(var(--border))]/40">
        <h4 className="text-xs font-semibold">{t("modelLab.missedOpp.axisGapTitle")}</h4>
        <p className="text-[10px] text-ink-muted">{t("modelLab.missedOpp.axisGapSub")}</p>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-ink-muted border-b border-[rgb(var(--border))]/30">
            <th className="py-1.5 px-2 font-medium text-left">{t("modelLab.missedOpp.axisCol")}</th>
            <th className="py-1.5 px-2 font-medium text-right">{t("modelLab.missedOpp.currentCol")}</th>
            <th className="py-1.5 px-2 font-medium text-right">{t("modelLab.missedOpp.targetCol")}</th>
            <th className="py-1.5 px-2 font-medium text-right">{t("modelLab.missedOpp.gapCol")}</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr
              key={g.id}
              className={`border-b border-[rgb(var(--border))]/20 ${
                g.belowThreshold ? "bg-[rgb(var(--warn))]/6" : ""
              }`}
            >
              <td className="py-1.5 px-2 font-medium">{g.label}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">
                {g.current}
                {g.rawValue != null ? (
                  <span className="text-[9px] text-ink-muted ml-1">
                    ({g.rawValue}{g.unit})
                  </span>
                ) : null}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">{g.target}</td>
              <td
                className={`py-1.5 px-2 text-right tabular-nums font-medium ${
                  g.gapPct > 15
                    ? "text-[rgb(var(--signal-down))]"
                    : g.gapPct > 5
                      ? "text-[rgb(var(--warn))]"
                      : "text-ink-muted"
                }`}
              >
                −{g.gapPct}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MissedOpportunityDetailDrawer({
  open,
  row,
  patternRec,
  onClose,
}: {
  open: boolean;
  row: MissedOppRow | null;
  patternRec: CdPatternTickerRecommendation | null;
  onClose: () => void;
}) {
  const t = useT();

  const axisGaps = useMemo(
    () => (patternRec ? buildAxisGapsFromPattern(patternRec.axes) : []),
    [patternRec],
  );

  if (!open || !row) return null;

  const showForwardTooLowBadge = isForwardBelowEntryThreshold(row.planReturnPct, {
    inLoss: false,
    matchPct: row.matchPct,
    dailyPct24h: row.dailyPct24h,
    daysToCd: row.daysToCd,
    sdsScore: null,
    eisSuperScore:
      patternRec?.nearestEis?.superScore ?? patternRec?.nearestEis?.score ?? null,
  });

  return (
    <div
      className="fixed inset-0 z-[75] flex items-stretch justify-end bg-black/50"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl sm:max-w-2xl h-full bg-surface border-l border-[rgb(var(--border))]/60 shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/50 bg-surface/80">
          <div>
            <h3 className="text-base font-bold text-ink">
              {row.ticker}
              {row.company ? (
                <span className="text-sm font-normal text-ink-muted ml-2">{row.company}</span>
              ) : null}
            </h3>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {t("modelLab.missedOpp.detailLead", {
                pct: fmtPct(row.dailyPct24h),
                prob: row.probPct != null ? `${row.probPct.toFixed(0)}%` : "—",
              })}
            </p>
            {showForwardTooLowBadge ? (
              <span className="inline-flex items-center mt-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                {t("sim.lossAnalysis.badge.forwardTooLow", {
                  min: String(FWD_ENTRY_MIN),
                })}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-[rgb(var(--border))]/60 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted text-[9px] uppercase">24h</p>
              <p className="font-bold tabular-nums text-[rgb(var(--signal-up))]">{fmtPct(row.dailyPct24h)}</p>
            </div>
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted text-[9px] uppercase">P(plan)</p>
              <p className="font-bold tabular-nums">{row.probPct != null ? `${row.probPct.toFixed(0)}%` : "—"}</p>
            </div>
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted text-[9px] uppercase">Target</p>
              <p className="font-bold tabular-nums">{fmtPct(row.planReturnPct)}</p>
            </div>
            <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted text-[9px] uppercase">Match</p>
              <p className="font-bold tabular-nums">{row.matchPct != null ? `${Math.round(row.matchPct)}%` : "—"}</p>
            </div>
          </div>

          {row.blockers.length ? (
            <div className="rounded-lg border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/6 px-3 py-2">
              <p className="text-[10px] font-semibold text-[rgb(var(--warn))] mb-1">
                {t("modelLab.missedOpp.detailBlockers")}
              </p>
              <ul className="text-[11px] text-ink-muted space-y-0.5 list-disc pl-4">
                {row.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {patternRec ? (
            <>
              <CdPatternWithEisSection rec={patternRec} inPortfolio={row.inPortfolio} />
              <AxisGapTable gaps={axisGaps} />
            </>
          ) : (
            <p className="text-xs text-ink-muted text-center py-4">{t("modelLab.missedOpp.noPattern")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
