import { AppModal, AppModalCloseButton } from "./AppModal";
import type { SynthSyncSummary } from "../sheet/synthCapitalSyncLog";
import { useLang, useT, type TranslationKey } from "../shared/i18n";

function fmtEur(v: number, locale: string): string {
  return `${Math.round(v).toLocaleString(locale)} €`;
}

function fmtWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(
  source: SynthSyncSummary["source"],
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (source === "bulk") return t("synthSyncSummary.sourceBulk");
  if (source === "manual") return t("synthSyncSummary.sourceManual");
  return t("synthSyncSummary.sourceManual");
}

export function SynthSyncSummaryModal({
  open,
  summary,
  onClose,
}: {
  open: boolean;
  summary: SynthSyncSummary | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  if (!summary) return null;

  const upsN = summary.upsized.length;
  const trimN = summary.trimmed.length;
  const total = upsN + trimN;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="synth-sync-summary-title"
      panelClassName="w-full max-w-md"
    >
      <div className="rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-start gap-3 border-b border-teal-500/30 bg-teal-500/10 px-4 py-3 shrink-0">
          <span className="text-xl leading-none mt-0.5" aria-hidden>
            ⇄
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="synth-sync-summary-title" className="text-sm font-bold text-ink">
              {t("synthSyncSummary.title")}
            </h2>
            <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
              {t("synthSyncSummary.subtitle", { n: total })}
            </p>
            <p className="text-[10px] text-ink-muted/80 mt-1 tabular-nums">
              {fmtWhen(summary.at, locale)} · {sourceLabel(summary.source, t)}
            </p>
          </div>
          <AppModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          <div className="flex flex-wrap gap-2">
            {upsN > 0 ? (
              <span className="inline-flex items-center rounded-full border border-teal-500/40 bg-teal-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-teal-800 dark:text-teal-200 tabular-nums">
                {t("synthSyncSummary.upsizedBadge", { n: upsN })}
              </span>
            ) : null}
            {trimN > 0 ? (
              <span className="inline-flex items-center rounded-full border border-amber-500/45 bg-amber-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100 tabular-nums">
                {t("synthSyncSummary.trimmedBadge", { n: trimN })}
              </span>
            ) : null}
          </div>

          {upsN > 0 ? (
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300 mb-1.5">
                {t("synthSyncSummary.upsizedSection")}
              </h3>
              <SynthSyncSummaryTable lines={summary.upsized} locale={locale} direction="up" />
            </section>
          ) : null}

          {trimN > 0 ? (
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-1.5">
                {t("synthSyncSummary.trimmedSection")}
              </h3>
              <SynthSyncSummaryTable lines={summary.trimmed} locale={locale} direction="down" />
            </section>
          ) : null}

          <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/40 pt-2">
            {t("synthSyncSummary.footerNote")}
          </p>
        </div>

        <div className="shrink-0 flex justify-end border-t border-[rgb(var(--border))]/50 px-4 py-3 bg-surface/50">
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            {t("synthSyncSummary.acknowledge")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

function SynthSyncSummaryTable({
  lines,
  locale,
  direction,
}: {
  lines: SynthSyncSummary["upsized"];
  locale: string;
  direction: "up" | "down";
}) {
  const t = useT();
  const deltaClass =
    direction === "up"
      ? "text-teal-700 dark:text-teal-300"
      : "text-amber-800 dark:text-amber-200";

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="bg-[rgb(var(--surface))]/80 text-ink-muted border-b border-[rgb(var(--border))]/40">
            <th className="text-left font-semibold px-2 py-1">{t("synthSyncSummary.colTicker")}</th>
            <th className="text-right font-semibold px-2 py-1">{t("synthSyncSummary.colFrom")}</th>
            <th className="text-right font-semibold px-2 py-1">{t("synthSyncSummary.colTo")}</th>
            <th className="text-right font-semibold px-2 py-1">{t("synthSyncSummary.colDelta")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={`${line.rowKey}-${line.fromCapitalEur}-${line.toCapitalEur}`}
              className="border-b border-[rgb(var(--border))]/30 last:border-0"
            >
              <td className="px-2 py-1 font-semibold text-ink">{line.ticker}</td>
              <td className="px-2 py-1 text-right text-ink-muted">{fmtEur(line.fromCapitalEur, locale)}</td>
              <td className="px-2 py-1 text-right font-semibold">{fmtEur(line.toCapitalEur, locale)}</td>
              <td className={`px-2 py-1 text-right font-semibold ${deltaClass}`}>
                {line.deltaEur > 0 ? "+" : ""}
                {fmtEur(line.deltaEur, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
