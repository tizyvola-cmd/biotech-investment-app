import { useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { extractAllRowFeatures } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import { loadTradeLeadTimes } from "../riskPattern/patternMatchTracker";
import {
  buildClosedValidationPoints,
  buildLeadTimeValidationPoints,
  medianLeadTimeDays,
  summarizeClosedValidation,
  validationPointJitter,
  type ClosedValidationPoint,
  type LeadTimeValidationPoint,
  type PatternValidationGrade,
} from "../riskPattern/patternValidationChartData";
import type { RiskPattern } from "../riskPattern/riskPatternTypes";

type ChartPoint = ClosedValidationPoint & { x: number };
type LeadChartPoint = LeadTimeValidationPoint & { x: number };

function fmtPct01(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

function GradeBadge({ grade, it }: { grade: PatternValidationGrade; it: boolean }) {
  const styles: Record<PatternValidationGrade, string> = {
    insufficient:
      "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
    weak: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    ok: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    strong:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  };
  const labels: Record<PatternValidationGrade, { it: string; en: string }> = {
    insufficient: { it: "Dati insufficienti", en: "Insufficient data" },
    weak: { it: "Debole", en: "Weak" },
    ok: { it: "Accettabile", en: "Acceptable" },
    strong: { it: "Solido", en: "Strong" },
  };
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${styles[grade]}`}>
      {it ? labels[grade].it : labels[grade].en}
    </span>
  );
}

function ClosedTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  const sign = p.pnlPct >= 0 ? "+" : "";
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/95 dark:bg-surface/95 px-2 py-1.5 text-[10px] shadow-md">
      <p className="font-semibold text-ink">
        {p.ticker} <span className="text-ink-muted">· {p.cd}</span>
      </p>
      <p className="tabular-nums">
        P&L:{" "}
        <span className={`font-semibold ${p.isLoss ? "text-rose-700" : "text-emerald-700"}`}>
          {sign}
          {p.pnlPct.toFixed(1)}%
        </span>
      </p>
      <p className="text-ink-muted">
        {p.matchPattern
          ? it
            ? "Match pattern (entry state)"
            : "Pattern match (entry state)"
          : it
            ? "Fuori pattern"
            : "Outside pattern"}
      </p>
    </div>
  );
}

function LeadTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: Array<{ payload: LeadChartPoint }>;
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  const sign = p.pnlPct >= 0 ? "+" : "";
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/95 dark:bg-surface/95 px-2 py-1.5 text-[10px] shadow-md">
      <p className="font-semibold text-ink">{p.ticker}</p>
      <p className="tabular-nums">
        {it ? "Anticipo" : "Lead time"}:{" "}
        <span className="font-semibold">
          {p.leadTimeDays >= 1
            ? `${p.leadTimeDays.toFixed(1)}d`
            : `${p.leadTimeHours.toFixed(1)}h`}
        </span>
        {" · "}
        P&L:{" "}
        <span className={`font-semibold ${p.isLoss ? "text-rose-700" : "text-emerald-700"}`}>
          {sign}
          {p.pnlPct.toFixed(1)}%
        </span>
      </p>
    </div>
  );
}

export function PatternValidationChart({
  pattern,
  closedRows,
  simTable,
  sdsRows,
  it,
  minLeadTimeSamples = 5,
}: {
  pattern: RiskPattern;
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  it: boolean;
  minLeadTimeSamples?: number;
}) {
  const features = useMemo(
    () => extractAllRowFeatures(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  const closedPoints = useMemo(() => {
    const raw = buildClosedValidationPoints(pattern, closedRows, features);
    return raw.map((p) => ({
      ...p,
      x: p.xSlot + validationPointJitter(`${p.ticker}|${p.cd}`),
    }));
  }, [pattern, closedRows, features]);

  const summary = useMemo(() => summarizeClosedValidation(closedPoints), [closedPoints]);

  const leadPoints = useMemo(() => {
    const all = loadTradeLeadTimes();
    let raw = buildLeadTimeValidationPoints(all, pattern.id);
    if (raw.length === 0) {
      const approvedId = loadApprovedPattern().current?.id;
      if (approvedId && approvedId !== pattern.id) {
        raw = buildLeadTimeValidationPoints(all, approvedId);
      }
    }
    return raw.map((p) => ({ ...p, x: p.leadTimeDays }));
  }, [pattern.id]);

  const medianLead = useMemo(() => medianLeadTimeDays(leadPoints), [leadPoints]);

  const matchedLosses = closedPoints.filter((p) => p.matchPattern && p.isLoss);
  const matchedWins = closedPoints.filter((p) => p.matchPattern && !p.isLoss);
  const otherLosses = closedPoints.filter((p) => !p.matchPattern && p.isLoss);
  const otherWins = closedPoints.filter((p) => !p.matchPattern && !p.isLoss);

  const leadLosses = leadPoints.filter((p) => p.isLoss);
  const leadWins = leadPoints.filter((p) => !p.isLoss);

  return (
    <div className="rounded-lg border border-indigo-200/50 dark:border-indigo-800/40 bg-indigo-50/20 dark:bg-indigo-950/10 px-2.5 py-2 space-y-2.5">
      <div>
        <p className="text-[10px] font-semibold text-indigo-900 dark:text-indigo-100">
          {it ? "Validazione pattern" : "Pattern validation"}
        </p>
        <p className="text-[9px] text-indigo-800/80 dark:text-indigo-200/70 mt-0.5 leading-relaxed max-w-2xl">
          {it
            ? "Due livelli: (1) fit sulle posizioni aperte (precision/recall slider) non prova predittività; (2) sui trade chiusi verifichiamo se il pattern concentra le perdite. Dopo approvazione, il sim loop misura l'anticipo prima della chiusura."
            : "Two layers: (1) open-book fit (slider precision/recall) is not predictive proof; (2) on closed trades we check whether the pattern concentrates losses. After approval, the sim loop measures lead time before closure."}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[9px] tabular-nums text-ink-muted">
          <GradeBadge grade={summary.grade} it={it} />
          <span>{summary.gradeReason}</span>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {/* Retrospective closed-trade strip */}
        <div className="rounded-md border border-[rgb(var(--border))]/30 bg-white/50 dark:bg-surface/40 p-2">
          <p className="text-[10px] font-semibold text-ink mb-0.5">
            {it ? "Chiusi — il pattern predice le perdite?" : "Closed — does the pattern predict losses?"}
          </p>
          <p className="text-[9px] text-ink-muted mb-1.5 leading-snug">
            {it
              ? "Dot plot: sinistra = fuori pattern, destra = match. Perdite in alto (rosso), win in basso (verde)."
              : "Dot plot: left = outside pattern, right = match. Losses up (red), wins down (green)."}
            {" "}
            {summary.matchedN > 0 ? (
              <>
                {it ? "Precisione loss" : "Loss precision"}: {fmtPct01(summary.precision)} ·{" "}
                {it ? "Recall loss" : "Loss recall"}: {fmtPct01(summary.recall)} · lift{" "}
                {summary.lift != null ? `${summary.lift.toFixed(2)}×` : "—"}
              </>
            ) : null}
          </p>
          {closedPoints.length === 0 ? (
            <p className="text-[10px] text-ink-muted py-8 text-center">
              {it ? "Nessun trade chiuso con feature entry." : "No closed trades with entry features."}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 24, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[-0.35, 1.35]}
                  ticks={[0, 1]}
                  tickFormatter={(v) =>
                    v < 0.5
                      ? it
                        ? "No match"
                        : "No match"
                      : it
                        ? "Match"
                        : "Match"
                  }
                  tick={{ fontSize: 9 }}
                />
                <YAxis
                  type="number"
                  dataKey="pnlPct"
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                  label={{
                    value: "P&L %",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 9,
                  }}
                />
                <ZAxis type="number" range={[36, 36]} />
                <Tooltip content={<ClosedTooltip it={it} />} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.5)" strokeDasharray="3 3" />
                <ReferenceLine y={-2} stroke="rgba(244,63,94,0.35)" strokeDasharray="2 2" />
                {otherWins.length > 0 ? (
                  <Scatter data={otherWins} fill="#10b981" fillOpacity={0.45} stroke="#059669" />
                ) : null}
                {otherLosses.length > 0 ? (
                  <Scatter data={otherLosses} fill="#ef4444" fillOpacity={0.55} stroke="#b91c1c" />
                ) : null}
                {matchedWins.length > 0 ? (
                  <Scatter
                    data={matchedWins}
                    fill="#10b981"
                    fillOpacity={0.55}
                    stroke="#6366f1"
                    strokeWidth={2}
                  />
                ) : null}
                {matchedLosses.length > 0 ? (
                  <Scatter
                    data={matchedLosses}
                    fill="#ef4444"
                    fillOpacity={0.85}
                    stroke="#6366f1"
                    strokeWidth={2}
                  />
                ) : null}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Forward lead-time scatter */}
        <div className="rounded-md border border-[rgb(var(--border))]/30 bg-white/50 dark:bg-surface/40 p-2">
          <p className="text-[10px] font-semibold text-ink mb-0.5">
            {it ? "Anticipo — quanto prima del sell?" : "Lead time — how early before sell?"}
          </p>
          <p className="text-[9px] text-ink-muted mb-1.5 leading-snug">
            {leadPoints.length >= minLeadTimeSamples ? (
              <>
                {it ? "Mediana anticipo" : "Median lead"}:{" "}
                {medianLead != null
                  ? medianLead >= 1
                    ? `${medianLead.toFixed(1)} giorni`
                    : `${(medianLead * 24).toFixed(1)} ore`
                  : "—"}
                {" · "}
                n={leadPoints.length}
              </>
            ) : (
              <>
                {it
                  ? `Serve approvare il pattern e chiudere ≥${minLeadTimeSamples} posizioni nel sim loop (raccolti: ${leadPoints.length}).`
                  : `Approve the pattern and close ≥${minLeadTimeSamples} sim-loop positions (collected: ${leadPoints.length}).`}
              </>
            )}
          </p>
          {leadPoints.length === 0 ? (
            <p className="text-[10px] text-ink-muted py-8 text-center">
              {it
                ? "Nessun dato lead-time per questo pattern."
                : "No lead-time data for this pattern yet."}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 24, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={it ? "Giorni prima del sell" : "Days before sell"}
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v) => (v >= 1 ? `${v}d` : `${(v * 24).toFixed(0)}h`)}
                  label={{
                    value: it ? "Anticipo (giorni)" : "Lead time (days)",
                    position: "insideBottom",
                    offset: -12,
                    fontSize: 9,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="pnlPct"
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                />
                <ZAxis type="number" range={[40, 40]} />
                <Tooltip content={<LeadTooltip it={it} />} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.5)" strokeDasharray="3 3" />
                {medianLead != null && medianLead > 0 ? (
                  <ReferenceLine
                    x={medianLead}
                    stroke="rgba(99,102,241,0.55)"
                    strokeDasharray="4 2"
                    label={{
                      value: it ? "mediana" : "median",
                      position: "top",
                      fontSize: 8,
                      fill: "#6366f1",
                    }}
                  />
                ) : null}
                {leadWins.length > 0 ? (
                  <Scatter data={leadWins} fill="#10b981" fillOpacity={0.55} stroke="#059669" />
                ) : null}
                {leadLosses.length > 0 ? (
                  <Scatter data={leadLosses} fill="#ef4444" fillOpacity={0.75} stroke="#b91c1c" />
                ) : null}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
