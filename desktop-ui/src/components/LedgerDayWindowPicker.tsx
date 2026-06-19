import { useMemo, useState } from "react";
import { useLang, useT } from "../shared/i18n";
import {
  LEDGER_VISIBLE_DAYS,
  addLedgerDays,
  buildLedgerCalendarGrid,
  formatLedgerWindowRange,
  parseLedgerDayKey,
  resolveDefaultLedgerWindowEnd,
  todayLedgerDayKey,
} from "../sheet/ledgerDayWindow";

const WEEKDAY_LABELS = {
  it: ["D", "L", "M", "M", "G", "V", "S"],
  en: ["S", "M", "T", "W", "T", "F", "S"],
};

export function LedgerDayWindowPicker({
  windowEndKey,
  onWindowEndChange,
  ledgerDayKeys,
}: {
  windowEndKey: string;
  onWindowEndChange: (endKey: string) => void;
  ledgerDayKeys: string[];
}) {
  const { lang } = useLang();
  const t = useT();
  const todayKey = useMemo(() => todayLedgerDayKey(), []);
  const dataSet = useMemo(() => new Set(ledgerDayKeys), [ledgerDayKeys]);

  const endDate = parseLedgerDayKey(windowEndKey) ?? new Date();
  const [viewYear, setViewYear] = useState(endDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(endDate.getMonth());

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleDateString(lang === "it" ? "it-IT" : "en-US", {
      month: "long",
      year: "numeric",
    });
  }, [viewYear, viewMonth, lang]);

  const cells = useMemo(
    () => buildLedgerCalendarGrid(viewYear, viewMonth, windowEndKey, dataSet, todayKey),
    [viewYear, viewMonth, windowEndKey, dataSet, todayKey],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const shiftWindow = (deltaDays: number) => {
    onWindowEndChange(addLedgerDays(windowEndKey, deltaDays));
    const next = parseLedgerDayKey(addLedgerDays(windowEndKey, deltaDays));
    if (next) {
      setViewYear(next.getFullYear());
      setViewMonth(next.getMonth());
    }
  };

  const jumpToLast5 = () => {
    const end = resolveDefaultLedgerWindowEnd(ledgerDayKeys, todayKey);
    onWindowEndChange(end);
    const d = parseLedgerDayKey(end);
    if (d) {
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  };

  const pickDay = (dayKey: string) => {
    onWindowEndChange(dayKey);
  };

  return (
    <div className="ledger-day-window-picker rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/35 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted shrink-0">
          {t("sim.pnl.ledger.windowTitle")}
        </p>
        <span className="text-[11px] tabular-nums text-ink font-medium">
          {formatLedgerWindowRange(windowEndKey, lang)}
        </span>
        <span className="text-[10px] text-ink-muted/80">
          ({t("sim.pnl.ledger.windowDays", { n: LEDGER_VISIBLE_DAYS })})
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="ledger-window-nav-btn"
            onClick={() => shiftWindow(-1)}
            title={t("sim.pnl.ledger.windowPrevDay")}
            aria-label={t("sim.pnl.ledger.windowPrevDay")}
          >
            ‹
          </button>
          <button
            type="button"
            className="ledger-window-nav-btn"
            onClick={() => shiftWindow(1)}
            title={t("sim.pnl.ledger.windowNextDay")}
            aria-label={t("sim.pnl.ledger.windowNextDay")}
          >
            ›
          </button>
          <button
            type="button"
            className="rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/80 px-2 py-0.5 text-[10px] font-medium text-ink-muted hover:text-ink hover:border-[rgb(var(--accent))]/35 transition-colors"
            onClick={jumpToLast5}
          >
            {t("sim.pnl.ledger.windowLast5")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="ledger-window-nav-btn"
          onClick={() => shiftMonth(-1)}
          aria-label={t("sim.pnl.ledger.windowPrevMonth")}
        >
          «
        </button>
        <p className="text-xs font-semibold text-ink capitalize">{monthLabel}</p>
        <button
          type="button"
          className="ledger-window-nav-btn"
          onClick={() => shiftMonth(1)}
          aria-label={t("sim.pnl.ledger.windowNextMonth")}
        >
          »
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS[lang].map((lab, i) => (
          <div key={`wd-${i}`} className="text-[9px] font-semibold text-ink-muted/70 py-0.5">
            {lab}
          </div>
        ))}
        {cells.map((cell) => {
          const dayNum = parseLedgerDayKey(cell.dayKey)?.getDate() ?? "";
          return (
            <button
              key={cell.dayKey}
              type="button"
              onClick={() => pickDay(cell.dayKey)}
              className={[
                "ledger-cal-day relative rounded-md py-1 text-[11px] tabular-nums transition-colors",
                !cell.inMonth ? "text-ink-muted/35 hover:text-ink-muted/55" : "text-ink",
                cell.inWindow && cell.inMonth
                  ? "bg-[rgb(var(--accent))]/18 font-semibold text-[rgb(var(--accent))]"
                  : "hover:bg-[rgb(var(--surface-3))]/60",
                cell.isWindowEnd && cell.inMonth
                  ? "ring-2 ring-[rgb(var(--accent))]/55 ring-offset-1 ring-offset-[rgb(var(--surface))]"
                  : "",
                cell.isToday && !cell.inWindow ? "underline decoration-[rgb(var(--accent))]/50" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={cell.hasData ? t("sim.pnl.ledger.windowHasData") : undefined}
            >
              {dayNum}
              {cell.hasData && cell.inMonth ? (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-0.5 rounded-full bg-[rgb(var(--signal-up))]" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[9px] text-ink-muted/75 leading-snug">{t("sim.pnl.ledger.windowHint")}</p>
    </div>
  );
}
