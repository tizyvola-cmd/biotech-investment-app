import { buildTickerEisDetail, type TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { eisBarPercent, eisColor, type EisBreakdown } from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import {
  ClinicalIndicatorChips,
  ClinicalIndicatorSummaryBlock,
} from "./ClinicalIndicatorSummary";
import { prepareClinicalIndicators } from "../sheet/clinicalIndicators";

function NctStudyLink({
  nctId,
  href,
}: {
  nctId: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/50 underline-offset-2 hover:decoration-[rgb(var(--accent))]"
      onClick={(e) => openExternalUrl(href, e)}
    >
      {nctId}
      <span className="opacity-60 no-underline">↗</span>
      <span className="font-normal text-ink-muted no-underline">
        · ClinicalTrials.gov
      </span>
    </a>
  );
}

function StudyMetaRow({
  nctId,
  studyUrl,
  studyPhase,
  feedLabels,
  studyConditions,
}: {
  nctId: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  feedLabels: string[];
  studyConditions: string | null;
}) {
  if (!nctId && !studyPhase && !feedLabels.length && !studyConditions) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-ink-muted">
      {nctId && studyUrl ? (
        <NctStudyLink nctId={nctId} href={studyUrl} />
      ) : nctId ? (
        <span className="font-mono">{nctId}</span>
      ) : null}
      {studyPhase ? (
        <span className="rounded bg-[rgb(var(--surface-3))]/80 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
          {studyPhase}
        </span>
      ) : null}
      {feedLabels.length ? <span>{feedLabels.join(" · ")}</span> : null}
      {studyConditions ? (
        <span className="w-full text-[10px] text-ink-muted/90 leading-snug line-clamp-2">
          {studyConditions}
        </span>
      ) : null}
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

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

function BreakdownGrid({ b, it }: { b: EisBreakdown; it: boolean }) {
  const w = b.weights;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] tabular-nums">
      <div className="rounded border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-black/10 px-2 py-1">
        <p className="text-ink-muted/80">{it ? "ΔP 1g" : "ΔP 1d"}</p>
        <p className="font-semibold">{fmtPct(b.delta_p_1d)}</p>
        <p className="text-[9px] text-ink-muted">×{(w.w1 * 100).toFixed(0)}%</p>
      </div>
      <div className="rounded border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-black/10 px-2 py-1">
        <p className="text-ink-muted/80">{it ? "ΔP 3g" : "ΔP 3d"}</p>
        <p className="font-semibold">{fmtPct(b.delta_p_3d)}</p>
        <p className="text-[9px] text-ink-muted">×{(w.w2 * 100).toFixed(0)}%</p>
      </div>
      <div className="rounded border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-black/10 px-2 py-1">
        <p className="text-ink-muted/80">{it ? "Volume" : "Volume"}</p>
        <p className="font-semibold">{fmtNum(b.vol_term)}</p>
        <p className="text-[9px] text-ink-muted">×{(w.w3 * 100).toFixed(0)}%</p>
      </div>
      <div className="rounded border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-black/10 px-2 py-1">
        <p className="text-ink-muted/80">KPI / sent</p>
        <p className="font-semibold">
          {b.kpi_score != null ? fmtNum(b.kpi_score) : fmtNum(b.sent_term)}
        </p>
        <p className="text-[9px] text-ink-muted">×{(w.w4 * 100).toFixed(0)}%</p>
      </div>
    </div>
  );
}

function EventCard({ ev, it }: { ev: TickerEisEventDetail; it: boolean }) {
  const color = eisColor(ev.breakdown.score);
  const w = eisBarPercent(ev.breakdown.score);
  const arrow = ev.breakdown.score >= 5 ? "↑" : ev.breakdown.score <= -5 ? "↓" : "–";
  const eventIndicators = prepareClinicalIndicators(ev.indicators);

  return (
    <article className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/60 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgb(var(--surface-3))]/80 text-ink-muted">
              {ev.sourceLabel}
            </span>
            <span className="text-[10px] text-ink-muted tabular-nums">{fmtDate(ev.eventDate, it)}</span>
          </div>
          <h4 className="text-sm font-semibold text-ink leading-snug">{ev.title}</h4>
          {ev.summary && ev.summary !== ev.title ? (
            <p className="text-[11px] text-ink-muted mt-1 leading-snug line-clamp-3">{ev.summary}</p>
          ) : null}
          {ev.studyTitle ? (
            <p className="text-[11px] font-medium text-ink/90 mt-1.5 leading-snug">{ev.studyTitle}</p>
          ) : null}
          {ev.nctId && ev.studyUrl ? (
            <div className="mt-1">
              <NctStudyLink nctId={ev.nctId} href={ev.studyUrl} />
            </div>
          ) : ev.nctId ? (
            <span className="text-[10px] font-mono text-ink-muted mt-1 inline-block">{ev.nctId}</span>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <span
            className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
          >
            {arrow} EIS {ev.breakdown.score >= 0 ? "+" : ""}
            {ev.breakdown.score.toFixed(1)}
          </span>
          <div className="h-1.5 w-20 bg-slate-200/80 rounded-full mt-1.5 ml-auto overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
          </div>
        </div>
      </div>
      <BreakdownGrid b={ev.breakdown} it={it} />
      <div className="border-t border-[rgb(var(--border))]/30 pt-2 space-y-1.5">
        <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted/85">
          {it ? "Indici clinici (componente KPI EIS)" : "Clinical indices (EIS KPI component)"}
        </p>
        <ClinicalIndicatorChips indicators={eventIndicators} it={it} maxShown={4} />
      </div>
      {ev.impactNote ? (
        <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
          {ev.impactNote}
        </p>
      ) : null}
    </article>
  );
}

export function EisDetailPanel({
  ticker,
  clinicalKpi,
  it = false,
}: {
  ticker: string;
  clinicalKpi?: number | null;
  it?: boolean;
}) {
  const detail = buildTickerEisDetail(ticker, it ? "it" : "en", clinicalKpi);
  const score = detail.score;
  const color = score != null && Number.isFinite(score) ? eisColor(score) : null;
  const w = score != null && Number.isFinite(score) ? eisBarPercent(score) : 0;
  const arrow =
    score != null && score >= 5 ? "↑" : score != null && score <= -5 ? "↓" : "–";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--accent))]/5 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
              Event Impact Score
            </p>
            <h3 className="text-xl font-bold text-ink">{ticker.toUpperCase()}</h3>
            {detail.company ? (
              <p className="text-[12px] text-ink-muted">{detail.company}</p>
            ) : null}
            {detail.studyTitle ? (
              <p className="text-[13px] font-semibold text-ink leading-snug mt-1.5 max-w-prose">
                {detail.studyTitle}
              </p>
            ) : null}
            <StudyMetaRow
              nctId={detail.nctId}
              studyUrl={detail.studyUrl}
              studyPhase={detail.studyPhase}
              feedLabels={detail.feedLabels}
              studyConditions={detail.studyConditions}
            />
          </div>
          {score != null && Number.isFinite(score) && color ? (
            <div className="text-right shrink-0">
              <span
                className="inline-flex items-center gap-1 text-lg font-bold px-3 py-1 rounded-full"
                style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
              >
                {arrow} EIS {score >= 0 ? "+" : ""}
                {score.toFixed(1)}
              </span>
              <div className="h-2 w-28 bg-slate-200/80 rounded-full mt-2 ml-auto overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
              </div>
              {detail.breakdownHint ? (
                <p className="text-[10px] text-ink-muted mt-1 max-w-[12rem]">{detail.breakdownHint}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">EIS —</p>
          )}
        </div>

        {detail.sheetFallback ? (
          <p className="text-[11px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border border-[rgb(var(--warn))]/25 rounded-md px-2.5 py-1.5">
            {it
              ? "Score da colonna Simulation — nessun evento nel feed clinico. Aggiorna il feed per il breakdown completo."
              : "Score from Simulation sheet column — no clinical feed events. Refresh feed for full breakdown."}
          </p>
        ) : null}

        <p className="text-[10px] text-ink-muted leading-snug">
          EIS = 0.35×ΔP₁d + 0.35×ΔP₃d + 0.15×(vol−1)×20 + 0.15×KPI×10
          {it
            ? " · KPI da endpoint/ORR/EASI/IGA · fonti: Intelligence, PubMed, press, SEC 8-K, CD/CT.gov"
            : " · KPI from endpoint/ORR/EASI/IGA · sources: Intelligence, PubMed, press, SEC 8-K, CD/CT.gov"}
        </p>

        <ClinicalIndicatorSummaryBlock
          title={
            it
              ? "Riepilogo indici clinici (rollup pre-CD)"
              : "Clinical indices summary (pre-CD rollup)"
          }
          indicators={detail.clinicalIndicators}
          it={it}
          maxShown={6}
          note={
            clinicalKpi != null && Number.isFinite(clinicalKpi)
              ? it
                ? `Clinical KPI foglio Simulation: ${clinicalKpi >= 0 ? "+" : ""}${clinicalKpi.toFixed(2)} (peso ×15% nella formula EIS quando presente nel feed).`
                : `Simulation sheet Clinical KPI: ${clinicalKpi >= 0 ? "+" : ""}${clinicalKpi.toFixed(2)} (×15% EIS weight when present in feed).`
              : it
                ? "Gli indici quantificabili (ORR, PFS, enrollment, endpoint) alimentano il termine KPI×10 dell'EIS."
                : "Quantifiable indices (ORR, PFS, enrollment, endpoints) feed the KPI×10 term in EIS."
          }
        />
      </div>

      {detail.events.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">
            {it
              ? `Eventi clinici (${detail.events.length})`
              : `Clinical events (${detail.events.length})`}
          </h4>
          <div className="space-y-2">
            {detail.events.map((ev, i) => (
              <EventCard key={`${ev.eventDate}-${ev.title}-${i}`} ev={ev} it={it} />
            ))}
          </div>
        </div>
      ) : !detail.sheetFallback ? (
        <p className="text-[12px] text-ink-muted text-center py-6 border border-dashed rounded-lg">
          {it
            ? "Nessun evento con EIS calcolabile nel feed clinico per questo ticker."
            : "No events with computable EIS in the clinical feed for this ticker."}
        </p>
      ) : null}
    </div>
  );
}
