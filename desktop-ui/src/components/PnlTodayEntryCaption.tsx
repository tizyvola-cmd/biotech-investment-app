import {
  fmtPortfolioPnlPct,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import { useT } from "../shared/i18n";

/** Riga esplicativa sotto il ticker: «Oggi +1,2% · dall'ingresso −7,9%». */
export function PnlTodayEntryCaption({
  pnlPct,
  pnlPct24h,
  hasPosition = true,
  className = "",
}: {
  pnlPct?: number | null;
  pnlPct24h?: number | null;
  /** Fuori portafoglio: mostra solo la var. giornaliera. */
  hasPosition?: boolean;
  className?: string;
}) {
  const t = useT();

  const todayPct =
    pnlPct24h != null && Number.isFinite(pnlPct24h) ? fmtPortfolioPnlPct(pnlPct24h) : null;
  const entryPct =
    hasPosition && pnlPct != null && Number.isFinite(pnlPct) ? fmtPortfolioPnlPct(pnlPct) : null;

  if (!todayPct && !entryPct) return null;

  const todayAccent = portfolioPnlAccentClass(null, pnlPct24h);
  const entryAccent = portfolioPnlAccentClass(null, pnlPct);

  return (
    <p
      className={`text-[11px] tabular-nums leading-snug ${className}`}
      title={t("sim.lossAnalysis.pnlDual.tip")}
    >
      {todayPct ? (
        <span className={`font-semibold ${todayAccent}`}>
          {t("sim.lossAnalysis.pnlDual.today", { pct: todayPct })}
        </span>
      ) : null}
      {todayPct && entryPct ? <span className="text-ink-muted font-normal mx-1">·</span> : null}
      {entryPct ? (
        <span className={`font-semibold ${entryAccent}`}>
          {t("sim.lossAnalysis.pnlDual.entry", { pct: entryPct })}
        </span>
      ) : null}
    </p>
  );
}
