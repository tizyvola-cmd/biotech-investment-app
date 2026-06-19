import { useState } from "react";
import type { PortfolioVsSimLoopInsight } from "../sheet/portfolioVsSimLoopAnalysis";
import { useT, type TranslationKey } from "../shared/i18n";

const FACTOR_KEYS: Record<
  PortfolioVsSimLoopInsight["factors"][number]["id"],
  TranslationKey
> = {
  ahead: "modelLab.missedOpp.vsSimLoop.factorAhead",
  behind: "modelLab.missedOpp.vsSimLoop.factorBehind",
  ra_not_driver: "modelLab.missedOpp.vsSimLoop.factorRaNotDriver",
  sim_bad_buys: "modelLab.missedOpp.vsSimLoop.factorBadBuys",
  sim_missed_buys: "modelLab.missedOpp.vsSimLoop.factorMissedBuys",
  low_overlap: "modelLab.missedOpp.vsSimLoop.factorLowOverlap",
  advice_precision: "modelLab.missedOpp.vsSimLoop.factorAdvicePrecision",
  executable_aligned: "modelLab.missedOpp.vsSimLoop.factorExecutableAligned",
};

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}

function toneClass(tone: "good" | "warn" | "info"): string {
  if (tone === "good") return "text-emerald-800 dark:text-emerald-200";
  if (tone === "warn") return "text-amber-900 dark:text-amber-200";
  return "text-ink-muted";
}

export function PortfolioVsSimLoopPanel({
  insight,
}: {
  insight: PortfolioVsSimLoopInsight | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (!insight) return null;
  if (insight.summary.deltaEur == null && insight.summary.simLoopTotalEur == null) {
    return null;
  }

  const { summary, factors, overlapCount, paperTickerCount, portfolioTickerCount } =
    insight;
  const delta = summary.deltaEur;
  const deltaColor =
    delta == null
      ? "text-ink-muted"
      : delta >= 0
        ? "text-[rgb(var(--signal-up))]"
        : "text-[rgb(var(--signal-down))]";

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/25 px-2.5 py-2 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-surface/50 px-2 py-1.5">
          <p className="text-[9px] uppercase text-ink-muted">
            {t("modelLab.missedOpp.vsSimLoop.kpiDelta")}
          </p>
          <p className={`text-sm font-semibold tabular-nums ${deltaColor}`}>
            {fmtEur(delta)}
          </p>
          <p className="text-[8px] text-ink-muted leading-tight">
            {t("modelLab.missedOpp.vsSimLoop.kpiDeltaHint")}
          </p>
        </div>
        <div className="rounded-md bg-surface/50 px-2 py-1.5">
          <p className="text-[9px] uppercase text-ink-muted">
            {t("modelLab.missedOpp.lineActual")}
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {fmtEur(summary.actualTotalEur)}
          </p>
        </div>
        <div className="rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-1.5 col-span-2 sm:col-span-1">
          <p className="text-[9px] uppercase text-indigo-800 dark:text-indigo-200">
            {t("modelLab.missedOpp.lineSimLoop")}
          </p>
          <p className="text-sm font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
            {fmtEur(summary.simLoopTotalEur)}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-[10px] font-medium text-ink hover:opacity-90"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {open
          ? t("modelLab.missedOpp.vsSimLoop.analysisHide")
          : t("modelLab.missedOpp.vsSimLoop.analysisShow")}
      </button>

      {open ? (
        <div className="space-y-2 text-[10px] leading-snug">
          <p className="text-ink-muted">{t("modelLab.missedOpp.vsSimLoop.analysisLead")}</p>
          <ul className="space-y-1.5 m-0 pl-0 list-none">
            {factors.map((f) => (
              <li
                key={f.id}
                className={`rounded border border-[rgb(var(--border))]/30 px-2 py-1.5 ${toneClass(f.tone)}`}
              >
                {t(FACTOR_KEYS[f.id], f.params)}
              </li>
            ))}
          </ul>
          <p className="text-[9px] text-ink-muted tabular-nums">
            {t("modelLab.missedOpp.vsSimLoop.overlapMeta", {
              overlap: String(overlapCount),
              paperN: String(paperTickerCount),
              realN: String(portfolioTickerCount),
            })}
          </p>
          {summary.deltaDailyEur != null ? (
            <p className="text-[9px] text-ink-muted">
              {t("modelLab.missedOpp.vsSimLoop.dailyDelta", {
                delta: fmtEur(summary.deltaDailyEur),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
