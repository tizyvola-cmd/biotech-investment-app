import { useMemo, useState } from "react";
import type { ResidualMoveBreakdown } from "../sheet/residualMoveAttribution";
import {
  formatResidualSummary,
  residualDominantChannel,
  residualDominantChannelLabel,
} from "../sheet/residualMoveAttribution";
import {
  buildTickerEisDetail,
  type TickerEisEventDetail,
} from "../sheet/tickerEisSummary";
import {
  listManualFeedEventsForTicker,
  resolveManualEventEis,
  resolveManualFeedEventLink,
  type ManualFeedEventDraft,
} from "../sheet/manualFeedEvents";
import { eisColor } from "../sheet/eventImpactScore";
import {
  localizeClinicalIndicatorLabel,
  localizeClinicalIndicatorValue,
} from "../sheet/clinicalIndicators";
import { useT } from "../shared/i18n";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { ManualNewsDetailModal } from "./ManualNewsDetailModal";

function fmtSignedPct(v: number, digits = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtSignedNum(v: number, digits = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}`;
}

function fmtDateLoc(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function eventFallsInWindow(iso: string | null | undefined, windowDays: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(`${iso}T12:00:00`);
  if (!Number.isFinite(ms)) return false;
  const cutoff = Date.now() - windowDays * 86_400_000;
  return ms >= cutoff;
}

function ChannelBar({
  label,
  hint,
  value,
  highlight,
  muted,
}: {
  label: string;
  hint: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
}) {
  const abs = Math.abs(value);
  // Bar caps at 20% for visual comparability across cards.
  const barW = Math.min(100, (abs / 20) * 100);
  return (
    <div
      className={`flex items-start gap-3 rounded-md px-2 py-1.5 ${
        muted ? "opacity-55" : highlight ? "ring-1 ring-sky-300/70 bg-sky-50/40 dark:bg-sky-950/20" : ""
      }`}
    >
      <div className="w-[7rem] shrink-0">
        <p className="text-[11px] font-semibold text-ink leading-tight">{label}</p>
        <p className="text-[9px] text-ink-muted leading-snug">{hint}</p>
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-700/50 overflow-hidden">
          <div
            className={`h-full rounded-full ${value >= 0 ? "bg-emerald-500/75" : "bg-rose-500/75"}`}
            style={{ width: `${barW}%` }}
          />
        </div>
      </div>
      <span className="w-[4.5rem] shrink-0 text-right text-[12px] tabular-nums font-bold text-ink">
        {fmtSignedPct(value)}
      </span>
    </div>
  );
}

function EventCard({
  ev,
  it,
  onOpenLink,
}: {
  ev: TickerEisEventDetail;
  it: boolean;
  onOpenLink?: (link: string) => void;
}) {
  const b = ev.breakdown;
  const scoreColor = eisColor(b.score);
  const title = ev.title || (it ? "Evento clinico" : "Clinical event");
  const summary = ev.summary && ev.summary !== title ? ev.summary : null;
  const link = ev.link?.trim() || ev.studyUrl?.trim() || null;
  return (
    <li className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/70 dark:bg-surface/40 px-2.5 py-2 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-semibold text-ink tabular-nums">
          {fmtDateLoc(ev.eventDate, it)}
        </span>
        <span className="text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-px text-ink-muted">
          {ev.sourceLabel}
        </span>
        {ev.itemsRaw ? (
          <span className="text-[9px] text-ink-muted">· {it ? "voci" : "items"} {ev.itemsRaw}</span>
        ) : null}
        {ev.asset ? <span className="text-[9px] text-ink-muted">· {ev.asset}</span> : null}
        <span
          className="ml-auto shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-px rounded bg-surface/70"
          style={{ color: scoreColor }}
          title={it ? "Punteggio di impatto evento (EIS)" : "Event Impact Score"}
        >
          EIS {fmtSignedNum(b.score, 1)}
        </span>
      </div>

      <p className="text-[11px] font-medium text-ink leading-snug line-clamp-2">{title}</p>
      {summary ? (
        <p className="text-[10px] text-ink-muted leading-relaxed line-clamp-3">{summary}</p>
      ) : null}
      {ev.impactNote ? (
        <p className="text-[10px] italic text-ink-muted leading-relaxed line-clamp-2">
          “{ev.impactNote}”
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-muted tabular-nums pt-0.5">
        {b.delta_p_1d != null ? (
          <span title="ΔP₁d">
            <span className="font-semibold">ΔP₁d</span> {fmtSignedPct(b.delta_p_1d)}
          </span>
        ) : null}
        {b.delta_p_3d != null ? (
          <span title="ΔP₃d">
            · <span className="font-semibold">ΔP₃d</span> {fmtSignedPct(b.delta_p_3d)}
          </span>
        ) : null}
        {b.kpi_score != null ? (
          <span>
            · <span className="font-semibold">KPI</span> {fmtSignedNum(b.kpi_score, 2)}
          </span>
        ) : null}
        {Math.abs(b.sent_term) > 0.01 ? (
          <span>
            · <span className="font-semibold">sent</span> {fmtSignedNum(b.sent_term, 1)}
          </span>
        ) : null}
        {b.vol_term != null && Math.abs(b.vol_term) > 0.05 ? (
          <span>
            · <span className="font-semibold">vol</span> {fmtSignedNum(b.vol_term, 1)}
          </span>
        ) : null}
        {b.vol_ratio != null && Math.abs(b.vol_ratio - 1) > 0.05 ? (
          <span title={it ? "Rapporto volume" : "Volume ratio"}>
            · <span className="font-semibold">volR</span> {b.vol_ratio.toFixed(2)}×
          </span>
        ) : null}
      </div>

      {ev.indicators.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {ev.indicators.slice(0, 6).map((ind, i) => {
            const lab = localizeClinicalIndicatorLabel(String(ind.label ?? ""), it);
            const val = localizeClinicalIndicatorValue(String(ind.value ?? ""), it);
            return (
            <span
              key={`${ind.label}-${i}`}
              className="text-[9px] rounded bg-violet-50 dark:bg-violet-950/30 text-violet-800 dark:text-violet-200 px-1 py-px"
              title={val || undefined}
            >
              {lab}
              {val ? `: ${val.slice(0, 24)}` : ""}
            </span>
            );
          })}
          {ev.indicators.length > 6 ? (
            <span className="text-[9px] text-ink-muted">+{ev.indicators.length - 6}</span>
          ) : null}
        </div>
      ) : null}

      {link ? (
        <div className="pt-0.5">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline break-all"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLink?.(link);
            }}
          >
            {link.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 64)}
            {link.length > 68 ? "…" : ""} →
          </a>
        </div>
      ) : null}
    </li>
  );
}

export function ResidualAttributionDetailModal({
  ticker,
  breakdown,
  lang,
  onClose,
}: {
  ticker: string;
  breakdown: ResidualMoveBreakdown;
  lang: "it" | "en";
  onClose: () => void;
}) {
  const t = useT();
  const it = lang === "it";
  const [detailNote, setDetailNote] = useState<ManualFeedEventDraft | null>(null);

  const eisDetail = useMemo(() => buildTickerEisDetail(ticker, lang), [ticker, lang]);
  const manualNotes = useMemo(() => listManualFeedEventsForTicker(ticker), [ticker]);

  const eventsInWindow = useMemo(
    () => eisDetail.events.filter((ev) => eventFallsInWindow(ev.eventDate, 7)),
    [eisDetail.events],
  );
  const eventsOlder = useMemo(
    () =>
      eisDetail.events
        .filter((ev) => !eventFallsInWindow(ev.eventDate, 7))
        .slice(0, 6),
    [eisDetail.events],
  );

  const domLabel = residualDominantChannelLabel(breakdown, lang);
  const dominant = residualDominantChannel(breakdown);
  const summary = formatResidualSummary(breakdown, lang);

  const observedTone =
    breakdown.observedPct >= 0
      ? "text-[rgb(var(--signal-up))]"
      : "text-[rgb(var(--signal-down))]";

  const marketOnly = breakdown.flags.marketOnly;
  const explainedShareTone =
    breakdown.flags.splitContaminationSuspect
      ? "text-amber-700 dark:text-amber-300"
      : breakdown.flags.needsInvestigation
        ? "text-rose-700 dark:text-rose-300"
        : marketOnly || breakdown.flags.lowConfidence
          ? "text-amber-700 dark:text-amber-300"
          : breakdown.explainedSharePct >= 55
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-ink-muted";

  return (
    <>
      <AppModal
        open
        onClose={onClose}
        aria-label={
          it ? "Dettaglio attribuzione movimento" : "Move attribution detail"
        }
        panelClassName="w-full max-w-2xl"
      >
        <div className="card w-full max-h-[92vh] shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border))]/40 px-4 py-3 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {ticker} · {t("sim.lossAnalysis.residual.title")}
              </p>
              <h3 className="text-sm font-bold text-ink leading-snug mt-0.5">
                {t("sim.lossAnalysis.residual.detailModal.headline")}
              </h3>
              <p className={`mt-0.5 text-[11px] tabular-nums font-medium ${explainedShareTone}`}>
                {summary}
              </p>
            </div>
            <div className="flex items-start gap-2 shrink-0">
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wide text-ink-muted">
                  {t("sim.lossAnalysis.residual.observed")}
                </p>
                <p className={`text-lg font-bold tabular-nums leading-none ${observedTone}`}>
                  {fmtSignedPct(breakdown.observedPct)}
                </p>
              </div>
              <AppModalCloseButton onClose={onClose} />
            </div>
          </div>

          <div className="px-4 py-3 space-y-4 min-h-0 overflow-y-auto">
            <section className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink">
                  {t("sim.lossAnalysis.residual.detailModal.channelsTitle")}
                </h4>
                {domLabel ? (
                  <span className="text-[10px] text-ink-muted italic">
                    {t("sim.lossAnalysis.residual.detailModal.dominant", { label: domLabel })}
                  </span>
                ) : null}
              </div>
              <p className="text-[10px] text-ink-muted leading-relaxed">
                {t("sim.lossAnalysis.residual.lead")}
              </p>
              <div className="space-y-1 pt-1">
                <ChannelBar
                  label={t("sim.lossAnalysis.residual.channelMarket")}
                  hint={
                    marketOnly
                      ? t("sim.lossAnalysis.residual.channelMarketHintAlignmentOnly")
                      : t("sim.lossAnalysis.residual.channelMarketHint")
                  }
                  value={breakdown.marketExplainedPct}
                  highlight={dominant === "market" && !marketOnly}
                />
                <ChannelBar
                  label={t("sim.lossAnalysis.residual.channelEis")}
                  hint={
                    Math.abs(breakdown.eisManualBoostPct) >= 0.05 &&
                    Math.abs(breakdown.eisPricedPct) < 0.05
                      ? it
                        ? "Nota diluizione/M&A — non lo score EIS della scheda"
                        : "Dilution/M&A note — not the event EIS score"
                      : Math.abs(breakdown.eisManualBoostPct) >= 0.05
                        ? it
                          ? `ΔP ${breakdown.eisPricedPct.toFixed(1)}% + nota ${breakdown.eisManualBoostPct.toFixed(1)}%`
                          : `ΔP ${breakdown.eisPricedPct.toFixed(1)}% + note ${breakdown.eisManualBoostPct.toFixed(1)}%`
                        : t("sim.lossAnalysis.residual.channelEisHint", {
                            n: String(breakdown.eventCountInWindow),
                          })
                  }
                  value={breakdown.eisExplainedPct}
                  highlight={dominant === "eis"}
                  muted={
                    breakdown.eventCountInWindow === 0 &&
                    Math.abs(breakdown.eisExplainedPct) < 0.05
                  }
                />
                <ChannelBar
                  label={t("sim.lossAnalysis.residual.channelModel")}
                  hint={t("sim.lossAnalysis.residual.channelModelHint")}
                  value={breakdown.modelExplainedPct}
                  highlight={dominant === "model"}
                  muted={Math.abs(breakdown.modelExplainedPct) < 0.05}
                />
                <div className="flex items-center gap-3 rounded-md px-2 py-1.5 border-t border-[rgb(var(--border))]/40 mt-1 pt-2">
                  <div className="w-[7rem] shrink-0">
                    <p className="text-[11px] font-semibold text-ink leading-tight">
                      {t("sim.lossAnalysis.residual.detailModal.residualRow")}
                    </p>
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {t("sim.lossAnalysis.residual.detailModal.residualHint")}
                    </p>
                  </div>
                  <div className="flex-1" />
                  <span
                    className={`w-[4.5rem] shrink-0 text-right text-[12px] tabular-nums font-bold ${
                      Math.abs(breakdown.unexplainedPct) >= 3
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-ink-muted"
                    }`}
                  >
                    {fmtSignedPct(breakdown.unexplainedPct)}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-ink-muted tabular-nums pt-1">
                {t("sim.lossAnalysis.residual.totals", {
                  explained: fmtSignedPct(breakdown.explainedPct),
                  share: breakdown.explainedSharePct.toFixed(0),
                  residual: fmtSignedPct(breakdown.unexplainedPct),
                })}
              </p>
              {marketOnly ? (
                <p className="text-[10px] text-amber-800 dark:text-amber-300">
                  {t("sim.lossAnalysis.residual.marketOnlyHint")}
                </p>
              ) : breakdown.flags.lowConfidence ? (
                <p className="text-[10px] text-amber-800 dark:text-amber-300">
                  {t("sim.lossAnalysis.residual.lowConfidence")}
                </p>
              ) : null}
              {breakdown.flags.needsInvestigation ? (
                <p className="text-[10px] text-rose-700 dark:text-rose-300">
                  {t("sim.lossAnalysis.residual.investigateHint")}
                </p>
              ) : null}
              {breakdown.flags.splitContaminationSuspect ? (
                <p className="text-[10px] text-amber-800 dark:text-amber-300">
                  {t("sim.lossAnalysis.residual.detailModal.splitWarning")}
                </p>
              ) : null}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink">
                {t("sim.lossAnalysis.residual.detailModal.eventsTitle", {
                  n: String(eventsInWindow.length),
                })}
              </h4>
              <p className="text-[10px] text-ink-muted leading-relaxed">
                {t("sim.lossAnalysis.residual.detailModal.eventsLead")}
              </p>
              {eventsInWindow.length > 0 ? (
                <ul className="space-y-1.5">
                  {eventsInWindow.map((ev, i) => (
                    <EventCard key={`${ev.eventDate ?? "na"}-${i}`} ev={ev} it={it} />
                  ))}
                </ul>
              ) : (
                <p className="text-[10px] italic text-ink-muted">
                  {t("sim.lossAnalysis.residual.detailModal.eventsEmpty")}
                </p>
              )}

              {eventsOlder.length > 0 ? (
                <details className="pt-1">
                  <summary className="cursor-pointer text-[10px] font-semibold text-ink-muted hover:text-ink">
                    {t("sim.lossAnalysis.residual.detailModal.olderEvents", {
                      n: String(eventsOlder.length),
                    })}
                  </summary>
                  <ul className="space-y-1.5 mt-1.5">
                    {eventsOlder.map((ev, i) => (
                      <EventCard
                        key={`older-${ev.eventDate ?? "na"}-${i}`}
                        ev={ev}
                        it={it}
                      />
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>

            {manualNotes.length > 0 ? (
              <section className="space-y-1.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink">
                  {t("sim.lossAnalysis.residual.notesTitle")} · {manualNotes.length}
                </h4>
                <p className="text-[10px] text-ink-muted leading-relaxed">
                  {t("sim.lossAnalysis.residual.notesLead")}
                </p>
                <ul className="space-y-1.5">
                  {manualNotes.map((note) => {
                    const link = resolveManualFeedEventLink(note);
                    const eisScore = resolveManualEventEis(note).score;
                    const excerpt = (note.body || note.title || "").trim();
                    const clipped = excerpt.length > 180 ? `${excerpt.slice(0, 177)}…` : excerpt;
                    return (
                      <li
                        key={note.id}
                        className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/70 dark:bg-surface/40 px-2.5 py-2 space-y-1"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[11px] font-semibold text-ink tabular-nums">
                            {note.eventDate || note.createdAt?.slice(0, 10)}
                          </span>
                          {note.source ? (
                            <span className="text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-px text-ink-muted">
                              {note.source}
                            </span>
                          ) : null}
                          <span
                            className="ml-auto shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-px rounded bg-surface/70"
                            style={{ color: eisColor(eisScore) }}
                          >
                            EIS {fmtSignedNum(eisScore, 1)}
                          </span>
                        </div>
                        {note.title && note.title !== excerpt ? (
                          <p className="text-[11px] font-medium text-ink leading-snug line-clamp-2">
                            {note.title}
                          </p>
                        ) : null}
                        {clipped ? (
                          <p className="text-[10px] text-ink-muted leading-relaxed line-clamp-3">
                            {clipped}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline"
                            onClick={() => setDetailNote(note)}
                          >
                            {t("manualFeed.detail.openFull")}
                          </button>
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-ink-muted hover:text-[rgb(var(--accent))] hover:underline break-all"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {link.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 48)}
                              {link.length > 52 ? "…" : ""}
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section className="rounded-md border border-[rgb(var(--border))]/40 bg-surface/40 px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {t("sim.lossAnalysis.residual.detailModal.methodTitle")}
              </p>
              <p className="text-[10px] text-ink-muted leading-relaxed">
                {t("sim.lossAnalysis.residual.detailModal.methodBody")}
              </p>
            </section>
          </div>

          <div className="border-t border-[rgb(var(--border))]/40 px-4 py-2 flex justify-end shrink-0">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              {t("manualFeed.detail.close")}
            </button>
          </div>
        </div>
      </AppModal>

      {detailNote ? (
        <ManualNewsDetailModal
          payload={{
            ticker: detailNote.ticker,
            eventDate: detailNote.eventDate,
            title: detailNote.title,
            body: detailNote.body || detailNote.title,
            source: detailNote.source,
            link: resolveManualFeedEventLink(detailNote),
            eisScore: resolveManualEventEis(detailNote).score,
          }}
          it={it}
          onClose={() => setDetailNote(null)}
        />
      ) : null}
    </>
  );
}
