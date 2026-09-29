/**
 * Home banner: buys / sells from the previous calendar day + realized €.
 * Dismiss with × (persists for that day).
 */
import { useEffect, useMemo, useState } from "react";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";
import {
  buildPriorDayBookActivity,
  dismissPriorDayActivity,
  isPriorDayActivityDismissed,
  priorDayActivityHasRows,
  type PriorDayBookActivityItem,
} from "../sheet/priorDayBookActivity";
import { useLang } from "../shared/i18n";
import type { SheetTable } from "../types";

function fmtCapital(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `€${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPnl(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${Math.round(n).toLocaleString("en-US")}`;
}

function ActivityLine({
  item,
  investedLabel,
}: {
  item: PriorDayBookActivityItem;
  investedLabel: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="font-semibold tabular-nums">{item.ticker}</span>
      <span className="text-ink-muted tabular-nums">
        {investedLabel} {fmtCapital(item.capitalEur)}
        {item.pnlEur != null ? (
          <span className={`ml-1 font-semibold${portfolioPnlAccentClass(item.pnlEur)}`}>
            ({fmtPnl(item.pnlEur)})
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function PriorDayBookActivityBanner({
  inputs,
  history = [],
  simTable = null,
}: {
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[];
  simTable?: SheetTable | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const activity = useMemo(
    () =>
      buildPriorDayBookActivity(
        inputs,
        undefined,
        history,
        simTable?.rows ?? null,
      ),
    [inputs, history, simTable],
  );
  const [dismissed, setDismissed] = useState(() =>
    isPriorDayActivityDismissed(activity.dayKey),
  );
  // Re-sync when the calendar day key arrives/changes (first paint can be empty).
  useEffect(() => {
    setDismissed(isPriorDayActivityDismissed(activity.dayKey));
  }, [activity.dayKey]);

  if (dismissed || !priorDayActivityHasRows(activity)) return null;

  const investedLabel = it ? "investito" : "invested";

  return (
    <section
      className="shrink-0 rounded-xl border border-[rgb(var(--accent))]/35 bg-[rgb(var(--surface))] px-3 py-2.5 shadow-sm"
      aria-label={it ? "Movimenti giorno precedente" : "Prior-day book activity"}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--accent))]">
            {it ? "Giorno precedente" : "Previous day"}
          </p>
          <h3 className="text-sm font-bold text-ink tracking-tight">
            {it
              ? `Acquisti e vendite · ${activity.dayKey}`
              : `Buys & sells · ${activity.dayKey}`}
          </h3>
          <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
            {it
              ? "Aperture di ieri · chiusure di ieri o di oggi. Stesso formato: investito + P&L tra parentesi. Chiudi con ×."
              : "Opened yesterday · closed yesterday or today. Same format: invested + P&L in parentheses. Dismiss with ×."}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-ink-muted hover:bg-[rgb(var(--border))]/40 hover:text-ink"
          aria-label={it ? "Nascondi" : "Dismiss"}
          title={it ? "Nascondi questo riepilogo" : "Dismiss this recap"}
          onClick={() => {
            dismissPriorDayActivity(activity.dayKey);
            setDismissed(true);
          }}
        >
          ×
        </button>
      </div>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
          <p className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
            {it
              ? `Acquistati (${activity.buys.length})`
              : `Bought (${activity.buys.length})`}
          </p>
          {activity.buys.length ? (
            <ul className="mt-1 space-y-1">
              {activity.buys.map((b) => (
                <ActivityLine key={b.key} item={b} investedLabel={investedLabel} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-ink-muted">
              {it ? "Nessun acquisto ieri" : "No buys yesterday"}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-2.5 py-2">
          <p className="text-[10px] font-semibold text-rose-800 dark:text-rose-300">
            {it
              ? `Venduti (${activity.sells.length})`
              : `Sold (${activity.sells.length})`}
          </p>
          {activity.sells.length ? (
            <ul className="mt-1 space-y-1">
              {activity.sells.map((s) => (
                <ActivityLine key={s.key} item={s} investedLabel={investedLabel} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-ink-muted">
              {it ? "Nessuna vendita ieri/oggi" : "No sells yesterday/today"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
