/* LossRescuePanel v2 */
import { useMemo, useState } from "react";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import {
  computeLossRescue,
  computeEisFeedWindowScore,
  deriveCauseInputFromSdsRow,
  RESCUE_BUDGET_FRACTION,
  type LossRescueResult,
  type RescueAllocation,
  type RescueCauseInput,
} from "../sheet/lossRescueEngine";
import type { SdsRow } from "../api/supernova";
import { buildTickerEisDetail } from "../sheet/tickerEisSummary";
import { useLang } from "../shared/i18n";
import type { SheetTable } from "../types";
import { detectPortfolioLossAlerts } from "../sheet/portfolioLossUrgent";
import { getInvestSimInputsSnapshot, resolveInvestedAt, loadInvestSimHistory, type InvestSimInputs } from "../sheet/investSimStorage";
import { useInvestSimInputsMutable } from "../hooks/useInvestSimInputs";
import type { PaperPosition } from "../sheet/investDecisionSimLoop";
import type { ExperimentPiggyBank } from "../sheet/investDecisionSimExperiment";
import { pickSignalFromSimRow } from "../sheet/top2FromSimulation";
import { resolveSimulationEntrySolidity } from "../sheet/simulationEntrySolidity";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { summarizePaperClosedDeals } from "../sheet/paperSimMaturation";

/**
 * Cumulative EIS in the crash window — delegates to shared feed window helper.
 */
function computeEisWindowScore(
  ticker: string,
  entryAt: string,
  lang: "it" | "en",
  history?: import("../sheet/investSimStorage").InvestSimHistoryPoint[],
): number | null {
  return computeEisFeedWindowScore(ticker, lang, entryAt, history ?? null);
}

type AiReference = { title: string; url?: string; date?: string };
type AiTimelineEvent = { date: string; event: string };
type AiRecoverySignal = { signal: string; type: string; date?: string };
type AiRescueResult = {
  recovery_score?: "LOW" | "MEDIUM" | "HIGH";
  crash_cause?: string;
  rationale?: string;
  timeline?: AiTimelineEvent[];
  recovery_signals?: AiRecoverySignal[];
  catalysts?: string[];
  risks?: string[];
  references?: AiReference[];
  raw?: string;
};

// ── Local feed analysis (no backend needed) ────────────────────────────────

function buildLocalRescueAnalysis(
  ticker: string,
  entryAt: string | undefined,
  lastMarkPct: number | undefined,
  lang: "it" | "en",
): AiRescueResult {
  const it = lang === "it";
  const detail = buildTickerEisDetail(ticker, lang);
  const entryMs = entryAt ? Date.parse(`${entryAt}T00:00:00`) : 0;

  // All events sorted newest-first; split into pre/post entry
  const allEvents = detail.events.filter((ev) => ev.eventDate);
  const postEntry = allEvents.filter(
    (ev) => !entryMs || Date.parse(`${ev.eventDate}T12:00:00`) >= entryMs - 7 * 86_400_000,
  );
  const windowEvents = postEntry.length > 0 ? postEntry : allEvents.slice(0, 8);

  // Timeline: events in chronological order
  const timeline: AiTimelineEvent[] = [...windowEvents]
    .sort((a, b) => Date.parse(`${a.eventDate}T12:00:00`) - Date.parse(`${b.eventDate}T12:00:00`))
    .slice(0, 8)
    .map((ev) => ({
      date: ev.eventDate ?? "?",
      event: ev.title + (ev.impactNote ? ` — ${ev.impactNote}` : ""),
    }));

  // Crash cause: most negative EIS event post-entry
  const crashEvent = [...windowEvents].sort((a, b) => a.breakdown.score - b.breakdown.score)[0];
  let crash_cause: string | undefined;
  if (crashEvent && crashEvent.breakdown.score < -1) {
    const d1 = crashEvent.breakdown.delta_p_1d;
    crash_cause = `${crashEvent.title} (${crashEvent.sourceLabel}, ${crashEvent.eventDate ?? "?"})` +
      (d1 != null ? `. ${it ? "Reazione prezzo" : "Price reaction"}: ${d1 >= 0 ? "+" : ""}${d1.toFixed(1)}% (1d).` : ".");
  } else if (lastMarkPct != null && lastMarkPct < -20) {
    crash_cause = it
      ? `Nessun evento clinico negativo identificato nel feed per questa finestra. La perdita (${lastMarkPct.toFixed(1)}%) potrebbe derivare da notizie non ancora indicizzate o fattori macro.`
      : `No negative clinical event found in feed for this window. The loss (${lastMarkPct.toFixed(1)}%) may stem from news not yet indexed or macro factors.`;
  }

  // Recovery signals: positive EIS events post-entry + upcoming (no date)
  const recovery_signals: AiRecoverySignal[] = windowEvents
    .filter((ev) => ev.breakdown.score > 0.5)
    .slice(0, 5)
    .map((ev) => ({
      signal: ev.title + (ev.summary ? ` — ${ev.summary.slice(0, 120)}` : ""),
      type: ev.sourceLabel.toLowerCase().includes("8-k") || ev.sourceLabel.toLowerCase().includes("sec")
        ? "insider"
        : ev.sourceLabel.toLowerCase().includes("ct") || ev.sourceLabel.toLowerCase().includes("clinical")
          ? "catalyst"
          : "other",
      date: ev.eventDate ?? "TBD",
    }));

  // References: events with link
  const references: AiReference[] = windowEvents
    .filter((ev) => ev.link || ev.studyUrl)
    .slice(0, 5)
    .map((ev) => ({
      title: ev.studyTitle || ev.title,
      url: ev.link ?? ev.studyUrl ?? undefined,
      date: ev.eventDate ?? undefined,
    }));

  // Overall recovery score
  const cumEis = windowEvents.reduce((s, ev) => s + ev.breakdown.score, 0);
  const positiveCount = windowEvents.filter((ev) => ev.breakdown.score > 0).length;
  const recovery_score: AiRescueResult["recovery_score"] =
    cumEis > 2 || positiveCount >= 2 ? "HIGH" :
    cumEis > -1 ? "MEDIUM" : "LOW";

  // Rationale
  let rationale: string;
  if (windowEvents.length === 0) {
    rationale = it
      ? `Nessun evento feed trovato per ${ticker} nella finestra temporale. Aggiorna il feed clinico per ottenere dati recenti.`
      : `No feed events found for ${ticker} in the time window. Refresh the clinical feed to get recent data.`;
  } else {
    const nPos = windowEvents.filter((ev) => ev.breakdown.score > 0).length;
    const nNeg = windowEvents.filter((ev) => ev.breakdown.score < -1).length;
    const eisStr = cumEis >= 0 ? `+${cumEis.toFixed(1)}` : cumEis.toFixed(1);
    rationale = it
      ? `Analisi su ${windowEvents.length} eventi feed nella finestra ${entryAt ?? "storica"}–oggi. EIS cumulativo: ${eisStr}. Eventi positivi: ${nPos}, negativi rilevanti: ${nNeg}.${
          detail.studyTitle ? ` Studio principale: ${detail.studyTitle}.` : ""}`
      : `Analysis on ${windowEvents.length} feed events in window ${entryAt ?? "historical"}–today. Cumulative EIS: ${eisStr}. Positive events: ${nPos}, relevant negative: ${nNeg}.${
          detail.studyTitle ? ` Main study: ${detail.studyTitle}.` : ""}`;
  }

  return { recovery_score, crash_cause, rationale, timeline, recovery_signals, references };
}

// ── Upcoming catalyst helper ────────────────────────────────────────────────

type UpcomingCatalyst = {
  daysUntil: number;
  date: string;
  title: string;
  url?: string;
  type: string;
};

function buildUpcomingCatalysts(ticker: string, lang: "it" | "en"): UpcomingCatalyst[] {
  const detail = buildTickerEisDetail(ticker, lang);
  const today = Date.now();
  const out: UpcomingCatalyst[] = [];

  for (const ev of detail.events) {
    if (!ev.eventDate) continue;
    const evMs = Date.parse(`${ev.eventDate}T12:00:00`);
    const daysUntil = Math.round((evMs - today) / 86_400_000);
    if (daysUntil < -1) continue; // skip past events (allow yesterday due to TZ)
    out.push({
      daysUntil: Math.max(0, daysUntil),
      date: ev.eventDate,
      title: ev.studyTitle || ev.title,
      url: ev.link ?? ev.studyUrl ?? undefined,
      type: ev.sourceLabel,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 8);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtEur(v: number): string {
  return v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtPct(v: number, showPlus = false): string {
  return `${showPlus && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreLabel(score: number, it: boolean): string {
  if (score >= 70) return it ? "Buona prob. ripresa" : "Good recovery prob.";
  if (score >= 45) return it ? "Ripresa incerta" : "Uncertain recovery";
  return it ? "Rischio alto" : "High risk";
}

// ── Upcoming events block ────────────────────────────────────────────────────

function UpcomingEventsBlock({ ticker, it }: { ticker: string; it: boolean }) {
  const { lang } = useLang();
  const catalysts = buildUpcomingCatalysts(ticker, lang);

  if (catalysts.length === 0) {
    return (
      <div className="rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 px-3 py-2">
        <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wide mb-0.5">
          {it ? "📅 Quando potrebbe risalire?" : "📅 When could it recover?"}
        </p>
        <p className="text-[11px] text-ink-muted">
          {it
            ? "Nessun evento futuro pianificato trovato nel feed clinico per questo ticker. Aggiorna il feed per ottenere i prossimi catalyst."
            : "No upcoming planned events found in the clinical feed for this ticker. Refresh the feed to get the next catalysts."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200/60 dark:border-indigo-800/30 bg-indigo-50/40 dark:bg-indigo-950/20 px-3 py-2.5 space-y-2">
      <p className="text-[10px] font-semibold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide">
        {it ? "📅 Quando potrebbe risalire?" : "📅 When could it recover?"}
        <span className="ml-1 normal-case font-normal text-ink-muted">
          {it ? `— ${catalysts.length} eventi futuri nel feed` : `— ${catalysts.length} upcoming events in feed`}
        </span>
      </p>
      <div className="space-y-1.5">
        {catalysts.map((ev, i) => {
          const urgency =
            ev.daysUntil <= 7
              ? "text-rose-700 dark:text-rose-300 font-bold"
              : ev.daysUntil <= 30
                ? "text-amber-700 dark:text-amber-300 font-semibold"
                : "text-ink-muted";
          const dayLabel = ev.daysUntil === 0
            ? (it ? "oggi" : "today")
            : ev.daysUntil === 1
              ? (it ? "domani" : "tomorrow")
              : it ? `fra ${ev.daysUntil}gg` : `in ${ev.daysUntil}d`;
          return (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className={`shrink-0 tabular-nums w-16 ${urgency}`}>
                {dayLabel}
              </span>
              <span className="text-ink-muted shrink-0 tabular-nums">{ev.date}</span>
              <span className="flex-1 leading-snug text-ink">
                {ev.url ? (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 underline hover:no-underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {ev.title}
                  </a>
                ) : (
                  ev.title
                )}
                <span className="ml-1 text-[9px] text-ink-muted/70 font-normal">{ev.type}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-ink-muted/60 leading-snug">
        {it
          ? "⚠ Date indicative dal feed clinico. Rosso = entro 7gg, arancio = entro 30gg."
          : "⚠ Indicative dates from clinical feed. Red = within 7d, orange = within 30d."}
      </p>
    </div>
  );
}

// ── Rescue score bar ─────────────────────────────────────────────────────────

function RescoreBar({ score }: { score: number }) {
  const pct = Math.round(score);
  const bg =
    pct >= 70
      ? "bg-emerald-500"
      : pct >= 45
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-semibold tabular-nums w-7 text-right ${scoreColor(pct)}`}>
        {pct}
      </span>
    </div>
  );
}

// ── Single allocation card ───────────────────────────────────────────────────


function AllocationCard({
  alloc,
  it,
  aiResult,
  aiUpdatedAt,
  loadingAi,
  onRequestAi,
  onExecuteAllocation,
  isExecuted,
  sdsRow,
}: {
  alloc: RescueAllocation;
  it: boolean;
  aiResult: AiRescueResult | null;
  aiUpdatedAt?: string | null;
  loadingAi: boolean;
  onRequestAi: () => void;
  onExecuteAllocation?: () => void;
  isExecuted?: boolean;
  sdsRow?: SdsRow | null;
}) {
  const { position: pos } = alloc;
  const [expanded, setExpanded] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState(false);

  // Breakdown for score modal — use engine-computed breakdown if available, else recompute
  const breakdown = alloc.scoreBreakdown ?? {
    probPt: Math.round(Math.max(0, Math.min((pos.entryProbPct ?? 50) - 30, 40))),
    lossPt: Math.round(Math.max(0, Math.min(Math.abs(pos.lastMarkPct) * 0.7, 20))),
    eisPt: pos.eisWindowScore != null ? Math.round(Math.min(Math.max(0, (pos.eisWindowScore / 25) * 15), 15)) : 0,
    volPenalty: 0,
    extBonus: 0,
    cashPenalty: 0,
    rescoreScore: alloc.rescoreScore,
  };

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/70 bg-white/60 dark:bg-surface/60 overflow-hidden">
      {/* ── Rescue score modal ── */}
      {showScoreModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowScoreModal(false)}
        >
          <div
            className="bg-white dark:bg-surface rounded-2xl shadow-2xl border border-[rgb(var(--border))]/60 w-full max-w-sm mx-4 p-5 space-y-4 overflow-y-auto max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-ink">{pos.ticker} — Rescue Score</p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {it ? "Come è calcolato lo score" : "How the score is calculated"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScoreModal(false)}
                className="text-ink-muted hover:text-ink text-lg leading-none mt-0.5"
              >✕</button>
            </div>

            {/* Score total */}
            <div className="rounded-xl bg-slate-50 dark:bg-white/5 px-4 py-3 flex items-center gap-3">
              <RescoreBar score={alloc.rescoreScore} />
              <span className={`text-[20px] font-black tabular-nums ${scoreColor(alloc.rescoreScore)}`}>
                {alloc.rescoreScore}
                <span className="text-[12px] font-normal text-ink-muted">/100</span>
              </span>
            </div>

            {/* Breakdown */}
            <div className="space-y-2 text-[12px]">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">
                {it ? "Dettaglio componenti" : "Score breakdown"}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink">
                  {it ? "P(plan) ingresso" : "Entry P(plan)"}
                  <span className="text-ink-muted ml-1">
                    ({pos.entryProbPct != null ? `${pos.entryProbPct.toFixed(0)}%` : "~50%"} → max 40 pt)
                  </span>
                </span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  +{breakdown.probPt} pt
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink">
                  {it ? "Profondità perdita" : "Loss depth"}
                  <span className="text-ink-muted ml-1">
                    ({fmtPct(pos.lastMarkPct)}, max 20 pt)
                  </span>
                </span>
                <span className="font-semibold text-red-500 tabular-nums">+{breakdown.lossPt} pt</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink">
                  {it ? "Attività EIS (da data crollo)" : "EIS activity (from crash date)"}
                  <span className="text-ink-muted ml-1">
                    ({pos.eisWindowScore != null
                      ? `EIS ${pos.eisWindowScore >= 0 ? "+" : ""}${pos.eisWindowScore.toFixed(1)} → max 15 pt`
                      : it ? "nessun evento nella finestra" : "no events in window"})
                  </span>
                </span>
                <span className={`font-semibold tabular-nums ${breakdown.eisPt > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-muted"}`}>
                  +{breakdown.eisPt} pt
                </span>
              </div>
              {/* Cause attribution components */}
              <div className="flex items-center justify-between gap-2">
                <span className={breakdown.extBonus > 0 ? "text-sky-700" : "text-ink"}>
                  {it ? "Allineamento settore (causa esterna)" : "Sector alignment (external cause)"}
                  <span className="text-ink-muted ml-1">(max +10 pt)</span>
                </span>
                <span className={`font-semibold tabular-nums ${breakdown.extBonus > 0 ? "text-sky-600 dark:text-sky-400" : "text-ink-muted"}`}>+{breakdown.extBonus} pt</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={breakdown.volPenalty > 0 ? "text-rose-700" : "text-ink"}>
                  {it ? "Volume anomalo (causa interna)" : "Volume anomaly (internal cause)"}
                  <span className="text-ink-muted ml-1">(max −10 pt)</span>
                </span>
                <span className={`font-semibold tabular-nums ${breakdown.volPenalty > 0 ? "text-rose-600 dark:text-rose-400" : "text-ink-muted"}`}>−{breakdown.volPenalty} pt</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={breakdown.cashPenalty > 0 ? "text-rose-700" : "text-ink"}>
                  {it ? "Rischio cash runway" : "Cash runway risk"}
                  <span className="text-ink-muted ml-1">(max −5 pt)</span>
                </span>
                <span className={`font-semibold tabular-nums ${breakdown.cashPenalty > 0 ? "text-rose-600 dark:text-rose-400" : "text-ink-muted"}`}>−{breakdown.cashPenalty} pt</span>
              </div>
              <div className="border-t border-[rgb(var(--border))]/40 pt-2 flex items-center justify-between gap-2 font-semibold">
                <span className="text-ink">{it ? "Totale" : "Total"}</span>
                <span className={scoreColor(alloc.rescoreScore)}>{alloc.rescoreScore}/100</span>
              </div>
            </div>

            {/* Formula note */}
            <p className="text-[10px] text-ink-muted leading-relaxed">
              {it
                ? "Score = P(plan) (max 40) + profondità perdita (max 20) + EIS dal crollo (max 15) + allineamento settore (max +10, causa esterna) − volume anomalo (max −10, causa interna) − rischio cash runway (max −5). Causa esterna (settore in calo) aumenta la probabilità di recupero. Causa interna (volume anomalo, diluzione) la riduce."
                : "Score = P(plan) (max 40) + loss depth (max 20) + EIS from crash (max 15) + sector alignment (max +10, external cause) − anomalous volume (max −10, internal cause) − cash runway risk (max −5). External cause (sector decline) increases recovery odds. Internal cause (volume spike, dilution) decreases them."}
            </p>

            {/* AI deep analysis — shown after Analyse now */}
            {aiResult ? (
              <>
              {aiUpdatedAt && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[9px] text-ink-muted/70 italic">
                    {fmtUpdatedAt(aiUpdatedAt, it)}
                  </span>
                  <button
                    type="button"
                    onClick={onRequestAi}
                    disabled={loadingAi}
                    className="text-[9px] text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 font-semibold"
                  >
                    {loadingAi ? "…" : (it ? "↻ Aggiorna" : "↻ Refresh")}
                  </button>
                </div>
              )}
              <div className="space-y-3 border-t border-[rgb(var(--border))]/30 pt-3">

                {/* Crash cause */}
                {aiResult.crash_cause && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                      {it ? "Causa del crollo" : "Why it crashed"}
                    </p>
                    <p className="text-[11px] text-red-700 dark:text-red-400 leading-relaxed bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                      {aiResult.crash_cause}
                    </p>
                  </div>
                )}

                {/* Timeline */}
                {aiResult.timeline && aiResult.timeline.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                      {it ? "Timeline eventi chiave" : "Key events timeline"}
                    </p>
                    <div className="space-y-1.5 relative pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                      {aiResult.timeline.map((ev, i) => (
                        <div key={i} className="text-[11px]">
                          <span className="font-semibold text-ink tabular-nums">{ev.date}</span>
                          <span className="text-ink-muted mx-1">—</span>
                          <span className="text-ink">{ev.event}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recovery signals */}
                {aiResult.recovery_signals && aiResult.recovery_signals.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                      {it ? "Segnali di recupero" : "Recovery signals"}
                    </p>
                    <ul className="space-y-1.5">
                      {aiResult.recovery_signals.map((s, i) => {
                        const badgeClass =
                          s.type === "catalyst" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                          s.type === "earnings"  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" :
                          s.type === "insider"   ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                          s.type === "upgrade"   ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" :
                          "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
                        return (
                          <li key={i} className="text-[11px] flex gap-2 items-start">
                            <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide mt-0.5 ${badgeClass}`}>
                              {s.type}
                            </span>
                            <span className="text-ink flex-1">
                              {s.signal}
                              {s.date && <span className="text-ink-muted ml-1">({s.date})</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Rationale */}
                {aiResult.rationale && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                      {it ? "Outlook ripresa" : "Recovery outlook"}
                    </p>
                    <p className="text-[11px] text-ink leading-relaxed">{aiResult.rationale}</p>
                  </div>
                )}

                {/* References */}
                {aiResult.references && aiResult.references.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                      {it ? "News e fonti rilevanti" : "Relevant news & references"}
                    </p>
                    <ul className="space-y-1.5">
                      {aiResult.references.map((ref, i) => (
                        <li key={i} className="text-[11px] flex gap-1.5 items-start">
                          <span className="text-ink-muted shrink-0 tabular-nums">[{i + 1}]</span>
                          <span>
                            {ref.url ? (
                              <a href={ref.url} target="_blank" rel="noopener noreferrer"
                                className="text-indigo-600 dark:text-indigo-400 underline hover:no-underline">
                                {ref.title}
                              </a>
                            ) : (
                              <span className="text-ink">{ref.title}</span>
                            )}
                            {ref.date && <span className="text-ink-muted ml-1">({ref.date})</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Raw fallback */}
                {aiResult.raw && !aiResult.crash_cause && !aiResult.rationale && (
                  <p className="text-[11px] text-ink leading-relaxed whitespace-pre-wrap">{aiResult.raw}</p>
                )}
              </div>
              </>
            ) : (
              <p className="text-[10px] text-ink-muted italic">
                {it
                  ? "Clicca 'Analizza ora' nella card per ottenere l'analisi completa: causa del crollo, timeline eventi, segnali di recupero e fonti."
                  : "Click 'Analyse now' in the card to get the full analysis: crash cause, event timeline, recovery signals and references."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Header row — labelled */}
      {/* div instead of button: row contains inner <button> elements (score, simulation, AI),
          nested <button> inside <button> is invalid HTML and breaks click/close handling */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
      >
        {/* Ticker */}
        <span className="text-[13px] font-bold text-ink tracking-wide w-14 shrink-0">
          {pos.ticker}
        </span>

        {/* PnL% + EUR labelled */}
        <div className="flex flex-col shrink-0">
          <span className={`text-[13px] font-semibold tabular-nums leading-tight ${pos.lastMarkPct < -5 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
            {fmtPct(pos.lastMarkPct)}
          </span>
          <span className="text-[10px] text-ink-muted leading-tight">{it ? "rendimento" : "return"}</span>
        </div>

        <div className="flex flex-col shrink-0">
          <span className="text-[13px] font-semibold tabular-nums text-red-600 dark:text-red-400 leading-tight">
            {fmtEur(pos.pnlEur)}
          </span>
          <span className="text-[10px] text-ink-muted leading-tight">{it ? "perdita €" : "loss €"}</span>
        </div>

        <div className="flex flex-col shrink-0">
          <span className="text-[13px] font-semibold tabular-nums text-ink leading-tight">
            {pos.daysSinceEntry}d
          </span>
          <span className="text-[10px] text-ink-muted leading-tight">{it ? "giorni" : "days"}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Rescue score — clickable pill */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowScoreModal(true); }}
          className={`flex flex-col items-center shrink-0 px-2 py-1 rounded-lg border transition-colors hover:bg-slate-100 dark:hover:bg-white/10 ${
            alloc.rescoreScore >= 70 ? "border-emerald-300 dark:border-emerald-700" :
            alloc.rescoreScore >= 45 ? "border-amber-300 dark:border-amber-700" :
            "border-red-300 dark:border-red-700"
          }`}
          title={it ? "Clicca per vedere come è calcolato lo score" : "Click to see score breakdown"}
        >
          <span className={`text-[14px] font-black tabular-nums leading-tight ${scoreColor(alloc.rescoreScore)}`}>
            {alloc.rescoreScore}
          </span>
          <span className="text-[9px] text-ink-muted leading-tight">{it ? "score" : "score"}</span>
        </button>

        {/* Suggested realloc */}
        {alloc.suggestedEur > 0 && (
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums leading-tight">
              +{fmtEur(alloc.suggestedEur)}
            </span>
            <span className="text-[9px] text-ink-muted leading-tight">{it ? "rescue" : "rescue"}</span>
          </div>
        )}

        {/* Rescue score label badge */}
        <span
          className={`text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded border ${
            alloc.rescoreScore >= 70 ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" :
            alloc.rescoreScore >= 45 ? "border-amber-300 text-amber-700 dark:text-amber-300" :
            "border-red-300 text-red-600 dark:text-red-400"
          }`}
          title={it ? "Livello di rischio basato sul rescue score (P(plan) + perdita + EIS + cause attribution)" : "Risk level based on rescue score (P(plan) + loss depth + EIS + cause attribution)"}
        >
          {alloc.rescoreScore >= 70 ? (it ? "BASSO RISCHIO" : "LOW RISK") :
           alloc.rescoreScore >= 45 ? (it ? "RISCHIO MEDIO" : "MED RISK") :
           (it ? "ALTO RISCHIO" : "HIGH RISK")}
        </span>

        <span className="text-ink-muted text-[11px]">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (

        <div className="border-t border-[rgb(var(--border))]/40 px-4 py-3 space-y-3">
          {/* ── Full Rescue Score Breakdown (mirrors 24h tab) ── */}
          <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 p-2.5 space-y-2">
            {/* Header + bar + score */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink">Rescue Score</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, alloc.rescoreScore)}%`,
                      backgroundColor:
                        alloc.rescoreScore >= 70 ? "#10b981" :
                        alloc.rescoreScore >= 45 ? "#d97706" : "#ef4444",
                    }}
                  />
                </div>
                <span className={`text-[17px] font-bold tabular-nums leading-none ${scoreColor(alloc.rescoreScore)}`}>
                  {alloc.rescoreScore}
                </span>
              </div>
            </div>

            {/* Diagnosis summary */}
            <p className="text-[11px] text-ink font-medium leading-snug">
              {alloc.rescoreScore >= 70
                ? (it ? "Alta probabilità di recupero" : "High recovery probability")
                : alloc.rescoreScore >= 45
                  ? (it ? "Recupero possibile — monitorare" : "Recovery possible — monitor")
                  : (it ? "Recupero incerto — causa interna o fondamentali deboli" : "Uncertain recovery — internal cause or weak fundamentals")}
            </p>

            {/* Breakdown chips */}
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border))]/50 bg-surface/60 px-2 py-0.5 text-[10px] font-medium leading-none">
                <span className="text-ink-muted">P(plan)</span>
                <span className="font-bold tabular-nums text-indigo-600">+{breakdown.probPt}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border))]/50 bg-surface/60 px-2 py-0.5 text-[10px] font-medium leading-none">
                <span className="text-ink-muted">{it ? "Profondità" : "Depth"}</span>
                <span className="font-bold tabular-nums text-red-500">+{breakdown.lossPt}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border))]/50 bg-surface/60 px-2 py-0.5 text-[10px] font-medium leading-none">
                <span className="text-ink-muted">EIS</span>
                <span className={`font-bold tabular-nums ${breakdown.eisPt > 0 ? "text-emerald-600" : "text-ink-muted"}`}>+{breakdown.eisPt}</span>
              </span>
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium leading-none ${breakdown.extBonus > 0 ? "border-sky-300 bg-sky-50" : "border-[rgb(var(--border))]/50 bg-surface/60"}`}>
                <span className={breakdown.extBonus > 0 ? "text-sky-700" : "text-ink-muted"}>{it ? "Settore" : "Sector"}</span>
                <span className={`font-bold tabular-nums ${breakdown.extBonus > 0 ? "text-sky-700" : "text-ink-muted"}`}>+{breakdown.extBonus}</span>
              </span>
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium leading-none ${breakdown.volPenalty > 0 ? "border-rose-300 bg-rose-50" : "border-[rgb(var(--border))]/50 bg-surface/60"}`}>
                <span className={breakdown.volPenalty > 0 ? "text-rose-700" : "text-ink-muted"}>Vol.</span>
                <span className={`font-bold tabular-nums ${breakdown.volPenalty > 0 ? "text-rose-700" : "text-ink-muted"}`}>{`\u2212`}{breakdown.volPenalty}</span>
              </span>
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium leading-none ${breakdown.cashPenalty > 0 ? "border-rose-300 bg-rose-50" : "border-[rgb(var(--border))]/50 bg-surface/60"}`}>
                <span className={breakdown.cashPenalty > 0 ? "text-rose-700" : "text-ink-muted"}>Cash</span>
                <span className={`font-bold tabular-nums ${breakdown.cashPenalty > 0 ? "text-rose-700" : "text-ink-muted"}`}>{`\u2212`}{breakdown.cashPenalty}</span>
              </span>
            </div>

            {/* Indicator cards — 2 columns (matching 24h tab) */}
            <div className="grid grid-cols-2 gap-1.5">
              {/* P(plan) */}
              <div className="border-l-[3px] border-l-indigo-400 rounded bg-white/80 p-2 space-y-0.5">
                <span className="text-[10px] text-ink-muted">{it ? "Prob. ingresso" : "Entry probability"}</span>
                <p className="text-[13px] font-bold text-ink leading-tight">
                  {pos.entryProbPct != null ? `${pos.entryProbPct.toFixed(0)}%` : "~50%"}
                  {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} +{breakdown.probPt}/40</span>
                </p>
                <p className="text-[9px] text-ink-muted leading-snug">
                  {it
                    ? "Probabilità calcolata dal modello SuperNova al momento dell'ingresso. Più alta = fondamentali solidi."
                    : "Model-computed probability at entry. Higher = stronger fundamentals."}
                </p>
              </div>

              {/* Loss depth */}
              <div className="border-l-[3px] border-l-red-400 rounded bg-white/80 p-2 space-y-0.5">
                <span className="text-[10px] text-ink-muted">{it ? "Profondità perdita" : "Loss depth"}</span>
                <p className="text-[13px] font-bold text-ink leading-tight">
                  {fmtPct(pos.lastMarkPct)}
                  {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} +{breakdown.lossPt}/20</span>
                </p>
                <p className="text-[9px] text-ink-muted leading-snug">
                  {it
                    ? `Formula: 0.7 × |${pos.lastMarkPct.toFixed(1)}%| = ${(Math.abs(pos.lastMarkPct) * 0.7).toFixed(1)} pt (cap 20). Drawdown profondi in biotech con fondamentali intatti mostrano rebound medio +35-50% entro 6 mesi.`
                    : `Formula: 0.7 × |${pos.lastMarkPct.toFixed(1)}%| = ${(Math.abs(pos.lastMarkPct) * 0.7).toFixed(1)} pt (cap 20). Deep drawdowns in biotech with intact fundamentals show avg +35-50% rebound within 6 months.`}
                </p>
                <a href={`https://finance.yahoo.com/quote/${pos.ticker}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[rgb(var(--accent))] hover:underline" onClick={(e) => e.stopPropagation()}>Yahoo Finance {`\u2197`}</a>
              </div>

              {/* EIS activity */}
              <div className={`border-l-[3px] rounded bg-white/80 p-2 space-y-0.5 ${breakdown.eisPt > 0 ? "border-l-emerald-400" : "border-l-gray-300"}`}>
                <span className="text-[10px] text-ink-muted">{it ? "Attività EIS" : "EIS activity"}</span>
                <p className="text-[13px] font-bold text-ink leading-tight">
                  {pos.eisWindowScore != null
                    ? `EIS ${pos.eisWindowScore >= 0 ? "+" : ""}${pos.eisWindowScore.toFixed(1)}`
                    : (it ? "Nessun evento" : "No events")}
                  {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} +{breakdown.eisPt}/15</span>
                </p>
                <p className="text-[9px] text-ink-muted leading-snug">
                  {pos.eisWindowScore != null
                    ? (it
                      ? "Score EIS cumulativo nella finestra post-crollo."
                      : "Cumulative EIS score in post-crash window.")
                    : (it
                      ? "Nessun filing SEC o press release rilevante nella finestra di rescue."
                      : "No SEC filings or press releases found in rescue window.")}
                </p>
                <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${pos.ticker}&type=8-K&dateb=&owner=include&count=10`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[rgb(var(--accent))] hover:underline" onClick={(e) => e.stopPropagation()}>SEC EDGAR {`\u2197`}</a>
              </div>

              {/* Sector alignment */}
              {(() => {
                const ca = sdsRow?.cause_attribution;
                const tickerRet = ca?.external_alignment?.ticker_return_pct;
                const xbiRet = ca?.external_alignment?.xbi_return_pct;
                const gap = ca?.external_alignment?.return_gap_pct;
                const hasCA = ca?.external_alignment?.score != null;
                const xbiRS = (sdsRow as any)?.cluster_c?.xbi_relative_strength;
                const fbTickerRet = xbiRS?.ticker_return_90d;
                const fbXbiRet = xbiRS?.xbi_return_90d;
                const fbRS = xbiRS?.rs_90d;
                const hasAny = hasCA || fbTickerRet != null;
                return (
                  <div className={`border-l-[3px] rounded bg-white/80 p-2 space-y-0.5 ${breakdown.extBonus > 0 ? "border-l-sky-400" : "border-l-gray-300"}`}>
                    <span className="text-[10px] text-ink-muted">{it ? "Allineamento settore" : "Sector alignment"}</span>
                    <p className="text-[13px] font-bold text-ink leading-tight">
                      {hasCA
                        ? `${tickerRet != null ? `${tickerRet > 0 ? "+" : ""}${(tickerRet as number).toFixed(1)}%` : "—"} vs XBI ${xbiRet != null ? `${xbiRet > 0 ? "+" : ""}${(xbiRet as number).toFixed(1)}%` : "—"}`
                        : hasAny
                          ? `${pos.ticker} ${fbTickerRet != null ? `${fbTickerRet > 0 ? "+" : ""}${fbTickerRet.toFixed(1)}%` : "—"} vs XBI ${fbXbiRet != null ? `${fbXbiRet > 0 ? "+" : ""}${fbXbiRet.toFixed(1)}%` : "—"}`
                          : (it ? "Nessun dato" : "No data")}
                      {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} +{breakdown.extBonus}/10</span>
                    </p>
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {hasCA
                        ? (it
                          ? `Gap ticker-settore (5d): ${gap != null ? `${gap > 0 ? "+" : ""}${(gap as number).toFixed(1)}%` : "—"}. Calo allineato = causa esterna = recupero più probabile.`
                          : `Ticker-sector gap (5d): ${gap != null ? `${gap > 0 ? "+" : ""}${(gap as number).toFixed(1)}%` : "—"}. Aligned drop = external cause = recovery more likely.`)
                        : hasAny
                          ? (it
                            ? `RS 90d: ${fbRS != null ? fbRS.toFixed(2) : "N/D"}. Dati 5d non disponibili.`
                            : `RS 90d: ${fbRS != null ? fbRS.toFixed(2) : "N/A"}. 5d data unavailable.`)
                          : (it ? "Nessun dato settoriale. Score +0." : "No sector data. Score +0.")}
                    </p>
                    <a href="https://finance.yahoo.com/quote/XBI" target="_blank" rel="noopener noreferrer" className="text-[9px] text-[rgb(var(--accent))] hover:underline" onClick={(e) => e.stopPropagation()}>XBI — Yahoo Finance {`\u2197`}</a>
                  </div>
                );
              })()}

              {/* Volume anomaly */}
              {(() => {
                const ca = sdsRow?.cause_attribution;
                const zScore = ca?.volume_anomaly?.volume_zscore;
                const caAvg20d = ca?.volume_anomaly?.avg_volume_20d;
                const volToday = ca?.volume_anomaly?.volume_today;
                const hasCA = ca?.volume_anomaly?.score != null;
                const volR = (sdsRow as any)?.cluster_c?.volume_ratio;
                const fbRatio5v20 = volR?.ratio_5d_vs_20d;
                const hasAny = hasCA || fbRatio5v20 != null;
                const fmtVol = (v: number | null | undefined) => v == null ? "—" : v > 1e6 ? `${(v / 1e6).toFixed(1)}M` : v > 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v.toFixed(0)}`;
                return (
                  <div className={`border-l-[3px] rounded bg-white/80 p-2 space-y-0.5 ${breakdown.volPenalty > 0 ? "border-l-rose-400" : "border-l-gray-300"}`}>
                    <span className="text-[10px] text-ink-muted">{it ? "Volume anomalo" : "Volume anomaly"}</span>
                    <p className="text-[13px] font-bold text-ink leading-tight">
                      {hasCA
                        ? `z=${zScore != null ? (zScore as number).toFixed(1) : "—"}`
                        : hasAny
                          ? `Ratio 5d/20d: ${fbRatio5v20 != null ? fbRatio5v20.toFixed(2) : "—"}x`
                          : (it ? "Nessuna penalità" : "No penalty")}
                      {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} {`\u2212`}{breakdown.volPenalty}/10</span>
                    </p>
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {hasCA
                        ? (it
                          ? `Vol. oggi ${fmtVol(volToday as number | null | undefined)} vs media 20d ${fmtVol(caAvg20d as number | null | undefined)}. Spike = possibile evento interno.`
                          : `Today vol. ${fmtVol(volToday as number | null | undefined)} vs 20d avg ${fmtVol(caAvg20d as number | null | undefined)}. Spike = possible internal event.`)
                        : (it ? "Nessun dato volume disponibile." : "No volume data available.")}
                    </p>
                    <a href={`https://finance.yahoo.com/quote/${pos.ticker}/history`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[rgb(var(--accent))] hover:underline" onClick={(e) => e.stopPropagation()}>{it ? "Storico volume" : "Volume history"} — Yahoo {`\u2197`}</a>
                  </div>
                );
              })()}

              {/* Cash runway */}
              {(() => {
                const ca = sdsRow?.cause_attribution;
                const caMonths = ca?.cash_runway_risk?.cash_runway_months;
                const hasCA = ca?.cash_runway_risk?.score != null;
                const cashD = (sdsRow as any)?.cluster_d?.cash_runway;
                const fbMonths = cashD?.runway_months;
                const fbCash = cashD?.total_cash_mm;
                const fbBurn = cashD?.monthly_burn_mm;
                const months = hasCA ? caMonths : fbMonths;
                const hasAny = hasCA || fbMonths != null || fbCash != null;
                return (
                  <div className={`border-l-[3px] rounded bg-white/80 p-2 space-y-0.5 ${breakdown.cashPenalty > 0 || (months != null && (months as number) < 12) ? "border-l-rose-400" : "border-l-gray-300"}`}>
                    <span className="text-[10px] text-ink-muted">Cash runway</span>
                    <p className="text-[13px] font-bold text-ink leading-tight">
                      {months != null
                        ? `${(months as number).toFixed(0)} ${it ? "mesi" : "months"}`
                        : hasAny
                          ? (it ? "cash disponibile" : "cash available")
                          : (it ? "Nessuna penalità" : "No penalty")}
                      {" "}<span className="text-[10px] font-normal text-ink-muted">{`\u2192`} {`\u2212`}{breakdown.cashPenalty}/5</span>
                    </p>
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {hasCA && caMonths != null
                        ? (it
                          ? `Runway: ${(caMonths as number).toFixed(0)} mesi. ${(caMonths as number) < 12 ? "Rischio diluzione." : "Runway adeguato."}`
                          : `Runway: ${(caMonths as number).toFixed(0)} months. ${(caMonths as number) < 12 ? "Dilution risk." : "Adequate runway."}`)
                        : hasAny
                          ? (it
                            ? `Cash: ${fbCash != null ? `$${fbCash.toFixed(0)}M` : "N/D"} · Burn: ${fbBurn != null ? `$${fbBurn.toFixed(1)}M/mese` : "N/D"}`
                            : `Cash: ${fbCash != null ? `$${fbCash.toFixed(0)}M` : "N/A"} · Burn: ${fbBurn != null ? `$${fbBurn.toFixed(1)}M/mo` : "N/A"}`)
                          : (it ? "Nessun dato cash disponibile." : "No cash data available.")}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Formula note */}
            <p className="text-[9px] text-ink-muted/60 leading-snug">
              Score = P(plan) + {it ? "profondità" : "depth"} + EIS + {it ? "settore" : "sector"} {`\u2212`} vol. {`\u2212`} cash.
              {sdsRow?.cause_attribution?.internal_cause_flag && (it ? " Causa interna \u2193" : " Internal cause \u2193")}
              {sdsRow?.cause_attribution?.external_cause_flag && (it ? " Causa esterna \u2191 recupero" : " External cause \u2191 recovery")}
            </p>
          </div>

          {/* Stats grid (compact summary) */}
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            <div>
              <p className="text-ink-muted">{it ? "Capitale" : "Capital"}</p>
              <p className="font-semibold text-ink">{fmtEur(pos.capital)}</p>
            </div>
            <div>
              <p className="text-ink-muted">{it ? "P(plan) ingresso" : "P(plan) at entry"}</p>
              <p className="font-semibold text-ink">
                {pos.entryProbPct != null ? `${pos.entryProbPct.toFixed(0)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-ink-muted">{it ? "Score ripresa" : "Rescue score"}</p>
              <p className={`font-semibold ${scoreColor(alloc.rescoreScore)}`}>
                {alloc.rescoreScore}/100 · {scoreLabel(alloc.rescoreScore, it)}
              </p>
            </div>
          </div>

          {/* AI Analysis block */}
          <div className="rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 px-3 py-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-ink">
                {it ? "Analisi AI — outlook ripresa" : "AI Analysis — recovery outlook"}
              </p>
              <button
                type="button"
                disabled={loadingAi}
                onClick={(e) => { e.stopPropagation(); onRequestAi(); }}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {loadingAi
                  ? (it ? "Caricamento…" : "Loading…")
                  : aiResult ? (it ? "Aggiorna" : "Refresh") : (it ? "Analizza ora" : "Analyse now")}
              </button>
            </div>

            {aiResult ? (
              <>
                {/* Recovery score badge + rationale */}
                {aiResult.recovery_score && (
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      aiResult.recovery_score === "HIGH" ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300" :
                      aiResult.recovery_score === "MEDIUM" ? "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300" :
                      "border-red-300 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300"
                    }`}>
                      {it ? "Prob. ripresa:" : "Recovery:"} {aiResult.recovery_score}
                    </span>
                  </div>
                )}
                {aiResult.rationale && (
                  <p className="text-[11px] text-ink leading-relaxed">{aiResult.rationale}</p>
                )}

                {/* Catalysts */}
                {aiResult.catalysts && aiResult.catalysts.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                      {it ? "Catalyst imminenti" : "Upcoming catalysts"}
                    </p>
                    <ul className="space-y-0.5">
                      {aiResult.catalysts.map((c, i) => (
                        <li key={i} className="text-[11px] text-ink flex gap-1.5">
                          <span className="text-emerald-500 shrink-0">▸</span>{c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Risks */}
                {aiResult.risks && aiResult.risks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                      {it ? "Rischi principali" : "Key risks"}
                    </p>
                    <ul className="space-y-0.5">
                      {aiResult.risks.map((r, i) => (
                        <li key={i} className="text-[11px] text-ink flex gap-1.5">
                          <span className="text-red-400 shrink-0">▸</span>{r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* References */}
                {aiResult.references && aiResult.references.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                      {it ? "Fonti" : "References"}
                    </p>
                    <ul className="space-y-1">
                      {aiResult.references.map((ref, i) => (
                        <li key={i} className="text-[11px] flex gap-1.5 items-start">
                          <span className="text-ink-muted shrink-0">[{i + 1}]</span>
                          <span>
                            {ref.url ? (
                              <a
                                href={ref.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-600 dark:text-indigo-400 underline hover:no-underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {ref.title}
                              </a>
                            ) : (
                              <span className="text-ink">{ref.title}</span>
                            )}
                            {ref.date && <span className="text-ink-muted ml-1">({ref.date})</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Raw fallback */}
                {!aiResult.recovery_score && aiResult.raw && (
                  <p className="text-[11px] text-ink leading-relaxed whitespace-pre-wrap">{aiResult.raw}</p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-ink-muted italic">
                {it
                  ? "Clicca 'Analizza ora' per un'analisi AI con catalyst imminenti, rischi e fonti."
                  : "Click 'Analyse now' for an AI analysis with upcoming catalysts, risks and references."}
              </p>
            )}
          </div>

          {/* ── Upcoming recovery events ── */}
          <UpcomingEventsBlock ticker={pos.ticker} it={it} />

          {/* Suggested action: invest more (high score) vs disinvest (low score) */}
          {alloc.rescoreScore < 30 ? (
            <div className="rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10 px-3 py-2 space-y-1">
              <p className="text-[11px] font-bold text-red-700 dark:text-red-300">
                {it ? "⚠ Raccomandazione: DISINVESTIRE" : "⚠ Recommendation: DISINVEST"}
              </p>
              <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                {it
                  ? `Rescue score ${alloc.rescoreScore}/100 — probabilità di recupero molto bassa. Considerare la vendita per limitare ulteriori perdite prima di un possibile ulteriore calo. Il capitale può essere riallocato su posizioni con score più alto.`
                  : `Rescue score ${alloc.rescoreScore}/100 — very low recovery probability. Consider selling to limit further losses before a possible continued decline. Capital can be reallocated to higher-score positions.`}
              </p>
            </div>
          ) : alloc.suggestedEur > 0 ? (
            <div className="flex items-center gap-3">
              <p className="text-[11px] text-ink-muted flex-1">
                {it
                  ? `Allocazione suggerita dal rescue budget: ${fmtEur(alloc.suggestedEur)} (proporzionale al rescue score: ${alloc.rescoreScore}/100).`
                  : `Suggested allocation from rescue budget: ${fmtEur(alloc.suggestedEur)} (proportional to rescue score: ${alloc.rescoreScore}/100).`}
              </p>
              {onExecuteAllocation && !isExecuted && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onExecuteAllocation(); }}
                  className="shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                >
                  {it ? `Alloca +${fmtEur(alloc.suggestedEur)}` : `Allocate +${fmtEur(alloc.suggestedEur)}`}
                </button>
              )}
              {isExecuted && (
                <span className="shrink-0 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  ✓ {it ? "Allocato" : "Allocated"}
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── AI notes localStorage cache ─────────────────────────────────────────────

const AI_NOTES_CACHE_KEY = "supernova_rescue_ai_notes_v1";

type AiNotesCacheEntry = { result: AiRescueResult; updatedAt: string };
type AiNotesCache = Record<string, AiNotesCacheEntry>;

function loadAiNotesCache(): AiNotesCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AI_NOTES_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AiNotesCache) : {};
  } catch {
    return {};
  }
}

function saveAiNotesCache(cache: AiNotesCache): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AI_NOTES_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function fmtUpdatedAt(iso: string, it: boolean): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return it
    ? `Aggiornato ${d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`
    : `Updated ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function LossRescuePanel({
  simTable,
  sdsRows,
}: {
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [refreshToken, setRefreshToken] = useState(0);
  const [aiCache, setAiCache] = useState<AiNotesCache>(() => loadAiNotesCache());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [universe, setUniverse] = useState<"simloop" | "real">("simloop");
  const [executedKeys, setExecutedKeys] = useState<Set<string>>(new Set());

  // Capital management: patch investSimInputs to increase capital on a position
  const { patchInputs } = useInvestSimInputsMutable(simTable ?? null);

  // Build causeByTicker map from SDS rows for rescue score computation
  const causeByTicker = useMemo(() => {
    if (!sdsRows?.length) return null;
    const m = new Map<string, RescueCauseInput>();
    for (const row of sdsRows) {
      const ci = deriveCauseInputFromSdsRow(row);
      if (ci) m.set(row.ticker.trim().toUpperCase(), ci);
    }
    return m;
  }, [sdsRows]);

  const aiNotes: Record<string, AiRescueResult> = Object.fromEntries(
    Object.entries(aiCache).map(([k, v]) => [k, v.result]),
  );

  const simLoopResult = useMemo((): LossRescueResult => {
    const state = loadDecisionSimState();
    const inputs = getInvestSimInputsSnapshot();
    const history = loadInvestSimHistory();
    const rowByKey = simTable?.rows?.length ? buildSimRowByKeyMap(simTable.rows) : new Map<string, Record<string, unknown>>();
    const portfolioWithEis: PaperPosition[] = state.paperPortfolio.map((p) => {
      // Use live P(plan) from simTable Affidabilità column (aligned with 24h tab)
      let liveProb: number | null = null;
      const simRow = rowByKey.get(p.key);
      if (simRow) {
        const colAffid = Object.keys(simRow).find((c) =>
          c.toLowerCase().includes("affidabilit"),
        ) ?? "";
        const affidRaw = parseFloat(String(simRow[colAffid] ?? ""));
        const affidPct = Number.isFinite(affidRaw)
          ? affidRaw > 1 ? affidRaw : affidRaw * 100
          : null;
        if (affidPct != null && affidPct > 0) {
          liveProb = Math.round(affidPct);
        } else {
          const pick = pickSignalFromSimRow(simRow, inputs, null, null);
          const sol = resolveSimulationEntrySolidity(pick, undefined, lang, "rascore");
          const ra = sol?.composite.total ?? null;
          if (ra != null && Number.isFinite(ra)) liveProb = Math.round(ra);
        }
      }
      return {
        ...p,
        entryProbPct: liveProb ?? p.entryProbPct,
        eisWindowScore: computeEisWindowScore(p.ticker, p.entryAt, lang, history),
      } as PaperPosition & { eisWindowScore: number | null };
    });
    return computeLossRescue(
      portfolioWithEis as PaperPosition[],
      { closedPnlEur: summarizePaperClosedDeals(state.ticks).rawPnlEur } as ExperimentPiggyBank,
      causeByTicker,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, lang, simTable, causeByTicker]);

  const realPortfolioResult = useMemo((): LossRescueResult => {
    if (!simTable?.rows?.length) {
      return { lossPositions: [], closedPnlEur: 0, rescueBudgetEur: 0, allocations: [] };
    }
    const inputs = getInvestSimInputsSnapshot();
    const history = loadInvestSimHistory();
    const alerts = detectPortfolioLossAlerts(simTable, inputs);
    const rowByKey = buildSimRowByKeyMap(simTable.rows);
    const syntheticPortfolio: (PaperPosition & { eisWindowScore: number | null })[] = alerts.map((a) => {
      const investedAt = resolveInvestedAt(a.key, inputs[a.key], []);
      const entryAt = investedAt ?? a.completionDate ?? new Date().toISOString().slice(0, 10);
      // Use live P(plan) from simTable (same source as 24h tab) for consistent rescue score
      let entryProbPct: number | null = null;
      const simRow = rowByKey.get(a.key);
      if (simRow) {
        // Primary: read Affidabilità column directly (same as 24h tab)
        const colAffid = Object.keys(simRow).find((c) =>
          c.toLowerCase().includes("affidabilit"),
        ) ?? "";
        const affidRaw = parseFloat(String(simRow[colAffid] ?? ""));
        const affidPct = Number.isFinite(affidRaw)
          ? affidRaw > 1 ? affidRaw : affidRaw * 100
          : null;
        if (affidPct != null && affidPct > 0) {
          entryProbPct = Math.round(affidPct);
        } else {
          // Secondary: resolve from signal picker
          const pick = pickSignalFromSimRow(simRow, inputs, null, null);
          const sol = resolveSimulationEntrySolidity(pick, undefined, lang, "rascore");
          const ra = sol?.composite.total ?? null;
          if (ra != null && Number.isFinite(ra)) entryProbPct = Math.round(ra);
        }
      }
      // Fallback to saved entryProbPct if live value unavailable
      if (entryProbPct == null) {
        const savedProb = inputs[a.key]?.entryProbPct;
        if (savedProb != null && Number.isFinite(savedProb) && savedProb > 0) {
          entryProbPct = Math.round(savedProb);
        }
      }
      return {
        key: a.key,
        ticker: a.ticker,
        entryAt,
        capital: a.capital,
        lastMarkPct: a.pnlPct,
        entryProbPct,
        eisWindowScore: computeEisWindowScore(a.ticker, entryAt, lang, history),
      } as PaperPosition & { eisWindowScore: number | null };
    });
    // Real closed P&L from inputs (posizioni vendute reali), not sim loop piggyBank
    let realClosedPnlEur = 0;
    for (const entry of Object.values(inputs)) {
      if (entry?.ignoreSheet && entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)) {
        realClosedPnlEur += entry.closedPnlEur;
      }
    }
    const realPiggy = { closedPnlEur: realClosedPnlEur } as ExperimentPiggyBank;
    return computeLossRescue(syntheticPortfolio as PaperPosition[], realPiggy, causeByTicker);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, simTable, lang, causeByTicker]);

  const result = universe === "simloop" ? simLoopResult : realPortfolioResult;

  function requestAnalysis(ticker: string, key: string, entryAt?: string, lastMarkPct?: number) {
    setLoadingKeys((prev) => new Set([...prev, key]));
    try {
      const result = buildLocalRescueAnalysis(ticker, entryAt, lastMarkPct, lang);
      const updatedAt = new Date().toISOString();
      setAiCache((prev) => {
        const next = { ...prev, [key]: { result, updatedAt } };
        saveAiNotesCache(next);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = { raw: `Error: ${msg}` };
      const updatedAt = new Date().toISOString();
      setAiCache((prev) => {
        const next = { ...prev, [key]: { result, updatedAt } };
        saveAiNotesCache(next);
        return next;
      });
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const { lossPositions, closedPnlEur, rescueBudgetEur, allocations } = result;
  const hasGain = closedPnlEur > 0;

  const hasReal = simTable?.rows?.length ? simTable.rows.length > 0 : false;

  return (
    <div className="space-y-4 px-1 py-2">
      {/* Universe tab switch */}
      {hasReal && (
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 w-fit">
          <button
            type="button"
            className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-colors ${
              universe === "simloop"
                ? "bg-white dark:bg-surface shadow text-indigo-700 dark:text-indigo-300"
                : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => setUniverse("simloop")}
          >
            {it ? "Sim Loop BUY" : "Sim Loop BUY"}
          </button>
          <button
            type="button"
            className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-colors ${
              universe === "real"
                ? "bg-white dark:bg-surface shadow text-emerald-700 dark:text-emerald-300"
                : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => setUniverse("real")}
          >
            {it ? "Portafoglio reale" : "Real portfolio"}
          </button>
        </div>
      )}
      {/* Budget header */}
      <div className="rounded-xl border border-[rgb(var(--border))]/60 bg-white/50 dark:bg-surface/50 px-4 py-3 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[180px]">
          <p className="text-[11px] text-ink-muted mb-0.5">
            {it ? "Gain netti trade chiusi" : "Net closed-trade gains"}
          </p>
          <p className={`text-[18px] font-bold tabular-nums ${hasGain ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
            {fmtEur(closedPnlEur)}
          </p>
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="text-[11px] text-ink-muted mb-0.5">
            {it
              ? `Budget rescue (${Math.round(RESCUE_BUDGET_FRACTION * 100)}% dei gain)`
              : `Rescue budget (${Math.round(RESCUE_BUDGET_FRACTION * 100)}% of gains)`}
          </p>
          <p className={`text-[18px] font-bold tabular-nums ${rescueBudgetEur > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-ink-muted"}`}>
            {fmtEur(rescueBudgetEur)}
          </p>
        </div>
        <div className="flex-1 min-w-[140px]">
          <p className="text-[11px] text-ink-muted mb-0.5">
            {it ? "Posizioni in perdita" : "Positions in loss"}
          </p>
          <p className="text-[18px] font-bold tabular-nums text-ink">
            {lossPositions.length}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 text-[10px] font-semibold px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 text-ink-muted hover:text-ink hover:border-slate-400 transition-colors"
          onClick={() => setRefreshToken((n) => n + 1)}
        >
          {it ? "Aggiorna" : "Refresh"}
        </button>
      </div>

      {/* Description */}
      <p className="text-[11px] text-ink-muted leading-relaxed px-1">
        {it
          ? `Le posizioni aperte sotto il prezzo di ingresso (PnL < 0%) sono ordinate per perdita. Il rescue score combina P(plan), profondità perdita, attività EIS, allineamento settoriale, volume anomalo e rischio cash runway. Il budget di riallocazione (${Math.round(RESCUE_BUDGET_FRACTION * 100)}% dei gain chiusi) viene distribuito proporzionalmente al rescue score (posizioni con bassa probabilità di recupero ricevono raccomandazione di disinvestimento). Clicca "Analizza ora" per un'analisi AI sulla probabilità di ripresa.`
          : `Open positions below entry price (PnL < 0%) are ranked by loss. The rescue score combines P(plan), loss depth, EIS activity, sector alignment, anomalous volume, and cash runway risk. The reallocation budget (${Math.round(RESCUE_BUDGET_FRACTION * 100)}% of closed gains) is distributed proportionally to rescue score (positions with low recovery probability receive a disinvestment recommendation). Click "Analyse now" for an AI recovery probability analysis.`}
      </p>

      {/* No positions message */}
      {lossPositions.length === 0 && (
        <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-6 text-center">
          <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
            {it ? "Nessuna posizione sotto il prezzo di ingresso" : "No positions below entry price"}
          </p>
          <p className="text-[11px] text-ink-muted mt-1">
            {it ? "Tutte le posizioni aperte sono al di sopra del prezzo di acquisto." : "All open positions are above their entry price."}
          </p>
        </div>
      )}

      {/* No budget warning */}
      {lossPositions.length > 0 && rescueBudgetEur <= 0 && (
        <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10 px-4 py-3">
          <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            {it ? "Nessun gain chiuso disponibile per il rescue budget" : "No closed gains available for rescue budget"}
          </p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {it
              ? "Il rescue budget si attiva quando i trade chiusi generano gain netti positivi. Puoi comunque analizzare le posizioni sotto."
              : "The rescue budget activates once closed trades generate positive net gains. You can still analyse positions below."}
          </p>
        </div>
      )}

      {/* All loss positions — with or without budget */}
      {lossPositions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-ink px-1">
            {allocations.length > 0
              ? (it ? "Suggerimenti di riallocazione" : "Reallocation suggestions")
              : (it ? "Posizioni in perdita" : "Loss positions")}
          </p>
          {allocations.length > 0
            ? allocations.map((alloc) => (
                <AllocationCard
                  key={alloc.position.key}
                  alloc={alloc}
                  it={it}
                  aiResult={aiNotes[alloc.position.key] ?? null}
                  aiUpdatedAt={aiCache[alloc.position.key]?.updatedAt ?? null}
                  loadingAi={loadingKeys.has(alloc.position.key)}
                  onRequestAi={() => requestAnalysis(alloc.position.ticker, alloc.position.key, alloc.position.entryAt, alloc.position.lastMarkPct)}
                  isExecuted={executedKeys.has(alloc.position.key)}
                  sdsRow={sdsRows?.find((r) => r.ticker.trim().toUpperCase() === alloc.position.ticker.trim().toUpperCase()) ?? null}
                  onExecuteAllocation={universe === "real" && alloc.suggestedEur > 0 ? () => {
                    const key = alloc.position.key;
                    const addEur = alloc.suggestedEur;
                    const ok = window.confirm(
                      it
                        ? `Aggiungere +${fmtEur(addEur)} al capitale di ${alloc.position.ticker}? L'importo verrà sommato al capitale investito in Pick Stocks.`
                        : `Add +${fmtEur(addEur)} to ${alloc.position.ticker} capital? The amount will be added to the invested capital in Pick Stocks.`,
                    );
                    if (!ok) return;
                    patchInputs((prev: InvestSimInputs) => {
                      const cur = prev[key];
                      if (!cur) return prev;
                      return { ...prev, [key]: { ...cur, capital: (cur.capital ?? 0) + addEur } };
                    });
                    setExecutedKeys((prev) => new Set([...prev, key]));
                    setRefreshToken((n) => n + 1);
                  } : undefined}
                />
              ))
            : lossPositions.map((pos) => {
                const probPt = Math.round(Math.max(0, Math.min((pos.entryProbPct ?? 50) - 30, 40)));
                const lossPt = Math.round(Math.max(0, Math.min(Math.abs(pos.lastMarkPct) * 0.7, 20)));
                const eisPt = pos.eisWindowScore != null ? Math.round(Math.min(Math.max(0, (pos.eisWindowScore / 25) * 15), 15)) : 0;
                const rescoreScore = Math.round(Math.max(0, Math.min(probPt + lossPt + eisPt, 100)));
                return (
                <AllocationCard
                  key={pos.key}
                  alloc={{ position: pos, suggestedEur: 0, rescoreScore, scoreBreakdown: { probPt, lossPt, eisPt, volPenalty: 0, extBonus: 0, cashPenalty: 0, rescoreScore } }}
                  it={it}
                  aiResult={aiNotes[pos.key] ?? null}
                  aiUpdatedAt={aiCache[pos.key]?.updatedAt ?? null}
                  loadingAi={loadingKeys.has(pos.key)}
                  onRequestAi={() => requestAnalysis(pos.ticker, pos.key, pos.entryAt, pos.lastMarkPct)}
                  sdsRow={sdsRows?.find((r) => r.ticker.trim().toUpperCase() === pos.ticker.trim().toUpperCase()) ?? null}
                />
              );
              })
          }
        </div>
      )}
    </div>
  );
}
