import { useEffect, useMemo, useState } from "react";
import { useLang, useT } from "../shared/i18n";
import {
  formatLedgerDayKey,
  sumLedgerRowsForDayKeys,
  type PortfolioDailyPnlLedger,
} from "../sheet/simulationPosition";
import {
  buildLedgerDayWindow,
  resolveDefaultLedgerWindowEnd,
  todayLedgerDayKey,
} from "../sheet/ledgerDayWindow";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { LedgerDayWindowPicker } from "./LedgerDayWindowPicker";

function fmtEurSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}€ ${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Griglia gain/loss per ticker e giorno — finestra 5 giorni scorrevole. */
export function PortfolioDailyPnlLedgerTable({
  ledger,
  compact = false,
  windowResetToken,
}: {
  ledger: PortfolioDailyPnlLedger | null;
  compact?: boolean;
  /** Cambia quando il drawer si riapre → reset finestra agli ultimi 5 giorni. */
  windowResetToken?: boolean | number;
}) {
  const { lang } = useLang();
  const t = useT();
  const todayKey = useMemo(() => todayLedgerDayKey(), []);
  const locale = lang === "it" ? "it" : "en";

  const defaultEndKey = useMemo(
    () => resolveDefaultLedgerWindowEnd(ledger?.dayKeys ?? [], todayKey),
    [ledger?.dayKeys, todayKey],
  );

  const [windowEndKey, setWindowEndKey] = useState(defaultEndKey);

  useEffect(() => {
    setWindowEndKey(defaultEndKey);
  }, [defaultEndKey, windowResetToken]);

  const visibleDayKeys = useMemo(
    () => buildLedgerDayWindow(windowEndKey),
    [windowEndKey],
  );

  const openRows = useMemo(
    () => ledger?.rows.filter((r) => !r.archived) ?? [],
    [ledger?.rows],
  );

  const windowOpenSubtotal = useMemo(
    () => sumLedgerRowsForDayKeys(openRows, visibleDayKeys),
    [openRows, visibleDayKeys],
  );

  const windowOpenByDay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const dk of visibleDayKeys) {
      out[dk] = sumLedgerRowsForDayKeys(openRows, [dk]);
    }
    return out;
  }, [openRows, visibleDayKeys]);

  if (!ledger || openRows.length === 0) {
    return (
      <p className="text-sm text-ink-muted text-center py-8">{t("sim.pnl.ledger.empty")}</p>
    );
  }

  const cellPad = compact ? "py-1.5" : "py-2";
  const textSize = compact ? "text-[10px]" : "text-[11px]";

  return (
    <>
      <LedgerDayWindowPicker
        windowEndKey={windowEndKey}
        onWindowEndChange={setWindowEndKey}
        ledgerDayKeys={ledger.dayKeys}
      />
      <p className={`${textSize} text-ink-muted mb-3 mt-3`}>{t("sim.pnl.ledger.todayNote")}</p>
      {ledger.archivedRowCount > 0 ? (
        <p className="text-[10px] text-ink-muted/85 mb-2">
          {t("sim.pnl.ledger.closedInPiggyNote", { n: ledger.archivedRowCount })}
        </p>
      ) : null}
      {ledger.incompleteDailyHistory ? (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-[11px] text-ink leading-snug">
          {t("sim.pnl.ledger.incompleteBanner")}
        </div>
      ) : null}
      {ledger.legTotalDiffersFromMtm ? (
        <div className="mb-3 rounded-lg border border-sky-500/35 bg-sky-500/8 px-3 py-2 text-[11px] text-ink leading-snug">
          {t("sim.pnl.ledger.mtmDivergenceBanner")}
        </div>
      ) : null}
      <p className={`${textSize} text-ink-muted/85 mb-2 leading-snug`}>
        {t("sim.pnl.ledger.windowMismatchNote")}
      </p>
      <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/50">
        <table className={`${SHEET_GRID_TABLE_CLASS} min-w-[32rem] ${textSize} border-collapse`}>
          <SheetGridColgroup columnCount={2 + visibleDayKeys.length + 1} />
          <thead>
            <tr className="bg-[rgb(var(--surface-2))]/80 text-ink-muted">
              <th
                className={`sticky left-0 z-20 bg-[rgb(var(--surface-2))]/95 ${gridTh("left", `${cellPad} font-semibold uppercase tracking-wide`)}`}
              >
                {t("sim.pnl.ledger.colTicker")}
              </th>
              <th
                className={`${gridTh("left", `${cellPad} font-semibold uppercase tracking-wide`)} whitespace-nowrap`}
              >
                {t("sim.pnl.ledger.colCd")}
              </th>
              {visibleDayKeys.map((dk) => (
                <th
                  key={dk}
                  className={`${gridTh("center", `${cellPad} font-semibold uppercase tracking-wide`)} whitespace-nowrap`}
                  title={dk === todayKey ? t("sim.pnl.ledger.colToday") : undefined}
                >
                  {formatLedgerDayKey(dk, locale)}
                  {dk === todayKey ? " *" : ""}
                </th>
              ))}
              <th
                className={`sticky right-0 z-20 bg-[rgb(var(--surface-2))]/95 ${gridTh("center", `${cellPad} font-semibold uppercase tracking-wide`)} whitespace-nowrap`}
                title={t("sim.pnl.ledger.colTotalAllDaysTitle")}
              >
                {t("sim.pnl.ledger.colTotalAllDays")}
              </th>
            </tr>
          </thead>
          <tbody>
            {openRows.map((row) => (
              <tr
                key={row.key}
                className="border-t border-[rgb(var(--border))]/30 hover:bg-[rgb(var(--surface-2))]/40"
              >
                <td
                  className={`sticky left-0 z-10 bg-[rgb(var(--surface))] ${gridTd("left")} font-semibold text-ink whitespace-nowrap`}
                >
                  {row.ticker}
                </td>
                <td className={`${gridTd("left")} text-ink-muted whitespace-nowrap`}>
                  {row.completionDate !== "—" ? row.completionDate : "—"}
                </td>
                {visibleDayKeys.map((dk) => {
                  const v = row.pnlByDay[dk];
                  return (
                    <td
                      key={dk}
                      className={`${gridTd("center")} whitespace-nowrap${
                        v != null ? portfolioPnlAccentClass(v) : " text-ink-muted/50"
                      }`}
                    >
                      {v != null ? fmtEurSigned(v) : "—"}
                    </td>
                  );
                })}
                <td
                  className={`sticky right-0 z-10 bg-[rgb(var(--surface))] ${gridTd("center")} font-semibold whitespace-nowrap${portfolioPnlAccentClass(row.totalEur)}`}
                  title={
                    row.mtmTotalEur != null
                      ? t("sim.pnl.ledger.rowMtmTip", {
                          mtm: fmtEurSigned(row.mtmTotalEur),
                          ledger: fmtEurSigned(row.totalEur),
                        })
                      : t("sim.pnl.ledger.colTotalAllDaysTitle")
                  }
                >
                  {fmtEurSigned(row.totalEur)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/50 font-semibold">
              <td
                className={`sticky left-0 z-10 bg-[rgb(var(--surface-2))]/90 ${gridTd("left", cellPad)} text-ink whitespace-nowrap`}
                colSpan={2}
              >
                {t("sim.pnl.ledger.portfolioTotal")}
              </td>
              {visibleDayKeys.map((dk) => {
                const v = ledger.openDayTotals[dk];
                return (
                  <td
                    key={dk}
                    className={`${gridTd("center", cellPad)} whitespace-nowrap${portfolioPnlAccentClass(v)}`}
                  >
                    {fmtEurSigned(v)}
                  </td>
                );
              })}
              <td
                className={`sticky right-0 z-10 bg-[rgb(var(--surface-2))]/90 ${gridTd("center", cellPad)} whitespace-nowrap${portfolioPnlAccentClass(ledger.openGrandTotal)}`}
                title={t("sim.pnl.ledger.colTotalMtmTip")}
              >
                {fmtEurSigned(ledger.openGrandTotal)}
              </td>
            </tr>
            <tr className="border-t border-dashed border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/25 text-[10px] font-medium text-ink-muted">
              <td
                className={`sticky left-0 z-10 bg-[rgb(var(--surface-2))]/85 ${gridTd("left", cellPad)} whitespace-nowrap`}
                colSpan={2}
              >
                {t("sim.pnl.ledger.windowSubtotal")}
              </td>
              {visibleDayKeys.map((dk) => {
                const v = windowOpenByDay[dk];
                return (
                  <td
                    key={dk}
                    className={`${gridTd("center", cellPad)} whitespace-nowrap${portfolioPnlAccentClass(v)}`}
                  >
                    {fmtEurSigned(v)}
                  </td>
                );
              })}
              <td
                className={`sticky right-0 z-10 bg-[rgb(var(--surface-2))]/85 ${gridTd("center", cellPad)} whitespace-nowrap${portfolioPnlAccentClass(windowOpenSubtotal)}`}
                title={t("sim.pnl.ledger.windowSubtotal")}
              >
                {fmtEurSigned(windowOpenSubtotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink-muted/70 mt-2">* {t("sim.pnl.ledger.todayFootnote")}</p>
    </>
  );
}
