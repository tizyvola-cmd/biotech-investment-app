import { useEffect, useState } from "react";
import {
  formatManualEisConfirmedScore,
  resolveManualEisConfirmedDisplay,
} from "../sheet/manualEisConfirmedDisplay";
import { MANUAL_FEED_EVENTS_CHANGED_EVENT } from "../sheet/manualFeedEvents";
import { GAIN_STAR_LEDGER_CHANGED_EVENT } from "../sheet/gainStarLedger";
import { useT } from "../shared/i18n";

export function ManualEisConfirmedCell({
  ticker,
  pnlPct24h,
  className = "",
  uniform = false,
}: {
  ticker: string;
  pnlPct24h?: number | null;
  className?: string;
  /** Match KPI snapshot table typography (10px medium). */
  uniform?: boolean;
}) {
  const t = useT();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, bump);
    window.addEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, bump);
      window.removeEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, bump);
    };
  }, []);

  void version;

  const display = resolveManualEisConfirmedDisplay(ticker, pnlPct24h);
  if (!display) {
    return (
      <span
        className={`text-ink-muted/65 ${uniform ? "" : "text-[10px] font-medium uppercase tracking-wide"} ${className}`.trim()}
        title={t("sim.lossAnalysis.summaryTable.manualEisNaTip")}
      >
        na
      </span>
    );
  }

  const color =
    display.polarity === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-rose-700 dark:text-rose-300";

  return (
    <span
      className={`inline-flex items-center justify-center gap-0.5 tabular-nums ${uniform ? "font-medium" : "font-semibold text-[10px]"} ${color} ${className}`.trim()}
      title={t("sim.lossAnalysis.summaryTable.manualEisTip")}
    >
      {display.showStar ? (
        <span className={`text-[#eab308] ${uniform ? "text-[10px]" : "text-[9px]"} leading-none`} aria-hidden>
          ★
        </span>
      ) : null}
      {formatManualEisConfirmedScore(display.score)}
    </span>
  );
}

/** Gold ★ only — portfolio piggy chips when gain is manual-EIS confirmed. */
export function ManualEisGainStarOnly({
  ticker,
  pnlPct24h,
  className = "",
}: {
  ticker: string;
  pnlPct24h?: number | null;
  className?: string;
}) {
  const t = useT();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, bump);
    window.addEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, bump);
      window.removeEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, bump);
    };
  }, []);

  void version;

  const display = resolveManualEisConfirmedDisplay(ticker, pnlPct24h);
  if (!display?.showStar) return null;

  return (
    <span
      className={`text-[#eab308] text-[9px] leading-none shrink-0 ${className}`.trim()}
      title={t("manualFeed.gainStar.mark")}
      aria-label={t("manualFeed.gainStar.mark")}
    >
      ★
    </span>
  );
}
