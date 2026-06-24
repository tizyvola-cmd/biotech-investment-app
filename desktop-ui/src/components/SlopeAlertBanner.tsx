import { useState } from "react";
import { useLang, useT, type TranslationKey } from "../shared/i18n";
import type { SlopeAlertRow } from "../sheet/slopePositionAlerts";
import {
  SLOPE_BANNER_MAX_ACCEL,
  SLOPE_BANNER_MAX_ERRORS,
  sliceSlopeAlertsForBanner,
} from "../sheet/slopePositionAlerts";
import { slopeThresholdSummary } from "../sheet/slopeThresholds";
import { fmtSlopeCapitalLossEur } from "../sheet/slopeStockPrices";
import { SlopeTrendDiagram } from "./SlopeTrendDiagram";

export function SlopeAlertBanner({
  alerts,
  onOpenSlopeErrorCharts,
  onNavigateToSimulation,
  compact = false,
}: {
  alerts: SlopeAlertRow[];
  onOpenSlopeErrorCharts?: (ticker?: string) => void;
  /** Simulation → riga ticker (sell per uscita / errori pendenza). */
  onNavigateToSimulation?: (ticker: string, action: "buy" | "sell", cd?: string) => void;
  /** Header Decision Lab: compatto sotto il sottotitolo. */
  compact?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const [dismissed, setDismissed] = useState(false);
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  const slice = sliceSlopeAlertsForBanner(
    alerts,
    compact ? SLOPE_BANNER_MAX_ERRORS : 32,
    compact ? SLOPE_BANNER_MAX_ACCEL : 16,
  );
  const { shown, errorRows, accelRows, hiddenErrors, hiddenAccels, totalErrors, totalAccels } =
    slice;

  if (!shown.length) return null;
  if (dismissed) return null;

  const hasErrors = errorRows.length > 0;
  const hasAccels = accelRows.length > 0;
  const hiddenTotal = hiddenErrors + hiddenAccels;

  const summaryKey: TranslationKey =
    shown.length === 1 ? "signals.slope.summary.singular" : "signals.slope.summary.plural";

  const shell = compact
    ? hasErrors
      ? "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/[0.06]"
      : "border-[rgb(var(--signal-up))]/25 bg-[rgb(var(--signal-up))]/[0.05]"
    : hasErrors
      ? "border-[rgb(var(--signal-down))]/40 bg-[rgb(var(--signal-down))]/5"
      : "border-[rgb(var(--signal-up))]/30 bg-[rgb(var(--signal-up))]/5";

  function renderRow(a: SlopeAlertRow) {
    const isRev = a.kind === "reversal";
    const isContrarian = a.kind === "contrarian";
    const isAcc = a.kind === "acceleration";
    const icon = isRev ? "🔴" : isContrarian ? "🔵" : isAcc ? "🟢" : "🟠";
    const color = isRev
      ? "text-[rgb(var(--signal-down))]"
      : isContrarian
        ? "text-[rgb(var(--accent))]"
        : isAcc
          ? "text-[rgb(var(--signal-up))]"
          : "text-[rgb(var(--warn))]";
    const descr = isRev
      ? t("signals.slope.descr.reversal", { s5: fmt(a.slope5d), s20: fmt(a.slope20d) })
      : isContrarian
        ? t("signals.slope.descr.contrarian", { s5: fmt(a.slope5d) })
        : isAcc
          ? t("signals.slope.descr.acceleration", { d: fmt(a.delta) })
          : t("signals.slope.descr.deceleration", { d: fmt(a.delta) });
    const action = isRev
      ? t("signals.slope.action.exit")
      : isContrarian
        ? t("signals.slope.action.contrarian")
        : isAcc
          ? t("signals.slope.action.acceleration")
          : t("signals.slope.action.keepMonitoring");

    const showConsiderExitLink = !!onNavigateToSimulation && !isAcc;

    const diagramTitle = `${a.ticker}: 20d ${fmt(a.slope20d)} → 5d ${fmt(a.slope5d)} pp/d`;

    return (
      <div
        key={`${a.kind}-${a.ticker}-${a.cd}`}
        className={`flex items-center gap-2 ${compact ? "text-[10px] leading-snug" : "text-[11px]"}`}
      >
        <div className="flex items-baseline gap-1.5 flex-wrap min-w-0 flex-1">
          <span>{icon}</span>
          {onOpenSlopeErrorCharts ? (
            <button
              type="button"
              onClick={() => onOpenSlopeErrorCharts(a.ticker)}
              className={`font-bold ${color} hover:underline underline-offset-2`}
              title={t("signals.slope.openChartsTicker")}
            >
              {a.ticker}
            </button>
          ) : (
            <span className={`font-bold ${color}`}>{a.ticker}</span>
          )}
          <span className="text-ink-muted">
            {descr}
            {a.capitalLossEur != null && a.capitalEur != null && a.capitalEur > 0 ? (
              <>
                {" · "}
                <span
                  className={
                    a.capitalLossEur < 0
                      ? "font-semibold text-[rgb(var(--signal-down))] tabular-nums"
                      : "tabular-nums"
                  }
                  title={t("signals.slope.col.capitalLoss.body")}
                >
                  {t("signals.slope.banner.capitalLoss", {
                    loss: fmtSlopeCapitalLossEur(a.capitalLossEur, lang),
                  })}
                </span>
              </>
            ) : null}
            {showConsiderExitLink ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() =>
                    onNavigateToSimulation!(a.ticker, "sell", a.cd)
                  }
                  className="font-semibold text-[rgb(var(--signal-down))] hover:underline underline-offset-2"
                  title={t("signals.slope.link.considerExitTip")}
                >
                  ↩ {t("signals.card.considerExit")}
                </button>
              </>
            ) : (
              action
            )}
          </span>
        </div>
        <SlopeTrendDiagram
          slope5d={a.slope5d}
          slope20d={a.slope20d}
          variant={compact ? "mini" : "default"}
          title={diagramTitle}
        />
        {a.days != null && a.days >= 0 && (
          <span
            className={`text-ink-muted/50 shrink-0 tabular-nums ${
              compact ? "text-[9px]" : "text-[10px]"
            }`}
          >
            {t("signals.slope.cdInDays", { n: a.days })}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`border ${shell} ${
        compact
          ? "rounded-lg px-2.5 py-1.5 mt-1.5 space-y-1 max-w-full"
          : "rounded-xl px-4 py-3 space-y-2"
      }`}
    >
      <p
        className={`font-semibold flex items-center gap-1 flex-wrap ${
          compact ? "text-[10px] leading-tight" : "text-xs"
        } ${hasErrors ? "text-[rgb(var(--signal-down))]" : "text-[rgb(var(--signal-up))]"}`}
      >
        {hasErrors ? (
          <span className={compact ? "text-sm" : "animate-pulse text-base"}>⚠️</span>
        ) : (
          <span className={compact ? "text-sm" : "text-base"}>📈</span>
        )}
        <span>
          {hasErrors ? t("signals.slope.title.error") : t("signals.slope.title.rise")}
        </span>
        <span className="font-normal text-ink-muted">
          {t(summaryKey, { n: shown.length })}
          {compact && (totalErrors + totalAccels > shown.length) ? (
            <span className="ml-0.5">
              {t("signals.slope.summary.pool", {
                total: totalErrors + totalAccels,
                errors: totalErrors,
                accels: totalAccels,
              })}
            </span>
          ) : null}
        </span>
        {onOpenSlopeErrorCharts && (
          <button
            type="button"
            onClick={() => onOpenSlopeErrorCharts()}
            className="text-[10px] font-semibold text-accent hover:text-accent/80 underline underline-offset-2 transition"
          >
            {t("signals.slope.openCharts")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={`ml-auto text-ink-muted/50 hover:text-ink-muted transition leading-none ${
            compact ? "text-sm" : "text-base"
          }`}
          title={lang === "it" ? "Chiudi" : "Close"}
        >
          ×
        </button>
      </p>

      <div className={compact ? "space-y-0.5" : "space-y-1.5"}>
        {errorRows.map(renderRow)}
        {hasAccels ? (
          <>
            {hasErrors ? (
              <p
                className={`${
                  compact ? "text-[9px] pt-0.5" : "text-[10px] pt-1"
                } uppercase tracking-wide font-semibold text-[rgb(var(--signal-up))]/90`}
              >
                {t("signals.slope.section.rise")}
              </p>
            ) : null}
            {accelRows.map(renderRow)}
          </>
        ) : null}
        {hiddenTotal > 0 && onOpenSlopeErrorCharts ? (
          <button
            type="button"
            onClick={() => onOpenSlopeErrorCharts()}
            className="text-[10px] text-accent hover:underline"
          >
            {t("signals.slope.moreHidden", {
              n: hiddenTotal,
              errors: hiddenErrors,
              accels: hiddenAccels,
            })}
          </button>
        ) : null}
      </div>

      {!compact ? (
        <p className="text-[10px] text-ink-muted/50 border-t border-[rgb(var(--border))]/20 pt-1.5">
          {slopeThresholdSummary(lang)}
          {onOpenSlopeErrorCharts && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => onOpenSlopeErrorCharts()}
                className="text-accent hover:underline underline-offset-2"
              >
                {t("signals.slope.openCharts")}
              </button>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
