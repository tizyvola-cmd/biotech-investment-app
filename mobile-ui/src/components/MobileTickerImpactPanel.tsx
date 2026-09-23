import { useMemo } from "react";
import type { TickerEisDetail, TickerEisEventDetail } from "../eis/tickerEisSummary";
import { eisColor } from "../eis/eventImpactScore";
import {
  classifyTickerEisEvent,
  impactKindBadge,
  topImpactEventsByKind,
} from "../eis/tickerImpactEvents";
import {
  formatRegulatoryScoreDisplay,
  regulatoryScoreColor,
  regulatoryScoreSummaryLabel,
} from "../mobileRegulatoryDisplay";
import { useMobileLang } from "../hooks/useMobileLang";

function fmtShortDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", { day: "2-digit", month: "short" });
}

function ImpactEventRow({ ev, it }: { ev: TickerEisEventDetail; it: boolean }) {
  const kind = classifyTickerEisEvent(ev);
  const badge = impactKindBadge(kind, it);
  const score = ev.breakdown.score;
  const href = ev.link?.trim() || ev.studyUrl?.trim() || null;

  return (
    <li className="mob-impact-event">
      <div className="mob-impact-event-main">
        <div className="mob-impact-event-meta">
          <span className={`mob-impact-badge ${badge.className}`}>{badge.label}</span>
          <span className="mob-impact-date">{fmtShortDate(ev.eventDate, it)}</span>
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="mob-impact-title mob-impact-title--link">
            {ev.title}
          </a>
        ) : (
          <p className="mob-impact-title">{ev.title}</p>
        )}
      </div>
      <span className="mob-impact-score" style={{ color: eisColor(score) }}>
        {score >= 0 ? "+" : ""}
        {score.toFixed(1)}
      </span>
    </li>
  );
}

function ScoreLane({
  label,
  score,
  scoreKind,
  events,
  emptyLabel,
  it,
  onOpenDetail,
}: {
  label: string;
  score: number | null | undefined;
  scoreKind: "eis" | "regRisk";
  events: TickerEisEventDetail[];
  emptyLabel: string;
  it: boolean;
  onOpenDetail?: () => void;
}) {
  const lang = it ? "it" : "en";
  const hasScore = score != null && Number.isFinite(score);

  return (
    <div className="mob-impact-lane">
      <div className="mob-impact-lane-head">
        {onOpenDetail ? (
          <button type="button" className="mob-impact-lane-label mob-impact-lane-link" onClick={onOpenDetail}>
            {label} →
          </button>
        ) : (
          <p className="mob-impact-lane-label">{label}</p>
        )}
        {hasScore ? (
          scoreKind === "regRisk" ? (
            <span className="mob-impact-reg-score" style={{ color: regulatoryScoreColor(score!) }}>
              {formatRegulatoryScoreDisplay(score!)}
            </span>
          ) : (
            <span className="mob-impact-eis-score" style={{ color: eisColor(score!) }}>
              {score! >= 0 ? "+" : ""}
              {score!.toFixed(1)}
            </span>
          )
        ) : (
          <span className="mob-impact-score-empty">—</span>
        )}
      </div>
      {scoreKind === "regRisk" && hasScore ? (
        <p className="mob-impact-lane-hint">{regulatoryScoreSummaryLabel(score!, lang)}</p>
      ) : null}
      {events.length ? (
        <ul className="mob-impact-events">
          {events.map((ev, i) => (
            <ImpactEventRow key={`${ev.eventDate}-${ev.title}-${i}`} ev={ev} it={it} />
          ))}
        </ul>
      ) : (
        <p className="hint mob-impact-empty">{emptyLabel}</p>
      )}
    </div>
  );
}

type Props = {
  eisDetail: TickerEisDetail;
  regulatorySignedScore: number | null;
  onOpenEis?: () => void;
  onOpenRegulatory?: () => void;
  onOpenAll?: () => void;
};

export function MobileTickerImpactPanel({
  eisDetail,
  regulatorySignedScore,
  onOpenEis,
  onOpenRegulatory,
  onOpenAll,
}: Props) {
  const { t, lang } = useMobileLang();
  const it = lang === "it";
  const impactByKind = useMemo(() => topImpactEventsByKind(eisDetail, 2), [eisDetail]);

  return (
    <section className="mob-impact-panel">
      <div className="mob-impact-grid">
        <ScoreLane
          label="EIS"
          score={eisDetail.score}
          scoreKind="eis"
          events={impactByKind.clinical}
          emptyLabel={it ? "Nessuna news EIS recente" : "No recent EIS news"}
          it={it}
          onOpenDetail={onOpenEis ?? onOpenAll}
        />
        <ScoreLane
          label={it ? "Regolatorio" : "Regulatory"}
          score={regulatorySignedScore}
          scoreKind="regRisk"
          events={impactByKind.regulatory}
          emptyLabel={it ? "Nessuna news regolatoria recente" : "No recent regulatory news"}
          it={it}
          onOpenDetail={onOpenRegulatory ?? onOpenAll}
        />
      </div>
      {onOpenAll && (eisDetail.events.length > 0 || eisDetail.clinicalIndicators.length > 0) ? (
        <button type="button" className="mob-impact-more" onClick={onOpenAll}>
          {t("opportunity.impactMore")}
        </button>
      ) : null}
    </section>
  );
}
