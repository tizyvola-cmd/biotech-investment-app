import type { MIGResult } from "../sheet/marketInterestGate";
import { miiModelGapPct } from "../sheet/marketInterestGate";
import { fmtPortfolioPnlPct, fmtSignedUsdPnl, portfolioPnlTextClass } from "../sheet/portfolioGainLossStyle";
import { useLang, useT } from "../shared/i18n";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { GAP_ARC_COLOR, MigCalibPie, MigSlopeLegendBar, MigTripleSlopeGlyph, fmtDeg, migPrePostSlopesSame } from "./MigCalibVisual";

function fmtRefresh(iso: string | null | undefined, lang: "it" | "en"): string {
  if (!iso) {
    return lang === "it" ? "Refresh Simulation non disponibile" : "Simulation refresh unavailable";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function MigCalibModal({
  open,
  onClose,
  row,
  priceRefreshAt,
  chartsUpdatedAt,
  changePct24h,
  pnlEur24h,
}: {
  open: boolean;
  onClose: () => void;
  row: MIGResult | null;
  priceRefreshAt?: string | null;
  chartsUpdatedAt?: string | null;
  changePct24h?: number | null;
  pnlEur24h?: number | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  if (!open || !row) return null;

  const gapPre = miiModelGapPct(row.slopeAngleDeg, row.calibPreDaily.modelSlopeAngleDeg);
  const gapPost = miiModelGapPct(row.slopeAngleDeg, row.calibPostDaily.modelSlopeAngleDeg);
  const refreshLabel = priceRefreshAt ?? chartsUpdatedAt ?? null;
  const calibScore = row.calibPreDaily.calibrationScore;
  const samePrePost = migPrePostSlopesSame(
    row.calibPreDaily.modelSlopeAngleDeg,
    row.calibPostDaily.modelSlopeAngleDeg,
  );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="mig-calib-modal-title"
      panelClassName="w-full max-w-xl flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
    >
      <div className="flex items-start gap-2.5 border-b border-slate-200/80 px-3 py-2.5 dark:border-slate-700 shrink-0">
        <MigCalibPie score={calibScore} tier={row.calibPreDaily.calibrationTier} size={44} />
        <div className="flex-1 min-w-0">
          <h2 id="mig-calib-modal-title" className="text-sm font-bold leading-tight">
            {t("signals.mig.calibModal.title", { ticker: row.ticker })}
          </h2>
          <p className="text-[10px] text-ink-muted mt-0.5 leading-snug line-clamp-2">
            {t("signals.mig.calibModal.subtitle")}
          </p>
          <p className="text-[9px] text-ink-muted mt-0.5">
            {row.cd ? `CD ${row.cd}` : ""}
            {row.daysToCd != null ? ` · T−${row.daysToCd}d` : ""}
            {" · "}
            {t("signals.mig.calibModal.refresh", { at: fmtRefresh(refreshLabel, lang === "it" ? "it" : "en") })}
          </p>
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5 min-h-0">
        <section className="invest-trend-chart-panel rounded-lg border p-2 sm:p-2.5 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
            {t("signals.mig.calibModal.slopeChart")}
          </p>
          <MigTripleSlopeGlyph
            miiAngleDeg={row.slopeAngleDeg}
            preAngleDeg={row.calibPreDaily.modelSlopeAngleDeg}
            postAngleDeg={row.calibPostDaily.modelSlopeAngleDeg}
            variant="large"
            showAngleLabels
            showInlineLegend={false}
            showGapArc
            gapPctPre={gapPre}
            size={280}
          />
        </section>

        <MigSlopeLegendBar lang={lang === "it" ? "it" : "en"} samePrePost={samePrePost} />

        <section className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
          <MetricCard label={it ? "MII mercato" : "Market MII"} value={fmtDeg(row.slopeAngleDeg)} />
          <MetricCard
            label={t("signals.mig.col.pnl24h")}
            value={
              changePct24h != null
                ? `${fmtPortfolioPnlPct(changePct24h)}${
                    pnlEur24h != null ? ` · ${fmtSignedUsdPnl(pnlEur24h)}` : ""
                  }`
                : "—"
            }
            className={
              changePct24h != null ? portfolioPnlTextClass(pnlEur24h ?? null, changePct24h) : undefined
            }
          />
          <MetricCard
            label={samePrePost ? (it ? "Modello" : "Model") : it ? "Modello pre" : "Model pre"}
            value={row.calibPreDaily.modelSlopeAngleDeg != null ? fmtDeg(row.calibPreDaily.modelSlopeAngleDeg) : "—"}
          />
          {!samePrePost ? (
            <MetricCard
              label={it ? "Modello post" : "Model post"}
              value={row.calibPostDaily.modelSlopeAngleDeg != null ? fmtDeg(row.calibPostDaily.modelSlopeAngleDeg) : "—"}
            />
          ) : null}
          <MetricCard
            label={it ? "Gap → MII" : "Gap → MII"}
            value={gapPre != null ? `${gapPre.toFixed(0)}%` : "—"}
            accent={GAP_ARC_COLOR}
          />
          <MetricCard
            label={it ? "Calib ≈ MII" : "Calib ≈ MII"}
            value={calibScore != null ? `${calibScore.toFixed(0)}/100` : "—"}
          />
          {!samePrePost && gapPost != null && gapPost !== gapPre ? (
            <MetricCard
              label={it ? "Gap post → MII" : "Gap post → MII"}
              value={`${gapPost.toFixed(0)}%`}
              accent={gapPost > 50 ? GAP_ARC_COLOR : undefined}
            />
          ) : null}
        </section>

        <p className="text-[9px] text-ink-muted leading-snug border-t border-slate-200/60 dark:border-slate-700 pt-2">
          {t("signals.mig.calibModal.dailyNote")}
        </p>
      </div>
    </AppModal>
  );
}

function MetricCard({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: string;
  accent?: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-3))]/25 px-2 py-1.5">
      <p className="text-[8px] uppercase tracking-wide text-ink-muted leading-tight">{label}</p>
      <p
        className={`text-xs font-bold tabular-nums mt-0.5${className ? ` ${className}` : ""}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
