import { useMemo } from "react";
import type { ClinicalPreCdRecord, GuidanceCalendarEvent } from "../api/supernova";
import { buildTickerEisDetail } from "../sheet/tickerEisSummary";
import { hydrateClinicalPreCdRecords } from "../sheet/clinicalPreCdSnapshotCache";
import {
  daysUntilIso,
  eisEventsNearCatalystDate,
  resolveRegulatoryCatalystOutcome,
} from "../sheet/regulatoryCatalystOutcome";
import { CATALYST_TYPE_LABELS } from "../sheet/catalystChartLanes";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { EisEventCard } from "./EisDetailPanel";

function fmtDate(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function referenceLinkLabel(href: string, it: boolean): string {
  const u = href.trim();
  if (!u) return it ? "Apri fonte" : "Open source";
  if (/clinicaltrials\.gov/i.test(u)) return "ClinicalTrials.gov";
  if (/fda\.gov/i.test(u)) return "FDA.gov";
  if (/sec\.gov|edgar/i.test(u)) return "SEC EDGAR";
  if (/businesswire|prnewswire|globenewswire|newsfilecorp|accesswire/i.test(u)) {
    return it ? "Press release" : "Press release";
  }
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return it ? "Apri fonte" : "Open source";
  }
}

function outcomeTone(kind: string): { bg: string; text: string; border: string } {
  if (kind === "approved") return { bg: "#dcfce7", text: "#166534", border: "#22c55e" };
  if (kind === "tentative_approval") return { bg: "#fef9c3", text: "#854d0e", border: "#eab308" };
  if (kind === "crl") return { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" };
  if (kind === "pending") return { bg: "#e0f2fe", text: "#075985", border: "#38bdf8" };
  return { bg: "#f1f5f9", text: "#334155", border: "#94a3b8" };
}

export function RegulatoryCatalystDetailModal({
  event: ev,
  ticker,
  clinicalRecords,
  it,
  onClose,
}: {
  event: GuidanceCalendarEvent;
  ticker: string;
  clinicalRecords?: ClinicalPreCdRecord[];
  it: boolean;
  onClose: () => void;
}) {
  const key = ev.event_type || "other";
  const typeLabel = CATALYST_TYPE_LABELS[key] || key.toUpperCase();
  const windowIso = ev.window_start || ev.window_end || null;
  const days = daysUntilIso(windowIso);
  const outcome = resolveRegulatoryCatalystOutcome(ev);
  const tone = outcomeTone(outcome.kind);
  const records = clinicalRecords?.length ? clinicalRecords : hydrateClinicalPreCdRecords();
  const eisNear = useMemo(() => {
    const detail = buildTickerEisDetail(ticker, it ? "it" : "en", null, records);
    return eisEventsNearCatalystDate(detail.events, windowIso, [
      ev.asset_name ?? "",
      ev.company ?? "",
      ticker,
    ]);
  }, [ticker, records, windowIso, ev.asset_name, ev.company, it]);

  const windowStr =
    ev.window_start && ev.window_end && ev.window_start !== ev.window_end
      ? `${fmtDate(ev.window_start, it)} → ${fmtDate(ev.window_end, it)}`
      : fmtDate(windowIso, it);

  const whenLabel =
    days == null
      ? null
      : days > 1
        ? it
          ? `Tra ${days} giorni`
          : `In ${days} days`
        : days === 1
          ? it
            ? "Domani"
            : "Tomorrow"
          : days === 0
            ? it
              ? "Oggi"
              : "Today"
            : days === -1
              ? it
                ? "Ieri"
                : "Yesterday"
              : it
                ? `${Math.abs(days)} giorni fa`
                : `${Math.abs(days)} days ago`;

  const priceBits = eisNear
    .map((e) => e.breakdown)
    .filter((b) => b.delta_p_1d != null || b.delta_p_3d != null);
  const d1 = priceBits.find((b) => b.delta_p_1d != null)?.delta_p_1d ?? null;
  const d3 = priceBits.find((b) => b.delta_p_3d != null)?.delta_p_3d ?? null;

  return (
    <AppModal
      open
      onClose={onClose}
      aria-label={`${typeLabel} · ${ticker}`}
      panelClassName="w-full max-w-xl overflow-hidden rounded-2xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] shadow-2xl flex flex-col"
    >
      <div
        className="flex shrink-0 items-start gap-2 px-4 py-2.5"
        style={{ backgroundColor: tone.bg, borderBottom: `2px solid ${tone.border}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: tone.text }}>
              {typeLabel}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ color: tone.text, border: `1px solid ${tone.border}` }}
            >
              {it ? outcome.labelIt : outcome.labelEn}
            </span>
            {whenLabel ? (
              <span className="text-[10px] font-bold tabular-nums" style={{ color: tone.text }}>
                {whenLabel}
              </span>
            ) : null}
          </div>
          {ev.asset_name ? (
            <p className="mt-1 text-[13px] font-semibold text-ink">{ev.asset_name}</p>
          ) : null}
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted font-medium shrink-0 w-20">{it ? "Finestra" : "Window"}</span>
          <span className="font-semibold tabular-nums">{windowStr}</span>
        </div>
        {ev.company ? (
          <div className="flex items-center gap-2">
            <span className="text-muted font-medium shrink-0 w-20">{it ? "Società" : "Company"}</span>
            <span className="font-semibold">{ev.company}</span>
          </div>
        ) : null}
        {ev.indication ? (
          <div className="flex items-center gap-2">
            <span className="text-muted font-medium shrink-0 w-20">
              {it ? "Indicazione" : "Indication"}
            </span>
            <span className="font-semibold">{ev.indication}</span>
          </div>
        ) : null}
        {ev.trial_phase ? (
          <div className="flex items-center gap-2">
            <span className="text-muted font-medium shrink-0 w-20">
              {it ? "Fase" : "Phase"}
            </span>
            <span className="font-semibold">{ev.trial_phase}</span>
          </div>
        ) : null}

        {d1 != null || d3 != null ? (
          <div className="rounded-lg border border-[rgb(var(--border))]/35 bg-surface/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              {it ? "Reazione di prezzo (EIS)" : "Price reaction (EIS)"}
            </p>
            <p className="text-[12px] font-semibold tabular-nums text-ink">
              {d1 != null ? `Δ1g ${d1 >= 0 ? "+" : ""}${d1.toFixed(1)}%` : null}
              {d1 != null && d3 != null ? " · " : null}
              {d3 != null ? `Δ3g ${d3 >= 0 ? "+" : ""}${d3.toFixed(1)}%` : null}
            </p>
          </div>
        ) : days != null && days < 0 && outcome.kind === "unknown" ? (
          <p className="text-[11px] text-ink-muted leading-snug">
            {it
              ? "La data è passata ma il calendario non ha ancora l'esito FDA. Sotto le EIS del ticker vicine a questa finestra."
              : "The date has passed but the calendar has no FDA outcome yet. EIS events near this window are below."}
          </p>
        ) : null}

        {ev.timing_quote ? (
          <div className="pt-1 border-t border-[rgb(var(--border))]/20">
            <span className="text-muted font-medium text-[10px] uppercase tracking-wider block mb-1">
              {it ? "Fonte (citazione)" : "Source quote"}
            </span>
            <p className="text-foreground/85 leading-relaxed italic text-[11px]">
              "{ev.timing_quote}"
            </p>
          </div>
        ) : null}

        <div className="rounded-lg border border-[rgb(var(--border))]/35 bg-surface/50 px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {it ? "Referenza" : "Reference"}
          </p>
          {ev.link && /^https?:\/\//i.test(ev.link.trim()) ? (
            <a
              href={ev.link.trim()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--accent))] hover:underline break-all"
            >
              <span aria-hidden>↗</span>
              {referenceLinkLabel(ev.link, it)}
            </a>
          ) : (
            <p className="text-[11px] text-ink-muted">
              {it
                ? "Nessun link alla fonte (studio / FDA / press / EDGAR)."
                : "No source link (study / FDA / press / EDGAR)."}
            </p>
          )}
          {ev.source_date ? (
            <p className="text-[10px] text-ink-muted tabular-nums">
              {it ? "Data fonte:" : "Source date:"} {fmtDate(ev.source_date, it)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3 pt-1 text-[10px] text-muted">
          {ev.source_type ? <span className="capitalize">{ev.source_type.replace(/_/g, " ")}</span> : null}
          {ev.estimation_method ? (
            <span className="px-1 py-px rounded bg-[rgb(var(--border))]/15 text-[9px] font-medium">
              {ev.estimation_method.replace(/_/g, " ")}
            </span>
          ) : null}
          {ev.confidence != null ? (
            <span className="tabular-nums font-medium ml-auto">
              {it ? "Conf." : "Conf."} {Math.round(ev.confidence * 100)}%
            </span>
          ) : null}
        </div>

        <section className="space-y-2 border-t border-[rgb(var(--border))]/30 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {it ? "EIS associate" : "Associated EIS"}
            {eisNear.length ? ` · ${eisNear.length}` : ""}
          </p>
          {eisNear.length ? (
            eisNear.slice(0, 4).map((e, i) => (
              <EisEventCard
                key={`${e.eventDate}-${e.title}-${i}`}
                ev={e}
                it={it}
                ticker={ticker}
              />
            ))
          ) : (
            <p className="text-[11px] text-ink-muted">
              {it
                ? "Nessun evento EIS vicino a questa data nel feed clinico."
                : "No EIS events near this date in the clinical feed."}
            </p>
          )}
        </section>
      </div>
    </AppModal>
  );
}
