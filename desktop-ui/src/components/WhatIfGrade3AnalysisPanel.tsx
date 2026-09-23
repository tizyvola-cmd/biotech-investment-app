import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SheetTable } from "../types";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  backfillWhatIfCrownReadouts,
  downloadWhatIfCrownHitExport,
  evaluateWhatIfGrade3Gate,
  listAllWhatIfCrownHits,
  loadWhatIfCrownHitStore,
  type WhatIfCrownHitEvent,
  type WhatIfCrownSessionSummary,
} from "../sheet/whatIfCrownHitStore";
import {
  fmtReadoutCell,
  summarizeWhatIfGrade3Analysis,
  type WhatIfCrownReadoutContext,
} from "../sheet/whatIfCrownReadout";
import {
  fetchNonCrownControlExport,
  importNonCrownControlFromJson,
  loadNonCrownControlFromLocalStorage,
  mergeGrade3AnalysisRows,
  populationLabel,
  rowSurfaceClass,
  type Grade3AnalysisRow,
  type Grade3RowKind,
  type NonCrownControlEvent,
} from "../sheet/whatIfNonCrownControlStore";
import { downloadWhatIfGrade3Excel } from "../sheet/whatIfGrade3Export";
import { AppModal, AppModalCloseButton } from "./AppModal";

type RowFilter = "all" | "crown" | "noncrown";

function rowsToEvents(rows: Grade3AnalysisRow[]): WhatIfCrownHitEvent[] {
  return rows.map((r) => ({
    sessionDate: r.sessionDate,
    ticker: r.ticker,
    simKey: r.simKey,
    endPnl: r.endPnl,
    pathMax: r.pathMax,
    pathMin: r.pathMin,
    oscillating: r.oscillating,
    capturedAt: "",
    updatedAt: "",
    readout: r.readout,
  }));
}

function MedianGrid({
  title,
  tone,
  analysis,
  it,
}: {
  title: string;
  tone: "amber" | "sky";
  analysis: ReturnType<typeof summarizeWhatIfGrade3Analysis>;
  it: boolean;
}) {
  const border =
    tone === "amber" ? "border-amber-300/50 bg-amber-50/60" : "border-sky-300/50 bg-sky-50/60";
  const cardBorder =
    tone === "amber" ? "border-amber-300/40" : "border-sky-300/40";
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${border}`}>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1">{title}</p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-[10px] tabular-nums">
        {(
          [
            ["SDS", analysis.medians.sds],
            ["EIS", analysis.medians.eis],
            ["P(plan)", analysis.medians.pPlan],
            ["P(cont)", analysis.medians.pCont],
            [it ? "P&L fine" : "End P&L", analysis.medians.endPnl, "$"],
            [it ? "Picco path" : "Path max", analysis.medians.pathMax, "$"],
          ] as const
        ).map(([label, val, sfx]) => (
          <div key={label} className={`rounded border ${cardBorder} bg-white/80 dark:bg-black/20 px-1 py-0.5`}>
            <p className="text-[7px] uppercase tracking-wide text-ink-muted">{label}</p>
            <p className="font-bold text-ink">
              {sfx === "$" && val != null
                ? `${val >= 0 ? "+" : "−"}$${Math.abs(Math.round(val)).toLocaleString("en-US")}`
                : fmtReadoutCell(val, sfx === "$" ? "" : "")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhatIfGrade3AnalysisPanel({
  summary,
  simTable,
  readoutCtx,
  liveNonCrownEvents,
  it,
  open,
  onClose,
  onStoreChange,
  storeTick,
  variant = "modal",
  panelRef,
}: {
  summary: WhatIfCrownSessionSummary;
  simTable: SheetTable | null;
  readoutCtx: WhatIfCrownReadoutContext;
  /** Current session strong_offbook + pf_nonstrong (live). */
  liveNonCrownEvents: NonCrownControlEvent[];
  it: boolean;
  open: boolean;
  onClose: () => void;
  onStoreChange: () => void;
  storeTick: number;
  variant?: "inline" | "modal";
  panelRef?: RefObject<HTMLDivElement>;
}) {
  const gate = useMemo(() => evaluateWhatIfGrade3Gate(summary), [summary]);
  const crownEvents = useMemo(() => {
    if (!open) return [];
    return listAllWhatIfCrownHits();
  }, [open, storeTick]);
  const [exportedNonCrown, setExportedNonCrown] = useState<NonCrownControlEvent[]>([]);
  const [importedNonCrown, setImportedNonCrown] = useState<NonCrownControlEvent[]>(() =>
    loadNonCrownControlFromLocalStorage(),
  );
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [contentReady, setContentReady] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Paint modal shell first; build table + medians on next frame (avoids multi-second block).
  useEffect(() => {
    if (!open) {
      setContentReady(false);
      return;
    }
    let cancelled = false;
    const t = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!cancelled) setContentReady(true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !contentReady) return;
    let cancelled = false;
    const defer =
      typeof requestIdleCallback !== "undefined"
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 800 })
        : (cb: () => void) => window.setTimeout(cb, 120);
    const idleId = defer(() => {
      void fetchNonCrownControlExport().then((events) => {
        if (!cancelled) setExportedNonCrown(events);
      });
    });
    setImportedNonCrown(loadNonCrownControlFromLocalStorage());
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback !== "undefined" && typeof idleId === "number") {
        cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId as number);
      }
    };
  }, [open, contentReady, storeTick]);

  const allRows = useMemo(() => {
    if (!open || !contentReady) return [];
    return mergeGrade3AnalysisRows({
      crownEvents,
      importedNonCrown,
      exportedNonCrown,
      liveNonCrown: liveNonCrownEvents,
    });
  }, [open, contentReady, crownEvents, importedNonCrown, exportedNonCrown, liveNonCrownEvents]);

  const visibleRows = useMemo(() => {
    if (rowFilter === "crown") return allRows.filter((r) => r.kind === "crown");
    if (rowFilter === "noncrown") return allRows.filter((r) => r.kind !== "crown");
    return allRows;
  }, [allRows, rowFilter]);

  const crownRows = useMemo(() => allRows.filter((r) => r.kind === "crown"), [allRows]);
  const nonCrownRows = useMemo(() => allRows.filter((r) => r.kind !== "crown"), [allRows]);
  const crownAnalysis = useMemo(
    () => summarizeWhatIfGrade3Analysis(rowsToEvents(crownRows)),
    [crownRows],
  );
  const nonCrownAnalysis = useMemo(
    () => summarizeWhatIfGrade3Analysis(rowsToEvents(nonCrownRows)),
    [nonCrownRows],
  );

  const rowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable],
  );

  const resolveRow = useCallback(
    (ev: WhatIfCrownHitEvent): Record<string, unknown> | null => {
      if (ev.simKey && rowByKey.has(ev.simKey)) {
        return rowByKey.get(ev.simKey)!;
      }
      const tk = ev.ticker.trim().toUpperCase();
      for (const row of simTable?.rows ?? []) {
        if (String(row.Ticker ?? "").trim().toUpperCase() === tk) return row;
      }
      return null;
    },
    [rowByKey, simTable],
  );

  const handleBackfill = useCallback(() => {
    backfillWhatIfCrownReadouts(resolveRow, loadWhatIfCrownHitStore(), undefined, readoutCtx);
    onStoreChange();
  }, [resolveRow, readoutCtx, onStoreChange]);

  const needsEnrichment =
    crownAnalysis.totalHits - crownAnalysis.withReadout + crownAnalysis.partialReadout;

  const handleImportNonCrown = useCallback(async (file: File) => {
    const text = await file.text();
    const events = importNonCrownControlFromJson(text);
    setImportedNonCrown(events);
  }, []);

  useEffect(() => {
    if (!open || variant !== "inline" || !contentReady) return;
    const el = panelRef?.current;
    if (!el) return;
    const t = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(t);
  }, [open, variant, panelRef, contentReady]);

  if (!open) return null;

  const loadingNote = it ? "Caricamento tabella…" : "Loading table…";

  const filterBtn = (id: RowFilter, label: string) => (
    <button
      key={id}
      type="button"
      className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition ${
        rowFilter === id
          ? id === "crown"
            ? "bg-amber-100 border-amber-400 text-amber-950"
            : id === "noncrown"
              ? "bg-sky-100 border-sky-400 text-sky-950"
              : "bg-[rgb(var(--surface-3))] border-[rgb(var(--border))] text-ink"
          : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
      }`}
      onClick={() => setRowFilter(id)}
    >
      {label}
    </button>
  );

  const body = (
    <div className="rounded-xl bg-[rgb(var(--surface-elevated))]/95 px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {it ? "Grado 3 · corona + controllo" : "Grade 3 · crown + control"}
          </p>
          <p className="text-[11px] text-ink-muted leading-snug mt-0.5">
            {contentReady
              ? it
                ? `${crownRows.length} corona · ${nonCrownRows.length} controllo · ${visibleRows.length} righe visibili`
                : `${crownRows.length} crown · ${nonCrownRows.length} control · ${visibleRows.length} rows visible`
              : it
                ? `${crownEvents.length} corona in log · caricamento controllo…`
                : `${crownEvents.length} crown in log · loading control…`}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-900 dark:text-amber-100">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-300 border border-amber-500/60" />
              {it ? "Giallo = corona (Strong∩PF)" : "Yellow = crown (Strong∩PF)"}
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] font-medium text-sky-900 dark:text-sky-100">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-200 border border-sky-400/70" />
              {it ? "Azzurrino = controllo non-corona" : "Light blue = non-crown control"}
            </span>
          </div>
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      {!contentReady ? (
        <p className="text-[11px] text-ink-muted py-6 text-center animate-pulse">{loadingNote}</p>
      ) : (
        <>
      <div className="flex flex-wrap gap-1.5">
        {filterBtn("all", it ? "Tutti" : "All")}
        {filterBtn("crown", it ? `Corona (${crownRows.length})` : `Crown (${crownRows.length})`)}
        {filterBtn(
          "noncrown",
          it ? `Controllo (${nonCrownRows.length})` : `Control (${nonCrownRows.length})`,
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-600/40 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-950"
          onClick={() => {
            void downloadWhatIfGrade3Excel({
              lang: it ? "it" : "en",
              liveNonCrown: liveNonCrownEvents,
            });
          }}
        >
          {it ? "Scarica Excel" : "Download Excel"}
        </button>
        <button
          type="button"
          className="text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-600/40 bg-amber-50/80 hover:bg-amber-100 text-amber-950"
          onClick={() => downloadWhatIfCrownHitExport()}
        >
          {it ? "Esporta corona (JSON)" : "Export crown (JSON)"}
        </button>
        <button
          type="button"
          className="text-[10px] font-semibold px-2 py-0.5 rounded border border-sky-500/40 bg-sky-50/80 hover:bg-sky-100 text-sky-950"
          onClick={() => importRef.current?.click()}
        >
          {it ? "Importa controllo (JSON)" : "Import control (JSON)"}
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportNonCrown(f);
            e.target.value = "";
          }}
        />
        <span className="text-[9px] text-ink-muted self-center">
          {exportedNonCrown.length > 0
            ? it
              ? `+ ${exportedNonCrown.length} da data/whatif_noncrown_export.json`
              : `+ ${exportedNonCrown.length} from data/whatif_noncrown_export.json`
            : it
              ? "Controllo offline: npx tsx scripts/export-noncrown-control.ts"
              : "Offline control: npx tsx scripts/export-noncrown-control.ts"}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {crownRows.length > 0 ? (
          <MedianGrid
            title={it ? "Mediane · corona" : "Medians · crown"}
            tone="amber"
            analysis={crownAnalysis}
            it={it}
          />
        ) : null}
        {nonCrownRows.length > 0 ? (
          <MedianGrid
            title={it ? "Mediane · controllo" : "Medians · control"}
            tone="sky"
            analysis={nonCrownAnalysis}
            it={it}
          />
        ) : null}
      </div>

      {gate.ready && needsEnrichment > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300/40 bg-amber-50/50 px-2 py-1">
          <p className="text-[10px] text-amber-900/90">
            {it
              ? `${needsEnrichment} hit corona con campi mancanti. Arricchimento manuale da book attuale — non sovrascrive capture (●).`
              : `${needsEnrichment} crown hits missing SDS/EIS/P(plan). Manual enrichment from today's book — never overwrites live capture (●).`}
          </p>
          <button
            type="button"
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-500/50 bg-white/90 hover:bg-white"
            onClick={handleBackfill}
          >
            {it ? "Riempi campi nulli" : "Fill null fields"}
          </button>
        </div>
      ) : null}

      <div className="max-h-[min(52vh,420px)] overflow-auto rounded border border-[rgb(var(--border))]/40">
        <table className="w-full text-[10px] tabular-nums">
          <thead className="sticky top-0 bg-[rgb(var(--surface-elevated))] text-ink-muted z-[1]">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">{it ? "Gruppo" : "Group"}</th>
              <th className="px-2 py-1.5 text-left font-semibold">{it ? "Data" : "Date"}</th>
              <th className="px-2 py-1.5 text-left font-semibold">Ticker</th>
              <th className="px-2 py-1.5 text-right font-semibold">SDS</th>
              <th className="px-2 py-1.5 text-right font-semibold">EIS</th>
              <th className="px-2 py-1.5 text-right font-semibold">P(plan)</th>
              <th className="px-2 py-1.5 text-right font-semibold">P(cont)</th>
              <th className="px-2 py-1.5 text-left font-semibold">Precat</th>
              <th className="px-2 py-1.5 text-right font-semibold">Δ24h</th>
              <th className="px-2 py-1.5 text-right font-semibold">P&L</th>
              <th className="px-2 py-1.5 text-center font-semibold">Src</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-2 py-4 text-center text-ink-muted">
                  {it ? "Nessuna riga per il filtro selezionato." : "No rows for selected filter."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const r = row.readout;
                const kind = row.kind as Grade3RowKind;
                return (
                  <tr
                    key={`${row.kind}|${row.sessionDate}|${row.ticker}`}
                    className={`border-t border-[rgb(var(--border))]/30 ${rowSurfaceClass(kind)}`}
                  >
                    <td className="px-2 py-1 whitespace-nowrap">
                      <span
                        className={`inline-block rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                          kind === "crown"
                            ? "bg-amber-200/80 text-amber-950"
                            : "bg-sky-200/80 text-sky-950"
                        }`}
                      >
                        {populationLabel(kind, it)}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-ink-muted whitespace-nowrap">{row.sessionDate}</td>
                    <td className="px-2 py-1 font-semibold text-ink">{row.ticker}</td>
                    <td className="px-2 py-1 text-right">{fmtReadoutCell(r?.sds)}</td>
                    <td className="px-2 py-1 text-right">{fmtReadoutCell(r?.eis)}</td>
                    <td className="px-2 py-1 text-right">{fmtReadoutCell(r?.pPlan)}</td>
                    <td className="px-2 py-1 text-right">{fmtReadoutCell(r?.pCont)}</td>
                    <td className="px-2 py-1 text-left text-ink-muted">{r?.precatKind ?? "—"}</td>
                    <td className="px-2 py-1 text-right">
                      {r?.dailyPct24h != null ? `${r.dailyPct24h >= 0 ? "+" : ""}${r.dailyPct24h}%` : "—"}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-medium ${
                        row.endPnl >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {row.endPnl >= 0 ? "+" : "−"}$
                      {Math.abs(Math.round(row.endPnl)).toLocaleString("en-US")}
                    </td>
                    <td className="px-2 py-1 text-center text-[9px] text-ink-muted">
                      {r?.source === "backfill"
                        ? "↻"
                        : r?.source === "snapshot"
                          ? "◆"
                          : r?.source === "capture"
                            ? "●"
                            : r
                              ? "?"
                              : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );

  if (variant === "modal") {
    return (
      <AppModal
        open={open}
        onClose={onClose}
        aria-label={it ? "Grado 3 · corona + controllo" : "Grade 3 · crown + control"}
        zIndexClass="z-[500]"
        panelClassName="w-full max-w-5xl overflow-y-auto rounded-xl border border-amber-400/50 bg-[rgb(var(--surface-elevated))] shadow-2xl"
      >
        {body}
      </AppModal>
    );
  }

  return (
    <div
      ref={panelRef}
      className="relative z-20 mt-2 rounded-xl border-2 border-amber-400/70 bg-[rgb(var(--surface-elevated))] shadow-lg [content-visibility:visible]"
      role="region"
      aria-label={it ? "Grado 3 · corona + controllo" : "Grade 3 · crown + control"}
    >
      {body}
    </div>
  );
}
