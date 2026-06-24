import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAiProviderInfo,
  fetchClinicalPreCdSnapshot,
  fetchClinicalPreCdStatus,
  runClinicalPreCdRefresh,
  type AiProviderId,
  type AiProviderInfo,
  type ClinicalPreCdRecord,
  type ClinicalPreCdStatus,
  type ClinicalPublicationEvent,
  type ClinicalStudyIndicator,
} from "../api/supernova";
import type { SheetTable } from "../types";
import { PortfolioScopeToggle, PortfolioTickerMark } from "./PortfolioScopeToggle";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import {
  hydrateClinicalPreCdRecords,
  readClinicalPreCdSnapshotCache,
  writeClinicalPreCdSnapshotCache,
} from "../sheet/clinicalPreCdSnapshotCache";
import {
  recordMatchesScope,
  useSimulationPortfolioScope,
  type PortfolioScopeMode,
} from "../sheet/portfolioScope";
import { eisBarPercent, eisColor, resolveEventEis } from "../sheet/eventImpactScore";
import {
  isClinicalPreCdRecordTrusted,
  isEventReferenceVerified,
  referenceMatchLabel,
  trustedRecordEvents,
  verifyEventReference,
} from "../sheet/referenceVerification";
import { AiApiKeysPanel } from "./AiApiKeysPanel";
import { AiProviderSwitch } from "./AiProviderSwitch";
import { CatalystCopilotChat } from "./CatalystCopilotChat";
import {
  buildCopilotPrefill,
  buildTickerCritSummaryPrefill,
  type CopilotStudyFocus,
} from "./catalystCopilotFocus";
import { ClinicalIndicatorChips } from "./ClinicalIndicatorSummary";
import {
  cleanClinicalIndicators as cleanIndicators,
  dedupeClinicalIndicators as dedupeIndicators,
  indicatorIsOutcome,
  prioritizeClinicalIndicators as prioritizeIndicators,
} from "../sheet/clinicalIndicators";
import {
  buildCompanyUnifiedTimeline,
  eventDateMs,
  filterEventsBySource,
  groupRecordsByTicker,
  isSecK8Event,
  timelineBadge,
  timelineKind,
  type EventSourceFilter,
  type UnifiedTimelineRow,
} from "../sheet/clinicalTimeline";

/** Wider indicators column for readable KPI chips (sums to 100). */
const FEED_TIMELINE_COL_PCT = [6, 7, 15, 7, 18, 20, 5, 11, 11];
const FEED_STUDY_COL_PCT = [7, 17, 8, 20, 22, 10, 6, 10];

/** Eventi più recenti in cima, poi via via più indietro nel tempo. */
function eventsNewestFirst(events: ClinicalPublicationEvent[]): ClinicalPublicationEvent[] {
  return [...events].sort((a, b) => eventDateMs(b.event_date) - eventDateMs(a.event_date));
}

function recordLatestEventMs(rec: ClinicalPreCdRecord): number {
  const evs = trustedRecordEvents(rec);
  if (!evs.length) return 0;
  return Math.max(...evs.map((e) => eventDateMs(e.event_date)));
}

function eventDrug(ev: ClinicalPublicationEvent): string {
  const raw = ev.drug ?? ev.asset ?? (isSecK8Event(ev) ? "Corporate" : "—");
  return String(raw ?? "—").trim() || "—";
}

function EventTypeBadge({ ev, it }: { ev: ClinicalPublicationEvent; it: boolean }) {
  const { label, className } = timelineBadge(timelineKind(ev), it ? "it" : "en");
  return (
    <span className={`inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  );
}

function windowSubtitle(rec: ClinicalPreCdRecord, it: boolean): string {
  const fmt = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(it ? "it-IT" : "en-US", { month: "short", year: "numeric" });
  };
  const a = fmt(rec.window_start);
  const b = fmt(rec.window_end);
  const win = a && b ? ` (${a} – ${b})` : "";
  return `${it ? "Pubblicazioni cliniche e corporate" : "Clinical & corporate publications"}${win}`;
}

function fmtDate(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n.d.";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPctInline(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function DrugBadge({ drug }: { drug: string }) {
  const label = String(drug ?? "—");
  const corp = label.toLowerCase().includes("corporate");
  return (
    <span
      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
        corp ? "feed-panel-chip-corp" : "feed-panel-chip-clin"
      }`}
    >
      {label}
    </span>
  );
}

/** Colonna Prezzo: T, T+1, T+3 in verticale (risparmio larghezza tabella). */
function PriceSummary({ ev, it }: { ev: ClinicalPublicationEvent; it: boolean }) {
  const p = ev.price;
  const d1 = fmtPctInline(p?.delta_p_1d);
  const d3 = fmtPctInline(p?.delta_p_3d);

  if (p?.p_t0 == null && d1 == null && d3 == null) {
    return (
      <span className="text-[11px] feed-panel-muted italic leading-relaxed">
        {it ? "dati non disponibili" : "data not available"}
      </span>
    );
  }

  const t0 = fmtPrice(p?.p_t0);
  const t1 = p?.p_t1 != null ? fmtPrice(p.p_t1) : "n.d.";
  const t3 = p?.p_t3 != null ? fmtPrice(p.p_t3) : "n.d.";
  const pctClass = (v: number | null | undefined) =>
    (v ?? 0) >= 0 ? "cell-up" : "cell-down";

  const row = (label: string, price: string, pct: string | null, delta?: number | null) => (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[9px] font-semibold feed-panel-muted w-[22px] shrink-0">{label}</span>
      <span className="feed-panel-text">{price}</span>
      {pct && (
        <span className={`font-semibold text-[10px] ${pctClass(delta)}`}>
          {pct}
        </span>
      )}
    </div>
  );

  return (
    <div className="text-[11px] feed-panel-text leading-snug tabular-nums flex flex-col gap-0.5">
      {row("T", t0, null)}
      {row("T+1", t1, d1, p?.delta_p_1d)}
      {row("T+3", t3, d3, p?.delta_p_3d)}
    </div>
  );
}

/** Split impact_note: price reaction (T+1 %, volume stays with EIS context). */
function splitImpactNote(note: string | undefined): {
  priceParts: string[];
  contextNote: string | null;
} {
  if (!note?.trim()) return { priceParts: [], contextNote: null };
  const priceParts: string[] = [];
  const contextParts: string[] = [];
  for (const part of note.split(" · ").map((s) => s.trim()).filter(Boolean)) {
    if (/T\+[0-9]|%/.test(part) && !/^volume/i.test(part)) {
      priceParts.push(part);
    } else {
      contextParts.push(part);
    }
  }
  return {
    priceParts,
    contextNote: contextParts.length ? contextParts.join(" · ") : null,
  };
}

function stockDeltaLines(ev: ClinicalPublicationEvent, it: boolean): string[] {
  const lines: string[] = [];
  const p = ev.price;
  const eis = ev.eis;
  const d1 = p?.delta_p_1d ?? eis?.delta_p_1d ?? null;
  const d3 = p?.delta_p_3d ?? eis?.delta_p_3d ?? null;
  if (d1 != null) {
    lines.push(`Δ1d ${d1 >= 0 ? "+" : ""}${d1.toFixed(2)}%`);
  }
  if (d3 != null) {
    const eff = (eis as { delta_p_3d_effective?: number | null } | undefined)?.delta_p_3d_effective;
    if (eff != null && eff !== d3) {
      lines.push(
        it
          ? `Δ3d ${d3 >= 0 ? "+" : ""}${d3.toFixed(2)}% (eff ${eff >= 0 ? "+" : ""}${eff.toFixed(2)}%)`
          : `Δ3d ${d3 >= 0 ? "+" : ""}${d3.toFixed(2)}% (eff ${eff >= 0 ? "+" : ""}${eff.toFixed(2)}%)`,
      );
    } else {
      lines.push(`Δ3d ${d3 >= 0 ? "+" : ""}${d3.toFixed(2)}%`);
    }
  }
  const { priceParts } = splitImpactNote(ev.impact_note);
  for (const part of priceParts) {
    if (!lines.some((l) => l.includes(part))) lines.push(part);
  }
  return lines;
}

/** Colonna variazione prezzo (separata da EIS). */
function StockPriceColumn({ ev, it }: { ev: ClinicalPublicationEvent; it: boolean }) {
  const p = ev.price;
  const hasPrices =
    p?.p_t0 != null || p?.p_t1 != null || p?.p_t3 != null || p?.delta_p_1d != null || p?.delta_p_3d != null;
  const deltaLines = stockDeltaLines(ev, it);

  if (hasPrices) {
    return <PriceSummary ev={ev} it={it} />;
  }

  if (!deltaLines.length) {
    return (
      <span className="text-[11px] feed-panel-muted italic leading-relaxed">
        {it ? "dati non disponibili" : "data not available"}
      </span>
    );
  }

  const pctClass = (line: string) => {
    const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(line);
    const v = m ? Number(m[1]) : 0;
    return v >= 0 ? "cell-up" : "cell-down";
  };

  return (
    <div className="text-[10px] feed-panel-text leading-snug tabular-nums flex flex-col gap-0.5 min-w-[108px]">
      {deltaLines.map((line) => (
        <span key={line} className={`font-semibold ${pctClass(line)}`}>
          {line}
        </span>
      ))}
    </div>
  );
}

/** Solo volume / sentiment / KPI (niente Δ prezzo). */
function eisContextHint(eis: NonNullable<ClinicalPublicationEvent["eis"]>, it: boolean): string {
  const parts: string[] = [];
  if (eis.vol_term != null) parts.push(`vol ${eis.vol_term >= 0 ? "+" : ""}${eis.vol_term}`);
  if (eis.kpi_score != null) parts.push(`KPI ${eis.kpi_score >= 0 ? "+" : ""}${eis.kpi_score}`);
  else if (eis.sent_term != null && Math.abs(eis.sent_term) > 0.01)
    parts.push(`sent ${eis.sent_term >= 0 ? "+" : ""}${eis.sent_term}`);
  if (!parts.length) {
    return it
      ? "EIS ≈ 0: nessuna reazione prezzo e KPI neutri"
      : "EIS ≈ 0: no price reaction and neutral KPIs";
  }
  return parts.join(" · ");
}

function EisColumn({
  ev,
  indicators,
  it,
}: {
  ev: ClinicalPublicationEvent;
  indicators?: ClinicalStudyIndicator[];
  it: boolean;
}) {
  const resolved = resolveEventEis(ev, indicators);
  const score = resolved?.score;
  const { contextNote } = splitImpactNote(ev.impact_note);
  if (score == null || !Number.isFinite(score)) {
    return (
      <div className="min-w-[100px]">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[rgb(var(--panel-mint-bg-soft))] feed-panel-muted">
          EIS n.d.
        </span>
        {contextNote && (
          <p className="mt-1.5 text-[10px] feed-panel-muted leading-snug">{contextNote}</p>
        )}
      </div>
    );
  }
  const color = eisColor(score);
  const w = eisBarPercent(score);
  const arrow = score >= 5 ? "↑" : score <= -5 ? "↓" : "–";
  const hint = resolved ? eisContextHint(resolved, it) : "";
  return (
    <div className="min-w-[100px]" title={hint || undefined}>
      <span
        className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
      >
        {arrow} EIS {score >= 0 ? "+" : ""}{score.toFixed(1)}
      </span>
      <div className="h-1.5 bg-[rgb(var(--panel-mint-bg-soft))] rounded-full mt-1.5 overflow-hidden max-w-[100px]">
        <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: color }} />
      </div>
      {Math.abs(score) < 2.5 && hint && (
        <p className="mt-1 text-[9px] feed-panel-muted leading-snug max-w-[200px]">{hint}</p>
      )}
      {contextNote && (
        <p className="mt-1.5 text-[10px] feed-panel-muted leading-snug max-w-[200px]">{contextNote}</p>
      )}
    </div>
  );
}

/** Outcome KPIs first; no study-level fallback on SEC 8-K rows. */
function indicatorsForDisplay(
  ev: ClinicalPublicationEvent,
  rec: ClinicalPreCdRecord,
): ClinicalStudyIndicator[] | undefined {
  if (isSecK8Event(ev)) return undefined;

  const local = cleanIndicators(ev.indicators ?? []);
  const study = cleanIndicators(rec.clinical_indicators ?? []);
  const localOutcomes = local.filter(indicatorIsOutcome);
  const studyOutcomes = study.filter(indicatorIsOutcome);

  if (localOutcomes.length) {
    return dedupeIndicators(prioritizeIndicators(local)).slice(0, 4);
  }
  if (studyOutcomes.length) {
    return dedupeIndicators(prioritizeIndicators([...studyOutcomes.slice(0, 3), ...local])).slice(0, 4);
  }
  if (local.length) {
    return dedupeIndicators(prioritizeIndicators(local)).slice(0, 2);
  }
  return undefined;
}

function RefBadge({ ev, rec, it }: { ev: ClinicalPublicationEvent; rec: ClinicalPreCdRecord; it: boolean }) {
  const { verified, match } = verifyEventReference(ev, rec);
  if (verified) {
    return (
      <span
        className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full feed-panel-chip-ok"
        title={referenceMatchLabel(match, it)}
      >
        ✓ {referenceMatchLabel(match, it)}
      </span>
    );
  }
  return (
    <span
      className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full feed-panel-chip-pending"
      title={it ? "Nessun match società/farmaco nel testo" : "No company/drug match in text"}
    >
      ? {it ? "ref. debole" : "weak ref"}
    </span>
  );
}

function UnifiedCompanyTimeline({
  rows,
  recordsByTicker,
  it,
  verifiedOnly,
  sourceFilter,
  isPortfolioTicker,
  onDeepenStudy: _onDeepenStudy,
  onTickerSummary,
}: {
  rows: UnifiedTimelineRow[];
  recordsByTicker: Map<string, ClinicalPreCdRecord[]>;
  it: boolean;
  verifiedOnly: boolean;
  sourceFilter: EventSourceFilter;
  isPortfolioTicker: (t: string) => boolean;
  onDeepenStudy?: (focus: CopilotStudyFocus) => void;
  onTickerSummary?: (ticker: string) => void;
}) {
  let events = rows;
  if (sourceFilter !== "all") {
    events = rows.filter((r) =>
      filterEventsBySource([r.event], sourceFilter).length > 0,
    );
  }
  if (verifiedOnly) {
    events = events.filter((r) => {
      const recs = recordsByTicker.get(r.ticker) ?? [];
      const rec = recs.find((x) => x.nct_id === r.nctId) ?? recs[0];
      return rec ? isEventReferenceVerified(r.event, rec) : false;
    });
  }

  if (!events.length) {
    return (
      <p className="px-4 py-8 text-center text-[12px] feed-panel-muted italic">
        {it
          ? "Nessun evento nella timeline unificata per questo filtro."
          : "No events in unified timeline for this filter."}
      </p>
    );
  }

  const byTicker = new Map<string, UnifiedTimelineRow[]>();
  for (const row of events) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push(row);
    byTicker.set(row.ticker, list);
  }

  return (
    <div className="space-y-4">
      {[...byTicker.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ticker, tickerRows]) => {
          const company = tickerRows[0]?.company ?? ticker;
          const inPortfolio = isPortfolioTicker(ticker);
          return (
            <div
              key={ticker}
              className="feed-panel-card rounded-xl shadow-sm overflow-hidden"
              style={
                inPortfolio
                  ? { borderLeft: "3px solid rgb(var(--signal-up))" }
                  : undefined
              }
            >
              <div className="px-4 pt-3 pb-2.5 flex items-center justify-between gap-3 flex-nowrap border-b border-[rgb(var(--panel-feed-border-soft))] bg-[rgb(var(--panel-mint-bg-soft)/0.55)]">
                <p className="text-[13px] font-bold feed-panel-text flex items-center gap-x-1.5 min-w-0 truncate">
                  {company} (
                  <PortfolioTickerMark ticker={ticker} inPortfolio={inPortfolio} />)
                  <span className="feed-panel-muted font-medium text-[11px] shrink-0">
                    — {it ? "Timeline unificata" : "Unified timeline"} · {tickerRows.length}{" "}
                    {it ? "eventi" : "events"}
                  </span>
                </p>
                {onTickerSummary ? (
                  <button
                    type="button"
                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold text-white shadow-md feed-panel-btn-primary ring-2 ring-[rgb(var(--panel-feed-accent-strong)/0.35)] transition hover:opacity-95"
                    title={
                      it
                        ? "Summary AI: criticità e passi avanti (non è la colonna Riassunto)"
                        : "AI summary: risks & next steps (not the Brief column)"
                    }
                    onClick={() => onTickerSummary(ticker)}
                  >
                    <span aria-hidden>📋</span>
                    {it ? `Summary ${ticker}` : `${ticker} summary`}
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className={`${SHEET_GRID_TABLE_CLASS} feed-panel-table text-[11px] border-collapse min-w-[1280px]`}>
                  <SheetGridColgroup widths={FEED_TIMELINE_COL_PCT} />
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide feed-panel-label">
                      <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Data" : "Date"}</th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Tipo" : "Type"}</th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Evento" : "Event"}</th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>Drug</th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>
                        {it ? "Riassunto" : "Brief"}
                      </th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>
                        {it ? "Indicatori" : "Indicators"}
                      </th>
                      <th className={gridTh("left", "py-2.5 font-bold")}>Link</th>
                      <th className={gridTh("center", "py-2.5 font-bold")}>
                        {it ? "Var. prezzo" : "Stock Δ"}
                        <span className="block text-[9px] font-medium normal-case tracking-normal feed-panel-muted">
                          T · T+1 · T+3
                        </span>
                      </th>
                      <th className={gridTh("center", "py-2.5 font-bold")}>EIS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickerRows.map((row, i) => {
                      const recs = recordsByTicker.get(row.ticker) ?? [];
                      const rec =
                        recs.find((x) => x.nct_id === row.nctId) ?? recs[0];
                      const ev = row.event;
                      return (
                        <tr key={`${row.event.event_date}-${i}`} className="align-top">
                          <td className={`${gridTd("left", "py-3")} feed-panel-muted whitespace-nowrap`}>
                            {fmtDate(ev.event_date, it)}
                          </td>
                          <td className={gridTd("left", "py-3")}>
                            <EventTypeBadge ev={ev} it={it} />
                          </td>
                          <td className={gridTd("left", "py-3")}>
                            <p className="font-bold feed-panel-text text-[12px] leading-snug">
                              {ev.event_title ?? "—"}
                            </p>
                            {rec && <RefBadge ev={ev} rec={rec} it={it} />}
                            {_onDeepenStudy && rec ? (
                              <button
                                type="button"
                                className="mt-1.5 block text-[10px] font-semibold feed-panel-link hover:underline"
                                onClick={() =>
                                  _onDeepenStudy({
                                    ticker: row.ticker,
                                    company: row.company,
                                    event: ev,
                                    prefill: buildCopilotPrefill(rec, ev, it),
                                  })
                                }
                              >
                                {it ? "Approfondisci →" : "Deep dive →"}
                              </button>
                            ) : null}
                          </td>
                          <td className={gridTd("left", "py-3")}>
                            <DrugBadge drug={eventDrug(ev)} />
                          </td>
                          <td className={`${gridTd("left", "py-3")} feed-panel-muted leading-relaxed`}>
                            <p>{ev.summary ?? "—"}</p>
                            {rec?.data_gaps ? (
                              <p
                                className="mt-1 text-[10px] text-amber-800/90 leading-snug"
                                title={it ? "Lacune dati (snapshot)" : "Data gaps (snapshot)"}
                              >
                                ⚠ {String(rec.data_gaps).slice(0, 120)}
                                {String(rec.data_gaps).length > 120 ? "…" : ""}
                              </p>
                            ) : null}
                          </td>
                          <td className={`${gridTd("left", "py-3")} min-w-[220px]`}>
                            {rec ? (
                              <ClinicalIndicatorChips
                                indicators={indicatorsForDisplay(ev, rec)}
                                it={it}
                                variant="table"
                                maxShown={3}
                              />
                            ) : (
                              <span className="feed-panel-muted">—</span>
                            )}
                          </td>
                          <td className={gridTd("left", "py-3")}>
                            {ev.link ? (
                              <a
                                href={ev.link}
                                target="_blank"
                                rel="noreferrer"
                                className="feed-panel-link font-semibold hover:underline text-[11px]"
                              >
                                {ev.link_label ?? "Link"}
                              </a>
                            ) : (
                              <span className="feed-panel-muted">—</span>
                            )}
                          </td>
                          <td className={gridTd("center", "py-3")}>
                            <StockPriceColumn ev={ev} it={it} />
                          </td>
                          <td className={gridTd("center", "py-3")}>
                            <EisColumn
                              ev={ev}
                              indicators={indicatorsForDisplay(ev, rec)}
                              it={it}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </div>
  );
}

function ClinicalEventsTable({
  rec,
  it,
  verifiedOnly,
  sourceFilter,
  inPortfolio,
  onDeepenStudy,
}: {
  rec: ClinicalPreCdRecord;
  it: boolean;
  verifiedOnly: boolean;
  sourceFilter: EventSourceFilter;
  inPortfolio: boolean;
  onDeepenStudy?: (focus: CopilotStudyFocus) => void;
}) {
  let events = eventsNewestFirst(filterEventsBySource(trustedRecordEvents(rec), sourceFilter));
  if (verifiedOnly) {
    events = events.filter((ev) => isEventReferenceVerified(ev, rec));
  }
  const ticker = rec.ticker ?? "";

  if (!events.length) {
    return (
      <p className="px-4 py-8 text-center text-[12px] feed-panel-muted italic">
        {sourceFilter === "clinical"
          ? (it ? "Nessun evento clinico in questa finestra." : "No clinical events in this window.")
          : sourceFilter === "k8"
            ? (it ? "Nessun 8-K SEC in questa finestra." : "No SEC 8-K in this window.")
            : verifiedOnly
              ? (it
                ? "Nessun evento con referenza verificata (società o farmaco nel testo)."
                : "No events with verified reference (company or drug in text).")
              : (it ? "Nessun evento — clicca «Arricchisci»." : "No events — click «Enrich».")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <p className="px-4 pt-4 pb-2 text-[13px] font-bold feed-panel-text leading-snug flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span>
          {rec.company ?? "—"}{" "}
          (
          <PortfolioTickerMark
            ticker={rec.ticker ?? "—"}
            inPortfolio={inPortfolio}
          />
          )
        </span>
        <span className="feed-panel-muted font-medium">— {windowSubtitle(rec, it)}</span>
      </p>
      <table className={`${SHEET_GRID_TABLE_CLASS} feed-panel-table text-[11px] border-collapse min-w-[1240px]`}>
        <SheetGridColgroup widths={FEED_STUDY_COL_PCT} />
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide feed-panel-label">
            <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Data" : "Date"}</th>
            <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Evento" : "Event"}</th>
            <th className={gridTh("left", "py-2.5 font-bold")}>Drug</th>
            <th className={gridTh("left", "py-2.5 font-bold")}>{it ? "Summary dati" : "Data summary"}</th>
            <th className={gridTh("left", "py-2.5 font-bold")}>
              {it ? "Indicatori clinici" : "Clinical indicators"}
            </th>
            <th className={gridTh("center", "py-2.5 font-bold")}>
              {it ? `Prezzo ${ticker}` : `Price ${ticker}`}
              <span className="block text-[9px] font-medium normal-case tracking-normal feed-panel-muted">
                T · T+1 · T+3
              </span>
            </th>
            <th className={gridTh("left", "py-2.5 font-bold")}>Link</th>
            <th className={gridTh("center", "py-2.5 font-bold")}>EIS</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev, i) => (
            <tr
              key={`${ev.event_date}-${ev.event_title}-${i}`}
              className="align-top"
            >
              <td className={`${gridTd("left", "py-3")} feed-panel-muted whitespace-nowrap`}>
                {fmtDate(ev.event_date, it)}
              </td>
              <td className={gridTd("left", "py-3")}>
                <p className="font-bold feed-panel-text text-[12px] leading-snug">
                  {ev.event_title ?? "—"}
                </p>
                <EventTypeBadge ev={ev} it={it} />
                <RefBadge ev={ev} rec={rec} it={it} />
                {onDeepenStudy ? (
                  <button
                    type="button"
                    className="mt-1.5 block text-[10px] font-semibold feed-panel-link hover:underline"
                    onClick={() =>
                      onDeepenStudy({
                        ticker: String(rec.ticker ?? "").trim(),
                        company: rec.company ?? undefined,
                        event: ev,
                        prefill: buildCopilotPrefill(rec, ev, it),
                      })
                    }
                  >
                    {it ? "Approfondisci →" : "Deep dive →"}
                  </button>
                ) : null}
              </td>
              <td className={gridTd("left", "py-3")}>
                <DrugBadge drug={eventDrug(ev)} />
              </td>
              <td className={`${gridTd("left", "py-3")} feed-panel-muted leading-relaxed`}>
                {ev.summary ?? "—"}
              </td>
              <td className={`${gridTd("left", "py-3")} min-w-[220px]`}>
                <ClinicalIndicatorChips
                  indicators={indicatorsForDisplay(ev, rec)}
                  it={it}
                  variant="table"
                  maxShown={3}
                />
              </td>
              <td className={gridTd("center", "py-3")}>
                <PriceSummary ev={ev} it={it} />
              </td>
              <td className={gridTd("left", "py-3")}>
                {ev.link ? (
                  <a
                    href={ev.link}
                    target="_blank"
                    rel="noreferrer"
                    className="feed-panel-link font-semibold hover:underline text-[11px]"
                  >
                    {ev.link_label ?? "Link"}
                  </a>
                ) : (
                  <span className="feed-panel-muted">—</span>
                )}
              </td>
              <td className={gridTd("center", "py-3")}>
                <EisColumn
                  ev={ev}
                  indicators={indicatorsForDisplay(ev, rec)}
                  it={it}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[9px] feed-panel-muted border-t border-[rgb(var(--panel-feed-border-soft))] mt-1">
        {it
          ? "KPI esito = ORR/PFS/OS, endpoint raggiunto, esito studio, pubblicazione dati · CTX = reclutamento/status CT.gov · "
          : "Outcome KPIs = ORR/PFS/OS, endpoint met, study success, data readouts · CTX = registry enrollment/status · "}
        EIS = 0.35×ΔP₁d + 0.35×ΔP₃d + 0.15×(vol−1)×20 + 0.15×KPI×10 (KPI da endpoint/ORR/EASI/IGA) ·{" "}
        {it
          ? "Timeline: Intelligence + PubMed + press RSS + SEC 8-K + milestone CD/CT.gov"
          : "Timeline: Intelligence + PubMed + press RSS + SEC 8-K + CD/CT.gov milestones"}
      </p>
    </div>
  );
}

export function ClinicalPreCdFeedPanel({
  simTable,
  aiProvider,
  onProviderUpdate,
  reloadSnapshotToken = 0,
  initialTickerFilter = null,
  onInitialTickerFilterConsumed,
}: {
  simTable: SheetTable | null;
  aiProvider: AiProviderInfo | null;
  onProviderUpdate?: (info: AiProviderInfo) => void;
  /** Increment to reload clinical_pre_cd_enrichment_snapshot.json (fast, no AI). */
  reloadSnapshotToken?: number;
  /** Pre-fill ticker search (e.g. from Dashboard Top 2). */
  initialTickerFilter?: string | null;
  onInitialTickerFilterConsumed?: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [records, setRecords] = useState<ClinicalPreCdRecord[]>(() =>
    hydrateClinicalPreCdRecords(),
  );
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<string | null>(
    () => readClinicalPreCdSnapshotCache()?.updated_at ?? null,
  );
  const [status, setStatus] = useState<ClinicalPreCdStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<EventSourceFilter>("all");
  const [viewMode, setViewMode] = useState<"studies" | "unified">("unified");
  const [listMode, setListMode] = useState<PortfolioScopeMode>("portfolio");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [apiKeysHint, setApiKeysHint] = useState<AiProviderId | null>(null);
  const [studyFocus, setStudyFocus] = useState<CopilotStudyFocus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tk = initialTickerFilter?.trim().toUpperCase();
    if (!tk) return;
    setTickerFilter(tk);
    onInitialTickerFilterConsumed?.();
  }, [initialTickerFilter, onInitialTickerFilterConsumed]);

  const handleDeepenStudy = useCallback((focus: CopilotStudyFocus) => {
    setStudyFocus(focus);
    setCopilotOpen(true);
  }, []);

  const runTickerSummary = useCallback(
    (tk: string) => {
      const ticker = tk.trim().toUpperCase();
      if (!ticker) return;
      setStudyFocus({
        ticker,
        prefill: buildTickerCritSummaryPrefill(ticker, it),
        autoSend: true,
      });
      setCopilotOpen(true);
    },
    [it],
  );

  const { portfolioTickers, watchTickers, counts, isPortfolioTicker } =
    useSimulationPortfolioScope(simTable);

  const loadSnapshot = useCallback(async () => {
    try {
      const snap = await fetchClinicalPreCdSnapshot();
      const rows = Array.isArray(snap.records) ? snap.records : [];
      setRecords(rows);
      writeClinicalPreCdSnapshotCache(snap);
      setSnapshotUpdatedAt(snap.updated_at ?? null);
      setLoadError(null);
    } catch (e) {
      const cached = readClinicalPreCdSnapshotCache();
      if (cached?.records?.length) {
        setRecords(cached.records);
        setSnapshotUpdatedAt(cached.updated_at ?? null);
      }
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const s = await fetchClinicalPreCdStatus();
      setStatus(s);
      if (!s.running) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        await loadSnapshot();
        setLoading(false);
        if (s.error) {
          setLoadError(s.error);
        }
        const info = await fetchAiProviderInfo().catch(() => null);
        if (info) onProviderUpdate?.(info);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [loadSnapshot, onProviderUpdate]);

  useEffect(() => {
    void loadSnapshot();
    void pollStatus();
    void fetchAiProviderInfo().then((info) => onProviderUpdate?.(info)).catch(() => { /* ignore */ });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadSnapshot, pollStatus, onProviderUpdate]);

  useEffect(() => {
    if (reloadSnapshotToken > 0) void loadSnapshot();
  }, [reloadSnapshotToken, loadSnapshot]);

  /** Ricarica snapshot da disco quando si torna alla tab / finestra. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadSnapshot();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadSnapshot]);

  const enrichPortfolioOnly = listMode === "portfolio";

  const handleRefresh = useCallback(
    async (opts?: { force?: boolean; deep?: boolean }) => {
    setLoading(true);
    setLoadError(null);
    try {
      const started = await runClinicalPreCdRefresh(enrichPortfolioOnly, opts);
      if (started?.started === false && started?.message) {
        setLoadError(started.message);
        setLoading(false);
        return;
      }
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void pollStatus(), 2000);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  },
  [pollStatus, enrichPortfolioOnly],
  );

  const scoped = useMemo(
    () =>
      records.filter(
        (r) =>
          isClinicalPreCdRecordTrusted(r) &&
          recordMatchesScope(r.ticker, listMode, portfolioTickers, watchTickers),
      ),
    [records, listMode, portfolioTickers, watchTickers],
  );

  const recordHasVisibleEvents = useCallback(
    (rec: ClinicalPreCdRecord) => {
      let evs = filterEventsBySource(trustedRecordEvents(rec), sourceFilter);
      if (verifiedOnly) evs = evs.filter((ev) => isEventReferenceVerified(ev, rec));
      return evs.length > 0;
    },
    [sourceFilter, verifiedOnly],
  );

  const filtered = scoped
    .filter((r) => {
      if (!tickerFilter.trim()) return true;
      return (r.ticker ?? "").toUpperCase().includes(tickerFilter.trim().toUpperCase());
    })
    .filter((r) => sourceFilter === "all" || recordHasVisibleEvents(r))
    .sort((a, b) => recordLatestEventMs(b) - recordLatestEventMs(a));

  const recordsByTicker = useMemo(() => groupRecordsByTicker(scoped), [scoped]);

  const unifiedRows = useMemo(() => {
    const lang = it ? "it" : "en";
    const tickers = tickerFilter.trim()
      ? [...recordsByTicker.keys()].filter((t) =>
          t.includes(tickerFilter.trim().toUpperCase()),
        )
      : [...recordsByTicker.keys()];
    const rows: UnifiedTimelineRow[] = [];
    for (const tk of tickers.sort()) {
      rows.push(
        ...buildCompanyUnifiedTimeline(recordsByTicker.get(tk) ?? [], tk, lang),
      );
    }
    return rows;
  }, [recordsByTicker, tickerFilter, it]);

  const inFlight = loading || status?.running;
  const withEvents = scoped.filter((r) => trustedRecordEvents(r).length > 0).length;
  const providerLabel = (aiProvider?.label ?? "Intelligence").replace(
    /\bCopilot\b/gi,
    "Intelligence",
  );
  const aiUnavailable = aiProvider?.available === false;

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="shrink-0 px-4 py-2 text-[11px] feed-panel-header flex gap-2 items-start">
        <span>🧬</span>
        <span>
          {it
            ? "Feed 6 mesi pre-CD: timeline unificata (🧬 clinico · 📰 press · ◆ 8-K · 📅 CD/CT.gov) oppure vista per studio."
            : "6-month pre-CD feed: unified timeline (🧬 clinical · 📰 press · ◆ 8-K · 📅 CD/CT.gov) or per-study view."}
          {" "}
          {aiProvider?.last_success ? `${providerLabel} attivo.` : `${providerLabel} — .env`}
        </span>
      </div>

      <div className="shrink-0 px-4 py-2 border-b border-[rgb(var(--border))]/30 feed-panel-toolbar space-y-2">
        <AiProviderSwitch
          info={aiProvider}
          onUpdated={(info: AiProviderInfo) => onProviderUpdate?.(info)}
          onNeedKey={setApiKeysHint}
        />
        <AiApiKeysPanel
          onProviderUpdate={(info: AiProviderInfo) => onProviderUpdate?.(info)}
          openProviderHint={apiKeysHint}
          onClearProviderHint={() => setApiKeysHint(null)}
        />
      </div>

      {aiUnavailable && (
        <div className="shrink-0 px-4 py-2.5 text-[11px] feed-panel-warn flex gap-2 items-start">
          <span className="shrink-0">⚠️</span>
          <span>
            {it
              ? "Intelligence non configurata: apri «Chiavi API (Claude…)» sopra e incolla la ANTHROPIC_API_KEY dopo aver ricaricato i crediti, oppure usa Copilot (GITHUB_TOKEN). Senza AI restano solo dati CT.gov. Poi «Arricchisci portfolio»."
              : "Intelligence not configured: open «API keys (Claude…)» above and paste your ANTHROPIC_API_KEY after adding credits, or use Copilot (GITHUB_TOKEN). Without AI you only get CT.gov data. Then «Enrich portfolio»."}
            {it && aiProvider?.hint_it
              ? ` ${aiProvider.hint_it}`
              : !it && aiProvider?.hint_en
                ? ` ${aiProvider.hint_en}`
                : ""}
          </span>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-2 px-4 py-2 flex-wrap feed-panel-toolbar">
        <PortfolioScopeToggle
          mode={listMode}
          onModeChange={setListMode}
          counts={counts}
          it={it}
        />
        <div className="inline-flex items-center gap-1">
          <div className="relative">
            <input
              className={`feed-panel-input rounded-lg py-1.5 text-[12px] max-w-[7rem] ${
                tickerFilter.trim() ? "pl-3 pr-7 w-[7.5rem]" : "px-3 w-[7rem]"
              }`}
              placeholder="Ticker…"
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value)}
            />
            {tickerFilter.trim() ? (
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded text-[14px] leading-none feed-panel-muted hover:feed-panel-text hover:bg-[rgb(var(--panel-mint-bg-soft))]"
                title={
                  it
                    ? "Cancella filtro — mostra tutte le società del tab Portfolio/To Watch"
                    : "Clear filter — show all companies in current tab"
                }
                aria-label={it ? "Cancella filtro ticker" : "Clear ticker filter"}
                onClick={() => setTickerFilter("")}
              >
                ×
              </button>
            ) : null}
          </div>
          {tickerFilter.trim() ? (
            <span className="text-[10px] font-semibold feed-panel-link whitespace-nowrap">
              {it
                ? `Solo ${tickerFilter.trim().toUpperCase()}`
                : `Only ${tickerFilter.trim().toUpperCase()}`}
            </span>
          ) : null}
        </div>
        <span className="text-[11px] feed-panel-muted">
          {filtered.length} / {scoped.length}
          {listMode !== "all" ? ` · ${records.length} ${it ? "totali" : "total"}` : ""}
          {" · "}
          {withEvents} {it ? "con tabella" : "with table"}
          {snapshotUpdatedAt ? (
            <>
              {" · "}
              <span
                title={
                  it
                    ? "Snapshot su disco (data/clinical_pre_cd_enrichment_snapshot.json) + cache locale — i dati restano tra tab e riavvii"
                    : "On-disk snapshot + local cache — data persists across tabs and restarts"
                }
              >
                {it ? "salvato" : "saved"}{" "}
                {new Date(snapshotUpdatedAt).toLocaleString(lang === "it" ? "it-IT" : "en-US", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </>
          ) : null}
        </span>
        <label className="flex items-center gap-1.5 text-[12px] feed-panel-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="rounded accent-[rgb(var(--panel-feed-accent-strong))]"
          />
          {it ? "Solo ref. verificate" : "Verified refs only"}
        </label>
        <div className="flex gap-0.5 p-0.5 rounded-md feed-panel-seg">
          {(
            [
              ["unified", it ? "Timeline" : "Timeline"],
              ["studies", it ? "Per studio" : "By study"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={viewMode === id ? "seg-btn-active" : "seg-btn"}
              onClick={() => setViewMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-md feed-panel-seg">
          {(
            [
              ["all", it ? "Tutti" : "All"],
              ["clinical", it ? "Clinico" : "Clinical"],
              ["press", "Press"],
              ["k8", "8-K"],
              ["cd", "CD"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={sourceFilter === id ? "seg-btn-active" : "seg-btn"}
              onClick={() => setSourceFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCopilotOpen((v) => !v)}
            className={
              copilotOpen
                ? "seg-btn-active"
                : "feed-panel-intel-btn px-3 py-1.5 rounded-lg text-[12px] font-semibold transition"
            }
            title={it ? "Apri Intelligence sul feed" : "Open Intelligence on feed data"}
          >
            🧠 Intelligence
          </button>
          {status?.running && (
            <span className="text-[11px] feed-panel-link max-w-[320px] truncate" title={status.message}>
              {status.message}
            </span>
          )}
          <button
            type="button"
            disabled={inFlight}
            onClick={() => void loadSnapshot()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold feed-panel-input hover:bg-[rgb(var(--panel-mint-bg-soft))] disabled:opacity-50 transition"
            title={
              it
                ? "Ricarica solo lo snapshot JSON (veloce, senza AI)"
                : "Reload JSON snapshot only (fast, no AI)"
            }
          >
            {it ? "↻ Snapshot" : "↻ Snapshot"}
          </button>
          <button
            type="button"
            disabled={inFlight}
            onClick={() => void handleRefresh({ deep: true, force: true })}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[rgb(var(--panel-feed-border))] feed-panel-intel-btn disabled:opacity-50 transition"
            title={
              it
                ? "Passaggio Copilot profondo (Sonnet/gpt-4o) — ignora cache 30g"
                : "Deep Copilot pass (Sonnet/gpt-4o) — bypass 30-day cache"
            }
          >
            {it ? "🔬 Deep" : "🔬 Deep"}
          </button>
          <button
            type="button"
            disabled={inFlight}
            onClick={() => void handleRefresh()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white feed-panel-btn-primary disabled:opacity-50 transition"
            title={
              enrichPortfolioOnly
                ? it
                  ? "Arricchimento AI solo ticker in Portfolio (capitale > 0); deep auto ogni 7g"
                  : "AI enrich for Portfolio tickers (deep auto every 7d)"
                : it
                  ? "Arricchimento AI su tutti gli studi SEC 8-K"
                  : "AI enrich for all SEC 8-K studies"
            }
          >
            {inFlight
              ? it
                ? "In corso…"
                : "Running…"
              : enrichPortfolioOnly
                ? it
                  ? "✦ Arricchisci portfolio"
                  : "✦ Enrich portfolio"
                : it
                  ? "✦ Arricchisci tutti"
                  : "✦ Enrich all"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="shrink-0 px-4 py-2 text-[11px] text-red-700 border-b border-red-200 bg-red-50">
          {loadError}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {viewMode === "unified" && unifiedRows.length > 0 && (
          <UnifiedCompanyTimeline
            rows={unifiedRows}
            recordsByTicker={recordsByTicker}
            it={it}
            verifiedOnly={verifiedOnly}
            sourceFilter={sourceFilter}
            isPortfolioTicker={isPortfolioTicker}
            onDeepenStudy={handleDeepenStudy}
            onTickerSummary={runTickerSummary}
          />
        )}
        {viewMode === "unified" && unifiedRows.length === 0 && !inFlight && (
          <p className="text-center text-[12px] feed-panel-muted py-12 italic">
            {it
              ? "Timeline vuota — arricchisci il feed o allarga il filtro ticker."
              : "Empty timeline — enrich feed or widen ticker filter."}
          </p>
        )}
        {viewMode === "studies" && filtered.length === 0 && (
          <p className="text-center text-[12px] feed-panel-muted py-12 italic">
            {sourceFilter === "clinical"
              ? (it
                ? "Nessuna società con eventi clinici nel filtro corrente."
                : "No companies with clinical events under current filters.")
              : sourceFilter === "k8"
                ? (it
                  ? "Nessuna società con 8-K SEC nel filtro corrente."
                  : "No companies with SEC 8-K under current filters.")
                : listMode === "portfolio"
              ? (it
                ? "Nessun feed AI per ticker in Portfolio — verifica capitale investito in Simulation."
                : "No AI feed for Portfolio tickers — check invested capital in Simulation.")
              : listMode === "watch"
                ? (it
                  ? "Nessun feed per ticker To Watch."
                  : "No feed for To Watch tickers.")
                : (it ? "Nessun record — clicca «Arricchisci»." : "No records — click «Enrich».")}
          </p>
        )}
        {viewMode === "studies" &&
          filtered.map((rec) => {
          const inPortfolio = isPortfolioTicker(rec.ticker ?? "");
          return (
            <div
              key={`${rec.ticker}-${rec.nct_id}`}
              className="feed-panel-card rounded-xl shadow-sm overflow-hidden"
              style={inPortfolio ? { borderLeft: "3px solid rgb(var(--signal-up))" } : undefined}
            >
              <ClinicalEventsTable
                rec={rec}
                it={it}
                verifiedOnly={verifiedOnly}
                sourceFilter={sourceFilter}
                inPortfolio={inPortfolio}
                onDeepenStudy={handleDeepenStudy}
              />
            </div>
          );
        })}
      </div>
      </div>

      <CatalystCopilotChat
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        records={scoped}
        tickerHint={tickerFilter}
        studyFocus={studyFocus}
        onStudyFocusConsumed={() => setStudyFocus(null)}
        aiProvider={aiProvider}
        it={it}
      />
    </div>
  );
}
