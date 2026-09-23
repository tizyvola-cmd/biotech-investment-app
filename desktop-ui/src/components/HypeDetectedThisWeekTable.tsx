import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { useLang, useT } from "../shared/i18n";
import { daysToCdFromSimRow } from "../sheet/sdsCohortScope";
import { companyNameFromSimRow } from "../sheet/dashboardHeroEfficiency";
import {
  HYPE_ENTRIES_LEDGER_CHANGED_EVENT,
  dismissHypeEntriesPanel,
  hypeFirstSeenIso,
  isHypeEntriesPanelDismissed,
  recordCurrentHypeTickers,
} from "../sheet/hypeEntriesLedger";
import { tradeableTickerFromRow } from "../sheet/simulationPosition";

interface Row {
  ticker: string;
  company: string;
  cdDisplay: string;
  cdRaw: string;
  daysToCd: number | null;
  window: string;
  bucket: "sim" | "off_book" | null;
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

function daysToCdTone(days: number | null, bucket: string | null): string {
  if (bucket === "off_book") return "text-ink-muted";
  if (days == null) return "text-ink-muted";
  if (days < 0) return "text-ink-muted";
  if (days <= 30) return "text-[rgb(var(--warn))] font-semibold";
  if (days <= 60) return "text-[rgb(var(--accent))]";
  return "text-ink";
}

function parseBucket(raw: unknown): "sim" | "off_book" | null {
  if (raw === "sim" || raw === "off_book") return raw;
  return null;
}

function parseWindow(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  return s;
}

/**
 * Home-dashboard companion to {@link ../components/NewEntriesThisWeekTable}.
 *
 * Lists every ticker currently flagged `hype_volume_funnel` (10-day hold,
 * price-up + 3-day grace, or portfolio) — not only names first seen this week.
 */
export function HypeDetectedThisWeekTable({
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

  // Snapshot currently-flagged hype tickers into the ledger on every mount /
  // sim-table change; refresh on ledger events for cross-tab sync.
  useEffect(() => {
    const rows = simTable?.rows ?? [];
    if (!rows.length) return;
    const flagged: string[] = [];
    for (const row of rows) {
      if (!row.hype_volume_funnel) continue;
      const sheetTk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (!sheetTk) continue;
      // Hype tickers are always tradeable common — no warrant fold needed.
      flagged.push((tradeableTickerFromRow(row) || sheetTk).toUpperCase());
    }
    recordCurrentHypeTickers(flagged);
  }, [simTable]);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(HYPE_ENTRIES_LEDGER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(HYPE_ENTRIES_LEDGER_CHANGED_EVENT, onChange);
  }, []);

  const rows: Row[] = useMemo(() => {
    // `tick` is intentionally in the deps to force a rebuild whenever the
    // ledger changes.
    void tick;
    const simRows = simTable?.rows ?? [];
    if (!simRows.length) return [];
    const flaggedMap = new Map<string, Record<string, unknown>>();
    for (const row of simRows) {
      if (!row.hype_volume_funnel) continue;
      const sheetTk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (!sheetTk) continue;
      const tk = (tradeableTickerFromRow(row) || sheetTk).toUpperCase();
      if (!flaggedMap.has(tk)) flaggedMap.set(tk, row);
    }
    return [...flaggedMap.entries()]
      .map(([ticker, row]): Row => {
        const daysToCd = daysToCdFromSimRow(row);
        const cdRaw = String(row["Completion Date"] ?? row.CD ?? "").trim();
        const rowIso = String(row.hype_first_seen ?? "").trim();
        return {
          ticker,
          company: companyNameFromSimRow(row) || ticker,
          cdDisplay: cdRaw || "—",
          cdRaw,
          daysToCd,
          window: parseWindow(row.hype_volume_window),
          bucket: parseBucket(row.hype_cd_bucket),
          firstSeenIso: rowIso || hypeFirstSeenIso(ticker),
        };
      })
      .sort((a, b) => {
        // Primary: bucket (sim first, off_book after)
        const ab = a.bucket === "sim" ? 0 : 1;
        const bb = b.bucket === "sim" ? 0 : 1;
        if (ab !== bb) return ab - bb;
        // Secondary: soonest CD first (null last)
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
    isHypeEntriesPanelDismissed(dismissTickers),
  );

  // Re-check when the pipeline set changes (new company → show panel again).
  useEffect(() => {
    setDismissed(isHypeEntriesPanelDismissed(dismissTickers));
  }, [dismissTickers]);

  if (!rows.length || dismissed) return null;

  const bucketLabel = (b: "sim" | "off_book" | null): string => {
    if (b === "sim") return t("dashboard.hypeDetected.bucket.sim");
    if (b === "off_book") return t("dashboard.hypeDetected.bucket.offBook");
    return "—";
  };

  return (
    <section
      className="card px-3 py-2.5 space-y-2 min-w-0"
      aria-label={t("dashboard.hypeDetected.title")}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-ink">
          <span
            className="mr-1.5 inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-normal leading-none text-violet-800 dark:text-violet-200 border border-violet-400/60 bg-violet-500/15 align-middle"
            aria-hidden
          >
            HYPE
          </span>
          {t("dashboard.hypeDetected.title")}
        </h2>
        <span className="text-[10px] text-ink-muted">
          {t("dashboard.hypeDetected.subtitle")}
        </span>
        <span className="ml-auto text-[10px] text-ink-muted tabular-nums">
          {t("dashboard.hypeDetected.count", { n: rows.length })}
        </span>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-0.5 text-base leading-none text-ink-muted hover:bg-[rgb(var(--border))]/40 hover:text-ink"
          aria-label={t("dashboard.hypeDetected.dismiss")}
          title={t("dashboard.hypeDetected.dismissTip")}
          onClick={() => {
            dismissHypeEntriesPanel(dismissTickers);
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
                {t("dashboard.hypeDetected.col.ticker")}
              </th>
              <th className="py-1.5 px-2 font-medium">
                {t("dashboard.hypeDetected.col.company")}
              </th>
              <th className="py-1.5 px-2 font-medium">
                {t("dashboard.hypeDetected.col.cd")}
              </th>
              <th className="py-1.5 px-2 font-medium text-right">
                {t("dashboard.hypeDetected.col.daysToCd")}
              </th>
              <th className="py-1.5 px-2 font-medium text-center">
                {t("dashboard.hypeDetected.col.window")}
              </th>
              <th
                className="py-1.5 px-2 font-medium text-center"
                title={t("dashboard.hypeDetected.bucket.tip")}
              >
                {t("dashboard.hypeDetected.col.bucket")}
              </th>
              <th className="py-1.5 px-2 font-medium text-right">
                {t("dashboard.hypeDetected.col.firstSeen")}
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
                  className={`py-1 px-2 text-right tabular-nums ${daysToCdTone(r.daysToCd, r.bucket)}`}
                >
                  {formatDaysToCd(r.daysToCd, l)}
                </td>
                <td className="py-1 px-2 text-center tabular-nums text-ink-muted">
                  {r.window}
                </td>
                <td
                  className="py-1 px-2 text-center"
                  title={t("dashboard.hypeDetected.bucket.tip")}
                >
                  <span
                    className={
                      r.bucket === "sim"
                        ? "text-[10px] rounded px-1.5 py-px border border-[rgb(var(--accent))]/40 text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10"
                        : r.bucket === "off_book"
                        ? "text-[10px] rounded px-1.5 py-px border border-[rgb(var(--border))]/40 text-ink-muted bg-[rgb(var(--surface-3))]/50"
                        : "text-[10px] text-ink-muted"
                    }
                  >
                    {bucketLabel(r.bucket)}
                  </span>
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
        {t("dashboard.hypeDetected.footer")}
      </p>
    </section>
  );
}
