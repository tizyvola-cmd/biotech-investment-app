import type { TickerEisDetail } from "../sheet/tickerEisSummary";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import { useT } from "../shared/i18n";
import { localizeStudyPhase, localizeStudyStatus } from "../sheet/clinicalIndicators";
import { isRegulatoryMilestoneLabel } from "../sheet/simRowClinicalMeta";
import { ClinicalEfficacySafetySummary, ClinicalIndicatorChips } from "./ClinicalIndicatorSummary";

function fmtDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function NctStudyLink({
  nctId,
  href,
  className = "",
}: {
  nctId: string;
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className.trim() ||
        "inline-flex items-center gap-1 text-[10px] font-semibold text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/50 underline-offset-2 hover:decoration-[rgb(var(--accent))]"
      }
      onClick={(e) => openExternalUrl(href, e)}
    >
      {nctId}
      <span className="opacity-60 no-underline">↗</span>
    </a>
  );
}

export function CdCountdownBadge({
  cdDate,
  daysToCd,
  it,
}: {
  cdDate: string | null;
  daysToCd: number | null;
  it: boolean;
}) {
  if (!cdDate && daysToCd == null) return null;
  const dateLabel = cdDate ? fmtDate(cdDate, it) : "—";
  let countdown: string;
  if (daysToCd == null) {
    countdown = "";
  } else if (daysToCd > 0) {
    countdown = it ? `· ${daysToCd}g al CD` : `· ${daysToCd}d to CD`;
  } else if (daysToCd === 0) {
    countdown = it ? "· CD oggi" : "· CD today";
  } else {
    countdown = it
      ? `· CD passata (${Math.abs(daysToCd)}g fa)`
      : `· CD passed (${Math.abs(daysToCd)}d ago)`;
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink tabular-nums"
      title={it ? "Data di completamento dello studio (NCT)" : "Study Completion Date (NCT)"}
    >
      <span className="uppercase tracking-wide text-ink-muted font-bold">CD</span>
      <span>{dateLabel}</span>
      {countdown ? <span className="font-medium text-ink-muted">{countdown}</span> : null}
    </span>
  );
}

export function EisStudyMetaRow({
  nctId,
  studyUrl,
  studyPhase,
  feedLabels,
  studyConditions,
  cdDate,
  daysToCd,
  it,
}: {
  nctId: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  feedLabels: string[];
  studyConditions: string | null;
  cdDate: string | null;
  daysToCd: number | null;
  it: boolean;
}) {
  if (!nctId && !studyPhase && !feedLabels.length && !studyConditions && !cdDate && daysToCd == null) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-muted">
      {nctId && studyUrl ? (
        <NctStudyLink nctId={nctId} href={studyUrl} />
      ) : nctId ? (
        <span className="font-mono">{nctId}</span>
      ) : null}
      {studyPhase ? (
        <span className="rounded bg-[rgb(var(--surface-3))]/80 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
          {localizeStudyPhase(studyPhase, it)}
        </span>
      ) : null}
      <CdCountdownBadge cdDate={cdDate} daysToCd={daysToCd} it={it} />
      {feedLabels.length ? <span>{feedLabels.join(" · ")}</span> : null}
      {studyConditions ? (
        <span className="w-full text-[10px] text-ink-muted/90 leading-snug line-clamp-2">
          {studyConditions}
        </span>
      ) : null}
    </div>
  );
}

type StudyContextDetail = Pick<
  TickerEisDetail,
  | "company"
  | "studyTitle"
  | "nctId"
  | "studyUrl"
  | "studyPhase"
  | "feedLabels"
  | "studyConditions"
  | "studyDrug"
  | "cdDate"
  | "daysToCd"
  | "clinicalIndicators"
  | "primaryEvent"
  | "primaryStudyIndicators"
  | "cdStudyIndicators"
  | "catalystFit"
  | "cdCompletingStudy"
>;

export function eisStudyContextHasContent(detail: StudyContextDetail): boolean {
  const cd = detail.cdCompletingStudy;
  return Boolean(
    detail.primaryEvent?.title?.trim() ||
      detail.studyTitle?.trim() ||
      detail.nctId?.trim() ||
      detail.cdDate ||
      detail.daysToCd != null ||
      detail.studyPhase?.trim() ||
      detail.studyConditions?.trim() ||
      detail.studyDrug?.trim() ||
      cd?.studyTitle?.trim() ||
      cd?.nctId?.trim() ||
      cd?.studyDrug?.trim() ||
      cd?.catalystKind ||
      detail.clinicalIndicators.length > 0 ||
      detail.primaryStudyIndicators.length > 0 ||
      detail.cdStudyIndicators?.length > 0 ||
      detail.catalystFit === "unexplained_readthrough",
  );
}

/** Study context for HIGH-IMPACT EIS & Regulatory.
 * Event titles (8-K / press / etc.) live in the EIS SCORE / REGULATORY lanes below —
 * this header only shows company, asset, NCT/CD meta, then the registry study title.
 */
export function EisStudyContextHeader({
  detail,
  it,
  compact = false,
  showClinicalIndicators = false,
  clinicalMaxShown = 2,
  onExpandClinical,
  /** Put CD countdown first (approaching-CD strip next to Beta/Liq/Pcont). */
  emphasizeCd = false,
}: {
  detail: StudyContextDetail;
  it: boolean;
  compact?: boolean;
  showClinicalIndicators?: boolean;
  clinicalMaxShown?: number;
  onExpandClinical?: () => void;
  emphasizeCd?: boolean;
}) {
  const t = useT();
  if (!eisStudyContextHasContent(detail)) return null;

  const unexplained = detail.catalystFit === "unexplained_readthrough";
  const company = detail.company?.trim() || "";
  const cdStudy = emphasizeCd ? detail.cdCompletingStudy : null;
  const registryTitle =
    (cdStudy?.studyTitle || detail.studyTitle)?.trim() || "";
  const showRegistryTitle = Boolean(registryTitle && registryTitle !== company);
  const nctId = cdStudy?.nctId || detail.nctId;
  const studyUrl = cdStudy?.studyUrl || detail.studyUrl;
  const studyPhase = cdStudy?.studyPhase || detail.studyPhase;
  const studyConditions = cdStudy?.studyConditions || detail.studyConditions;
  const studyDrug = cdStudy?.studyDrug || detail.studyDrug;
  const catalystKind = cdStudy?.catalystKind || null;
  const assetFromEvent = detail.primaryEvent?.asset?.trim() || null;
  const assetLooksLikeMilestone = isRegulatoryMilestoneLabel(assetFromEvent);
  const asset =
    studyDrug ||
    (assetLooksLikeMilestone ? null : assetFromEvent) ||
    null;
  const cdIndicators = detail.cdStudyIndicators ?? [];
  const headerIndicators = emphasizeCd
    ? cdIndicators.length > 0
      ? cdIndicators
      : detail.primaryStudyIndicators.length
        ? detail.primaryStudyIndicators
        : detail.clinicalIndicators
    : detail.primaryStudyIndicators.length
      ? detail.primaryStudyIndicators
      : detail.clinicalIndicators;
  const showKpis = showClinicalIndicators && headerIndicators.length > 0;
  const hasCd = Boolean(detail.cdDate || detail.daysToCd != null);
  const hasTrial =
    Boolean(nctId || showRegistryTitle || studyPhase || studyConditions || studyDrug);
  const enrollment =
    cdStudy?.enrollment != null && Number.isFinite(cdStudy.enrollment)
      ? cdStudy.enrollment
      : null;
  const studyStatus = cdStudy?.studyStatus
    ? localizeStudyStatus(cdStudy.studyStatus, it)
    : null;
  const primaryEndpoint = cdStudy?.primaryEndpoint?.trim() || null;
  const chipsNamePrimary =
    Boolean(primaryEndpoint) &&
    headerIndicators.some((ind) => {
      const lab = (ind.label ?? "").trim().toLowerCase();
      return lab.length > 8 && primaryEndpoint!.toLowerCase().includes(lab.slice(0, 24));
    });

  return (
    <div
      className={`rounded-md shrink-0 ${
        unexplained
          ? "border border-amber-400/50 bg-amber-50/80 dark:bg-amber-950/30 space-y-1"
          : emphasizeCd
            ? "border-0 bg-transparent p-0"
            : "border border-[rgb(var(--accent))]/25 bg-[rgb(var(--accent))]/5 space-y-1"
      } ${emphasizeCd ? "" : compact ? "px-1.5 py-1" : "px-2 py-1.5"} ${
        emphasizeCd && compact ? "flex flex-wrap items-center gap-x-2 gap-y-0.5" : emphasizeCd ? "space-y-1" : ""
      }`}
    >
      {company && !emphasizeCd ? (
        <p className={`text-ink-muted leading-snug ${compact ? "text-[9px]" : "text-[10px]"}`}>
          {company}
        </p>
      ) : null}
      {emphasizeCd && hasCd ? (
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          <CdCountdownBadge cdDate={detail.cdDate} daysToCd={detail.daysToCd} it={it} />
          {catalystKind ? (
            <span className="inline-flex items-center rounded-md border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
              {catalystKind}
            </span>
          ) : null}
        </div>
      ) : null}
      {unexplained ? (
        <>
          <p
            className={`font-semibold leading-snug text-amber-900 dark:text-amber-100 ${
              compact ? "text-[10px] line-clamp-2" : "text-[11px] line-clamp-3"
            }`}
          >
            {t("decisionLab.pattern.eis.impactOverview.readthroughBanner")}
          </p>
          <p
            className={`text-amber-800/90 dark:text-amber-200/90 leading-snug ${
              compact ? "text-[9px]" : "text-[10px]"
            }`}
          >
            {t("decisionLab.pattern.eis.impactOverview.readthroughHint")}
          </p>
        </>
      ) : null}
      {asset && !(emphasizeCd && compact) ? (
        <p
          className={`font-semibold text-ink leading-snug ${
            emphasizeCd ? "text-[11px]" : compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          {asset}
        </p>
      ) : null}
      <EisStudyMetaRow
        nctId={nctId}
        studyUrl={studyUrl}
        studyPhase={studyPhase}
        feedLabels={emphasizeCd ? [] : detail.feedLabels}
        studyConditions={null}
        cdDate={emphasizeCd ? null : detail.cdDate}
        daysToCd={emphasizeCd ? null : detail.daysToCd}
        it={it}
      />
      {emphasizeCd && (enrollment != null || studyStatus) && !compact ? (
        <p className="text-[10px] text-ink-muted leading-snug">
          {[
            enrollment != null ? `n=${enrollment}` : null,
            studyStatus,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {showRegistryTitle && !(emphasizeCd && compact) ? (
        <p
          className={`leading-snug ${
            emphasizeCd
              ? "text-[9px] text-ink line-clamp-1"
              : compact
                ? "text-[9px] text-ink-muted line-clamp-2"
                : "text-[10px] text-ink-muted line-clamp-3"
          }`}
        >
          {unexplained
            ? `${t("decisionLab.pattern.eis.impactOverview.pipelineContext")}: ${registryTitle}`
            : registryTitle}
        </p>
      ) : null}
      {studyConditions && !(emphasizeCd && compact) ? (
        <p
          className={`text-ink-muted/90 leading-snug ${
            emphasizeCd ? "text-[10px]" : compact ? "text-[9px]" : "text-[10px]"
          } line-clamp-2`}
        >
          {studyConditions}
        </p>
      ) : null}
      {emphasizeCd && primaryEndpoint && !chipsNamePrimary && !compact ? (
        <p className="text-[10px] text-ink-muted leading-snug line-clamp-2">
          <span className="font-semibold text-ink">
            {t("decisionLab.pattern.eis.impactOverview.primaryEndpoint")}:
          </span>{" "}
          {primaryEndpoint}
        </p>
      ) : null}
      {emphasizeCd && cdStudy?.timingQuote && !compact ? (
        <p className="text-[10px] text-ink-muted/90 leading-snug line-clamp-3 italic">
          {cdStudy.timingQuote}
        </p>
      ) : null}
      {emphasizeCd && !hasTrial && !unexplained ? (
        <p className="text-[10px] text-ink-muted leading-snug">
          {t("decisionLab.pattern.eis.impactOverview.noCdStudy")}
        </p>
      ) : null}
      {showKpis ? (
        emphasizeCd ? (
          <ClinicalEfficacySafetySummary
            indicators={headerIndicators}
            it={it}
            onExpand={onExpandClinical}
          />
        ) : (
          <ClinicalIndicatorChips
            indicators={headerIndicators}
            it={it}
            maxShown={clinicalMaxShown}
            variant={compact ? "default" : "table"}
            onExpand={onExpandClinical}
          />
        )
      ) : null}
    </div>
  );
}
