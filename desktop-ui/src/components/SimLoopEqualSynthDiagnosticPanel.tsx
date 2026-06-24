import { useMemo } from "react";
import { useLang, useT } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";
import { fmtPulseEur } from "./PortfolioGainPlanAggregateChart";
import type { SimLoopEqualSynthReconcile } from "../sheet/simLoopPulseView";

function fmtSharePct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function SimLoopEqualSynthDiagnosticPanel({
  reconcile,
}: {
  reconcile: SimLoopEqualSynthReconcile;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const summary = useMemo(
    () => [
      {
        label: t("dashboard.pulse.simLoopSynth.reconcile.openPnl"),
        equal: reconcile.totals.equalOpenPnlEur,
        synth: reconcile.totals.synthOpenPnlEur,
      },
      {
        label: t("dashboard.pulse.simLoopSynth.reconcile.closedPnl"),
        equal: reconcile.totals.equalClosedPnlEur,
        synth: reconcile.totals.synthClosedPnlEur,
      },
      {
        label: t("dashboard.pulse.simLoopSynth.reconcile.totalPnl"),
        equal: reconcile.totals.equalTotalPnlEur,
        synth: reconcile.totals.synthTotalPnlEur,
        bold: true,
      },
    ],
    [reconcile.totals, t],
  );

  return (
    <details className="border-t border-[rgb(var(--panel-feed-border))]/35 shrink-0 group">
      <summary className="cursor-pointer select-none list-none px-4 py-2 bg-[rgb(var(--panel-feed-header-bg))]/40 hover:bg-[rgb(var(--panel-feed-row-hover))]/30 transition-colors [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
          {t("dashboard.pulse.simLoopSynth.reconcile.title")}
        </span>
        <span className="ml-2 text-[10px] text-ink-muted font-normal normal-case tracking-normal">
          {t("dashboard.pulse.simLoopSynth.reconcile.subtitle", {
            delta: fmtPulseEur(reconcile.totals.pnlDeltaEur),
          })}
        </span>
      </summary>

      <div className="px-4 pb-3 pt-2 space-y-3">
        {reconcile.signMismatch ? (
          <p className="text-[11px] text-[rgb(var(--signal-down))]/90 leading-snug">
            {t("dashboard.pulse.simLoopSynth.reconcile.signMismatch")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {summary.map((row) => (
            <div
              key={row.label}
              className="rounded-lg border border-[rgb(var(--panel-mint-border))]/45 bg-white/85 px-2.5 py-1.5 min-w-[9rem]"
            >
              <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted/80">
                {row.label}
              </p>
              <p className={`text-xs tabular-nums mt-0.5 ${row.bold ? "font-semibold" : ""}`}>
                <span className={portfolioPnlAccentClass(row.equal)}>{fmtPulseEur(row.equal)}</span>
                <span className="text-ink-muted mx-1">→</span>
                <span className={portfolioPnlAccentClass(row.synth)}>{fmtPulseEur(row.synth)}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px] border-collapse min-w-[52rem]`}>
            <SheetGridColgroup columnCount={11} />
            <thead>
              <tr className="bg-[rgb(var(--panel-feed-header-bg))]/80 text-[10px] uppercase tracking-wide text-ink-muted">
                <th className={gridTh("left", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.colTicker")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colStatus")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colEqualCap")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colSynthCap")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")} title={t("dashboard.pulse.simLoopSynth.reconcile.colShareEntryTip")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colShareEntry")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")} title={t("dashboard.pulse.simLoopSynth.reconcile.colShareLiveTip")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colShareLive")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colClosedEqual")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colClosedSynth")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colOpenEqual")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  {t("dashboard.pulse.simLoopSynth.reconcile.colOpenSynth")}
                </th>
                <th className={gridTh("center", "py-1.5 font-semibold")}>
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {reconcile.rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-[rgb(var(--panel-feed-border))]/25 hover:bg-[rgb(var(--panel-feed-row-hover))]/25"
                >
                  <td className={`${gridTd("left")} font-medium whitespace-nowrap`}>{row.ticker}</td>
                  <td className={`${gridTd("center")} text-ink-muted whitespace-nowrap`}>
                    {row.status === "open"
                      ? t("dashboard.pulse.simLoopSynth.reconcile.statusOpen")
                      : t("dashboard.pulse.simLoopSynth.reconcile.statusClosed")}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap`}>
                    {row.status === "open" ? fmtPulseEur(row.equalCapEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap`}>
                    {row.status === "open" ? fmtPulseEur(row.synthCapEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap`}>
                    {fmtSharePct(row.entrySharePct)}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap`}>
                    {fmtSharePct(row.liveSharePct)}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.equalPnlClosedEur)}`}>
                    {row.equalPnlClosedEur !== 0 ? fmtPulseEur(row.equalPnlClosedEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.synthPnlClosedEur)}`}>
                    {row.synthPnlClosedEur !== 0 ? fmtPulseEur(row.synthPnlClosedEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.equalPnlOpenEur)}`}>
                    {row.status === "open" ? fmtPulseEur(row.equalPnlOpenEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.synthPnlOpenEur)}`}>
                    {row.status === "open" ? fmtPulseEur(row.synthPnlOpenEur) : "—"}
                  </td>
                  <td className={`${gridTd("center")} tabular-nums whitespace-nowrap font-semibold${portfolioPnlAccentClass(row.pnlDeltaEur)}`}>
                    {fmtPulseEur(row.pnlDeltaEur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {reconcile.closedKeysWithoutEntryShare.length > 0 ? (
          <p className="text-[10px] text-ink-muted/80 leading-snug">
            {t("dashboard.pulse.simLoopSynth.reconcile.noEntryShare", {
              n: String(reconcile.closedKeysWithoutEntryShare.length),
            })}
          </p>
        ) : null}

        <p className="text-[10px] text-ink-muted/75 leading-snug">
          {it
            ? `Capitale aperto: equal ${fmtPulseEur(reconcile.totals.equalOpenCapEur)} · synth ${fmtPulseEur(reconcile.totals.synthOpenCapEur)}.`
            : `Open capital: equal ${fmtPulseEur(reconcile.totals.equalOpenCapEur)} · synth ${fmtPulseEur(reconcile.totals.synthOpenCapEur)}.`}
        </p>
      </div>
    </details>
  );
}
