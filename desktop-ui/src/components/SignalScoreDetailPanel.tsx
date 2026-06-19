import { useMemo, useState } from "react";
import { extractCurveInputs } from "../sheet/precatCurve";
import type { SignAccuracyCurveView } from "../sheet/signAccuracyCurve";
import {
  computeScoreBreakdown,
  formatGapTooltip,
  gapMagnitudeTone,
  SCORE_COMPONENT_MAX,
  scoreReliabilityLegend,
  scoreReliabilityTier,
  scoreContributionTone,
  signedMetricTone,
  signalScoreTone,
  type ScoreBreakdown,
} from "../sheet/investSignalScore";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

export type ScoreDetailSignal = {
  ticker: string;
  cd: string;
  days: number | null;
  score: number;
  action: string;
  affid: number | null;
  r2: number | null;
  pred5: number | null;
  gapPct: number | null;
  simRow: Record<string, unknown>;
};

type ScoreRow = ScoreDetailSignal & { breakdown: ScoreBreakdown };

function fmtPts(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(v % 1 === 0 ? 0 : 1)}`;
}

function StackedScoreBar({ b }: { b: ScoreBreakdown }) {
  const posTotal = Math.max(
    1,
    b.affidScore +
      b.r2Score +
      b.timingScore +
      Math.max(0, b.slopeAlign) +
      Math.max(0, b.predScore) +
      Math.max(0, b.accuracyScore),
  );
  const segs = [
    { w: (b.affidScore / posTotal) * 100, cls: "bg-indigo-500", label: "Conf" },
    { w: (b.r2Score / posTotal) * 100, cls: "bg-violet-500", label: "R²" },
    { w: (b.timingScore / posTotal) * 100, cls: "bg-amber-500", label: "CD" },
  ];
  if (b.accuracyScore > 0) {
    segs.push({
      w: (b.accuracyScore / posTotal) * 100,
      cls: "bg-teal-500",
      label: "Acc",
    });
  }
  if (b.predScore > 0) {
    segs.push({
      w: (b.predScore / posTotal) * 100,
      cls: "bg-sky-500",
      label: "Pred",
    });
  }
  if (b.slopeAlign > 0) {
    segs.push({
      w: (b.slopeAlign / posTotal) * 100,
      cls: "bg-emerald-500",
      label: "Align",
    });
  }
  return (
    <div className="flex h-2.5 w-full min-w-[5rem] max-w-[9rem] rounded-full overflow-hidden bg-slate-200/80">
      {segs.map((s) =>
        s.w > 0.5 ? (
          <div
            key={s.label}
            className={`h-full ${s.cls}`}
            style={{ width: `${s.w}%` }}
            title={`${s.label} ${fmtPts(
              s.label === "Conf"
                ? b.affidScore
                : s.label === "R²"
                  ? b.r2Score
                  : s.label === "CD"
                    ? b.timingScore
                    : s.label === "Acc"
                      ? b.accuracyScore
                      : b.slopeAlign,
            )}`}
          />
        ) : null,
      )}
      {b.slopeAlign < 0 && (
        <div
          className="h-full bg-red-400/90 ml-auto shrink-0"
          style={{ width: `${Math.min(18, (Math.abs(b.slopeAlign) / 15) * 18)}%` }}
          title={`Contrarian ${fmtPts(b.slopeAlign)}`}
        />
      )}
    </div>
  );
}

export function SignalScoreDetailPanel({
  signals,
  focusTicker,
  onFocusConsumed,
  signCurveView,
}: {
  signals: ScoreDetailSignal[];
  focusTicker?: string | null;
  onFocusConsumed?: () => void;
  signCurveView?: SignAccuracyCurveView | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [sortBy, setSortBy] = useState<"total" | "ticker">("total");

  const rows = useMemo((): ScoreRow[] => {
    return signals.map((s) => {
      const { slope5d, slope20d } = extractCurveInputs(s.simRow);
      const breakdown = computeScoreBreakdown(
        s.affid,
        s.r2,
        s.pred5,
        s.days,
        slope5d,
        s.gapPct,
        slope20d,
        { signCurveView },
      );
      return { ...s, breakdown };
    });
  }, [signals, signCurveView]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortBy === "ticker") {
      copy.sort((a, b) => a.ticker.localeCompare(b.ticker));
    } else {
      copy.sort((a, b) => b.breakdown.total - a.breakdown.total || a.ticker.localeCompare(b.ticker));
    }
    return copy;
  }, [rows, sortBy]);

  const focusUp = focusTicker?.trim().toUpperCase() ?? null;

  const reliabilityLegend = useMemo(() => scoreReliabilityLegend(), []);
  const bandMins = [65, 50, 35, 22, 0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/30 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {it ? "Affidabilità della predizione (0–100)" : "Prediction reliability (0–100)"}
          </h3>
          <p className="text-[11px] text-ink-muted mt-1 leading-snug max-w-3xl">
            {it
              ? "Quanto puoi fidarti del modello su questo ticker oggi, prima del CD. Combina: qualità storica (Conf), fit curva (R²), direction hit empirico (Align), forward 5g e quanto il prezzo reale segue il modello."
              : "How much to trust the model on this ticker today, pre-CD. Combines: historical quality (Conf), curve fit (R²), empirical direction hit (Align), 5d forward and how well live price tracks the model."}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[10px]">
          {reliabilityLegend.map((band, i) => {
            const min = bandMins[i] ?? 0;
            const range =
              i === 0
                ? `≥${min}`
                : i === reliabilityLegend.length - 1
                  ? `<${bandMins[i - 1]}`
                  : `${min}–${bandMins[i - 1]! - 1}`;
            return (
              <div
                key={band.tier}
                className={`rounded-lg border px-2.5 py-2 min-w-0 ${band.badgeClass}`}
                title={it ? band.hintIt : band.hintEn}
              >
                <p className="font-semibold flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${band.barClass}`} />
                  <span className={band.textClass}>
                    {range} — {it ? band.labelIt : band.labelEn}
                  </span>
                </p>
                <p className="text-ink-muted mt-0.5 leading-snug">
                  {it ? band.hintIt : band.hintEn}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[10px] border-t border-[rgb(var(--border))]/30 pt-3">
          <LegendItem
            color="bg-indigo-500"
            title={it ? "Conf — Confidence" : "Conf — Confidence"}
            body={
              it
                ? "Affidabilità modello (0–100%) × 30 pt. Quanto il cohort storico supporta il segnale pre-CD."
                : "Model confidence (0–100%) × 30 pts. How much historical cohort supports the pre-CD signal."
            }
          />
          <LegendItem
            color="bg-violet-500"
            title="R² — Curve fit"
            body={
              it
                ? "Fit curva pre-CD (0–1) × 25 pt. Quanto il modello traccia il prezzo lungo la traiettoria verso CD."
                : "Pre-CD curve fit (0–1) × 25 pts. How well the model tracks price along the path to CD."
            }
          />
          <LegendItem
            color="bg-amber-500"
            title={it ? "Timing — Vicinanza CD" : "Timing — CD proximity"}
            body={
              it
                ? "Quanto il titolo è in finestra operativa pre-CD. Hot ≤60g → fino a 10 pt; watch 61–120g → 7–8.5 pt (monitoraggio attivo, non penalizzato)."
                : "How close to the operational pre-CD window. Hot ≤60d → up to 10 pts; watch 61–120d → 7–8.5 pts (active monitoring)."
            }
          />
          <LegendItem
            color="bg-emerald-500"
            title={it ? "Align — Direction hit% (coorte Simulation)" : "Align — Direction hit% (Simulation cohort)"}
            body={
              it
                ? "La pendenza osservata (5g, o 20g se 5g piatta) concorda con il forward Pred +5? Contrarian max −8 pt."
                : "Does observed slope (5d, or 20d if 5d flat) agree with forward Pred +5? Contrarian max −8 pts."
            }
          />
          <LegendItem
            color="bg-slate-400"
            title={it ? "Mix — Barra composizione" : "Mix — Composition bar"}
            body={
              it
                ? "Proporzione visiva Conf / R² / Timing / Align positivo. Segmento rosso = penalità contrarian."
                : "Visual share of Conf / R² / Timing / positive Align. Red segment = contrarian penalty."
            }
          />
          <LegendItem
            color="bg-sky-500"
            title="Pred — Pred +5"
            body={
              it
                ? `Δ curva oggi→+5 gg (pre-CD), max ${SCORE_COMPONENT_MAX.pred} pt, |pred|×trust×allineamento. Mai ancora post-CD.`
                : `Curve delta today→+5d (pre-CD), max ${SCORE_COMPONENT_MAX.pred} pts, |pred|×trust×alignment. Never post-CD anchor.`
            }
          />
          <LegendItem
            color="bg-teal-500"
            title={it ? "Acc — Price accuracy coorte · Gap % — scostamento live oggi" : "Acc — Cohort price accuracy · Gap % — live deviation today"}
            body={
              it
                ? "Acc = price accuracy empirica (coorte Simulation, grafico «2 · Price accuracy»). Gap % = scostamento live oggi vs modello (informativo; piccola correzione su Acc se molto lontano)."
                : "Acc = empirical price accuracy (Simulation cohort, «2 · Price accuracy» chart). Gap % = live deviation vs model today (informational; small Acc adjustment if very far)."
            }
          />
          <LegendItem
            color="bg-[rgb(var(--accent))]"
            title="Tot — Score totale"
            body={
              it
                ? "Conf + R² + Timing + Align + Pred + Acc (max ~110, cap 100). Valuta fedeltà modello pre-CD, non esito post-CD."
                : "Conf + R² + Timing + Align + Pred + Acc (max ~110, cap 100). Pre-CD model fidelity, not post-CD outcome."
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
          {sorted.length} {it ? "ticker" : "tickers"}
        </span>
        <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30 ml-auto">
          <button
            type="button"
            className={sortBy === "total" ? "seg-btn-active" : "seg-btn"}
            onClick={() => setSortBy("total")}
          >
            {it ? "Score ↓" : "Score ↓"}
          </button>
          <button
            type="button"
            className={sortBy === "ticker" ? "seg-btn-active" : "seg-btn"}
            onClick={() => setSortBy("ticker")}
          >
            A→Z
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-[rgb(var(--border))]/50 max-h-[min(70vh,640px)]">
        <table className={`${SHEET_GRID_TABLE_CLASS} min-w-[52rem] text-xs border-collapse`}>
          <SheetGridColgroup columnCount={11} />
          <thead className="sticky top-0 z-[1] bg-[rgb(var(--surface-elevated))] shadow-[0_1px_0_rgb(var(--border)/0.4)]">
            <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
              <th className={gridTh("left", "py-2 font-medium")}>Ticker</th>
              <th className={gridTh("left", "py-2 font-medium")}>CD</th>
              <th className={gridTh("center", "py-2 font-medium")}>Tot</th>
              <th className={gridTh("center", "py-2 font-medium")}>Conf</th>
              <th className={gridTh("center", "py-2 font-medium")}>R²</th>
              <th className={gridTh("center", "py-2 font-medium")}>Timing</th>
              <th className={gridTh("center", "py-2 font-medium")}>Align</th>
              <th className={gridTh("center", "py-2 font-medium")}>Pred</th>
              <th className={gridTh("center", "py-2 font-medium")}>Acc</th>
              <th className={`${gridTh("left", "py-2 font-medium")} min-w-[8rem]`}>
                {it ? "Mix" : "Mix"}
              </th>
              <th className={gridTh("center", "py-2 font-medium")}>Gap %</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const b = r.breakdown;
              const highlighted = focusUp != null && r.ticker.toUpperCase() === focusUp;
              return (
                <tr
                  key={`${r.ticker}-${r.cd}`}
                  className={`border-t border-[rgb(var(--border))]/25 transition-colors ${
                    highlighted
                      ? "bg-[rgb(var(--accent))]/10 ring-1 ring-inset ring-[rgb(var(--accent))]/30"
                      : "hover:bg-[rgb(var(--surface-3))]/15"
                  }`}
                  onAnimationEnd={() => {
                    if (highlighted) onFocusConsumed?.();
                  }}
                >
                  <td className={`${gridTd("left", "py-2.5")} font-bold`}>{r.ticker}</td>
                  <td className={`${gridTd("left", "py-2.5")} text-ink-muted whitespace-nowrap`}>
                    {r.cd}
                    {r.days != null && (
                      <span className="block text-[9px] text-ink-muted/70">{r.days}d</span>
                    )}
                  </td>
                  <td className={`${gridTd("center", "py-2.5")}`}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`font-bold tabular-nums ${signalScoreTone(b.total)}`}>
                        {b.total}
                      </span>
                      <span
                        className={`text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${scoreReliabilityTier(b.total).badgeClass}`}
                      >
                        {it
                          ? scoreReliabilityTier(b.total).labelIt
                          : scoreReliabilityTier(b.total).labelEn}
                      </span>
                    </div>
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${scoreContributionTone(b.affidScore, SCORE_COMPONENT_MAX.affid)}`}
                    title={it ? `Confidence × ${SCORE_COMPONENT_MAX.affid}` : `Confidence × ${SCORE_COMPONENT_MAX.affid}`}
                  >
                    {fmtPts(b.affidScore)}
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${scoreContributionTone(b.r2Score, SCORE_COMPONENT_MAX.r2)}`}
                    title={it ? `R² × ${SCORE_COMPONENT_MAX.r2}` : `R² × ${SCORE_COMPONENT_MAX.r2}`}
                  >
                    {fmtPts(b.r2Score)}
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${scoreContributionTone(b.timingScore, SCORE_COMPONENT_MAX.timing)}`}
                    title={b.timingLabel}
                  >
                    {fmtPts(b.timingScore)}
                    {r.days != null && r.days > 0 ? (
                      <span className="block text-[9px] text-ink-muted/70 font-normal">{r.days}g</span>
                    ) : null}
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${signedMetricTone(b.slopeAlign)}`}
                    title={b.slopeAlignLabel}
                  >
                    {fmtPts(b.slopeAlign)}
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${scoreContributionTone(
                      b.predScore,
                      SCORE_COMPONENT_MAX.pred,
                    )}`}
                    title={b.predLabel}
                  >
                    {fmtPts(b.predScore)}
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${scoreContributionTone(
                      b.accuracyScore,
                      SCORE_COMPONENT_MAX.accuracy,
                    )}`}
                    title={b.accuracyLabel}
                  >
                    {fmtPts(b.accuracyScore)}
                  </td>
                  <td className={gridTd("left", "py-2.5")}>
                    <StackedScoreBar b={b} />
                  </td>
                  <td
                    className={`${gridTd("center", "py-2.5")} ${
                      r.gapPct != null ? gapMagnitudeTone(r.gapPct) : "text-ink-muted"
                    }`}
                    title={formatGapTooltip(r.gapPct, it ? "it" : "en", {
                      days: r.days,
                      signCurveView,
                    })}
                  >
                    {r.gapPct != null ? `${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-ink-muted">
                  {it ? "Nessun segnale." : "No signals."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LegendItem({
  color,
  title,
  body,
}: {
  color: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/30 bg-white/60 px-2.5 py-2 min-w-0">
      <p className="font-semibold text-ink flex items-center gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color}`} />
        {title}
      </p>
      <p className="text-ink-muted mt-0.5 leading-snug">{body}</p>
    </div>
  );
}
