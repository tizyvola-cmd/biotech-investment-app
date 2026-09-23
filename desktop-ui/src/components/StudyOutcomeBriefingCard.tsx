import type { CSSProperties, ReactNode } from "react";
import type { StudyOutcomeBriefing, StudyOutcomeDataLine } from "../sheet/studyOutcomeBriefing";
import { DiseaseSocBanner } from "./ClinicalIndicatorSummary";
import type { DiseaseSocContext } from "../api/supernova";
import { localizeStudyPhase, localizeStudyStatus } from "../sheet/clinicalIndicators";
import { eisBarPercent, eisColor } from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import { NctStudyLink } from "./EisStudyContextHeader";

function fmtEndedDate(iso: string | null): string {
  if (!iso) return "—";
  if (/[A-Za-z]{3,}/.test(iso) && !/^\d{4}-\d{2}/.test(iso)) return iso;
  const day = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso.slice(0, 7);
  const d = new Date(`${day.length === 7 ? `${day}-01` : day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: day.length >= 10 ? "2-digit" : undefined,
    month: "short",
    year: "numeric",
  });
}

function BriefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
      <span className="font-semibold text-ink-muted shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wide font-bold text-ink pt-2 mt-1 border-t border-[rgb(var(--border))]/40">
      {children}
    </p>
  );
}

/** Palette aqua (#34D399) fill + dark brilliant green left rail. */
const MET_CARD_STYLE: CSSProperties = {
  background: "rgb(var(--positive) / 0.22)",
  borderColor: "rgb(var(--positive) / 0.38)",
  borderLeftWidth: 4,
  borderLeftColor: "#0B8F62",
};
const MISS_CARD_STYLE: CSSProperties = {
  background: "rgb(var(--negative) / 0.16)",
  borderColor: "rgb(var(--negative) / 0.38)",
  borderLeftWidth: 4,
  borderLeftColor: "#BE123C",
};

function DataLines({
  lines,
  empty,
}: {
  lines: StudyOutcomeDataLine[];
  empty: string;
}) {
  if (!lines.length) {
    if (!empty) return null;
    return <p className="text-[12px] text-ink-muted">{empty}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {lines.map((line, i) => {
        const missed = line.endpointMet === false;
        const met = line.endpointMet === true;
        const toneCls = missed || met
          ? "border"
          : "border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-2))]/25";
        const valueCls = missed
          ? "text-[rgb(var(--negative))]"
          : met
            ? "text-[rgb(var(--positive))]"
            : "text-ink";
        return (
          <li
            key={`${line.label}-${line.value}-${i}`}
            className={`rounded-md px-2.5 py-2 space-y-1 ${toneCls}`}
            style={met ? MET_CARD_STYLE : missed ? MISS_CARD_STYLE : undefined}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className={`text-[12px] font-semibold leading-snug ${valueCls}`}>
                {line.label}
              </span>
              <span className="flex items-center gap-1.5">
                {missed ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--negative))]">
                    Endpoint not met
                  </span>
                ) : met ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[rgb(var(--positive))]">
                    Endpoint met
                  </span>
                ) : null}
                {line.timeFrame ? (
                  <span className="text-[10px] tabular-nums text-ink-muted">{line.timeFrame}</span>
                ) : null}
              </span>
            </div>
            <p className={`text-[13px] font-bold leading-snug ${valueCls}`}>
              {line.value}
              {line.href ? (
                <>
                  {" "}
                  <a
                    href={line.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2 whitespace-nowrap text-[11px]"
                    onClick={(e) => openExternalUrl(line.href!, e)}
                  >
                    [{line.sourceLabel || "source"} →]
                  </a>
                </>
              ) : line.sourceLabel ? (
                <span className="text-[11px] font-medium text-ink-muted"> · {line.sourceLabel}</span>
              ) : null}
            </p>
            {line.description ? (
              <p className={`text-[11px] leading-snug ${missed ? "text-[rgb(var(--negative))]/85" : "text-ink-muted"}`}>
                {line.description}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One study = one box. UI copy is English (clinical deep-dive standard). */
export function StudyOutcomeBriefingCard({
  briefing,
  diseaseSoc,
  index,
  total,
}: {
  briefing: StudyOutcomeBriefing;
  diseaseSoc?: DiseaseSocContext | null;
  /** 1-based study index when stacking multiple studies. */
  index?: number;
  total?: number;
}) {
  const endedLabel =
    briefing.endedKind === "primary_completion"
      ? "Primary completion"
      : briefing.endedKind === "completion"
        ? "Completion"
        : briefing.endedKind === "cd"
          ? "Completion date (CD)"
          : "End / status";

  const patientsParts: string[] = [];
  if (briefing.enrollment != null) {
    patientsParts.push(
      briefing.patientsTarget != null
        ? `n=${briefing.enrollment} / target ${briefing.patientsTarget}`
        : `n=${briefing.enrollment}`,
    );
  }
  if (briefing.nTreatment != null || briefing.nControl != null) {
    const arms = [
      briefing.nTreatment != null ? `treatment ${briefing.nTreatment}` : null,
      briefing.nControl != null ? `control ${briefing.nControl}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (arms) patientsParts.push(arms);
  }

  const header =
    total != null && total > 1 && index != null
      ? `Study ${index} of ${total}`
      : "Study outcome";

  const eisScore =
    briefing.eisScore != null && Number.isFinite(briefing.eisScore)
      ? briefing.eisScore
      : null;
  const eisColorValue = eisScore != null ? eisColor(eisScore) : null;
  const eisW = eisScore != null ? eisBarPercent(eisScore) : 0;
  const eisArrow =
    eisScore != null && eisScore >= 5 ? "↑" : eisScore != null && eisScore <= -5 ? "↓" : "–";

  return (
    <section className="rounded-lg border-2 border-[rgb(var(--border))]/55 bg-[rgb(var(--surface))] p-3.5 space-y-2.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide font-bold text-ink">{header}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {briefing.phase ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-[rgb(var(--surface-3))]/80 px-1.5 py-0.5 text-ink-muted">
                {localizeStudyPhase(briefing.phase, false)}
              </span>
            ) : null}
            {briefing.nctId && briefing.studyUrl ? (
              <NctStudyLink nctId={briefing.nctId} href={briefing.studyUrl} />
            ) : briefing.nctId ? (
              <span className="text-[10px] font-mono text-ink-muted">{briefing.nctId}</span>
            ) : null}
          </div>
        </div>
        {eisScore != null && eisColorValue ? (
          <div className="shrink-0 text-right">
            <span
              className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: `${eisColorValue}18`,
                color: eisColorValue,
                border: `1px solid ${eisColorValue}40`,
              }}
              title={
                briefing.eisEventTitle
                  ? `EIS from event: ${briefing.eisEventTitle}`
                  : "EIS from linked clinical event"
              }
            >
              {eisArrow} EIS {eisScore >= 0 ? "+" : ""}
              {eisScore.toFixed(1)}
            </span>
            <div className="h-1.5 w-20 bg-slate-200/80 rounded-full mt-1 ml-auto overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${eisW}%`, background: eisColorValue }}
              />
            </div>
            {briefing.eisKpiScore != null ? (
              <p className="text-[9px] text-ink-muted mt-0.5 tabular-nums">
                KPI {briefing.eisKpiScore >= 0 ? "+" : ""}
                {briefing.eisKpiScore.toFixed(2)}
              </p>
            ) : null}
            {briefing.eisEventDate ? (
              <p className="text-[9px] text-ink-muted mt-0.5 tabular-nums">{briefing.eisEventDate}</p>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-ink-muted font-medium">EIS —</span>
        )}
      </div>

      {index === 1 || index == null ? (
        <DiseaseSocBanner ctx={diseaseSoc ?? null} it={false} />
      ) : null}

      <div className="space-y-2">
        <BriefRow label="Study title">
          {briefing.studyTitle ? (
            <span className="font-semibold text-[13px] leading-snug">{briefing.studyTitle}</span>
          ) : (
            <span className="text-ink-muted">Not available</span>
          )}
        </BriefRow>

        <BriefRow label={endedLabel}>
          <span className="tabular-nums">
            {briefing.endedDate
              ? fmtEndedDate(briefing.endedDate)
              : briefing.status
                ? localizeStudyStatus(briefing.status, false)
                : "Not reported"}
            {briefing.endedDate && briefing.status
              ? ` · ${localizeStudyStatus(briefing.status, false)}`
              : null}
          </span>
        </BriefRow>

        <BriefRow label="Study design">
          {briefing.design ?? (
            <span className="text-ink-muted">
              Not extracted — run Clinical refresh / Deep on the feed
            </span>
          )}
        </BriefRow>

        <BriefRow label="Patients enrolled">
          {patientsParts.length ? (
            patientsParts.join(" · ")
          ) : (
            <span className="text-ink-muted">N not reported</span>
          )}
        </BriefRow>

        <BriefRow label="Inclusion criteria">
          {briefing.inclusionCriteria ? (
            <span className="whitespace-pre-wrap">{briefing.inclusionCriteria}</span>
          ) : (
            <span className="text-ink-muted">Not extracted yet — refresh CT.gov on the feed</span>
          )}
        </BriefRow>
      </div>

      <SectionTitle>Efficacy data</SectionTitle>
      <div className="space-y-1.5">
        {briefing.efficacyPrimary ? (
          <p className="text-[12px] text-ink leading-snug">
            <span className="font-semibold">Primary:</span> {briefing.efficacyPrimary}
          </p>
        ) : null}
        {briefing.efficacySecondary ? (
          <p className="text-[12px] text-ink leading-snug">
            <span className="font-semibold">Secondary:</span> {briefing.efficacySecondary}
          </p>
        ) : null}
        {briefing.efficacyProse ? (
          <p className="text-[12px] text-ink-muted leading-snug">{briefing.efficacyProse}</p>
        ) : null}
        <DataLines
          lines={briefing.efficacyLines}
          empty={
            briefing.efficacyPrimary || briefing.efficacySecondary || briefing.efficacyProse
              ? ""
              : "No quantified efficacy data"
          }
        />
      </div>

      <SectionTitle>Safety data</SectionTitle>
      <div className="space-y-1.5">
        {briefing.safetySummary ? (
          <p className="text-[12px] text-ink leading-snug">{briefing.safetySummary}</p>
        ) : null}
        <DataLines
          lines={briefing.safetyLines}
          empty={briefing.safetySummary ? "" : "No quantified safety data"}
        />
      </div>

      <SectionTitle>Original source links</SectionTitle>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {briefing.sourceLinks.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-semibold text-[rgb(var(--accent))] hover:underline underline-offset-2"
            onClick={(e) => openExternalUrl(l.href, e)}
          >
            {l.label} →
          </a>
        ))}
        {!briefing.sourceLinks.length ? (
          <span className="text-[12px] text-ink-muted">No links — enrich the clinical feed</span>
        ) : null}
      </div>
    </section>
  );
}
