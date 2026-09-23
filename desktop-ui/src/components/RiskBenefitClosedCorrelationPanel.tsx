/**
 * Scatter: score (risk or benefit) vs closed-deal P&L % with OLS regression line.
 */
import {
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  correlationSignificance,
  formatSignedCorrelation,
  linearRegressionOLS,
  pearsonR,
  spearmanR,
} from "../sheet/statSignificance";
import type { ClosedDealRiskBenefitPoint } from "../sheet/approvedWeightsClosedCorrelation";
import { BENEFIT_BLEND_V2_WEIGHTS } from "../sheet/riskBenefitScoring";
import { RISK_V2_WEIGHTS } from "../sheet/riskScoreV2";

export type RiskBenefitScatterPoint = {
  ticker: string;
  x: number;
  y: number;
  pnlEur?: number | null;
};

function scatterYDomain(pts: { y: number }[]): [number, number] {
  const ys = pts.map((p) => p.y).filter((y) => Number.isFinite(y) && Math.abs(y) <= 150);
  if (!ys.length) return [-15, 15];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pad = Math.max(4, (max - min) * 0.2 || 4);
  return [Math.min(min - pad, -2), Math.max(max + pad, 2)];
}

function ScatterTooltipBody({
  active,
  payload,
  xLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: RiskBenefitScatterPoint }>;
  xLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-2 py-1.5 text-[10px] shadow-lg">
      <p className="font-semibold">{p.ticker}</p>
      <p className="tabular-nums text-ink-muted">
        {xLabel}: <strong className="text-ink">{p.x.toFixed(0)}</strong>
      </p>
      <p className="tabular-nums text-ink-muted">
        P&L %: <strong className="text-ink">{p.y >= 0 ? "+" : ""}{p.y.toFixed(1)}%</strong>
      </p>
      {p.pnlEur != null && Number.isFinite(p.pnlEur) ? (
        <p className="tabular-nums text-ink-muted">
          P&L €: <strong className="text-ink">{Math.round(p.pnlEur).toLocaleString()} €</strong>
        </p>
      ) : null}
    </div>
  );
}

function correlationVerdict(
  r: number | null,
  n: number,
  expectedSign: "negative" | "positive",
  it: boolean,
): { label: string; tone: "ok" | "weak" | "wrong" | "neutral" } {
  if (r == null || n < 3) {
    return {
      label: it ? "Dati insufficienti" : "Insufficient data",
      tone: "neutral",
    };
  }
  const { stars } = correlationSignificance(r, n);
  const aligned =
    expectedSign === "negative"
      ? r <= -0.15
      : r >= 0.15;
  const opposed =
    expectedSign === "negative"
      ? r >= 0.15
      : r <= -0.15;
  if (stars !== "ns" && aligned) {
    return {
      label: it ? "Segnale coerente col modello" : "Signal aligns with model",
      tone: "ok",
    };
  }
  if (stars !== "ns" && opposed) {
    return {
      label: it ? "Segnale opposto all'atteso" : "Signal opposite to expected",
      tone: "wrong",
    };
  }
  if (Math.abs(r) < 0.15) {
    return {
      label: it
        ? "Nessun segnale — rumore su questo campione"
        : "No signal — noise on this sample",
      tone: "weak",
    };
  }
  return {
    label: it ? "Debole, non significativo" : "Weak, not significant",
    tone: "weak",
  };
}

export function ScoreVsClosedPnlScatter({
  title,
  pts,
  xLabel,
  xDomain = [0, 100] as [number, number],
  accentColor,
  it,
  height = 148,
  expectedSign,
  overlayPts,
  overlayLabel,
  subtitleExtra,
}: {
  title: string;
  pts: RiskBenefitScatterPoint[];
  xLabel: string;
  xDomain?: [number, number];
  accentColor: string;
  it: boolean;
  height?: number;
  expectedSign: "negative" | "positive";
  /** Optional second series (e.g. Risk v2 shadow) on the same axes. */
  overlayPts?: RiskBenefitScatterPoint[];
  overlayLabel?: string;
  subtitleExtra?: string;
}) {
  const data = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const overlayData = (overlayPts ?? []).filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const yDomain = scatterYDomain([...data, ...overlayData]);
  const xs = data.map((p) => p.x);
  const ys = data.map((p) => p.y);
  const r = data.length >= 3 ? pearsonR(xs, ys) : null;
  const rho = data.length >= 3 ? spearmanR(xs, ys) : null;
  const regression =
    data.length >= 3
      ? linearRegressionOLS(
          data.map((p) => p.x),
          data.map((p) => p.y),
          { min: xDomain[0], max: xDomain[1] },
        )
      : null;
  const overlayRegression =
    overlayData.length >= 3
      ? linearRegressionOLS(
          overlayData.map((p) => p.x),
          overlayData.map((p) => p.y),
          { min: xDomain[0], max: xDomain[1] },
        )
      : null;
  const { stars } = correlationSignificance(r, data.length);
  const verdict = correlationVerdict(r, data.length, expectedSign, it);
  const regColor =
    verdict.tone === "ok"
      ? "#059669"
      : verdict.tone === "wrong"
        ? "#e11d48"
        : "#6366f1";
  const verdictClass =
    verdict.tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : verdict.tone === "wrong"
        ? "text-rose-700 dark:text-rose-300"
        : "text-amber-800 dark:text-amber-200";

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 p-1.5 bg-[rgb(var(--surface))]/40 min-w-0 flex flex-col h-full">
      <div className="shrink-0 min-h-[52px]">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-ink leading-tight">{title}</p>
            <p className={`text-[9px] leading-tight min-h-[13px] ${verdictClass}`}>
              {verdict.label}
            </p>
            <p
              className={`text-[9px] leading-tight min-h-[13px] ${
                subtitleExtra
                  ? "text-violet-800 dark:text-violet-200"
                  : "invisible select-none"
              }`}
              aria-hidden={!subtitleExtra}
            >
              {subtitleExtra ?? "\u00a0"}
            </p>
          </div>
          <div className="text-[9px] text-ink-muted tabular-nums flex flex-col items-end gap-0.5 shrink-0 pt-0.5 min-h-[39px]">
            <span className={r != null ? undefined : "invisible select-none"} aria-hidden={r == null}>
              r ={" "}
              <strong className="text-ink">
                {r != null ? `${formatSignedCorrelation(r, 2)} ${stars}` : "—"}
              </strong>
            </span>
            <span className={rho != null ? undefined : "invisible select-none"} aria-hidden={rho == null}>
              ρ ={" "}
              <strong className="text-ink">
                {rho != null ? formatSignedCorrelation(rho, 2) : "—"}
              </strong>
            </span>
            <span>
              n = <strong className="text-ink">{data.length}</strong>
            </span>
          </div>
        </div>
      </div>
      <div className="shrink-0" style={{ height }}>
        {data.length < 3 ? (
          <p className="text-[10px] text-ink-muted h-full flex items-center justify-center text-center px-2">
            {it
              ? `Servono ≥3 trade chiusi con ${xLabel} (ora ${data.length}).`
              : `Need ≥3 closed trades with ${xLabel} (have ${data.length}).`}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 4, right: 4, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis
              type="number"
              dataKey="x"
              domain={xDomain}
              tick={{ fontSize: 8 }}
              tickCount={5}
              label={{
                value: xLabel,
                position: "bottom",
                offset: 8,
                fontSize: 8,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={yDomain}
              tick={{ fontSize: 8 }}
              width={28}
              tickCount={5}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
            />
            <ZAxis range={[32, 32]} />
            <ReferenceLine y={0} stroke="rgba(148,163,184,0.5)" strokeDasharray="2 2" />
            {regression?.line.length === 2 ? (
              <ReferenceLine
                segment={[
                  { x: regression.line[0]!.x, y: regression.line[0]!.y },
                  { x: regression.line[1]!.x, y: regression.line[1]!.y },
                ]}
                stroke={regColor}
                strokeWidth={2}
                strokeDasharray="6 4"
                strokeOpacity={0.9}
                ifOverflow="extendDomain"
              />
            ) : null}
            {overlayRegression?.line.length === 2 ? (
              <ReferenceLine
                segment={[
                  { x: overlayRegression.line[0]!.x, y: overlayRegression.line[0]!.y },
                  { x: overlayRegression.line[1]!.x, y: overlayRegression.line[1]!.y },
                ]}
                stroke="#7c3aed"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                strokeOpacity={0.85}
                ifOverflow="extendDomain"
              />
            ) : null}
            <Tooltip
              content={<ScatterTooltipBody xLabel={xLabel} />}
              cursor={{ strokeDasharray: "3 3" }}
            />
            <Scatter
              data={data}
              fill={accentColor}
              shape={(props: { cx?: number; cy?: number; payload?: { y: number } }) => {
                const cx = props.cx ?? 0;
                const cy = props.cy ?? 0;
                const y = props.payload?.y ?? 0;
                const color = y > 0 ? "#059669" : y < 0 ? "#e11d48" : "#94a3b8";
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={color}
                    fillOpacity={0.8}
                    stroke={color}
                    strokeWidth={1}
                  />
                );
              }}
            />
            {overlayData.length > 0 ? (
              <Scatter
                name={overlayLabel ?? "overlay"}
                data={overlayData}
                fill="#7c3aed"
                shape={(props: { cx?: number; cy?: number }) => {
                  const cx = props.cx ?? 0;
                  const cy = props.cy ?? 0;
                  return (
                    <polygon
                      points={`${cx},${cy - 4} ${cx + 3.5},${cy + 3} ${cx - 3.5},${cy + 3}`}
                      fill="#7c3aed"
                      fillOpacity={0.75}
                      stroke="#5b21b6"
                      strokeWidth={1}
                    />
                  );
                }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>
      <p className="shrink-0 min-h-[14px] text-[9px] text-ink-muted tabular-nums leading-tight">
        {regression && data.length >= 3 ? (
          <>
            OLS: y = {regression.slope >= 0 ? "+" : ""}
            {regression.slope.toFixed(3)}·x {regression.intercept >= 0 ? "+" : ""}
            {regression.intercept.toFixed(2)}
          </>
        ) : (
          <span className="invisible select-none" aria-hidden>
            OLS
          </span>
        )}
      </p>
      <div className="flex-1 min-h-0" aria-hidden />
    </div>
  );
}

function pctWeight(w: number): string {
  return `${Math.round(w * 100)}%`;
}

function IndexLine({
  label,
  weight,
  detail,
  r,
}: {
  label: string;
  weight: string;
  detail: string;
  r?: number | null;
}) {
  return (
    <li className="leading-snug">
      <span className="font-medium text-ink tabular-nums">{label}</span>
      <span className="text-ink-muted"> · {weight}</span>
      <span className="text-ink-muted"> — {detail}</span>
      {r != null ? (
        <span className="text-ink-muted tabular-nums"> · r {formatSignedCorrelation(r, 2)}</span>
      ) : null}
    </li>
  );
}

function ScoreIndicesLegend({
  it,
  v2ComponentN,
  rV2Plan,
  rV2Timing,
  rV2Liq,
  rV2Reg,
  rPplan,
  rSds,
  rPwinComp,
}: {
  it: boolean;
  v2ComponentN: { plan: number; timing: number; liquidity: number; regulatory: number };
  rV2Plan: number | null;
  rV2Timing: number | null;
  rV2Liq: number | null;
  rV2Reg: number | null;
  rPplan: number | null;
  rSds: number | null;
  rPwinComp: number | null;
}) {
  return (
    <div className="flex-1 min-w-[200px] rounded-lg border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/50 p-2 space-y-2.5 text-[9px]">
      <div>
        <p className="text-[10px] font-semibold text-violet-800 dark:text-violet-200">
          {it ? "💀 Indici Risk v2" : "💀 Risk v2 indices"}
        </p>
        <p className="text-[8px] text-ink-muted mt-0.5 leading-snug">
          {it
            ? "Pesi provvisori · componenti assenti si ricalibrano tra i presenti. ○ Phase A = overlay diagnostico (loss rate bucket)."
            : "Provisional weights · missing components renormalize among present. ○ Phase A = diagnostic overlay (bucket loss rate)."}
        </p>
        <ul className="mt-1.5 space-y-1 text-ink-muted list-none">
          <IndexLine
            label={it ? "Piano" : "Plan"}
            weight={pctWeight(RISK_V2_WEIGHTS.plan)}
            detail={
              it
                ? `100 − P(plan) all'ingresso (n=${v2ComponentN.plan})`
                : `100 − entry P(plan) (n=${v2ComponentN.plan})`
            }
            r={rV2Plan}
          />
          <IndexLine
            label={it ? "Timing" : "Timing"}
            weight={pctWeight(RISK_V2_WEIGHTS.timing)}
            detail={
              it
                ? `60% DTC + 40% slope 5d (n=${v2ComponentN.timing})`
                : `60% DTC + 40% slope 5d (n=${v2ComponentN.timing})`
            }
            r={rV2Timing}
          />
          <IndexLine
            label={it ? "Liquidità" : "Liquidity"}
            weight={pctWeight(RISK_V2_WEIGHTS.liquidity)}
            detail={
              it
                ? `ext 40% + vol 30% + illiquid 30% · proxy mcap (n=${v2ComponentN.liquidity})`
                : `ext 40% + vol 30% + illiquid 30% · mcap proxy (n=${v2ComponentN.liquidity})`
            }
            r={rV2Liq}
          />
          <IndexLine
            label={it ? "Regolatorio" : "Regulatory"}
            weight={pctWeight(RISK_V2_WEIGHTS.regulatory)}
            detail={
              it
                ? `imminenza K8 / cause_attr / DTC≤30d (n=${v2ComponentN.regulatory})`
                : `K8 imminence / cause_attr / DTC≤30d (n=${v2ComponentN.regulatory})`
            }
            r={rV2Reg}
          />
        </ul>
      </div>
      <div className="border-t border-[rgb(var(--border))]/30 pt-2">
        <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">
          {it ? "❤️ Indici Benefit v2" : "❤️ Benefit v2 indices"}
        </p>
        <p className="text-[8px] text-ink-muted mt-0.5 leading-snug">
          {it
            ? "Solo all'ingresso del trade chiuso — non i pesi % della tabella allocazione."
            : "Entry-time only on closed trades — not allocation % weights."}
        </p>
        <ul className="mt-1.5 space-y-1 text-ink-muted list-none">
          <IndexLine
            label="P(plan)"
            weight={pctWeight(BENEFIT_BLEND_V2_WEIGHTS.pplan)}
            detail={it ? "affidabilità % all'ingresso" : "entry affidabilità %"}
            r={rPplan}
          />
          <IndexLine
            label="SDS"
            weight={pctWeight(BENEFIT_BLEND_V2_WEIGHTS.sds)}
            detail={it ? "SDS SuperNova all'ingresso" : "entry SuperNova SDS"}
            r={rSds}
          />
          <IndexLine
            label={it ? "Slope 20d" : "Slope 20d"}
            weight={pctWeight(BENEFIT_BLEND_V2_WEIGHTS.slope)}
            detail={it ? "pendenza forward 20g (pp/giorno)" : "forward 20d slope (pp/day)"}
          />
          <IndexLine
            label="P(win)"
            weight={`max ${pctWeight(BENEFIT_BLEND_V2_WEIGHTS.win)}`}
            detail={
              it
                ? "composite approvato 4 dim (Learning Lab)"
                : "approved 4-dim composite (Learning Lab)"
            }
            r={rPwinComp}
          />
        </ul>
      </div>
    </div>
  );
}

export function RiskBenefitClosedCorrelationPanel({
  points,
  sourceCounts,
  it,
}: {
  points: ClosedDealRiskBenefitPoint[];
  sourceCounts?: { simloop: number; portfolio: number; total: number };
  it: boolean;
}) {
  const riskPts: RiskBenefitScatterPoint[] = points
    .filter((p) => p.riskScoreV2 != null && Number.isFinite(p.riskScoreV2))
    .map((p) => ({
      ticker: p.ticker,
      x: p.riskScoreV2!,
      y: p.pnlPct,
      pnlEur: p.pnlEur,
    }));
  const phaseAPts: RiskBenefitScatterPoint[] = points
    .filter(
      (p) =>
        p.riskScore != null &&
        Number.isFinite(p.riskScore) &&
        !p.riskScoreIsFallback,
    )
    .map((p) => ({
      ticker: p.ticker,
      x: p.riskScore!,
      y: p.pnlPct,
      pnlEur: p.pnlEur,
    }));
  const riskFallbackN = points.filter((p) => p.riskScoreIsFallback).length;
  const riskExcludedNoPhaseA = points.filter(
    (p) => p.riskScore == null && !p.riskScoreIsFallback,
  ).length;

  const benefitPts: RiskBenefitScatterPoint[] = points
    .filter((p) => Number.isFinite(p.benefitScore) && p.benefitScore > 0)
    .map((p) => ({
      ticker: p.ticker,
      x: p.benefitScore,
      y: p.pnlPct,
      pnlEur: p.pnlEur,
    }));

  const corrEntryX = (
    pick: (p: ClosedDealRiskBenefitPoint) => number | null | undefined,
  ): number | null => {
    const rows = points.filter((p) => {
      const x = pick(p);
      return x != null && Number.isFinite(x) && Number.isFinite(p.pnlPct);
    });
    if (rows.length < 3) return null;
    return pearsonR(
      rows.map((p) => pick(p)!),
      rows.map((p) => p.pnlPct),
    );
  };

  const rPplan = corrEntryX((p) => p.entryPplanPct);
  const rPwinComp = corrEntryX((p) =>
    Number.isFinite(p.benefitWinComponentPct) && p.benefitWinComponentPct > 0
      ? p.benefitWinComponentPct
      : null,
  );
  const rSds = corrEntryX((p) => p.entrySdsPct);

  const corrRiskMetric = (
    pickX: (p: ClosedDealRiskBenefitPoint) => number | null | undefined,
    pickY: (p: ClosedDealRiskBenefitPoint) => number,
  ): number | null => {
    const rows = points.filter((p) => {
      const x = pickX(p);
      return x != null && Number.isFinite(x) && Number.isFinite(pickY(p));
    });
    if (rows.length < 3) return null;
    return pearsonR(
      rows.map((p) => pickX(p)!),
      rows.map((p) => pickY(p)),
    );
  };

  const rRiskV2Pnl = corrRiskMetric((p) => p.riskScoreV2, (p) => p.pnlPct);
  const rhoRiskV2Pnl =
    riskPts.length >= 3
      ? spearmanR(
          riskPts.map((p) => p.x),
          riskPts.map((p) => p.y),
        )
      : null;
  const rRiskV1Pnl = corrRiskMetric(
    (p) => (p.riskScoreIsFallback ? null : p.riskScore),
    (p) => p.pnlPct,
  );
  const rRiskV2Loss = corrRiskMetric(
    (p) => p.riskScoreV2,
    (p) => (p.lossBinary ? 1 : 0),
  );
  const rRiskV1Loss = corrRiskMetric(
    (p) => (p.riskScoreIsFallback ? null : p.riskScore),
    (p) => (p.lossBinary ? 1 : 0),
  );

  const rV2Plan = corrRiskMetric((p) => p.riskScoreV2Breakdown?.plan ?? null, (p) => p.pnlPct);
  const rV2Timing = corrRiskMetric(
    (p) => p.riskScoreV2Breakdown?.timing ?? null,
    (p) => p.pnlPct,
  );
  const rV2Liq = corrRiskMetric(
    (p) => p.riskScoreV2Breakdown?.liquidity ?? null,
    (p) => p.pnlPct,
  );
  const rV2Reg = corrRiskMetric(
    (p) => p.riskScoreV2Breakdown?.regulatory ?? null,
    (p) => p.pnlPct,
  );

  const pplan5070Deals = points
    .filter(
      (p) =>
        p.entryPplanPct != null &&
        p.entryPplanPct >= 50 &&
        p.entryPplanPct < 70,
    )
    .map((p) => p.ticker);

  const v2ComponentN = {
    plan: points.filter((p) => p.riskScoreV2Breakdown?.plan != null).length,
    timing: points.filter((p) => p.riskScoreV2Breakdown?.timing != null).length,
    liquidity: points.filter((p) => p.riskScoreV2Breakdown?.liquidity != null).length,
    regulatory: points.filter((p) => p.riskScoreV2Breakdown?.regulatory != null).length,
  };
  const v2ReadyForWeightCalib =
    v2ComponentN.plan > 50 &&
    v2ComponentN.timing > 50 &&
    v2ComponentN.liquidity > 50 &&
    v2ComponentN.regulatory > 50;

  const riskPrimarySubtitle =
    rRiskV2Pnl != null
      ? it
        ? `Risk v2 r=${formatSignedCorrelation(rRiskV2Pnl, 2)} · loss bin ${formatSignedCorrelation(rRiskV2Loss, 2)} · n=${riskPts.length} · pesi provv. 40/25/25/10`
        : `Risk v2 r=${formatSignedCorrelation(rRiskV2Pnl, 2)} · loss bin ${formatSignedCorrelation(rRiskV2Loss, 2)} · n=${riskPts.length} · provisional weights 40/25/25/10`
      : undefined;

  return (
    <div className="space-y-2 min-w-[280px]">
      <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
        {it ? "Correlazione vs trade chiusi" : "Correlation vs closed trades"}
      </p>
      <p className="text-[9px] text-ink-muted leading-snug">
        {it
          ? `Fonte: sim loop + portafoglio reale (vendite con soldAt). n=${sourceCounts?.total ?? points.length} (sim ${sourceCounts?.simloop ?? "—"} · portafoglio ${sourceCounts?.portfolio ?? "—"}). Y = P&L % realizzato.`
          : `Source: sim loop + real portfolio (soldAt sells). n=${sourceCounts?.total ?? points.length} (sim ${sourceCounts?.simloop ?? "—"} · portfolio ${sourceCounts?.portfolio ?? "—"}). Y = realised P&L %.`}
      </p>
      <p className="text-[9px] text-ink-muted leading-snug">
        {it
          ? "Indici calcolati solo all'ingresso del trade chiuso — non sono i pesi % della tabella sopra (universo aperto/BUY)."
          : "Scores are entry-time only on closed trades — not the allocation % table above (open/BUY universe)."}
      </p>
      <p className="text-[9px] text-ink-muted leading-snug">
        {it
          ? "Risk v2 (ufficiale): piano · timing · liquidità · regolatorio — pesi provvisori 40/25/25/10. ○ Phase A (loss rate bucket) in overlay per confronto."
          : "Risk v2 (official): plan · timing · liquidity · regulatory — provisional weights 40/25/25/10. ○ Phase A (bucket loss rate) overlaid for comparison."}
      </p>
      {rRiskV1Pnl != null || rRiskV2Pnl != null ? (
        <p className="text-[9px] leading-snug text-slate-800 dark:text-slate-200 tabular-nums">
          {it ? "Diagnostica duale — r vs P&L % / loss binario:" : "Dual diagnostic — r vs P&L % / loss binary:"}{" "}
          v2 {formatSignedCorrelation(rRiskV2Pnl, 2)}
          {rhoRiskV2Pnl != null ? ` (ρ ${formatSignedCorrelation(rhoRiskV2Pnl, 2)})` : ""}
          {" / "}
          {formatSignedCorrelation(rRiskV2Loss, 2)}
          {" · "}
          Phase A {formatSignedCorrelation(rRiskV1Pnl, 2)} / {formatSignedCorrelation(rRiskV1Loss, 2)}
          {rRiskV2Pnl != null && rRiskV2Pnl < -0.15
            ? it
              ? " — v2 sopra soglia debole negativa"
              : " — v2 above weak-negative threshold"
            : rRiskV2Pnl != null
              ? it
                ? " — target v2: r < −0,15"
                : " — v2 target: r < −0.15"
              : ""}
        </p>
      ) : null}
      {rV2Plan != null ? (
        <p className="text-[9px] leading-snug text-violet-900 dark:text-violet-200 tabular-nums">
          {it ? "Componenti v2 vs P&L %:" : "v2 components vs P&L %:"}{" "}
          plan {formatSignedCorrelation(rV2Plan, 2)} · timing{" "}
          {formatSignedCorrelation(rV2Timing, 2)} · liq {formatSignedCorrelation(rV2Liq, 2)} · reg{" "}
          {formatSignedCorrelation(rV2Reg, 2)}
        </p>
      ) : null}
      {pplan5070Deals.length > 0 ? (
        <p className="text-[9px] text-slate-700 dark:text-slate-300 leading-snug">
          {it
            ? `P(plan) 50–70% (n=${pplan5070Deals.length}): ${pplan5070Deals.join(", ")} — fix bucket sizing applicato (monotono); componente plan v2 usa entry P(plan), Δ medio ±0 pt.`
            : `P(plan) 50–70% (n=${pplan5070Deals.length}): ${pplan5070Deals.join(", ")} — sizing bucket fix applied (monotonic); v2 plan uses entry P(plan), mean Δ ±0 pts.`}
        </p>
      ) : null}
      {v2ReadyForWeightCalib ? (
        <p className="text-[9px] text-amber-900 dark:text-amber-100 leading-snug font-medium">
          {it
            ? "Risk v2: campione sufficiente per ricalibrazione pesi — rieseguire validazione."
            : "Risk v2: sample large enough for weight recalibration — rerun validation."}
        </p>
      ) : null}
      {riskFallbackN > 0 ? (
        <p className="text-[9px] text-amber-800 dark:text-amber-200 leading-snug">
          {it
            ? `Risk: ${riskFallbackN} trade esclusi dal grafico (proxy 100−P(win) — non è Phase A).`
            : `Risk: ${riskFallbackN} trades excluded from chart (100−P(win) proxy — not Phase A).`}
        </p>
      ) : null}
      {riskExcludedNoPhaseA > 0 ? (
        <p className="text-[9px] text-ink-muted leading-snug">
          {it
            ? `${riskExcludedNoPhaseA} trade senza risk score Phase A.`
            : `${riskExcludedNoPhaseA} trades without Phase A risk score.`}
        </p>
      ) : null}
      <p className="text-[9px] text-ink-muted leading-snug">
        {it
          ? `Atteso: 💀 r<0 · ❤️ r>0. Con n≈${riskPts.length}/${benefitPts.length} serve |r|≳0.3 per un segnale robusto — valori vicini a 0 sono rumore, non un bug del grafico.`
          : `Expected: 💀 r<0 · ❤️ r>0. At n≈${riskPts.length}/${benefitPts.length} you need |r|≳0.3 for a robust signal — values near 0 are noise, not a chart bug.`}
      </p>
      <div className="flex flex-col lg:flex-row gap-2 items-stretch w-full">
        <div className="grid grid-cols-2 gap-1.5 items-stretch flex-1 min-w-0 lg:max-w-[52%] auto-rows-fr">
          <ScoreVsClosedPnlScatter
            title={it ? "💀 Risk v2 vs P&L" : "💀 Risk v2 vs P&L"}
            pts={riskPts}
            overlayPts={phaseAPts}
            overlayLabel={it ? "Phase A" : "Phase A"}
            subtitleExtra={riskPrimarySubtitle}
            xLabel={it ? "Risk v2" : "Risk v2"}
            accentColor="#7c3aed"
            it={it}
            expectedSign="negative"
            height={132}
          />
          <ScoreVsClosedPnlScatter
            title={it ? "❤️ Beneficio vs P&L" : "❤️ Benefit vs P&L"}
            pts={benefitPts}
            xLabel={it ? "Benefit score" : "Benefit score"}
            accentColor="#f43f5e"
            it={it}
            expectedSign="positive"
            height={132}
          />
        </div>
        <ScoreIndicesLegend
          it={it}
          v2ComponentN={v2ComponentN}
          rV2Plan={rV2Plan}
          rV2Timing={rV2Timing}
          rV2Liq={rV2Liq}
          rV2Reg={rV2Reg}
          rPplan={rPplan}
          rSds={rSds}
          rPwinComp={rPwinComp}
        />
      </div>
    </div>
  );
}
