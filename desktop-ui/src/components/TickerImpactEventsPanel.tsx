import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ClinicalPreCdRecord, RegulatoryRiskSnapshot } from "../api/supernova";
import { buildTickerEisDetail, cumulativeTickerEisScore } from "../sheet/tickerEisSummary";
import {
  classifyTickerEisEvent,
  impactKindBadge,
  partitionTickerEisEvents,
  pickEisLaneEvents,
  pickLatestEisNewsEvents,
  resolveEisBannerDualScores,
  sortEventsByImpact,
} from "../sheet/tickerImpactEvents";
import type { TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { EisEventDetailModal } from "./EisEventDetailModal";
import { eisBarPercent, eisColor } from "../sheet/eventImpactScore";
import {
  formatRegulatoryImpactDisplay,
  regulatoryImpactColorClass,
  regulatoryScoreSummaryLabel,
} from "../sheet/regulatoryRiskIndex";
import { resolveRegulatoryRiskBundleForTicker } from "../sheet/decisionChartBuild";
import { clinicalPhaseFromSimRow } from "../sheet/simRowClinicalMeta";
import { isMedtechTicker } from "../sheet/medtechSymbols";
import { normalizeExternalHref } from "../sheet/k8ChartLinks";
import { nctClinicalTrialsUrl } from "../sheet/cellLinks";
import { useT } from "../shared/i18n";
import { formatMarketCap } from "../finance/financialRow";
import { ClinicalIndicatorChips, ClinicalIndicatorSummaryBlock } from "./ClinicalIndicatorSummary";
import { EisStudyContextHeader, NctStudyLink } from "./EisStudyContextHeader";
import { useTickerGuidanceEvents } from "./TickerCatalystEventsTable";
import {
  ManualNewsDetailModal,
  type ManualNewsDetailPayload,
} from "./ManualNewsDetailModal";
import {
  RegulatoryScoreBreakdownModal,
  type RegulatoryScoreBreakdownPayload,
} from "./RegulatoryScoreBreakdownModal";

function fmtShortDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function fmtSignedEis(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

/** Prefer article link → study URL → ClinicalTrials.gov from NCT. */
function resolveEisEventHref(ev: TickerEisEventDetail): string | null {
  return (
    normalizeExternalHref(ev.link) ||
    normalizeExternalHref(ev.studyUrl) ||
    (ev.nctId ? nctClinicalTrialsUrl(ev.nctId) : null)
  );
}

function ImpactEventRow({
  ev,
  it,
  dense = false,
  ticker,
  onManualDetail,
}: {
  ev: TickerEisEventDetail;
  it: boolean;
  dense?: boolean;
  ticker?: string;
  onManualDetail?: (payload: ManualNewsDetailPayload) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const kind = classifyTickerEisEvent(ev);
  const badge = impactKindBadge(kind, it);
  const clinTax =
    ev.clinicalScore != null && Number.isFinite(ev.clinicalScore) ? ev.clinicalScore : null;
  const finTax =
    ev.financialScore != null && Number.isFinite(ev.financialScore) ? ev.financialScore : null;
  const accTax =
    ev.marketAccessScore != null && Number.isFinite(ev.marketAccessScore)
      ? ev.marketAccessScore
      : null;
  const href = resolveEisEventHref(ev);
  const isManual = ev.sourceType.toLowerCase() === "manual";

  const openManualDetail = () => {
    onManualDetail?.({
      ticker,
      eventDate: ev.eventDate,
      title: ev.title,
      body: ev.summary?.trim() || ev.title,
      source: ev.sourceLabel,
      link: href ?? ev.link,
      eisScore: clinTax ?? ev.breakdown.score,
    });
  };

  // Rows show only title + scores; summary, KPI detail and the external link
  // live in the detail modal.
  const openTitle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isManual) {
      openManualDetail();
      return;
    }
    setDetailOpen(true);
  };

  return (
    <li
      className={`flex items-center gap-1.5 rounded border border-[rgb(var(--border))]/35 bg-white/40 dark:bg-black/10${
        dense ? " px-1.5 py-1" : " px-2 py-1.5"
      }`}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className={`text-left font-medium text-[rgb(var(--accent))] hover:underline underline-offset-2 leading-snug w-full line-clamp-2${
            dense ? " text-[10px]" : " text-[11px]"
          }`}
          title={it ? "Clicca per leggere la news" : "Click to read the news"}
          onClick={openTitle}
        >
          {ev.title}
        </button>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[8px] font-semibold px-1 rounded ${badge.className}`}>
            {badge.label}
          </span>
          <span className="text-[8px] text-ink-muted tabular-nums">
            {fmtShortDate(ev.eventDate, it)}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right min-w-[3.25rem] space-y-0.5">
        <p
          className={`font-bold tabular-nums leading-none${dense ? " text-[11px]" : " text-[12px]"}`}
          style={{
            color: clinTax != null ? eisColor(clinTax) : "rgb(var(--ink-muted))",
          }}
          title={it ? "Score Clinical (tassonomia)" : "Clinical taxonomy score"}
        >
          Clin {fmtSignedEis(clinTax)}
        </p>
        {finTax != null && Math.abs(finTax) >= 0.15 ? (
          <p
            className="font-semibold tabular-nums text-[10px] leading-none"
            style={{ color: eisColor(finTax) }}
            title={it ? "Score Financial" : "Financial score"}
          >
            Fin {fmtSignedEis(finTax)}
          </p>
        ) : null}
        {accTax != null && Math.abs(accTax) >= 0.15 ? (
          <p
            className="font-semibold tabular-nums text-[10px] leading-none"
            style={{ color: eisColor(accTax) }}
            title={it ? "Score Access" : "Access score"}
          >
            Acc {fmtSignedEis(accTax)}
          </p>
        ) : null}
      </div>
      {detailOpen ? (
        <EisEventDetailModal
          ev={ev}
          ticker={ticker}
          it={it}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </li>
  );
}

function fmtFeedUpdated(iso: string | null | undefined, it: boolean): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(it ? "it-IT" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

function sumEventScores(events: TickerEisEventDetail[]): number | null {
  if (!events.length) return null;
  const total = events.reduce((s, ev) => s + ev.breakdown.score, 0);
  return Math.round(total * 10) / 10;
}

function RegScoreDisplay({
  score,
  compact = false,
  onClick,
  clickTitle,
}: {
  score: number;
  compact?: boolean;
  onClick?: () => void;
  clickTitle?: string;
}) {
  const cls = `font-bold tabular-nums leading-none shrink-0 ${regulatoryImpactColorClass(score)} ${
    compact ? "text-sm" : "text-sm"
  }`;
  const content = formatRegulatoryImpactDisplay(Math.round(score * 10) / 10);
  if (onClick) {
    return (
      <button
        type="button"
        className={`${cls} hover:underline underline-offset-2 cursor-pointer`}
        onClick={onClick}
        title={clickTitle ?? ""}
      >
        {content}
      </button>
    );
  }
  return <span className={cls}>{content}</span>;
}

function ScoreLanePanel({
  label,
  score,
  events,
  emptyLabel,
  it,
  scoreKind = "eis",
  ticker,
  onManualDetail,
  onOpenRegBreakdown,
  summaryOnly = false,
  onViewAllDetail,
}: {
  label: string;
  score: number | null | undefined;
  events: TickerEisEventDetail[];
  emptyLabel: string;
  it: boolean;
  /** EIS market-reaction vs bidirectional regulatory risk index (−100…+100). */
  scoreKind?: "eis" | "regRisk";
  ticker?: string;
  onManualDetail?: (payload: ManualNewsDetailPayload) => void;
  onOpenRegBreakdown?: () => void;
  /** When true, show only the score summary header and a link to detail — no inline event rows. */
  summaryOnly?: boolean;
  /** Callback when the user clicks "view all detail" in summaryOnly mode. */
  onViewAllDetail?: () => void;
}) {
  const t = useT();
  const hasScore = score != null && Number.isFinite(score);
  const eventSum = scoreKind === "regRisk" ? sumEventScores(events) : null;
  const clinSum =
    scoreKind === "eis"
      ? (() => {
          let s = 0;
          let n = 0;
          for (const ev of events) {
            const v = ev.clinicalScore;
            if (v == null || !Number.isFinite(v)) continue;
            s += v;
            n += 1;
          }
          return n > 0 ? Math.round(s * 10) / 10 : null;
        })()
      : null;
  const finSum =
    scoreKind === "eis"
      ? (() => {
          let s = 0;
          let n = 0;
          for (const ev of events) {
            const v = ev.financialScore;
            if (v == null || !Number.isFinite(v)) continue;
            s += v;
            n += 1;
          }
          return n > 0 ? Math.round(s * 10) / 10 : null;
        })()
      : null;
  const accSum =
    scoreKind === "eis"
      ? (() => {
          let s = 0;
          let n = 0;
          for (const ev of events) {
            const v = ev.marketAccessScore;
            if (v == null || !Number.isFinite(v)) continue;
            s += v;
            n += 1;
          }
          return n > 0 ? Math.round(s * 10) / 10 : null;
        })()
      : null;
  const lang = it ? "it" : "en";

  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-black/10 p-1.5 min-w-0 flex flex-col gap-1 h-full">
      <div className="flex items-start justify-between gap-1 shrink-0">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted leading-tight">
            {label}
          </p>
          {scoreKind === "regRisk" ? (
            <p className="text-[8px] text-ink-muted/75 leading-snug mt-0.5">
              {t("decisionLab.pattern.eis.impactOverview.regScoreHint")}
            </p>
          ) : (
            <p className="text-[8px] text-ink-muted/75 leading-snug mt-0.5">
              {it
                ? "Σ Clinical / Financial / Access — EIS solo per evento (12/24/36h)"
                : "Σ Clinical / Financial / Access — EIS per event only (12/24/36h)"}
            </p>
          )}
        </div>
        {scoreKind === "regRisk" ? (
          hasScore ? (
            <RegScoreDisplay
              score={score!}
              compact
              onClick={onOpenRegBreakdown}
              clickTitle={t("regulatoryScore.breakdown.openHint")}
            />
          ) : (
            <p className="text-sm font-bold text-ink-muted/45 leading-none">—</p>
          )
        ) : (
          <div className="shrink-0 text-right space-y-0.5">
            <p className="text-[8px] uppercase text-ink-muted/80 leading-none">
              {it ? "Σ Clin / Fin / Acc" : "Σ Clin / Fin / Acc"}
            </p>
            <p
              className="font-bold tabular-nums text-[11px] leading-none"
              style={{
                color: clinSum != null ? eisColor(clinSum) : "rgb(var(--ink-muted))",
              }}
            >
              Clin {fmtSignedEis(clinSum)}
            </p>
            <p
              className="font-semibold tabular-nums text-[11px] leading-none"
              style={{
                color: finSum != null ? eisColor(finSum) : "rgb(var(--ink-muted))",
              }}
            >
              Fin {fmtSignedEis(finSum)}
            </p>
            <p
              className="font-semibold tabular-nums text-[11px] leading-none"
              style={{
                color: accSum != null ? eisColor(accSum) : "rgb(var(--ink-muted))",
              }}
            >
              Acc {fmtSignedEis(accSum)}
            </p>
          </div>
        )}
      </div>
      {scoreKind === "regRisk" && hasScore ? (
        <p className="text-[8px] text-ink-muted/80 leading-snug shrink-0 -mt-0.5">
          {regulatoryScoreSummaryLabel(score!, lang)}
        </p>
      ) : null}
      {summaryOnly ? (
        onViewAllDetail ? (
          <button
            type="button"
            className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2 self-start shrink-0 mt-0.5"
            onClick={onViewAllDetail}
          >
            {events.length > 0
              ? it
                ? `Vedi tutte le news (${events.length}) →`
                : `View all news (${events.length}) →`
              : it
                ? "Vedi dettaglio →"
                : "View detail →"}
          </button>
        ) : null
      ) : events.length > 0 ? (
        <>
          {scoreKind === "regRisk" ? (
            <p className="text-[8px] font-semibold uppercase tracking-wide text-ink-muted/80 shrink-0">
              {t("decisionLab.pattern.eis.impactOverview.regEventScoresHint")}
              {eventSum != null ? (
                <span className="normal-case font-bold tabular-nums ml-1" style={{ color: eisColor(eventSum) }}>
                  · {t("decisionLab.pattern.eis.impactOverview.regEventSum")}{" "}
                  {eventSum >= 0 ? "+" : ""}
                  {eventSum.toFixed(1)}
                </span>
              ) : null}
            </p>
          ) : null}
          <ul className="space-y-1 min-h-0">
            {events.map((ev, i) => (
              <ImpactEventRow
                key={`lane-${label}-${ev.eventDate}-${ev.title}-${i}`}
                ev={ev}
                it={it}
                dense
                ticker={ticker}
                onManualDetail={onManualDetail}
              />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[10px] text-ink-muted/75 leading-snug flex-1">{emptyLabel}</p>
      )}
    </div>
  );
}

type TickerImpactEventsPanelProps = {
  ticker: string;
  sheetClinicalKpi?: number | null;
  lang?: "it" | "en";
  clinicalRecords?: ClinicalPreCdRecord[];
  clinicalFeedLoading?: boolean;
  regulatoryScore?: number | null;
  simRow?: Record<string, unknown> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  onOpenAllEvents: () => void;
  dense?: boolean;
  /** Side column: total score, top impact summary, last-24h news window. */
  layout?: "default" | "split";
  /** Taller split panel for Loss Analysis — more room for EIS/regulatory feed. */
  expanded?: boolean;
  feedUpdatedAt?: string | null;
};

type TickerImpactEventsPanelModel = {
  it: boolean;
  t: ReturnType<typeof useT>;
  resolvedTicker: string;
  detail: ReturnType<typeof buildTickerEisDetail>;
  headlineScore: number | null;
  hasEvents: boolean;
  sheetOnly: boolean;
  impactByKind: {
    clinical: TickerEisEventDetail[];
    regulatory: TickerEisEventDetail[];
    regulatoryAll: TickerEisEventDetail[];
  };
  cumulativeEis: ReturnType<typeof cumulativeTickerEisScore>;
  latestNewsEvents: TickerEisEventDetail[];
  autoClinicalLaneScore: number | null;
  /** Untruncated auto-clinical lane: market (price/volume) vs clinical (KPI×10) sums. */
  eisMarketSum: number | null;
  eisClinicalSum: number | null;
  feedTimeLabel: string | null;
  regulatoryScore?: number | null;
  clinicalFeedLoading: boolean;
  expanded: boolean;
  manualNewsMaxH: string;
  splitShellCls: string;
  setManualDetail: (payload: ManualNewsDetailPayload | null) => void;
  openRegBreakdown: () => void;
  onOpenAllEvents: () => void;
};

const TickerImpactEventsCtx = createContext<TickerImpactEventsPanelModel | null>(null);

function useTickerImpactEventsPanelModel({
  ticker,
  sheetClinicalKpi,
  lang = "it",
  clinicalRecords,
  clinicalFeedLoading = false,
  regulatoryScore,
  simRow = null,
  onOpenAllEvents,
  dense = false,
  layout = "default",
  expanded = false,
  feedUpdatedAt = null,
}: TickerImpactEventsPanelProps) {
  const t = useT();
  const it = lang === "it";
  const resolvedTicker = ticker.trim().toUpperCase();
  const splitLayout = layout === "split";
  const eventLimit = splitLayout ? (expanded ? 4 : 2) : dense ? 1 : 2;
  const manualNewsMaxH = expanded ? "max-h-[11rem]" : "max-h-[6.5rem]";
  const splitShellCls =
    "rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 p-1.5 space-y-1 shrink-0 flex flex-col w-full min-w-0";

  const simCompletionDate = simRow?.["Completion Date"];
  const guidanceEvents = useTickerGuidanceEvents(resolvedTicker);

  const detail = useMemo(
    () =>
      buildTickerEisDetail(
        resolvedTicker,
        lang,
        sheetClinicalKpi,
        clinicalRecords,
        simCompletionDate,
        simRow,
        guidanceEvents,
      ),
    [resolvedTicker, lang, sheetClinicalKpi, clinicalRecords, simCompletionDate, simRow, guidanceEvents],
  );

  const headlineScore = detail.score;
  const hasEvents = detail.events.length > 0;
  const sheetOnly = detail.sheetFallback && !hasEvents;

  const impactByKind = useMemo(() => {
    const { regulatory } = partitionTickerEisEvents(detail.events);
    return {
      clinical: pickEisLaneEvents(detail.events, eventLimit),
      regulatory: sortEventsByImpact(regulatory).slice(0, eventLimit),
      regulatoryAll: sortEventsByImpact(regulatory),
    };
  }, [detail.events, eventLimit]);

  const cumulativeEis = useMemo(
    () => cumulativeTickerEisScore(resolvedTicker, lang, sheetClinicalKpi, clinicalRecords),
    [resolvedTicker, lang, sheetClinicalKpi, clinicalRecords],
  );

  const latestNewsEvents = useMemo(
    () => pickLatestEisNewsEvents(detail.events, 8),
    [detail.events],
  );

  const autoClinicalLaneScore = useMemo(
    () => sumEventScores(impactByKind.clinical),
    [impactByKind.clinical],
  );

  const { eisMarketSum, eisClinicalSum } = useMemo(() => {
    const dual = resolveEisBannerDualScores(detail.events, headlineScore);
    return { eisMarketSum: dual.market, eisClinicalSum: dual.clinical };
  }, [detail.events, headlineScore]);

  const feedTimeLabel = fmtFeedUpdated(feedUpdatedAt, it);

  return {
    it,
    t,
    resolvedTicker,
    detail,
    headlineScore,
    hasEvents,
    sheetOnly,
    impactByKind,
    cumulativeEis,
    latestNewsEvents,
    autoClinicalLaneScore,
    eisMarketSum,
    eisClinicalSum,
    feedTimeLabel,
    regulatoryScore,
    clinicalFeedLoading,
    expanded,
    manualNewsMaxH,
    splitShellCls,
    onOpenAllEvents,
  };
}

export function TickerImpactEventsPanelProvider({
  children,
  ...props
}: TickerImpactEventsPanelProps & { children: ReactNode }) {
  const base = useTickerImpactEventsPanelModel(props);
  const it = base.it;
  const [manualDetail, setManualDetail] = useState<ManualNewsDetailPayload | null>(null);
  const [regBreakdown, setRegBreakdown] = useState<RegulatoryScoreBreakdownPayload | null>(null);

  const openRegBreakdown = () => {
    const bundle = resolveRegulatoryRiskBundleForTicker(
      base.resolvedTicker,
      props.simRow ?? null,
      props.autoRegSnap ?? null,
    );
    if (bundle.score == null || !bundle.index) return;
    const autoSig = props.autoRegSnap?.tickers?.[base.resolvedTicker] ?? null;
    setRegBreakdown({
      ticker: base.resolvedTicker,
      riskScore: bundle.score,
      index: bundle.index,
      clinicalPhase: clinicalPhaseFromSimRow(props.simRow ?? undefined) || null,
      cleanScan: Boolean(autoSig?.no_signals) && !bundle.index.hasAnySignal,
      isMedtech: isMedtechTicker(base.resolvedTicker),
      regulatoryEvents: base.impactByKind.regulatoryAll,
    });
  };

  const ctx: TickerImpactEventsPanelModel = {
    ...base,
    openRegBreakdown,
    setManualDetail,
  };

  return (
    <TickerImpactEventsCtx.Provider value={ctx}>
      {children}
      {manualDetail ? (
        <ManualNewsDetailModal payload={manualDetail} it={it} onClose={() => setManualDetail(null)} />
      ) : null}
      <RegulatoryScoreBreakdownModal
        payload={regBreakdown}
        it={it}
        onClose={() => setRegBreakdown(null)}
      />
    </TickerImpactEventsCtx.Provider>
  );
}

export function useTickerImpactEventsCtx(): TickerImpactEventsPanelModel {
  const ctx = useContext(TickerImpactEventsCtx);
  if (!ctx) {
    throw new Error("TickerImpactEvents section must be used inside TickerImpactEventsPanelProvider");
  }
  return ctx;
}

export function TickerImpactEventsContextSection({
  className = "",
  /** Compact strip next to Beta / Liquidity / P(cont) — study + approaching CD, no KPI grid. */
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "approachingCd";
}) {
  const {
    it,
    t,
    detail,
    hasEvents,
    clinicalFeedLoading,
    expanded,
    splitShellCls,
    onOpenAllEvents,
  } = useTickerImpactEventsCtx();

  const approaching = variant === "approachingCd";
  const shell = approaching
    ? `rounded-md border-0 bg-transparent p-0 space-y-0.5 shrink-0 flex flex-col w-full min-w-0`
    : splitShellCls;

  if (clinicalFeedLoading && !hasEvents) {
    return (
      <div className={`${shell} ${className}`.trim()}>
        <p className="text-[8px] font-semibold uppercase tracking-wide text-ink-muted">
          {approaching
            ? t("decisionLab.pattern.eis.impactOverview.approachingCdTitle")
            : t("decisionLab.pattern.eis.impactOverview.title")}
        </p>
        <p className="text-[9px] text-ink-muted animate-pulse">
          {it ? "Caricamento…" : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <div className={`${shell} ${className}`.trim()}>
      {!approaching ? (
        <p className="text-[8px] font-semibold uppercase tracking-wide text-ink-muted leading-none shrink-0">
          {t("decisionLab.pattern.eis.impactOverview.title")}
        </p>
      ) : null}
      <EisStudyContextHeader
        detail={detail}
        it={it}
        compact
        emphasizeCd={approaching}
        showClinicalIndicators={
          !approaching &&
          (detail.cdStudyIndicators.length > 0 ||
            detail.primaryStudyIndicators.length > 0 ||
            detail.clinicalIndicators.length > 0)
        }
        clinicalMaxShown={approaching ? 2 : expanded ? 3 : 2}
        onExpandClinical={onOpenAllEvents}
      />
    </div>
  );
}

/** Single-line CD STUDY strip for the deep-dive KPI template. */
export function TickerImpactEventsCdStudyStrip({ className = "" }: { className?: string }) {
  const { it, t, detail, clinicalFeedLoading, hasEvents, onOpenAllEvents } =
    useTickerImpactEventsCtx();
  const cd = detail.cdCompletingStudy;
  const drug = cd.studyDrug?.trim() || null;
  const phase = cd.studyPhase?.trim() || null;
  const conditions = cd.studyConditions?.trim() || null;
  const title = cd.studyTitle?.trim() || null;
  const titleShort =
    title && title.length > 28
      ? `${title.slice(0, 26).trim()}…`
      : title;
  const nctId = cd.nctId?.trim() || detail.nctId?.trim() || null;
  const studyUrl =
    cd.studyUrl?.trim() ||
    detail.studyUrl?.trim() ||
    (nctId ? `https://clinicaltrials.gov/study/${nctId}` : null);
  const days = detail.daysToCd;
  const daysLabel =
    days == null
      ? null
      : days > 0
        ? it
          ? `${days}g al CD`
          : `${days}d to CD`
        : days === 0
          ? it
            ? "CD oggi"
            : "CD today"
          : it
            ? `CD −${Math.abs(days)}g`
            : `CD −${Math.abs(days)}d`;
  const extra =
    (detail.cdStudyIndicators?.length ?? 0) +
    (detail.events?.length ? Math.min(detail.events.length, 9) : 0);
  const detailLabel =
    extra > 0 ? `+${extra} →` : "→";

  if (clinicalFeedLoading && !hasEvents && !drug && !nctId) {
    return (
      <div className={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--purple-soft))] shrink-0">
          CD Study
        </span>
        <span className="text-[11px] text-ink-muted animate-pulse">
          {it ? "Caricamento…" : "Loading…"}
        </span>
      </div>
    );
  }

  if (!drug && !nctId && !title && !phase && days == null) {
    return (
      <div className={`flex items-center gap-2 min-w-0 ${className}`.trim()}>
        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--purple-soft))] shrink-0">
          CD Study
        </span>
        <span className="text-[11px] text-ink-muted">
          {t("decisionLab.pattern.eis.impactOverview.noCdStudy")}
        </span>
      </div>
    );
  }

  const midParts = [titleShort, phase, conditions].filter(Boolean);

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-ink ${className}`.trim()}>
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--purple-soft))] shrink-0">
        CD Study
      </span>
      {drug ? (
        <span className="text-[12px] font-bold text-ink shrink-0">{drug}</span>
      ) : null}
      {midParts.length > 0 ? (
        <span className="text-[11px] text-ink-muted truncate min-w-0">
          {midParts.join(" · ")}
        </span>
      ) : null}
      {nctId && studyUrl ? (
        <NctStudyLink nctId={nctId} href={studyUrl} />
      ) : nctId ? (
        <span className="text-[11px] font-mono font-semibold text-[rgb(var(--purple-soft))]">{nctId}</span>
      ) : null}
      <span className="flex-1" />
      {daysLabel ? (
        <span className="text-[11px] tabular-nums font-semibold text-ink shrink-0">{daysLabel}</span>
      ) : null}
      <button
        type="button"
        onClick={onOpenAllEvents}
        className="text-[11px] font-bold text-[rgb(var(--warn))] hover:text-ink hover:underline shrink-0"
      >
        {detailLabel}
      </button>
    </div>
  );
}

/** Compact Market / Clinical EIS sums for the trading-day banner (replaces plan-capital aside). */
export function TickerImpactEventsBannerSummary({
  className = "",
  marketCapUsd = null,
}: {
  className?: string;
  marketCapUsd?: number | null;
}) {
  const { it, t, eisMarketSum, eisClinicalSum, onOpenAllEvents } = useTickerImpactEventsCtx();
  const mcapLabel =
    marketCapUsd != null && Number.isFinite(marketCapUsd) && marketCapUsd > 0
      ? `$${formatMarketCap(marketCapUsd)}`
      : "—";

  return (
    <button
      type="button"
      className={`flex items-stretch gap-3 text-left min-w-0 w-full ${className}`.trim()}
      onClick={onOpenAllEvents}
      title={t("decisionLab.pattern.eis.impactOverview.eisScoreDualHint")}
    >
      <span
        className="flex flex-col justify-center min-w-0 px-1"
        title={t("sim.lossAnalysis.metric.marketCapTip")}
      >
        <span className="text-[8px] uppercase text-ink-muted/80 leading-none">
          {t("sim.lossAnalysis.metric.marketCap")}
        </span>
        <span className="font-bold tabular-nums text-sm leading-none mt-0.5 text-ink">
          {mcapLabel}
        </span>
      </span>
      <span className="flex flex-col items-end min-w-0 ml-auto">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted leading-none">
          {t("decisionLab.pattern.eis.impactOverview.eisScore")}
        </span>
        <span className="text-[8px] text-ink-muted/70 leading-tight mt-0.5">
          {it ? "Mercato / clinico" : "Market / clinical"}
        </span>
        <span className="flex items-baseline gap-2 mt-0.5">
          <span
            className="font-bold tabular-nums text-lg leading-none"
            style={{ color: eisMarketSum != null ? eisColor(eisMarketSum) : undefined }}
          >
            {fmtSignedEis(eisMarketSum)}
          </span>
          <span className="text-ink-muted/40 font-semibold text-lg leading-none" aria-hidden>
            /
          </span>
          <span
            className="font-bold tabular-nums text-lg leading-none"
            style={{
              color: eisClinicalSum != null ? eisColor(eisClinicalSum) : "rgb(var(--ink-muted))",
            }}
          >
            {fmtSignedEis(eisClinicalSum)}
          </span>
        </span>
      </span>
    </button>
  );
}

export function TickerImpactEventsEisLane({ className = "" }: { className?: string }) {
  const {
    it,
    t,
    resolvedTicker,
    headlineScore,
    autoClinicalLaneScore,
    impactByKind,
    setManualDetail,
    splitShellCls,
    onOpenAllEvents,
  } = useTickerImpactEventsCtx();

  return (
    <div className={`${splitShellCls} ${className}`.trim()}>
      <ScoreLanePanel
        label={t("decisionLab.pattern.eis.impactOverview.eisScore")}
        score={autoClinicalLaneScore ?? headlineScore}
        events={impactByKind.clinical}
        emptyLabel={t("decisionLab.pattern.eis.impactOverview.laneEmptyEis")}
        it={it}
        ticker={resolvedTicker}
        onManualDetail={setManualDetail}
        summaryOnly
        onViewAllDetail={onOpenAllEvents}
      />
    </div>
  );
}

export function TickerImpactEventsRegLane({ className = "" }: { className?: string }) {
  const {
    it,
    t,
    resolvedTicker,
    regulatoryScore,
    impactByKind,
    setManualDetail,
    openRegBreakdown,
    splitShellCls,
    onOpenAllEvents,
  } = useTickerImpactEventsCtx();

  return (
    <div className={`${splitShellCls} ${className}`.trim()}>
      <ScoreLanePanel
        label={t("decisionLab.pattern.eis.impactOverview.regScore")}
        score={regulatoryScore}
        events={impactByKind.regulatory}
        emptyLabel={t("decisionLab.pattern.eis.impactOverview.laneEmptyReg")}
        it={it}
        scoreKind="regRisk"
        ticker={resolvedTicker}
        onManualDetail={setManualDetail}
        onOpenRegBreakdown={openRegBreakdown}
        summaryOnly
        onViewAllDetail={onOpenAllEvents}
      />
    </div>
  );
}

export function TickerImpactEventsFooterSection({ className = "" }: { className?: string }) {
  const {
    it,
    t,
    detail,
    hasEvents,
    cumulativeEis,
    latestNewsEvents,
    feedTimeLabel,
    manualNewsMaxH,
    resolvedTicker,
    setManualDetail,
    onOpenAllEvents,
    splitShellCls,
  } = useTickerImpactEventsCtx();

  return (
    <div className={`${splitShellCls} ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-1 shrink-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90 shrink-0">
            {t("decisionLab.pattern.eis.impactOverview.eisTotal")}
          </p>
          {cumulativeEis.total != null && Number.isFinite(cumulativeEis.total) ? (
            <p
              className="font-bold tabular-nums text-sm leading-none"
              style={{ color: eisColor(cumulativeEis.total) }}
            >
              {cumulativeEis.total >= 0 ? "+" : ""}
              {cumulativeEis.total.toFixed(1)}
            </p>
          ) : (
            <p className="text-sm font-bold text-ink-muted/45 leading-none">—</p>
          )}
        </div>
        <button
          type="button"
          className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline shrink-0"
          onClick={onOpenAllEvents}
        >
          {hasEvents
            ? t("decisionLab.pattern.eis.impactOverview.openAllCount", {
                count: String(detail.events.length),
              })
            : `${t("decisionLab.pattern.eis.impactOverview.openAll")} →`}
        </button>
      </div>

      <div className="space-y-0.5 shrink-0 border-t border-[rgb(var(--border))]/30 pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90">
            {t("decisionLab.pattern.eis.impactOverview.latestNews")}
          </p>
          <p className="text-[9px] text-ink-muted/75 leading-snug text-right">
            {t("decisionLab.pattern.eis.impactOverview.latestNewsHint")}
            {feedTimeLabel ? ` · ${feedTimeLabel}` : ""}
          </p>
        </div>
        {latestNewsEvents.length > 0 ? (
          <ul className={`space-y-1 ${manualNewsMaxH} overflow-y-auto pr-0.5`}>
            {latestNewsEvents.map((ev, i) => (
              <ImpactEventRow
                key={`latest-${ev.eventDate}-${ev.title}-${i}`}
                ev={ev}
                it={it}
                dense
                ticker={resolvedTicker}
                onManualDetail={setManualDetail}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-ink-muted/80 leading-snug">
            {t("decisionLab.pattern.eis.impactOverview.latestNewsEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}

export function TickerImpactEventsPanel({
  ticker,
  sheetClinicalKpi,
  lang = "it",
  clinicalRecords,
  clinicalFeedLoading = false,
  regulatoryScore,
  simRow = null,
  autoRegSnap = null,
  onOpenAllEvents,
  dense = false,
  layout = "default",
  expanded = false,
  feedUpdatedAt = null,
}: {
  ticker: string;
  sheetClinicalKpi?: number | null;
  lang?: "it" | "en";
  /** When set, avoids relying on localStorage-only hydrate (Check 24h / loss analysis). */
  clinicalRecords?: ClinicalPreCdRecord[];
  clinicalFeedLoading?: boolean;
  /** Signed regulatory risk index for this ticker (K-8 / auto snapshot). */
  regulatoryScore?: number | null;
  simRow?: Record<string, unknown> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  onOpenAllEvents: () => void;
  dense?: boolean;
  /** Side column: total score, top impact summary, last-24h news window. */
  layout?: "default" | "split";
  /** Taller split panel for Loss Analysis — more room for EIS/regulatory feed. */
  expanded?: boolean;
  /** Clinical feed snapshot timestamp (first daily refresh). */
  feedUpdatedAt?: string | null;
}) {
  const t = useT();
  const it = lang === "it";
  const resolvedTicker = ticker.trim().toUpperCase();
  const [manualDetail, setManualDetail] = useState<ManualNewsDetailPayload | null>(null);
  const [regBreakdown, setRegBreakdown] = useState<RegulatoryScoreBreakdownPayload | null>(null);
  const manualDetailModal = manualDetail ? (
    <ManualNewsDetailModal
      payload={manualDetail}
      it={it}
      onClose={() => setManualDetail(null)}
    />
  ) : null;
  const manualRowProps = {
    ticker: resolvedTicker,
    onManualDetail: setManualDetail,
  };
  const splitLayout = layout === "split";
  const shellCls = splitLayout
    ? `rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 p-1.5 space-y-1 shrink-0 flex flex-col w-full`
    : dense
      ? "rounded-md border border-[rgb(var(--border))]/45 bg-surface/50 p-2 space-y-1.5"
      : "rounded-lg border border-[rgb(var(--border))]/50 bg-surface/60 p-3 space-y-2";
  const eventLimit = splitLayout ? (expanded ? 4 : 2) : dense ? 1 : 2;
  const manualNewsMaxH = expanded ? "max-h-[11rem]" : "max-h-[6.5rem]";

  const simCompletionDate = simRow?.["Completion Date"];
  const guidanceEvents = useTickerGuidanceEvents(resolvedTicker);

  const detail = useMemo(
    () =>
      buildTickerEisDetail(
        resolvedTicker,
        lang,
        sheetClinicalKpi,
        clinicalRecords,
        simCompletionDate,
        simRow,
        guidanceEvents,
      ),
    [resolvedTicker, lang, sheetClinicalKpi, clinicalRecords, simCompletionDate, simRow, guidanceEvents],
  );

  const headlineScore = detail.score;
  const hasEvents = detail.events.length > 0;
  const sheetOnly = detail.sheetFallback && !hasEvents;

  const impactByKind = useMemo(() => {
    const { regulatory } = partitionTickerEisEvents(detail.events);
    return {
      clinical: pickEisLaneEvents(detail.events, eventLimit),
      regulatory: sortEventsByImpact(regulatory).slice(0, eventLimit),
      regulatoryAll: sortEventsByImpact(regulatory),
    };
  }, [detail.events, eventLimit]);

  const openRegBreakdown = () => {
    const bundle = resolveRegulatoryRiskBundleForTicker(resolvedTicker, simRow, autoRegSnap);
    if (bundle.score == null || !bundle.index) return;
    const autoSig = autoRegSnap?.tickers?.[resolvedTicker] ?? null;
    setRegBreakdown({
      ticker: resolvedTicker,
      riskScore: bundle.score,
      index: bundle.index,
      clinicalPhase: clinicalPhaseFromSimRow(simRow ?? undefined) || null,
      cleanScan: Boolean(autoSig?.no_signals) && !bundle.index.hasAnySignal,
      isMedtech: isMedtechTicker(resolvedTicker),
      regulatoryEvents: impactByKind.regulatoryAll,
    });
  };

  const regBreakdownModal = (
    <RegulatoryScoreBreakdownModal
      payload={regBreakdown}
      it={it}
      onClose={() => setRegBreakdown(null)}
    />
  );

  const cumulativeEis = useMemo(
    () => cumulativeTickerEisScore(resolvedTicker, lang, sheetClinicalKpi, clinicalRecords),
    [resolvedTicker, lang, sheetClinicalKpi, clinicalRecords],
  );

  const latestNewsEvents = useMemo(
    () => pickLatestEisNewsEvents(detail.events, 8),
    [detail.events],
  );

  const autoClinicalLaneScore = useMemo(
    () => sumEventScores(impactByKind.clinical),
    [impactByKind.clinical],
  );

  const feedTimeLabel = fmtFeedUpdated(feedUpdatedAt, it);

  if (!resolvedTicker) return null;

  if (clinicalFeedLoading && !hasEvents) {
    return (
      <>
        <div className={`${shellCls}${splitLayout ? "" : " h-full flex flex-col justify-center"}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
            {t("decisionLab.pattern.eis.impactOverview.title")}
          </p>
          <p className={`text-ink-muted animate-pulse${splitLayout ? " text-[10px]" : " text-[11px]"}`}>
            {it ? "Caricamento feed clinico…" : "Loading clinical feed…"}
          </p>
        </div>
        {manualDetailModal}
        {regBreakdownModal}
      </>
    );
  }

  if (splitLayout) {
    return (
      <>
        <div className={shellCls}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted leading-tight shrink-0">
            {t("decisionLab.pattern.eis.impactOverview.title")}
          </p>

          <EisStudyContextHeader
            detail={detail}
            it={it}
            compact
            showClinicalIndicators={
          detail.primaryStudyIndicators.length > 0 || detail.clinicalIndicators.length > 0
        }
            clinicalMaxShown={expanded ? 3 : 2}
            onExpandClinical={onOpenAllEvents}
          />

          <div className="grid grid-cols-2 gap-1.5 shrink-0">
            <ScoreLanePanel
              label={t("decisionLab.pattern.eis.impactOverview.eisScore")}
              score={autoClinicalLaneScore ?? headlineScore}
              events={impactByKind.clinical}
              emptyLabel={t("decisionLab.pattern.eis.impactOverview.laneEmptyEis")}
              it={it}
              ticker={resolvedTicker}
              onManualDetail={setManualDetail}
              summaryOnly
              onViewAllDetail={onOpenAllEvents}
            />
            <ScoreLanePanel
              label={t("decisionLab.pattern.eis.impactOverview.regScore")}
              score={regulatoryScore}
              events={impactByKind.regulatory}
              emptyLabel={t("decisionLab.pattern.eis.impactOverview.laneEmptyReg")}
              it={it}
              scoreKind="regRisk"
              ticker={resolvedTicker}
              onManualDetail={setManualDetail}
              onOpenRegBreakdown={openRegBreakdown}
              summaryOnly
              onViewAllDetail={onOpenAllEvents}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 shrink-0 border-t border-[rgb(var(--border))]/30 pt-1.5">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90 shrink-0">
                {t("decisionLab.pattern.eis.impactOverview.eisTotal")}
              </p>
              {cumulativeEis.total != null && Number.isFinite(cumulativeEis.total) ? (
                <p
                  className="font-bold tabular-nums text-sm leading-none"
                  style={{ color: eisColor(cumulativeEis.total) }}
                >
                  {cumulativeEis.total >= 0 ? "+" : ""}
                  {cumulativeEis.total.toFixed(1)}
                </p>
              ) : (
                <p className="text-sm font-bold text-ink-muted/45 leading-none">—</p>
              )}
            </div>
            <button
              type="button"
              className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline shrink-0"
              onClick={onOpenAllEvents}
            >
              {hasEvents
                ? t("decisionLab.pattern.eis.impactOverview.openAllCount", {
                    count: String(detail.events.length),
                  })
                : `${t("decisionLab.pattern.eis.impactOverview.openAll")} →`}
            </button>
          </div>

          <div className="space-y-0.5 shrink-0 border-t border-[rgb(var(--border))]/30 pt-1">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90">
                {t("decisionLab.pattern.eis.impactOverview.latestNews")}
              </p>
              <p className="text-[9px] text-ink-muted/75 leading-snug text-right">
                {t("decisionLab.pattern.eis.impactOverview.latestNewsHint")}
                {feedTimeLabel ? ` · ${feedTimeLabel}` : ""}
              </p>
            </div>
            {latestNewsEvents.length > 0 ? (
              <ul className={`space-y-1 ${manualNewsMaxH} overflow-y-auto pr-0.5`}>
                {latestNewsEvents.map((ev, i) => (
                  <ImpactEventRow
                    key={`latest-${ev.eventDate}-${ev.title}-${i}`}
                    ev={ev}
                    it={it}
                    dense
                    {...manualRowProps}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-ink-muted/80 leading-snug">
                {t("decisionLab.pattern.eis.impactOverview.latestNewsEmpty")}
              </p>
            )}
          </div>
        </div>
        {manualDetailModal}
        {regBreakdownModal}
      </>
    );
  }

  if (!hasEvents) {
    if (detail.clinicalIndicators.length > 0) {
      return (
        <>
          <div className={`${shellCls} h-full`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("decisionLab.pattern.eis.impactOverview.title")}
          </p>
          <p className={`text-ink-muted leading-snug${dense ? " text-[10px]" : " text-[11px]"}`}>
            {t("decisionLab.pattern.eis.noEvent")}
          </p>
          {regulatoryScore != null && Number.isFinite(regulatoryScore) ? (
            <p className="text-[10px] text-ink-muted">
              {it ? "Reg" : "Reg"}:{" "}
              <RegScoreDisplay
                score={regulatoryScore}
                compact
                onClick={openRegBreakdown}
                clickTitle={t("regulatoryScore.breakdown.openHint")}
              />
            </p>
          ) : null}
          {dense ? (
            <ClinicalIndicatorChips
              indicators={detail.clinicalIndicators}
              it={it}
              maxShown={2}
              onExpand={onOpenAllEvents}
            />
          ) : (
            <ClinicalIndicatorSummaryBlock
              title={t("decisionLab.pattern.eis.clinicalIndicators")}
              indicators={detail.clinicalIndicators}
              it={it}
              maxShown={4}
            />
          )}
          {!dense ? (
            <button
              type="button"
              className="btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50"
              onClick={onOpenAllEvents}
            >
              {t("decisionLab.pattern.eis.impactOverview.openAll")}
            </button>
          ) : null}
          </div>
          {manualDetailModal}
          {regBreakdownModal}
        </>
      );
    }
    return (
      <>
        <div className={`${shellCls} h-full flex flex-col justify-center`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
          {t("decisionLab.pattern.eis.impactOverview.title")}
        </p>
        <p className="text-[11px] text-ink-muted">{t("decisionLab.pattern.eis.noEvent")}</p>
        {regulatoryScore != null && Number.isFinite(regulatoryScore) ? (
          <p className="text-[10px] text-ink-muted">
            {it ? "Reg" : "Reg"}:{" "}
            <RegScoreDisplay
              score={regulatoryScore}
              compact
              onClick={openRegBreakdown}
              clickTitle={t("regulatoryScore.breakdown.openHint")}
            />
          </p>
        ) : null}
        {!dense ? (
          <p className="text-[10px] text-ink-muted/80 mt-2 leading-snug">
            {t("decisionLab.pattern.eis.noEventHint")}
          </p>
        ) : null}
        <button
          type="button"
          className={`text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline self-start${
            dense ? " mt-1" : " btn-ghost border border-[rgb(var(--border))]/50 mt-3"
          }`}
          onClick={onOpenAllEvents}
        >
          {t("decisionLab.pattern.eis.impactOverview.openAll")} →
        </button>
        </div>
        {manualDetailModal}
        {regBreakdownModal}
      </>
    );
  }

  return (
    <>
      <div className={`${shellCls} h-full`}>
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("decisionLab.pattern.eis.impactOverview.title")}
          </p>
          {!dense ? (
            <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
              {t("decisionLab.pattern.eis.impactOverview.subtitle", {
                count: String(detail.events.length),
              })}
            </p>
          ) : null}
          {dense && regulatoryScore != null && Number.isFinite(regulatoryScore) ? (
            <p className="text-[10px] text-ink-muted mt-0.5">
              {it ? "Reg" : "Reg"}:{" "}
              <RegScoreDisplay
                score={regulatoryScore}
                compact
                onClick={openRegBreakdown}
                clickTitle={t("regulatoryScore.breakdown.openHint")}
              />
            </p>
          ) : null}
        </div>
        {headlineScore != null && Number.isFinite(headlineScore) ? (
          <div className="text-right shrink-0">
            {!dense ? (
              <p className="text-[9px] uppercase tracking-wide text-ink-muted font-semibold">
                {t("decisionLab.pattern.eis.impactOverview.peakScore")}
              </p>
            ) : null}
            <p
              className={`font-bold tabular-nums${dense ? " text-sm leading-none" : " text-lg"}`}
              style={{ color: eisColor(headlineScore) }}
            >
              {headlineScore >= 0 ? "+" : ""}
              {headlineScore.toFixed(1)}
            </p>
            {!dense ? (
              <div className="h-1.5 w-16 rounded-full bg-[rgb(var(--surface-3))] overflow-hidden mt-1 ml-auto">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${eisBarPercent(headlineScore)}%`,
                    background: eisColor(headlineScore),
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!dense && regulatoryScore != null && Number.isFinite(regulatoryScore) ? (
        <p className="text-[10px] text-ink-muted">
          {it ? "Indice regolatorio" : "Regulatory index"}:{" "}
          <RegScoreDisplay
            score={regulatoryScore}
            compact
            onClick={openRegBreakdown}
            clickTitle={t("regulatoryScore.breakdown.openHint")}
          />
        </p>
      ) : null}

      <EisStudyContextHeader
        detail={detail}
        it={it}
        compact={dense}
        showClinicalIndicators={
          detail.primaryStudyIndicators.length > 0 || detail.clinicalIndicators.length > 0
        }
        clinicalMaxShown={dense ? 2 : 3}
        onExpandClinical={onOpenAllEvents}
      />

      {sheetOnly ? (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
          · {t("decisionLab.pattern.eis.sheetBadge")}
        </p>
      ) : null}

      {impactByKind.clinical.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90">
            {it ? "Top EIS clinico" : "Top clinical EIS"}
          </p>
          <ul className={dense ? "space-y-1" : "space-y-1.5"}>
            {impactByKind.clinical.map((ev, i) => (
              <ImpactEventRow
                key={`clin-${ev.eventDate}-${ev.title}-${i}`}
                ev={ev}
                it={it}
                dense={dense}
                {...manualRowProps}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {impactByKind.regulatory.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted/90">
            {it ? "Top regolatorio" : "Top regulatory"}
          </p>
          <ul className={dense ? "space-y-1" : "space-y-1.5"}>
            {impactByKind.regulatory.map((ev, i) => (
              <ImpactEventRow
                key={`reg-${ev.eventDate}-${ev.title}-${i}`}
                ev={ev}
                it={it}
                dense={dense}
                {...manualRowProps}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {detail.breakdownHint && !dense ? (
        <p className="text-[10px] text-ink-muted leading-snug line-clamp-2">
          {detail.breakdownHint}
        </p>
      ) : null}

      <button
        type="button"
        className={
          dense
            ? "text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline self-start"
            : "btn-ghost text-[10px] font-semibold border border-[rgb(var(--border))]/50 self-start"
        }
        onClick={onOpenAllEvents}
      >
        {t("decisionLab.pattern.eis.impactOverview.openAllCount", {
          count: String(detail.events.length),
        })}
      </button>
      </div>
      {manualDetailModal}
      {regBreakdownModal}
    </>
  );
}
