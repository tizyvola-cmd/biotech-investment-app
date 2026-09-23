import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { useLang, useT } from "../shared/i18n";
import { daysToCdFromSimRow, isRowInSdsCohortScope, SDS_COHORT_MAX_DAYS_TO_CD } from "../sheet/sdsCohortScope";
import { companyNameFromSimRow } from "../sheet/dashboardHeroEfficiency";
import {
  NEW_ENTRIES_LEDGER_CHANGED_EVENT,
  dismissNewEntriesPanel,
  isNewEntriesPanelDismissed,
  listWeeklyNewEntries,
  normalizeNewEntryTicker,
  recordCurrentTickers,
  type NewEntryLedgerRecord,
} from "../sheet/newEntriesLedger";
import { tradeableTickerFromRow } from "../sheet/simulationPosition";

interface Row {
  ticker: string;
  company: string;
  cdDisplay: string;
  /** Raw Completion Date for Evaluation Lab deep-link (may equal cdDisplay). */
  cdRaw: string;
  daysToCd: number | null;
  firstSeenIso: string;
}

function formatDaysToCd(days: number | null, lang: "it" | "en"): string {
  if (days == null) return "—";
  if (days < 0) return lang === "it" ? `${Math.abs(days)}g fa` : `${Math.abs(days)}d ago`;
  return lang === "it" ? `${days}g` : `${days}d`;
}

function formatFirstSeen(iso: string, lang: "it" | "en", nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const deltaMs = nowMs - ms;
  const days = Math.floor(deltaMs / 86_400_000);
  if (days <= 0) {
    const hours = Math.max(0, Math.floor(deltaMs / 3_600_000));
    if (hours === 0) return lang === "it" ? "adesso" : "just now";
    return lang === "it" ? `${hours}h fa` : `${hours}h ago`;
  }
  if (days === 1) return lang === "it" ? "ieri" : "yesterday";
  return lang === "it" ? `${days}g fa` : `${days}d ago`;
}

function daysToCdTone(days: number | null): string {
  if (days == null) return "text-ink-muted";
  if (days < 0) return "text-ink-muted";
  if (days <= 30) return "text-[rgb(var(--warn))] font-semibold";
  if (days <= 60) return "text-[rgb(var(--accent))]";
  return "text-ink";
}

export function NewEntriesThisWeekTable({
  simTable,
  onOpen24hAssessment,
}: {
  simTable: SheetTable | null;
  /** Open Evaluation Lab → Check 24h → Top KPI row for this ticker. */
  onOpen24hAssessment?: (focus: {
    ticker: string;
    cd?: string;
    rowKey?: string;
  }) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const l = lang === "it" ? "it" : "en";
  const [tick, setTick] = useState(0);

  // Snapshot the currently-in-scope tickers into the ledger on every mount /
  // sim-table change; also refresh on ledger change events (fires after each
  // localStorage write) so the table stays in sync across tabs.
  useEffect(() => {
    const rows = simTable?.rows ?? [];
    if (!rows.length) return;
    const inScope: string[] = [];
    for (const row of rows) {
      const sheetTk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (!sheetTk) continue;
      if (!isRowInSdsCohortScope(row, sheetTk)) continue;
      // Ledger key = tradeable common (JSPRW → JSPR) so warrant/common are one company.
      inScope.push(normalizeNewEntryTicker(tradeableTickerFromRow(row) || sheetTk));
    }
    recordCurrentTickers(inScope);
  }, [simTable]);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(NEW_ENTRIES_LEDGER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NEW_ENTRIES_LEDGER_CHANGED_EVENT, onChange);
  }, []);

  const rows: Row[] = useMemo(() => {
    // `tick` is intentionally in the deps to force a rebuild whenever the
    // ledger changes (e.g. after recordCurrentTickers writes a new stamp).
    void tick;
    const simRows = simTable?.rows ?? [];
    if (!simRows.length) return [];
    const inScopeMap = new Map<string, Record<string, unknown>>();
    for (const row of simRows) {
      const sheetTk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (!sheetTk) continue;
      if (!isRowInSdsCohortScope(row, sheetTk)) continue;
      const tk = normalizeNewEntryTicker(tradeableTickerFromRow(row) || sheetTk);
      // Prefer the row with the smallest days-to-CD (soonest catalyst) if
      // a ticker appears multiple times (incl. warrant + common).
      const existing = inScopeMap.get(tk);
      if (!existing) {
        inScopeMap.set(tk, row);
        continue;
      }
      const existingDays = daysToCdFromSimRow(existing);
      const newDays = daysToCdFromSimRow(row);
      if (newDays != null && (existingDays == null || newDays < existingDays)) {
        inScopeMap.set(tk, row);
      }
    }
    const ledger: NewEntryLedgerRecord[] = listWeeklyNewEntries(new Set(inScopeMap.keys()));
    return ledger
      .map((entry): Row | null => {
        const row = inScopeMap.get(entry.ticker);
        if (!row) return null;
        const daysToCd = daysToCdFromSimRow(row);
        const cdRaw = String(row["Completion Date"] ?? row.CD ?? "").trim();
        return {
          ticker: entry.ticker,
          company: companyNameFromSimRow(row) || entry.ticker,
          cdDisplay: cdRaw || "—",
          cdRaw,
          daysToCd,
          firstSeenIso: entry.firstSeenIso,
        };
      })
      .filter((r): r is Row => r != null)
      .sort((a, b) => {
        // Primary: soonest CD first (null last)
        const ad = a.daysToCd;
        const bd = b.daysToCd;
        if (ad == null && bd == null) return 0;
        if (ad == null) return 1;
        if (bd == null) return -1;
        return ad - bd;
      });
  }, [simTable, tick]);

  const nowMs = Date.now();
  const dismissTickers = useMemo(() => rows.map((r) => r.ticker), [rows]);
  const [dismissed, setDismissed] = useState(() =>
    isNewEntriesPanelDismissed(dismissTickers),
  );

  // Re-check when the weekly set changes (new company → show panel again).
  useEffect(() => {
    setDismissed(isNewEntriesPanelDismissed(dismissTickers));
  }, [dismissTickers]);

  if (!rows.length || dismissed) return null;

  return (
    <section
      className="card px-3 py-2.5 space-y-2 min-w-0"
      aria-label={t("dashboard.newEntries.title")}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-ink">
          {t("dashboard.newEntries.title")}
        </h2>
        <span className="text-[10px] text-ink-muted">
          {t("dashboard.newEntries.subtitle", { months: 4 })}
        </span>
        <span className="ml-auto text-[10px] text-ink-muted tabular-nums">
          {t("dashboard.newEntries.count", { n: rows.length })}
        </span>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-0.5 text-base leading-none text-ink-muted hover:bg-[rgb(var(--border))]/40 hover:text-ink"
          aria-label={t("dashboard.newEntries.dismiss")}
          title={t("dashboard.newEntries.dismissTip")}
          onClick={() => {
            dismissNewEntriesPanel(dismissTickers);
            setDismissed(true);
          }}
        >
          ×
        </button>
      </header>

      <div className="overflow-x-auto overflow-y-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
              <th className="py-1.5 px-2 font-medium">
                {t("dashboard.newEntries.col.ticker")}
              </th>
              <th className="py-1.5 px-2 font-medium">
                {t("dashboard.newEntries.col.company")}
              </th>
              <th className="py-1.5 px-2 font-medium">
                {t("dashboard.newEntries.col.cd")}
              </th>
              <th className="py-1.5 px-2 font-medium text-right">
                {t("dashboard.newEntries.col.daysToCd")}
              </th>
              <th className="py-1.5 px-2 font-medium text-right">
                {t("dashboard.newEntries.col.firstSeen")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.ticker}
                className={`border-b border-[rgb(var(--border))]/20 hover:bg-surface/40 ${
                  onOpen24hAssessment ? "cursor-pointer" : ""
                }`}
                onClick={
                  onOpen24hAssessment
                    ? () =>
                        onOpen24hAssessment({
                          ticker: r.ticker,
                          cd: r.cdRaw || undefined,
                        })
                    : undefined
                }
                role={onOpen24hAssessment ? "button" : undefined}
                tabIndex={onOpen24hAssessment ? 0 : undefined}
                onKeyDown={
                  onOpen24hAssessment
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpen24hAssessment({
                            ticker: r.ticker,
                            cd: r.cdRaw || undefined,
                          });
                        }
                      }
                    : undefined
                }
              >
                <td className="py-1 px-2 font-semibold tabular-nums text-[rgb(var(--accent))]">
                  {r.ticker}
                </td>
                <td className="py-1 px-2 text-ink truncate max-w-[220px]" title={r.company}>
                  {r.company}
                </td>
                <td className="py-1 px-2 text-ink-muted tabular-nums">{r.cdDisplay}</td>
                <td
                  className={`py-1 px-2 text-right tabular-nums ${daysToCdTone(r.daysToCd)}`}
                >
                  {formatDaysToCd(r.daysToCd, l)}
                </td>
                <td className="py-1 px-2 text-right text-ink-muted tabular-nums">
                  {formatFirstSeen(r.firstSeenIso, l, nowMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink-muted leading-snug">
        {t("dashboard.newEntries.footer", { maxDays: SDS_COHORT_MAX_DAYS_TO_CD })}
      </p>
    </section>
  );
}
