import type { MIGResult } from "../sheet/marketInterestGate";
import { miiModelGapPct } from "../sheet/marketInterestGate";
import { fmtPortfolioPnlPct, fmtSignedUsdPnl, portfolioPnlTextClass } from "../sheet/portfolioGainLossStyle";
import { useLang, useT } from "../shared/i18n";
import {
  GAP_ARC_COLOR,
  MigSlopeLegendBar,
  MigTripleSlopeGlyph,
  fmtDeg,
  migPrePostSlopesSame,
} from "./MigCalibVisual";

function MetricTile({
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
    <div className="rounded-lg border border-slate-200/70 bg-white/85 px-2 py-1.5 min-w-0 shadow-sm">
      <p className="text-[8px] uppercase tracking-wide text-ink-muted truncate">{label}</p>
      <p
        className={`text-[11px] font-bold tabular-nums mt-0.5 truncate${className ? ` ${className}` : ""}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** Embedded Market vs model slopes diagram (24h assessment / MII panel). */
export function MigMarketModelSlopesCard({
  row,
  pnlPct24h,
  pnlEur24h,
  embedded = false,
}: {
  row: MIGResult | null;
  pnlPct24h?: number | null;
  pnlEur24h?: number | null;
  /** Tile 24h assessment — riempie l'area grafico (200px) come gli altri chart. */
  embedded?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  if (!row) {
    return embedded ? (
      <div className="h-full w-full min-h-0 flex items-center justify-center px-2">
        <p className="text-xs text-ink-muted text-center">
          {it ? "Dati MII / calibrazione non disponibili." : "MII / calibration data unavailable."}
        </p>
      </div>
    ) : (
      <p className="text-xs text-ink-muted py-6 text-center">
        {it ? "Dati MII / calibrazione non disponibili." : "MII / calibration data unavailable."}
      </p>
    );
  }

  const gapPre = miiModelGapPct(row.slopeAngleDeg, row.calibPreDaily.modelSlopeAngleDeg);
  const gapPost = miiModelGapPct(row.slopeAngleDeg, row.calibPostDaily.modelSlopeAngleDeg);
  const calibScore = row.calibPreDaily.calibrationScore;
  const samePrePost = migPrePostSlopesSame(
    row.calibPreDaily.modelSlopeAngleDeg,
    row.calibPostDaily.modelSlopeAngleDeg,
  );
  const modelAngle = samePrePost
    ? row.calibPostDaily.modelSlopeAngleDeg ?? row.calibPreDaily.modelSlopeAngleDeg
    : null;
  const pnl24Class =
    pnlPct24h != null ? portfolioPnlTextClass(pnlEur24h ?? null, pnlPct24h) : undefined;

  if (embedded) {
    const gap = gapPost ?? gapPre;
    const summary = samePrePost
      ? `MII ${fmtDeg(row.slopeAngleDeg)} · ${it ? "mod." : "mdl."} ${
          modelAngle != null ? fmtDeg(modelAngle) : "—"
        } · Δ ${gap != null ? `${gap.toFixed(0)}%` : "—"}`
      : `MII ${fmtDeg(row.slopeAngleDeg)} · pre ${
          row.calibPreDaily.modelSlopeAngleDeg != null
            ? fmtDeg(row.calibPreDaily.modelSlopeAngleDeg)
            : "—"
        } · post ${
          row.calibPostDaily.modelSlopeAngleDeg != null
            ? fmtDeg(row.calibPostDaily.modelSlopeAngleDeg)
            : "—"
        }`;
    const summaryFull =
      calibScore != null ? `${summary} · cal ${calibScore.toFixed(0)}` : summary;

    return (
      <div className="h-full w-full min-h-0" title={summaryFull}>
        <MigTripleSlopeGlyph
          miiAngleDeg={row.slopeAngleDeg}
          preAngleDeg={row.calibPreDaily.modelSlopeAngleDeg}
          postAngleDeg={row.calibPostDaily.modelSlopeAngleDeg}
          variant="tile"
          fitContainer
          showAngleLabels
          showInlineLegend={false}
          showGapArc
          gapPctPre={gapPre}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MigTripleSlopeGlyph
        miiAngleDeg={row.slopeAngleDeg}
        preAngleDeg={row.calibPreDaily.modelSlopeAngleDeg}
        postAngleDeg={row.calibPostDaily.modelSlopeAngleDeg}
        variant="large"
        showAngleLabels
        showInlineLegend={false}
        showGapArc
        gapPctPre={gapPre}
        size={320}
      />
      <MigSlopeLegendBar lang={it ? "it" : "en"} samePrePost={samePrePost} />
      <div className="grid grid-cols-2 gap-1.5">
        <MetricTile label={it ? "MII mercato" : "Market MII"} value={fmtDeg(row.slopeAngleDeg)} />
        <MetricTile
          label={t("signals.mig.col.pnl24h")}
          value={
            pnlPct24h != null
              ? `${fmtPortfolioPnlPct(pnlPct24h)}${
                  pnlEur24h != null ? ` · ${fmtSignedUsdPnl(pnlEur24h)}` : ""
                }`
              : "—"
          }
          className={pnl24Class}
        />
        {samePrePost ? (
          <>
            <MetricTile
              label={it ? "Modello ricalibrato" : "Recalibrated model"}
              value={modelAngle != null ? fmtDeg(modelAngle) : "—"}
            />
            <MetricTile
              label={it ? "Gap modello → MII" : "Gap model → MII"}
              value={gapPost != null ? `${gapPost.toFixed(0)}%` : "—"}
              accent={GAP_ARC_COLOR}
            />
            <MetricTile
              label={it ? "Calib modello ≈ MII" : "Model calib ≈ MII"}
              value={calibScore != null ? `${calibScore.toFixed(0)}/100` : "—"}
            />
          </>
        ) : (
          <>
            <MetricTile
              label={it ? "Modello pre" : "Model pre"}
              value={
                row.calibPreDaily.modelSlopeAngleDeg != null
                  ? fmtDeg(row.calibPreDaily.modelSlopeAngleDeg)
                  : "—"
              }
            />
            <MetricTile
              label={it ? "Modello post" : "Model post"}
              value={
                row.calibPostDaily.modelSlopeAngleDeg != null
                  ? fmtDeg(row.calibPostDaily.modelSlopeAngleDeg)
                  : "—"
              }
            />
            <MetricTile
              label={it ? "Gap pre → MII" : "Gap pre → MII"}
              value={gapPre != null ? `${gapPre.toFixed(0)}%` : "—"}
              accent={GAP_ARC_COLOR}
            />
            <MetricTile
              label={it ? "Calib pre ≈ MII" : "Calib pre ≈ MII"}
              value={calibScore != null ? `${calibScore.toFixed(0)}/100` : "—"}
            />
            <MetricTile
              label={it ? "Gap post → MII" : "Gap post → MII"}
              value={gapPost != null ? `${gapPost.toFixed(0)}%` : "—"}
              accent={gapPost != null && gapPost > 50 ? GAP_ARC_COLOR : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
