import { useMemo } from "react";
import { AppModal } from "./AppModal";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { useLang, useT } from "../shared/i18n";
import type { SimLoopTradeAlertBatch } from "../sheet/simLoopTradeAlerts";

function fmtTs(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SimLoopTradeAlertModal({
  batch,
  onClose,
  onOpen24h,
}: {
  batch: SimLoopTradeAlertBatch | null;
  onClose: () => void;
  onOpen24h: (focus: { ticker: string; cd?: string; rowKey: string }) => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";
  const open = batch != null && batch.alerts.length > 0;

  const title = useMemo(() => {
    if (!batch) return "";
    if (batch.alerts.length === 1) {
      const a = batch.alerts[0]!;
      return t("simLoopTradeAlert.titleOne", { side: a.commandLabel, ticker: a.ticker });
    }
    return t("simLoopTradeAlert.titleMany", { n: String(batch.alerts.length) });
  }, [batch, t]);

  if (!open || !batch) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="sim-loop-trade-alert-title"
      panelClassName="max-w-lg w-full"
    >
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/40 bg-indigo-50/80 dark:bg-indigo-950/30">
          <h2 id="sim-loop-trade-alert-title" className="text-sm font-semibold text-ink">
            {title}
          </h2>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {batch.pending && batch.executeAfter
              ? t("simLoopTradeAlert.subtitlePending", {
                  when: fmtTs(batch.at, locale),
                  execute: fmtTs(batch.executeAfter, locale),
                })
              : t("simLoopTradeAlert.subtitle", { when: fmtTs(batch.at, locale) })}
          </p>
          {batch.pending ? (
            <p className="text-[10px] font-medium text-amber-800 dark:text-amber-200 mt-1">
              {t("simLoopTradeAlert.pendingHint")}
            </p>
          ) : null}
        </div>

        <ul className="max-h-[min(60vh,420px)] overflow-y-auto divide-y divide-[rgb(var(--border))]/30">
          {batch.alerts.map((alert) => {
            const sideCls =
              alert.side === "buy"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
            return (
              <li key={`${alert.key}-${alert.side}-${alert.at}`} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${sideCls}`}
                  >
                    {alert.commandLabel}
                  </span>
                  {alert.inRealPortfolio ? (
                    <PortfolioTickerMark
                      ticker={alert.ticker}
                      inPortfolio
                      pnlPct={alert.pnlPct}
                      layout="inline"
                      className="text-sm"
                      portfolioMarkTitle={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                    />
                  ) : (
                    <span className="text-sm font-semibold text-ink">{alert.ticker}</span>
                  )}
                  {alert.completionDate !== "—" ? (
                    <span className="text-[10px] text-ink-muted tabular-nums">
                      CD {alert.completionDate}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] leading-relaxed text-ink">{alert.recommendation}</p>
                {alert.detail && alert.detail !== alert.recommendation ? (
                  <p className="text-[10px] leading-snug text-ink-muted">{alert.detail}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {alert.capital != null ? (
                    <span className="text-[10px] tabular-nums text-ink-muted">
                      {it ? "Cap" : "Cap"} {Math.round(alert.capital).toLocaleString(it ? "it-IT" : "en-US")} €
                    </span>
                  ) : null}
                  {alert.pnlEur != null && Number.isFinite(alert.pnlEur) ? (
                    <span
                      className={`text-[10px] tabular-nums font-semibold ${
                        alert.pnlEur >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      P&L {alert.pnlEur >= 0 ? "+" : ""}
                      {Math.round(alert.pnlEur).toLocaleString(it ? "it-IT" : "en-US")} €
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="ml-auto rounded-md border border-indigo-300/70 bg-indigo-50/90 px-2.5 py-1 text-[10px] font-semibold text-indigo-900 hover:bg-indigo-100/90 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-200 transition"
                    onClick={() =>
                      onOpen24h({
                        ticker: alert.ticker,
                        cd: alert.completionDate !== "—" ? alert.completionDate : undefined,
                        rowKey: alert.key,
                      })
                    }
                  >
                    {t("simLoopTradeAlert.open24h")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-3 border-t border-[rgb(var(--border))]/40 flex justify-end">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            {t("simLoopTradeAlert.dismiss")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
