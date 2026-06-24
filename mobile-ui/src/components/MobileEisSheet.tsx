import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchClinicalPreCdSnapshot, type ClinicalPreCdRecord } from "../api";
import { eisBarPercent, eisColor, type EisBreakdown } from "../eis/eventImpactScore";
import { buildTickerEisDetail, type TickerEisDetail, type TickerEisEventDetail } from "../eis/tickerEisSummary";
import { useMobileLang } from "../hooks/useMobileLang";
import { formatEisBadge } from "../mobileActionsTable";
import { MobileClinicalIndicatorGrid } from "./MobileClinicalIndicatorGrid";

type Props = {
  open: boolean;
  ticker: string | null;
  eisScore: number | null;
  eisHint: string | null;
  onClose: () => void;
};

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function BreakdownGrid({ b, it }: { b: EisBreakdown; it: boolean }) {
  const w = b.weights;
  return (
    <div className="eis-breakdown-grid">
      <div className="eis-breakdown-cell">
        <p className="eis-breakdown-label">{it ? "ΔP 1g" : "ΔP 1d"}</p>
        <p className="eis-breakdown-val">{fmtPct(b.delta_p_1d)}</p>
        <p className="eis-breakdown-w">×{(w.w1 * 100).toFixed(0)}%</p>
      </div>
      <div className="eis-breakdown-cell">
        <p className="eis-breakdown-label">{it ? "ΔP 3g" : "ΔP 3d"}</p>
        <p className="eis-breakdown-val">{fmtPct(b.delta_p_3d)}</p>
        <p className="eis-breakdown-w">×{(w.w2 * 100).toFixed(0)}%</p>
      </div>
      <div className="eis-breakdown-cell">
        <p className="eis-breakdown-label">{it ? "Volume" : "Volume"}</p>
        <p className="eis-breakdown-val">{fmtNum(b.vol_term)}</p>
        <p className="eis-breakdown-w">×{(w.w3 * 100).toFixed(0)}%</p>
      </div>
      <div className="eis-breakdown-cell">
        <p className="eis-breakdown-label">KPI / sent</p>
        <p className="eis-breakdown-val">
          {b.kpi_score != null ? fmtNum(b.kpi_score) : fmtNum(b.sent_term)}
        </p>
        <p className="eis-breakdown-w">×{(w.w4 * 100).toFixed(0)}%</p>
      </div>
    </div>
  );
}

function EisScoreBadge({ score }: { score: number }) {
  const color = eisColor(score);
  const w = eisBarPercent(score);
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";
  return (
    <div className="eis-score-badge-wrap">
      <span
        className="eis-score-badge"
        style={{ color, borderColor: `${color}66`, background: `${color}18` }}
      >
        {arrow} EIS {score >= 0 ? "+" : ""}
        {score.toFixed(1)}
      </span>
      <div className="eis-score-bar">
        <div className="eis-score-bar-fill" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

function EventCard({ ev, it, locale }: { ev: TickerEisEventDetail; it: boolean; locale: string }) {
  const score = ev.breakdown.score;
  const color = eisColor(score);
  const w = eisBarPercent(score);
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";

  return (
    <article className="eis-event-card">
      <div className="eis-event-card-head">
        <div className="eis-event-card-main">
          <div className="eis-event-top">
            <span className="eis-event-source">{ev.sourceLabel}</span>
            <span className="eis-event-date">{fmtDate(ev.eventDate, locale)}</span>
          </div>
          <h4 className="eis-event-title">{ev.title}</h4>
          {ev.summary && ev.summary !== ev.title ? (
            <p className="eis-event-summary">{ev.summary}</p>
          ) : null}
        </div>
        <div className="eis-event-card-score">
          <span
            className="eis-event-score-pill"
            style={{ color, borderColor: `${color}66`, background: `${color}18` }}
          >
            {arrow} EIS {score >= 0 ? "+" : ""}
            {score.toFixed(1)}
          </span>
          <div className="eis-score-bar eis-score-bar-sm">
            <div className="eis-score-bar-fill" style={{ width: `${w}%`, background: color }} />
          </div>
        </div>
      </div>
      <BreakdownGrid b={ev.breakdown} it={it} />
      {ev.indicators.length ? (
        <MobileClinicalIndicatorGrid indicators={ev.indicators} it={it} maxShown={4} />
      ) : null}
      {ev.impactNote ? <p className="eis-event-impact">{ev.impactNote}</p> : null}
      {ev.link ? (
        <a className="actions-eis-link" href={ev.link} target="_blank" rel="noopener noreferrer">
          {it ? "Apri fonte" : "Open source"} →
        </a>
      ) : null}
    </article>
  );
}

function HeroCard({ detail, ticker, it, fallbackScore }: { detail: TickerEisDetail; ticker: string; it: boolean; fallbackScore: number | null }) {
  const score = detail.score ?? fallbackScore;
  const heroBreakdown = detail.heroBreakdown ?? detail.events[0]?.breakdown ?? null;

  return (
    <div className="eis-hero-card">
      <div className="eis-hero-head">
        <div className="eis-hero-copy">
          <p className="eis-hero-kicker">Event Impact Score</p>
          <h3 className="eis-hero-ticker">
            {ticker.toUpperCase()}
            {detail.company ? ` · ${detail.company}` : ""}
          </h3>
          {detail.studyTitle ? <p className="eis-hero-study">{detail.studyTitle}</p> : null}
          <div className="eis-hero-meta">
            {detail.nctId && detail.studyUrl ? (
              <a className="eis-nct-link" href={detail.studyUrl} target="_blank" rel="noopener noreferrer">
                {detail.nctId} · ClinicalTrials.gov ↗
              </a>
            ) : detail.nctId ? (
              <span className="eis-nct-mono">{detail.nctId}</span>
            ) : null}
            {detail.studyPhase ? <span className="eis-phase-pill">{detail.studyPhase}</span> : null}
            {detail.feedLabels.length ? (
              <span className="eis-feed-labels">{detail.feedLabels.join(" · ")}</span>
            ) : null}
            {detail.studyConditions ? (
              <span className="eis-conditions">{detail.studyConditions}</span>
            ) : null}
          </div>
        </div>
        {score != null && Number.isFinite(score) ? (
          <div className="eis-hero-score">
            <EisScoreBadge score={score} />
            {detail.breakdownHint ? <p className="eis-hero-hint">{detail.breakdownHint}</p> : null}
          </div>
        ) : (
          <p className="hint">EIS —</p>
        )}
      </div>

      {detail.sheetFallback ? (
        <p className="eis-sheet-fallback">
          {it
            ? "Score da colonna Simulation — nessun evento nel feed clinico."
            : "Score from Simulation sheet column — no clinical feed events."}
        </p>
      ) : null}

      {heroBreakdown ? <BreakdownGrid b={heroBreakdown} it={it} /> : null}

      <p className="eis-formula">
        EIS = 0.35×ΔP₁d + 0.35×ΔP₃d + 0.15×(vol−1)×20 + 0.15×KPI×10
        {it
          ? " · KPI da endpoint/ORR/EASI/IGA · fonti: Intelligence, PubMed, press, SEC 8-K, CD/CT.gov"
          : " · KPI from endpoint/ORR/EASI/IGA · sources: Intelligence, PubMed, press, SEC 8-K, CD/CT.gov"}
      </p>

      <MobileClinicalIndicatorGrid
        title={
          it ? "Riepilogo indici clinici (rollup pre-CD)" : "Clinical indices summary (pre-CD rollup)"
        }
        indicators={detail.clinicalIndicators}
        it={it}
        maxShown={6}
        note={
          it
            ? "Gli indici quantificabili (ORR, PFS, enrollment, endpoint) alimentano il termine KPI×10 dell'EIS."
            : "Quantifiable indices (ORR, PFS, enrollment, endpoints) feed the KPI×10 term in EIS."
        }
      />
    </div>
  );
}

export function MobileEisSheet({ open, ticker, eisScore, eisHint, onClose }: Props) {
  const { lang, t, locale } = useMobileLang();
  const it = lang === "it";
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [records, setRecords] = useState<ClinicalPreCdRecord[]>([]);

  useEffect(() => {
    if (!open || !ticker) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const snap = await fetchClinicalPreCdSnapshot();
        if (cancelled) return;
        setRecords(snap.records ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ticker]);

  const detail = useMemo(() => {
    if (!ticker) return null;
    return buildTickerEisDetail(ticker, records, lang, eisScore ?? undefined);
  }, [ticker, records, lang, eisScore]);

  const displayScore = detail?.score ?? eisScore;
  const badge = formatEisBadge(displayScore);

  if (!open || !ticker || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sheet-root eis-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-label={t("eis.detailTitle", { ticker: ticker.toUpperCase() })}
    >
      <button type="button" className="sheet-backdrop" aria-label={t("common.close")} onClick={onClose} />
      <div className="sheet-panel eis-sheet-panel">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div>
            <h2>{t("eis.detailTitle", { ticker: ticker.toUpperCase() })}</h2>
            <p className="eis-sheet-subtitle">{t("eis.detailSubtitle")}</p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="sheet-body eis-sheet-body">
          {loading ? (
            <p className="hint eis-loading">{t("common.loading")}</p>
          ) : err ? (
            <p className="msg err">{err}</p>
          ) : detail ? (
            <>
              <HeroCard detail={detail} ticker={ticker} it={it} fallbackScore={eisScore} />
              {detail.events.length > 0 ? (
                <section className="eis-events-section">
                  <h4 className="eis-events-heading">
                    {it
                      ? `Eventi clinici (${detail.events.length})`
                      : `Clinical events (${detail.events.length})`}
                  </h4>
                  <div className="eis-event-list">
                    {detail.events.map((ev, i) => (
                      <EventCard key={`${ev.eventDate}-${ev.title}-${i}`} ev={ev} it={it} locale={locale} />
                    ))}
                  </div>
                </section>
              ) : !detail.sheetFallback ? (
                <p className="hint eis-no-events">
                  {it
                    ? "Nessun evento con EIS calcolabile nel feed clinico per questo ticker."
                    : "No events with computable EIS in the clinical feed for this ticker."}
                </p>
              ) : null}
            </>
          ) : (
            <div className="eis-sheet-hero">
              <span
                className={`actions-eis-badge ${badge.hasScore ? "" : "actions-eis-badge-muted"}`}
                style={
                  badge.hasScore
                    ? { color: badge.color, borderColor: `${badge.color}66`, background: `${badge.color}18` }
                    : undefined
                }
              >
                {badge.label}
              </span>
              {eisHint ? <p className="hint eis-sheet-hint">{eisHint}</p> : null}
              <p className="hint eis-no-events">{t("eis.noEvents")}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
