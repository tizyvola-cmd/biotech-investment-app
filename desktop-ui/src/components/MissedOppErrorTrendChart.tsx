import {
  CartesianGrid,
  ComposedChart,
  Label,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import type { MissedOppErrorTrendPoint } from "../sheet/missedOpportunityAudit";

const FP_COLOR = "#ef4444"; // red — errore + (wrong Enter magnitude)
const MISS_COLOR = "#f97316"; // orange — errore − (missed gainer magnitude)
const ZERO_LINE_COLOR = "#22c55e"; // green — the "0 = no error" boundary

/**
 * Calendar-time trend of signed % error magnitude for a single days-to-CD
 * bucket. The two curves measure the **average size of the actual stock move
 * that contradicted the recommendation**, not the frequency of mistakes:
 *
 *  - Above 0 (red) → mean **drop %** (positive magnitude) of stocks the model
 *    suggested Enter on but which dropped. Bigger value = bigger wrong-Enter
 *    mistake.
 *  - Below 0 (orange, dashed) → mean **gain %** (sign-flipped) of stocks the
 *    model did NOT suggest but which gained ≥ threshold. Bigger distance from
 *    0 = bigger missed gainer.
 *
 * A point converging toward 0 means the loop-learning system is improving for
 * that bucket on that day. The 0-line is rendered in green dashed to make
 * "no error" visually obvious.
 */
export function MissedOppErrorTrendChart({
  points,
  bucketLabel,
  lang,
  height = 220,
}: {
  points: MissedOppErrorTrendPoint[];
  bucketLabel: string;
  lang: "it" | "en";
  height?: number;
}) {
  const it = lang === "it";

  const hasFp = points.some((p) => p.fpAvgDropPct != null);
  const hasMiss = points.some((p) => p.missAvgGainPctNeg != null);

  // Most recent point — used to render an explicit "today" summary banner
  // and an emphasised marker so the latest reading never looks like an
  // empty chart even when there's no historical line drawn.
  const lastPoint = points.length ? points[points.length - 1] : null;
  const lastIsSignal =
    lastPoint != null &&
    (lastPoint.fpAvgDropPct != null || lastPoint.missAvgGainPctNeg != null);
  const lastFp = lastPoint?.fpAvgDropPct ?? null;
  const lastMissNeg = lastPoint?.missAvgGainPctNeg ?? null;
  const lastFpSamples = lastPoint?.fpDropSamples ?? 0;
  const lastMissSamples = lastPoint?.missGainSamples ?? 0;

  // Symmetric, adaptive Y range around 0. We previously forced a 10 %
  // minimum range which made small-but-real errors (≈1–3 %) look invisible
  // next to the zero line. Drop the floor to 4 % so today's dot is always
  // clearly off-axis while large swings still fit naturally.
  const yDomain = useMemo<[number, number]>(() => {
    let max = 0;
    for (const p of points) {
      if (p.fpAvgDropPct != null && Number.isFinite(p.fpAvgDropPct)) {
        max = Math.max(max, Math.abs(p.fpAvgDropPct));
      }
      if (p.missAvgGainPctNeg != null && Number.isFinite(p.missAvgGainPctNeg)) {
        max = Math.max(max, Math.abs(p.missAvgGainPctNeg));
      }
    }
    const padded = Math.ceil((max * 1.4) / 2) * 2; // round up to nearest 2 with 40% headroom
    const bounded = Math.max(4, Math.min(100, padded || 4));
    return [-bounded, bounded];
  }, [points]);

  const tickStep = (yDomain[1] - yDomain[0]) / 4;
  const yTicks = [
    yDomain[0],
    yDomain[0] + tickStep,
    0,
    yDomain[1] - tickStep,
    yDomain[1],
  ];

  if (points.length === 0 || (!hasFp && !hasMiss)) {
    return (
      <div className="rounded-md border border-dashed border-[rgb(var(--border))]/50 bg-surface/30 p-3">
        <p className="text-[11px] text-ink-muted text-center leading-snug">
          {it
            ? "Nessun errore da mostrare per questo bucket: apri la Performance in giorni con almeno un Enter sbagliato o un rialzo perso per accumulare i punti del trend."
            : "No errors to plot for this bucket yet: open Performance on days with at least one wrong Enter or a missed gainer to seed the trend."}
        </p>
      </div>
    );
  }

  // Symmetric "today snapshot" banner — renders the latest aggregate values
  // explicitly so the user never has to squint at a 3 px dot to find the
  // current state. When neither side has signal we still print "0%" so the
  // user can tell a calm day apart from missing data.
  const todayBanner = lastIsSignal ? (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 py-1.5 rounded-md border border-[rgb(var(--border))]/45 bg-surface/40 text-[11px]">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-muted">
        {it ? "Oggi" : "Today"}
        {lastPoint?.date ? ` · ${lastPoint.date}` : ""}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FP_COLOR }} aria-hidden />
        <span className="text-ink-muted">
          {it ? "Errore + (Enter sbagliato)" : "Error + (wrong Enter)"}:
        </span>
        <span className="font-semibold tabular-nums" style={{ color: FP_COLOR }}>
          {lastFp != null ? `${lastFp.toFixed(1)}%` : (it ? "n/d" : "n/a")}
        </span>
        <span className="text-ink-muted/80 text-[10px]">· n={lastFpSamples}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MISS_COLOR }} aria-hidden />
        <span className="text-ink-muted">
          {it ? "Errore − (gainer persa)" : "Error − (missed gainer)"}:
        </span>
        <span className="font-semibold tabular-nums" style={{ color: MISS_COLOR }}>
          {lastMissNeg != null
            ? `${Math.abs(lastMissNeg).toFixed(1)}%`
            : (it ? "n/d" : "n/a")}
        </span>
        <span className="text-ink-muted/80 text-[10px]">· n={lastMissSamples}</span>
      </span>
      {points.length === 1 ? (
        <span className="text-[10px] text-ink-muted/85 italic ml-auto">
          {it
            ? "Storico in costruzione — la curva si forma giorno dopo giorno"
            : "History building — the curve fills in one daily snapshot at a time"}
        </span>
      ) : (
        <span className="text-[10px] text-ink-muted/80 ml-auto tabular-nums">
          {it ? `${points.length} giorni salvati` : `${points.length} saved days`}
        </span>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-1.5">
      {todayBanner}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={points}
          margin={{ top: 12, right: 26, left: 4, bottom: 28 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={28}
            label={{
              value: it ? "Data (asse temporale)" : "Date (time axis)",
              position: "insideBottom",
              offset: -16,
              fontSize: 10,
              fill: "rgb(var(--ink-muted))",
            }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            domain={yDomain}
            tickFormatter={(v) => `${Math.round(Number(v))}%`}
            ticks={yTicks}
            width={44}
            label={{
              value: it
                ? "% errore medio (signed)"
                : "Avg error % (signed)",
              angle: -90,
              position: "insideLeft",
              fontSize: 10,
              fill: "rgb(var(--ink-muted))",
            }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as MissedOppErrorTrendPoint | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5 dark:bg-slate-900 dark:border-slate-700">
                  <p className="font-semibold">
                    {bucketLabel} · {String(label)}
                  </p>
                  <p>
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: FP_COLOR }} />
                    <span className="text-ink-muted">
                      {it
                        ? "Errore + (Enter sbagliato, calo medio):"
                        : "Error + (wrong Enter, avg drop):"}
                    </span>{" "}
                    <span className="font-semibold" style={{ color: FP_COLOR }}>
                      {row.fpAvgDropPct != null
                        ? `${row.fpAvgDropPct.toFixed(1)}%`
                        : "—"}
                    </span>
                    <span className="text-ink-muted"> · n={row.fpDropSamples}</span>
                  </p>
                  <p>
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: MISS_COLOR }} />
                    <span className="text-ink-muted">
                      {it
                        ? "Errore − (gainer persa, rialzo medio):"
                        : "Error − (missed gainer, avg rise):"}
                    </span>{" "}
                    <span className="font-semibold" style={{ color: MISS_COLOR }}>
                      {row.missAvgGainPctNeg != null
                        ? `${Math.abs(row.missAvgGainPctNeg).toFixed(1)}%`
                        : "—"}
                    </span>
                    <span className="text-ink-muted"> · n={row.missGainSamples}</span>
                  </p>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            align="center"
            height={28}
            wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
            iconType="plainline"
            iconSize={18}
          />
          <ReferenceLine
            y={0}
            stroke={ZERO_LINE_COLOR}
            strokeWidth={1.8}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{
              value: it ? "0 = nessun errore" : "0 = no error",
              position: "insideTopRight",
              fontSize: 9,
              fill: ZERO_LINE_COLOR,
            }}
          />
          <Line
            type="monotone"
            dataKey="fpAvgDropPct"
            name={
              it
                ? "Errore + (Enter sbagliato, % calo)"
                : "Error + (wrong Enter, drop %)"
            }
            stroke={FP_COLOR}
            strokeWidth={2.2}
            dot={{ r: 3, stroke: FP_COLOR, fill: FP_COLOR }}
            activeDot={{ r: 4.5 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="missAvgGainPctNeg"
            name={
              it
                ? "Errore − (gainer persa, % rialzo)"
                : "Error − (missed gainer, gain %)"
            }
            stroke={MISS_COLOR}
            strokeWidth={2.2}
            strokeDasharray="6 3"
            dot={{ r: 3, stroke: MISS_COLOR, fill: MISS_COLOR }}
            activeDot={{ r: 4.5 }}
            connectNulls
            isAnimationActive={false}
          />
          {/* Emphasised markers on today's reading — ring + value label so
              the latest dot is impossible to miss even when no historical
              line is drawn yet. */}
          {lastPoint && lastFp != null ? (
            <ReferenceDot
              x={lastPoint.date}
              y={lastFp}
              r={6}
              fill={FP_COLOR}
              stroke="white"
              strokeWidth={2}
              isFront
            >
              <Label
                value={`${lastFp.toFixed(1)}%`}
                position="right"
                offset={8}
                style={{ fontSize: 10, fontWeight: 600, fill: FP_COLOR }}
              />
            </ReferenceDot>
          ) : null}
          {lastPoint && lastMissNeg != null ? (
            <ReferenceDot
              x={lastPoint.date}
              y={lastMissNeg}
              r={6}
              fill={MISS_COLOR}
              stroke="white"
              strokeWidth={2}
              isFront
            >
              <Label
                value={`${Math.abs(lastMissNeg).toFixed(1)}%`}
                position="right"
                offset={8}
                style={{ fontSize: 10, fontWeight: 600, fill: MISS_COLOR }}
              />
            </ReferenceDot>
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
