import { useEffect, useMemo, useState } from "react";
import type { DecisionChartTickerRow, DecisionRec } from "../sheet/decisionChartLogic";
import {
  DECISION_REC_ORDER,
  DECISION_REC_ZONE,
  decisionRecLabel,
} from "../sheet/decisionChartLogic";
import type { RecTransitionDisplay } from "../sheet/decisionChartRecHistory";
import type { LossAnalysisScoreSection } from "../sheet/investSimKeys";
import { useLang, useT } from "../shared/i18n";
import { ManualGainStarMark, PortfolioBriefcaseMark, GainStarMarks } from "./PortfolioScopeToggle";
import { RecommendationBreakdown } from "./RecommendationBreakdown";
import { buildRecommendationBreakdownModel } from "../sheet/recommendationContributions";

const REC_BADGE: Record<DecisionRec, string> = {
  buy: "bg-emerald-600",
  hold: "bg-sky-600",
  review: "bg-amber-600",
  sell: "bg-rose-600",
};

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function pnlToneClass(n: number | null | undefined): string {
  if (n != null && n > 0.05) return "text-emerald-700 dark:text-emerald-300";
  if (n != null && n < -0.05) return "text-rose-700 dark:text-rose-300";
  return "text-ink-muted";
}

function TickerBubble({
  row,
  selected,
  onSelect,
  portfolioMarkTitle,
  gainStarTitle,
}: {
  row: DecisionChartTickerRow;
  selected: boolean;
  onSelect: () => void;
  portfolioMarkTitle: string;
  gainStarTitle: string;
}) {
  const t = useT();
  const rescue = row.scores.isRescue;
  const mtm = row.hasPortfolio ? row.pnlPct : null;
  // Portfolio: primary = MTM (same as Piggy Bank total); 24h secondary.
  // Off-portfolio: keep daily % as the only readout.
  const primaryPct = row.hasPortfolio ? mtm : row.pnlPct;
  const dayPct = row.hasPortfolio ? row.pnlPct24h ?? null : null;
  const bubbleTitle = [
    row.diagnostic,
    mtm != null && Number.isFinite(mtm)
      ? `${t("sim.lossAnalysis.decisionChart.pnlMtm")}: ${fmtPct(mtm)}`
      : null,
    dayPct != null && Number.isFinite(dayPct)
      ? `${t("sim.lossAnalysis.summaryTable.var24h")}: ${fmtPct(dayPct)}`
      : !row.hasPortfolio && primaryPct != null && Number.isFinite(primaryPct)
        ? `${t("sim.lossAnalysis.summaryTable.var24h")}: ${fmtPct(primaryPct)}`
        : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`inline-flex flex-col items-center gap-0.5 rounded-lg border px-1.5 py-1 min-w-[52px] transition shadow-sm ${
        selected
          ? "border-amber-400 bg-amber-50/90 ring-2 ring-amber-400/50 dark:bg-amber-900/20"
          : "border-[rgb(var(--border))]/50 bg-white/90 hover:bg-surface/80 hover:border-[rgb(var(--accent))]/40"
      } ${rescue ? "ring-2 ring-rose-500/80" : ""}`}
      title={bubbleTitle}
    >
      <span className="text-[11px] font-medium text-ink leading-none">{row.ticker}</span>
      {row.hasPortfolio || (row.gainStars?.length ?? 0) > 0 ? (
        <span className="inline-flex items-center gap-0.5 leading-none">
          {row.hasPortfolio ? <PortfolioBriefcaseMark title={portfolioMarkTitle} className="text-[9px]" /> : null}
          {row.gainStars?.length ? (
            <GainStarMarks stars={row.gainStars} max={4} sizeClass="text-[8px]" />
          ) : row.manualGainStar ? (
            <ManualGainStarMark title={gainStarTitle} className="text-[8px]" />
          ) : null}
        </span>
      ) : null}
      <span
        className={`text-[9px] font-semibold tabular-nums leading-none inline-flex items-baseline gap-0.5 ${pnlToneClass(primaryPct)}`}
        title={
          row.hasPortfolio
            ? t("sim.lossAnalysis.decisionChart.pnlMtm")
            : t("sim.lossAnalysis.summaryTable.var24hTip")
        }
      >
        {fmtPct(primaryPct)}
        {row.hasPortfolio && primaryPct != null && Number.isFinite(primaryPct) ? (
          <span className="text-[7px] font-normal opacity-75">MTM</span>
        ) : null}
      </span>
      {row.hasPortfolio && dayPct != null && Number.isFinite(dayPct) ? (
        <span
          className={`text-[7px] font-medium tabular-nums leading-none ${pnlToneClass(dayPct)}`}
          title={t("sim.lossAnalysis.summaryTable.var24hTip")}
        >
          {fmtPct(dayPct)} 24h
        </span>
      ) : null}
      {row.insufficientScores ? (
        <span className="text-[7px] text-amber-700 leading-none">?</span>
      ) : null}
    </button>
  );
}

function RecTransitionStrip({
  transitions,
  it,
}: {
  transitions: RecTransitionDisplay[];
  it: boolean;
}) {
  if (!transitions.length) return null;
  return (
    <div className="decision-rec-timeline px-4 pb-2">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
        {it ? "Passaggi zona (ultime 3 settimane)" : "Zone crossings (last 3 weeks)"}
      </p>
      <div className="decision-rec-timeline-track" aria-hidden>
        {transitions.map((tr, i) => (
          <div
            key={`${tr.at}-${i}`}
            className="decision-rec-timeline-mark"
            style={{ left: `${tr.posPct}%` }}
            title={`${tr.from} → ${tr.to} · ${tr.atLabel}`}
          >
            <span className={`decision-rec-timeline-letter decision-rec-timeline-letter--${tr.to}`}>
              {tr.letter}
            </span>
            <span className="decision-rec-timeline-vline" />
            <span className="decision-rec-timeline-date">{tr.atLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  row,
  it,
  onClose,
  onScrollToCard,
  recTransitions = [],
}: {
  row: DecisionChartTickerRow;
  it: boolean;
  onClose: () => void;
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
  recTransitions?: RecTransitionDisplay[];
}) {
  const t = useT();
  const recLabel = decisionRecLabel(row.rec, it);
  const breakdown = useMemo(() => buildRecommendationBreakdownModel(row, it), [row, it]);

  return (
    <div className="decision-detail border-t border-[rgb(var(--border))]/40 bg-surface/30">
      <div className="decision-detail-head px-4 pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-base text-ink">{row.ticker}</strong>
            {row.hasPortfolio ? <PortfolioBriefcaseMark title={t("sim.lossAnalysis.summaryTable.portfolioMark")} /> : null}
            {row.gainStars?.length ? (
              <GainStarMarks stars={row.gainStars} max={4} sizeClass="text-[10px]" />
            ) : null}
            <span className={`text-[10px] font-bold uppercase text-white px-2 py-0.5 rounded ${REC_BADGE[row.rec]}`}>
              {recLabel}
            </span>
          </div>
          {row.company ? (
            <p className="text-[10px] text-ink-muted truncate mt-0.5">{row.company}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] tabular-nums">
            {row.phaseLabel ? <span className="text-ink-muted">{row.phaseLabel}</span> : null}
            {row.hasPortfolio && row.pnlPct24h != null && Number.isFinite(row.pnlPct24h) ? (
              <span
                className={`font-bold ${pnlToneClass(row.pnlPct24h)}`}
                title={t("sim.lossAnalysis.summaryTable.var24hTip")}
              >
                {fmtPct(row.pnlPct24h)}
                <span className="ml-1 text-[9px] font-normal text-ink-muted">24h</span>
              </span>
            ) : null}
            {row.hasPortfolio && row.pnlPct != null && Number.isFinite(row.pnlPct) ? (
              <span className={`font-bold ${pnlToneClass(row.pnlPct)}`}>
                {fmtPct(row.pnlPct)}
                <span className="ml-1 text-[9px] font-normal text-ink-muted">MTM</span>
              </span>
            ) : !row.hasPortfolio ? (
              <span className={`font-bold ${pnlToneClass(row.pnlPct)}`}>{fmtPct(row.pnlPct)}</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="decision-detail-close text-ink-muted hover:text-ink text-xl leading-none px-1"
          onClick={onClose}
          aria-label={it ? "Chiudi" : "Close"}
        >
          ×
        </button>
      </div>

      <RecTransitionStrip transitions={recTransitions} it={it} />

      <RecommendationBreakdown
        {...breakdown}
        it={it}
        row={row}
        onScrollToCard={onScrollToCard}
      />

      {onScrollToCard ? (
        <div className="px-4 pb-3">
          <button
            type="button"
            className="decision-open-charts-btn w-full rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/8 text-[rgb(var(--accent))] text-[11px] font-bold py-2 hover:bg-[rgb(var(--accent))]/12"
            onClick={() => onScrollToCard(row.key)}
          >
            {t("sim.lossAnalysis.decisionChart.openBelow")}
          </button>
          <p className="text-[9px] text-ink-muted mt-1 leading-snug">
            {t("sim.lossAnalysis.decisionChart.curvesHint")}
          </p>
        </div>
      ) : null}

      {row.scores.eisRaw == null ? (
        <p className="text-[9px] text-amber-700 px-4 pb-1">{t("sim.lossAnalysis.decisionChart.eisMissing")}</p>
      ) : null}
      <p className="text-[10px] text-ink-muted px-4 pb-3 leading-snug border-t border-[rgb(var(--border))]/30 pt-2 mx-0">
        {row.diagnostic}
      </p>
      {row.insufficientScores ? (
        <p className="text-[9px] text-amber-700 font-semibold px-4 pb-3">
          {t("sim.lossAnalysis.decisionChart.insufficient")}
        </p>
      ) : null}
    </div>
  );
}

export function DecisionChart({
  rows,
  onScrollToCard,
  highlightedKey = null,
  recTransitionsByKey,
}: {
  rows: DecisionChartTickerRow[];
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
  highlightedKey?: string | null;
  recTransitionsByKey?: Map<string, RecTransitionDisplay[]>;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const portfolioMarkTitle = t("sim.lossAnalysis.summaryTable.portfolioMark");
  const gainStarTitle = t("manualFeed.gainStar.mark");
  const [detailKey, setDetailKey] = useState<string | null>(null);

  useEffect(() => {
    if (highlightedKey) setDetailKey(highlightedKey);
  }, [highlightedKey]);

  const byRec = useMemo(() => {
    const map: Record<DecisionRec, DecisionChartTickerRow[]> = {
      buy: [],
      hold: [],
      review: [],
      sell: [],
    };
    for (const r of rows) map[r.rec].push(r);
    return map;
  }, [rows]);

  const detailRow = useMemo(
    () => (detailKey ? rows.find((r) => r.key === detailKey) ?? null : null),
    [detailKey, rows],
  );
  const detailTransitions = useMemo(
    () => (detailKey ? recTransitionsByKey?.get(detailKey) ?? [] : []),
    [detailKey, recTransitionsByKey],
  );

  if (!rows.length) return null;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 shadow-sm overflow-hidden">
      <div className="px-4 py-2 border-b border-[rgb(var(--border))]/30 bg-surface/40">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {it ? "Grafico decisionale" : "Decision chart"}
        </p>
        <p className="text-[10px] text-ink-muted/80 mt-0.5">
          {t("sim.lossAnalysis.decisionChart.hint")}
        </p>
      </div>

      <div className="mx-3 my-3 rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden divide-y divide-[rgb(var(--border))]/55">
        {DECISION_REC_ORDER.map((rec) => {
          const zone = DECISION_REC_ZONE[rec];
          const zoneRows = byRec[rec];
          return (
            <section key={rec} className={`border-l-4 ${zone.border} ${zone.bg}`}>
              <div
                className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${zone.divider} bg-white/35 dark:bg-black/10`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${zone.badge}`}
                  >
                    {it ? zone.labelIt : zone.labelEn}
                  </span>
                  <span className="text-[10px] text-ink-muted tabular-nums">
                    {zoneRows.length}{" "}
                    {it
                      ? zoneRows.length === 1
                        ? "azienda"
                        : "aziende"
                      : zoneRows.length === 1
                        ? "company"
                        : "companies"}
                  </span>
                </div>
                <span className="text-[10px] font-semibold tabular-nums text-ink-muted shrink-0">
                  ({zoneRows.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2.5 min-h-[52px]">
                {zoneRows.length ? (
                  zoneRows.map((r) => (
                    <TickerBubble
                      key={r.key}
                      row={r}
                      selected={detailKey === r.key || highlightedKey === r.key}
                      onSelect={() => {
                        // Click toggles the detail panel (spectrum + Setup/Risk
                        // bars + swing + open-below). "Apri sotto" jumps to the
                        // Top KPI row — separate from in-place score inspection.
                        setDetailKey((prev) => (prev === r.key ? null : r.key));
                      }}
                      portfolioMarkTitle={portfolioMarkTitle}
                      gainStarTitle={gainStarTitle}
                    />
                  ))
                ) : (
                  <span className="text-[10px] text-ink-muted/70 px-1 py-2">—</span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {detailRow ? (
        <DetailPanel
          row={detailRow}
          it={it}
          onClose={() => setDetailKey(null)}
          onScrollToCard={onScrollToCard}
          recTransitions={detailTransitions}
        />
      ) : null}
    </div>
  );
}
