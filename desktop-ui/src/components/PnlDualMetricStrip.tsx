import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  fmtSignedEurPnl,
  portfolioPnlAccentClass,
  portfolioPnlTone,
} from "../sheet/portfolioGainLossStyle";
import { useLang, useT } from "../shared/i18n";

function isRecovering(
  entryPct: number | null | undefined,
  shortPct: number | null | undefined,
): boolean {
  return (
    entryPct != null &&
    shortPct != null &&
    Number.isFinite(entryPct) &&
    Number.isFinite(shortPct) &&
    entryPct < -0.05 &&
    shortPct > 0.05
  );
}

function fmtReadingTime(iso: string | null | undefined, it: boolean): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCell({
  label,
  pct,
  eur,
  eurFmt = "usd",
  sub,
  title,
}: {
  label: string;
  pct: number | null | undefined;
  eur: number | null | undefined;
  eurFmt?: "usd" | "eur";
  sub?: string | null;
  title?: string;
}) {
  const accent = portfolioPnlAccentClass(eur, pct);
  const tone = portfolioPnlTone(eur, pct);
  const borderTone =
    tone === "gain"
      ? "border-emerald-300/70 bg-emerald-50/50 dark:bg-emerald-950/15"
      : tone === "loss"
        ? "border-rose-300/60 bg-rose-50/40 dark:bg-rose-950/15"
        : "border-[rgb(var(--border))]/45 bg-white/50 dark:bg-black/10";

  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 min-w-[6.5rem] flex-1 ${borderTone}`}
      title={title}
    >
      <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted leading-tight">
        {label}
      </p>
      <p className={`text-base font-bold tabular-nums leading-tight mt-0.5 ${accent}`}>
        {pct != null && Number.isFinite(pct) ? fmtPortfolioPnlPct(pct) : "—"}
      </p>
      <p className={`text-[11px] font-semibold tabular-nums ${accent}`}>
        {eur != null && Number.isFinite(eur)
          ? eurFmt === "eur"
            ? fmtSignedEurPnl(eur)
            : fmtPortfolioPnlUsd(eur)
          : "—"}
      </p>
      {sub ? <p className="text-[9px] text-ink-muted/85 mt-0.5 leading-snug">{sub}</p> : null}
    </div>
  );
}

/** Tre orizzonti P&L: portafoglio (ingresso) · ultima lettura · giornata borsa. */
export function PnlDualMetricStrip({
  pnlEur,
  pnlPct,
  pnlEurSinceReading,
  pnlPctSinceReading,
  priorReadingTs,
  pnlEurToday,
  pnlPctToday,
  hasToday = true,
  hasReadingDelta = true,
  capitalEur,
  className = "",
}: {
  pnlEur?: number | null;
  pnlPct?: number | null;
  pnlEurSinceReading?: number | null;
  pnlPctSinceReading?: number | null;
  priorReadingTs?: string | null;
  pnlEurToday?: number | null;
  pnlPctToday?: number | null;
  hasToday?: boolean;
  hasReadingDelta?: boolean;
  capitalEur?: number | null;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const showEntry = pnlPct != null || pnlEur != null;
  const showReading =
    hasReadingDelta && (pnlPctSinceReading != null || pnlEurSinceReading != null);
  const showToday = hasToday && (pnlPctToday != null || pnlEurToday != null);

  const shortTrendPct = showReading ? pnlPctSinceReading : pnlPctToday;
  const recovering = isRecovering(pnlPct, shortTrendPct);

  if (!showEntry && !showReading && !showToday) return null;

  const readingSub = fmtReadingTime(priorReadingTs, it);

  return (
    <div className={`space-y-1.5 ${className}`} title={t("sim.lossAnalysis.pnlDual.tip")}>
      <div className="flex flex-wrap items-stretch gap-2">
        {showEntry ? (
          <MetricCell
            label={t("sim.lossAnalysis.pnlDual.entryLabel")}
            pct={pnlPct}
            eur={pnlEur}
            title={t("sim.lossAnalysis.pnlDual.entryTip")}
          />
        ) : null}
        {showReading ? (
          <MetricCell
            label={t("sim.lossAnalysis.pnlDual.readingLabel")}
            pct={pnlPctSinceReading}
            eur={pnlEurSinceReading}
            sub={
              readingSub
                ? t("sim.lossAnalysis.pnlDual.readingSince", { ts: readingSub })
                : null
            }
            title={t("sim.lossAnalysis.pnlDual.readingTip")}
          />
        ) : null}
        {showToday ? (
          <MetricCell
            label={t("sim.lossAnalysis.pnlDual.todayLabel")}
            pct={pnlPctToday}
            eur={pnlEurToday}
            title={t("sim.lossAnalysis.pnlDual.todayTip")}
          />
        ) : null}
      </div>
      {recovering ? (
        <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 leading-snug">
          {t("sim.lossAnalysis.pnlDual.recovering")}
        </p>
      ) : null}
      {capitalEur != null && capitalEur > 0 ? (
        <p className="text-[10px] text-ink-muted tabular-nums">
          €{capitalEur.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
          {t("sim.lossAnalysis.pnlDual.invested")}
        </p>
      ) : null}
    </div>
  );
}
