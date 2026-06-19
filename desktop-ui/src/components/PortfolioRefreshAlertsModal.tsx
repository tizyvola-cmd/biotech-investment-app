import type { PortfolioRefreshAlert, PortfolioSummaryTotals } from "../sheet/portfolioRefreshAlerts";
import { useT } from "../shared/i18n";

function resolveAlertDetailVars(
  vars: Record<string, string | number> | undefined,
  t: ReturnType<typeof useT>
): Record<string, string | number> {
  const out = { ...(vars ?? {}) };
  const cdDays = out.cdDays;
  if (cdDays != null && typeof cdDays === "number") {
    out.cdSuffix = t("portfolioRefresh.alert.takeProfit.cdSuffix", { days: cdDays });
    delete out.cdDays;
  }
  if (out.cdSuffix === undefined) out.cdSuffix = "";
  return out;
}

const CAT_ICON: Record<string, string> = {
  direction: "↔",
  curve_direction: "📈",
  acceleration: "⚡",
  deceleration: "🟠",
  reversal: "🔴",
  buy_urgent: "🟢",
  buy_opportunity: "💡",
  sell_urgent: "🛑",
  sell_exit: "↩",
  pnl: "💹",
  new_position: "💼",
  closed_position: "📤",
  new_simulation_row: "🆕",
  cd_changed: "📅",
  new_biotech_ticker: "🧬",
  clinical_feed: "🧬",
  sustained_decline: "📉",
};

export function PortfolioRefreshAlertsModal({
  open,
  alerts,
  summaryTotals,
  onClose,
  titleKey = "portfolioRefresh.modal.title",
  subtitleKey = "portfolioRefresh.modal.subtitle",
  headerSummary,
  onOpenClinicalFeed,
}: {
  open: boolean;
  alerts: PortfolioRefreshAlert[];
  summaryTotals?: PortfolioSummaryTotals | null;
  onClose: () => void;
  titleKey?: import("../shared/i18n").TranslationKey;
  subtitleKey?: import("../shared/i18n").TranslationKey;
  headerSummary?: string | null;
  onOpenClinicalFeed?: (ticker: string) => void;
}) {
  const t = useT();
  if (!open) return null;

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warning = alerts.filter((a) => a.severity === "warning").length;

  const sevLabel = {
    critical: t("portfolioRefresh.severity.urgent"),
    warning: t("portfolioRefresh.severity.attention"),
    info: t("portfolioRefresh.severity.update"),
  } as const;

  const sevStyles = {
    critical: {
      border: "border-[rgb(var(--signal-down))]/50",
      badge: "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))]",
    },
    warning: {
      border: "border-[rgb(var(--warn))]/45",
      badge: "bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))]",
    },
    info: {
      border: "border-[rgb(var(--accent))]/40",
      badge: "bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]",
    },
  } as const;

  const summaryLine =
    summaryTotals && summaryTotals.n > 0
      ? t("portfolioRefresh.summary.now", {
          value: summaryTotals.value.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          capital: summaryTotals.capital.toLocaleString("en-US", { maximumFractionDigits: 0 }),
          pnlPct: `${summaryTotals.pnlPct >= 0 ? "+" : ""}${summaryTotals.pnlPct.toFixed(2)}%`,
          n: summaryTotals.n,
        })
      : summaryTotals
        ? t("portfolioRefresh.summary.noPositions")
        : undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="portfolio-refresh-alerts-title"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 border-b border-[rgb(var(--border))]/60 px-4 py-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 id="portfolio-refresh-alerts-title" className="text-base font-semibold text-ink">
              {t(titleKey)}
            </h2>
            <p className="text-xs text-ink-muted mt-1 leading-snug">
              {t(subtitleKey)}
            </p>
            {headerSummary ? (
              <p className="text-[11px] text-ink mt-1.5 leading-snug font-medium">{headerSummary}</p>
            ) : null}
            {summaryLine ? (
              <p className="text-[11px] text-ink-muted mt-1.5 tabular-nums">{summaryLine}</p>
            ) : null}
            {alerts.length > 0 ? (
              <p className="text-[11px] mt-1.5">
                {critical > 0 && (
                  <span className="text-[rgb(var(--signal-down))] font-semibold mr-2">
                    {t("portfolioRefresh.count.urgent", { n: critical })}
                  </span>
                )}
                {warning > 0 && (
                  <span className="text-[rgb(var(--warn))] font-medium">
                    {t("portfolioRefresh.count.warnings", { n: warning })}
                  </span>
                )}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-ghost text-xs shrink-0 px-2"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {alerts.length === 0 ? (
            <p className="text-sm text-ink-muted py-6 text-center">
              {t("portfolioRefresh.modal.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => {
                const sty = sevStyles[a.severity];
                const detailVars = resolveAlertDetailVars(a.detailVars, t);
                return (
                  <li
                    key={a.id}
                    className={`rounded-lg border px-3 py-2.5 ${sty.border} bg-[rgb(var(--surface))]/80`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5" aria-hidden>
                        {CAT_ICON[a.category] ?? "•"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                          <span className="font-semibold text-sm text-ink">{a.ticker}</span>
                          <span className="text-[10px] text-ink-muted truncate">{a.cd}</span>
                          <span
                            className={`text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${sty.badge}`}
                          >
                            {sevLabel[a.severity]}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-ink leading-snug">
                          {t(a.titleKey, a.titleVars)}
                        </p>
                        <p className="text-xs text-ink-muted mt-0.5 leading-snug">
                          {t(a.detailKey, detailVars)}
                        </p>
                        {a.feedSummary ? (
                          <p className="text-[11px] text-ink mt-1 leading-snug">{a.feedSummary}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                          {a.clinicalFeedTicker && onOpenClinicalFeed ? (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-accent hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenClinicalFeed(a.clinicalFeedTicker!);
                                onClose();
                              }}
                            >
                              {t("clinicalFeedRefresh.alert.openFeed")}
                            </button>
                          ) : null}
                          {a.linkUrl ? (
                            <a
                              href={a.linkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-medium text-accent hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {a.linkLabel
                                ? t("clinicalFeedRefresh.alert.sourceLink", { label: a.linkLabel })
                                : t("clinicalFeedRefresh.alert.sourceLinkDefault")}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[rgb(var(--border))]/60 px-4 py-3 shrink-0 flex justify-end">
          <button type="button" className="btn text-sm px-4" onClick={onClose}>
            {t("portfolioRefresh.modal.gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
