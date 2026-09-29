import { useMemo } from "react";
import type { SignalCalibrationDoc, SignalLiveRow } from "../data/signalCalibrationData";
import {
  buildPreCdSignalsNarrative,
  resolvePreCdTrendVisual,
} from "../sheet/preCdSignalsNarrative";
import type { PreCdSignalsScope } from "../sheet/preCdSignalsScope";
import { TrendNarrativeSummaryBox } from "./LearningTrendUi";
import { useLang } from "../shared/i18n";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function MetricPill({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 px-2.5 py-2 min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted truncate">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink">{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums">{sub}</p> : null}
    </div>
  );
}

export function PreCdSignalsNarrativeCard({
  doc,
  liveRows,
  usingSimPreview,
  loading,
  scope = "preCdRunup",
}: {
  doc: SignalCalibrationDoc | null;
  liveRows: SignalLiveRow[];
  usingSimPreview: boolean;
  loading?: boolean;
  scope?: PreCdSignalsScope;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const narrative = useMemo(
    () => buildPreCdSignalsNarrative(doc, liveRows, usingSimPreview, lang, scope),
    [doc, liveRows, usingSimPreview, lang, scope],
  );

  const trendVisual = useMemo(
    () => resolvePreCdTrendVisual(doc, liveRows, usingSimPreview),
    [doc, liveRows, usingSimPreview],
  );

  if (loading) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center rounded-xl border border-dashed border-[rgb(var(--border))]/50">
        {it ? "Caricamento segnali pre-CD…" : "Loading pre-CD signals…"}
      </p>
    );
  }

  const { kpis } = narrative;

  return (
    <div className="space-y-3 shrink-0">
      <TrendNarrativeSummaryBox
        headline={narrative.headline}
        whatHappened={narrative.whatHappened}
        modelImpact={narrative.modelImpact}
        visual={trendVisual}
        it={it}
        impactHeading={it ? "Cosa fare adesso" : "What to do next"}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricPill
          label={it ? "Live adesso" : "Live now"}
          value={`${kpis.liveActionable} / ${kpis.liveTotal}`}
          sub={
            kpis.liveStrong + kpis.liveUseful > 0
              ? `${kpis.liveStrong}S · ${kpis.liveUseful}U`
              : it
                ? "actionable"
                : "actionable"
          }
        />
        <MetricPill
          label={it ? "Hit Useful" : "Useful hit"}
          value={fmtPct(kpis.usefulHitPct)}
          sub={
            doc?.cohorts?.useful?.n != null ? `n=${doc.cohorts.useful.n}` : it ? "storico" : "history"
          }
        />
        <MetricPill
          label={it ? "Hit Strong" : "Strong hit"}
          value={fmtPct(kpis.strongHitPct)}
          sub={
            doc?.cohorts?.strong?.n != null ? `n=${doc.cohorts.strong.n}` : it ? "storico" : "history"
          }
        />
        <MetricPill
          label={it ? "In attesa +5g" : "Pending +5d"}
          value={String(kpis.pendingOutcomes)}
          sub={`${kpis.closedOutcomes} ${it ? "chiusi" : "closed"}`}
        />
        <MetricPill
          label={it ? "Hit settimanale" : "Weekly hit"}
          value={fmtPct(kpis.weeklyHitPct)}
          sub={
            kpis.weeklyDeltaPp != null && Math.abs(kpis.weeklyDeltaPp) >= 0.5
              ? fmtPp(kpis.weeklyDeltaPp)
              : it
                ? "actionable"
                : "actionable"
          }
        />
        <MetricPill
          label={scope === "nearCd" ? (it ? "CD ±7g" : "CD ±7d") : it ? "CD 8–60g" : "CD 8–60d"}
          value={String(kpis.imminentCd)}
          sub={it ? "segnali actionable" : "actionable signals"}
        />
      </div>
    </div>
  );
}
