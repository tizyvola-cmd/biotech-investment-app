/**
 * Channel-impact panels — the redesigned headline of the Model Calibration tab.
 *
 * Replaces the "8 magnitude loops" framing with the THREE channels that actually
 * move the needle (confirmed with the user + the walk-forward measurement):
 *   1. PREDICTION  -> direction-hit % + calibration error
 *   2. RECOMMENDATION -> hit-rate of the SDS-recommended action vs the whole book
 *   3. TRADING -> P&L per trade + win-rate
 *
 * Each panel shows the current headline number, a weekly trend sparkline, and the
 * per-loop attribution (which loop is actually a lever vs a ~0-impact guardrail).
 * Data comes from overview.channel_impact (prediction/recommendation/trading).
 */
import { useMemo, useState } from "react";
import type { ChannelImpact, ChannelLoopEffect } from "../api/supernova";
import type { RescueReboundAnalysis } from "../sheet/recommendationRescue";
import type { SellTimingAnalysis } from "../sheet/recommendationSellTiming";

// Snapshot of the channel scores taken when "re-estimate" is pressed, so the new
// values can be diffed against the ones shown before the recompute (arrows +
// green/red). Persisted so the comparison survives a rebuild/reload.
const BASELINE_KEY = "channelImpact.baseline.v1";
const DELTA_EPS_PP = 0.05;
type ChannelMetricMap = Record<string, number>;
type ChannelBaseline = { metrics: ChannelMetricMap; at: string };

function collectChannelMetrics(
  data: ChannelImpact,
  rescue?: RescueReboundAnalysis | null,
): ChannelMetricMap {
  const m: ChannelMetricMap = {};
  const put = (k: string, v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) m[k] = v;
  };
  const p = data.prediction;
  if (p) {
    put("pred.max", p.best_node?.sign_hit_pct);
    put("pred.min", p.worst_node?.sign_hit_pct);
    put("pred.avg", p.pre_cd_sign_hit_pct);
    (p.reliability_bands ?? []).forEach((b) => put(`pred.band.${b.key}`, b.mean_pct));
  }
  const r = data.recommendation;
  if (r) {
    put("rec.buy", r.buy?.up_hit_pct);
    put("rec.sell", r.sell?.down_hit_pct);
    (r.sell?.by_reason ?? []).forEach((b) => put(`rec.sell.${b.reason}`, b.down_hit_pct));
  }
  if (rescue?.available) {
    put("rescue.hit", rescue.hitRatePct);
    (rescue.tiers ?? []).forEach((t) => put(`rescue.tier.${t.tier}`, t.hitRatePct));
  }
  const t = data.trading;
  if (t) {
    put("trd.win", t.win_pct);
    put("trd.meanPnl", t.mean_pnl_pct);
    put("trd.medianPnl", t.median_pnl_pct);
  }
  return m;
}

function readChannelBaseline(): ChannelBaseline | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChannelBaseline;
    return parsed && parsed.metrics ? parsed : null;
  } catch {
    return null;
  }
}

function writeChannelBaseline(b: ChannelBaseline): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(b));
  } catch {
    /* quota / private mode */
  }
}

/** Tailwind text color for a delta (higher = better for every channel score). */
function deltaTone(diff?: number | null): string {
  if (diff == null || !Number.isFinite(diff) || Math.abs(diff) < DELTA_EPS_PP) return "";
  return diff > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

/** Tailwind row tint for a window that improved (green) / worsened (red). */
function deltaRowTone(diff?: number | null): string {
  if (diff == null || !Number.isFinite(diff) || Math.abs(diff) < DELTA_EPS_PP) return "";
  return diff > 0
    ? "bg-emerald-500/10 rounded px-1 -mx-1"
    : "bg-rose-500/10 rounded px-1 -mx-1";
}

function DeltaArrow({ diff }: { diff?: number | null }) {
  if (diff == null || !Number.isFinite(diff) || Math.abs(diff) < DELTA_EPS_PP) return null;
  const up = diff > 0;
  return (
    <span
      className={`text-[9px] font-bold tabular-nums ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
      title={`${up ? "+" : "−"}${Math.abs(diff).toFixed(1)} pp vs precedente`}
    >
      {up ? "▲" : "▼"}{Math.abs(diff).toFixed(1)}
    </span>
  );
}

const SELL_REASON_LABEL: Record<string, { it: string; en: string }> = {
  stop_loss: { it: "stop-loss", en: "stop-loss" },
  sds_below_40: { it: "SDS < 40", en: "SDS < 40" },
  pre_cd_exit: { it: "pre-CD", en: "pre-CD" },
  capital_removed: { it: "uscita (CD/chiusura)", en: "exit (CD/close)" },
};

const VERDICT_TONE: Record<string, string> = {
  improving: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  direction_lever: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  neutral: "bg-surface/60 text-ink-muted",
  not_helping: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  not_measurable: "bg-surface/60 text-ink-muted",
  collecting_data: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
};

function verdictLabel(v: string, it: boolean): string {
  switch (v) {
    case "improving":
      return it ? "riduce errore" : "reduces error";
    case "not_helping":
      return it ? "peggiora" : "hurts";
    case "neutral":
      return it ? "impatto ≈0" : "≈0 impact";
    case "direction_lever":
      return it ? "leva direzione" : "direction lever";
    case "not_measurable":
      return it ? "non misurabile" : "not measurable";
    case "collecting_data":
      return it ? "raccolta dati" : "collecting";
    default:
      return v;
  }
}

function fmt(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
}

function fmtSigned(v: number | null | undefined, unit = " pp", digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;
}

function liftClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : v < 0
      ? "text-rose-600 dark:text-rose-400"
      : "";
}

/** Minimal SVG line sparkline over a numeric series (nulls become gaps/0-baseline). */
function Sparkline({
  values,
  width = 132,
  height = 30,
  positiveIsGood = true,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  positiveIsGood?: boolean;
}) {
  const pts = values.map((v) => (v != null && Number.isFinite(v) ? v : null));
  const finite = pts.filter((v): v is number => v != null);
  if (finite.length < 2) {
    return <span className="text-[9px] text-ink-muted italic">{"trend n/d"}</span>;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const stepX = width / Math.max(1, pts.length - 1);
  const last = finite[finite.length - 1];
  const first = finite[0];
  const rising = last >= first;
  const good = positiveIsGood ? rising : !rising;
  const stroke = good ? "rgb(16 185 129)" : "rgb(244 63 94)";
  const coords: string[] = [];
  pts.forEach((v, i) => {
    if (v == null) return;
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    coords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Panel({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: { text: string; tone: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2 flex flex-col">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-ink">{title}</h4>
          <p className="text-[10px] text-ink-muted leading-snug">{subtitle}</p>
        </div>
        {badge ? (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${badge.tone}`}>
            {badge.text}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
}) {
  const tone = deltaTone(delta);
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums leading-none flex items-baseline gap-1">
        <span className={tone || "text-ink"}>{value}</span>
        <DeltaArrow diff={delta} />
      </span>
      <span className="text-[9px] text-ink-muted">{label}</span>
      {hint ? <span className="text-[8px] text-ink-muted/80 tabular-nums">{hint}</span> : null}
    </div>
  );
}

/** Predictive SELL timing: MII↓ + EIS≤0 + low rescue, graded walk-forward. */
function SellTimingBlock({
  sellTiming,
  reactivePct,
  it,
}: {
  sellTiming?: SellTimingAnalysis | null;
  reactivePct: number | null;
  it: boolean;
}) {
  if (!sellTiming) return null;
  const p = sellTiming.params;
  const wPct = (w: number) => `${Math.round((w / (p.wMomentum + p.wEis + p.wRescue || 1)) * 100)}%`;
  const beatsReactive =
    sellTiming.pDownPct != null && reactivePct != null ? sellTiming.pDownPct - reactivePct : null;
  return (
    <div className="pt-1 border-t border-[rgb(var(--border))]/30">
      <div className="flex items-end justify-between gap-2">
        <span className="text-[10px] font-medium text-ink">
          {it ? "SELL precoce · MII↓ + EIS + rescue" : "Early SELL · MII↓ + EIS + rescue"}
        </span>
        <span className="text-[9px] text-ink-muted">
          {it ? "forward ≤" : "forward ≤"}
          {p.forwardHorizonDays}
          {it ? "gg" : "d"}
        </span>
      </div>
      {sellTiming.available ? (
        <>
          <div className="flex items-end justify-between gap-2 pt-1">
            <Metric
              label={it ? "P(ribasso) precoce" : "early P(down)"}
              value={fmtPct(sellTiming.pDownPct)}
              hint={`n=${sellTiming.gradedN}${sellTiming.pendingN ? ` · ${sellTiming.pendingN} ${it ? "in attesa" : "pending"}` : ""}`}
            />
            <Metric
              label={it ? "vs reattivo" : "vs reactive"}
              value={reactivePct == null ? "—" : fmtPct(reactivePct)}
              hint={
                beatsReactive == null
                  ? undefined
                  : `${beatsReactive >= 0 ? "+" : "−"}${Math.abs(beatsReactive).toFixed(1)} pp`
              }
            />
            <Metric
              label={it ? "anticipo mediano" : "median lead"}
              value={sellTiming.medianLeadDays == null ? "—" : `${sellTiming.medianLeadDays}${it ? "gg" : "d"}`}
            />
          </div>
          <p className="text-[8.5px] text-ink-muted/90 leading-snug pt-1">
            {it
              ? `sell-score = ${wPct(p.wMomentum)} MII↓ + ${wPct(p.wEis)} EIS≤0 + ${wPct(p.wRescue)} rescue basso · soglia ${(p.threshold * 100).toFixed(0)}%. Conta come "giusta" la vendita seguita da un calo entro l'orizzonte. MII↓ = pendenza prezzo (proxy: lo storico non ha il volume).`
              : `sell-score = ${wPct(p.wMomentum)} MII↓ + ${wPct(p.wEis)} EIS≤0 + ${wPct(p.wRescue)} low rescue · threshold ${(p.threshold * 100).toFixed(0)}%. A sell counts "right" when a drop follows within the horizon. MII↓ = price slope (proxy: history has no volume).`}
          </p>
        </>
      ) : (
        <p className="text-[9px] text-ink-muted leading-snug pt-1">
          {sellTiming.note ??
            (it
              ? "Segnale di vendita precoce non ancora valutabile — si popola coi cicli."
              : "Early-sell signal not gradable yet — populates as cycles run.")}
        </p>
      )}
    </div>
  );
}

/** 1..5 reliability stars relative to the curve's peak (null -> not reliable). */
function Stars({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="text-ink-muted/60">{"☆☆☆☆☆"}</span>;
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="tabular-nums" title={`${full}/5`}>
      <span className="text-amber-500">{"★".repeat(full)}</span>
      <span className="text-ink-muted/30">{"★".repeat(5 - full)}</span>
    </span>
  );
}

function LoopRow({ loop, it }: { loop: ChannelLoopEffect; it: boolean }) {
  const tone = VERDICT_TONE[loop.verdict] ?? VERDICT_TONE.neutral;
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-[rgb(var(--border))]/20 last:border-0">
      <div className="min-w-0">
        <span className="text-[10.5px] text-ink">{loop.label}</span>
        {loop.note ? (
          <span className="block text-[9px] text-ink-muted leading-tight">{loop.note}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {loop.d_mae_pp != null ? (
          <span className="text-[10px] tabular-nums text-ink-muted" title={it ? "Δ MAE col loop attivo" : "Δ MAE with loop on"}>
            {fmtSigned(loop.d_mae_pp)} MAE
          </span>
        ) : null}
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${tone}`}>
          {verdictLabel(loop.verdict, it)}
        </span>
      </div>
    </div>
  );
}

export function ChannelImpactPanels({
  data,
  it,
  rescue,
  sellTiming,
  onReestimate,
  reestimating,
}: {
  data?: ChannelImpact;
  it: boolean;
  rescue?: RescueReboundAnalysis | null;
  sellTiming?: SellTimingAnalysis | null;
  onReestimate?: () => void | Promise<void>;
  reestimating?: boolean;
}) {
  const [baseline, setBaseline] = useState<ChannelBaseline | null>(() => readChannelBaseline());
  const metrics = useMemo<ChannelMetricMap>(
    () => (data && !data.error ? collectChannelMetrics(data, rescue) : {}),
    [data, rescue],
  );
  const deltaOf = (key: string): number | null => {
    if (!baseline) return null;
    const cur = metrics[key];
    const base = baseline.metrics[key];
    if (cur == null || base == null) return null;
    return cur - base;
  };
  const handleReestimate = async () => {
    // Snapshot the values on screen now, so the recomputed ones are diffed
    // against them (arrows + green/red windows).
    const snapshot: ChannelBaseline = { metrics, at: new Date().toISOString() };
    writeChannelBaseline(snapshot);
    setBaseline(snapshot);
    await onReestimate?.();
  };

  if (!data || data.error) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 text-[11px] text-ink-muted">
        {it
          ? "Impatto per canale non disponibile (rigenera la sim per popolare i dati)."
          : "Per-channel impact unavailable (rebuild the sim to populate)."}
        {data?.error ? <span className="block text-[9px] mt-1 opacity-70">{data.error}</span> : null}
      </div>
    );
  }

  const pred = data.prediction;
  const rec = data.recommendation;
  const trd = data.trading;
  const baselineAt = baseline
    ? new Date(baseline.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {it ? "Impatto per canale" : "Per-channel impact"}
          </h3>
          <p className="text-[10px] text-ink-muted">
            {it
              ? "I tre canali che muovono davvero l'efficienza: predizione, raccomandazione, trading. I loop di magnitudo (sotto) hanno impatto ≈0."
              : "The three channels that actually move efficiency: prediction, recommendation, trading. The magnitude loops (below) have ≈0 impact."}
          </p>
          {baselineAt ? (
            <p className="text-[9px] text-ink-muted/80">
              {it ? `frecce ▲▼ = variazione vs ultima stima (${baselineAt})` : `arrows ▲▼ = change vs last estimate (${baselineAt})`}
            </p>
          ) : null}
        </div>
        {onReestimate ? (
          <button
            type="button"
            onClick={handleReestimate}
            disabled={reestimating}
            className="shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/60 px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reestimating
              ? it ? "Ristimo…" : "Re-estimating…"
              : it ? "↻ Ristima valori" : "↻ Re-estimate"}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* ── Channel 1 · Prediction ─────────────────────────────── */}
        <Panel
          title={it ? "1 · Predizione" : "1 · Prediction"}
          subtitle={it ? "qualità curva pre-CD (segno + prezzo)" : "pre-CD curve quality (sign + price)"}
        >
          {pred && pred.available ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <Metric
                  label={it ? "sign-hit max" : "max sign-hit"}
                  value={fmtPct(pred.best_node?.sign_hit_pct ?? null)}
                  hint={pred.best_node ? `@ ${pred.best_node.label}` : undefined}
                  delta={deltaOf("pred.max")}
                />
                <Metric
                  label={it ? "sign-hit min" : "min sign-hit"}
                  value={fmtPct(pred.worst_node?.sign_hit_pct ?? null)}
                  hint={pred.worst_node ? `@ ${pred.worst_node.label}` : undefined}
                  delta={deltaOf("pred.min")}
                />
                <Metric label={it ? "sedute" : "sessions"} value={pred.n_sessions != null ? String(pred.n_sessions) : "—"} />
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums pt-0.5">
                <span className="text-ink-muted">{it ? "media pre-CD · accur. prezzo" : "pre-CD avg · price acc."}</span>
                <span className="text-ink-muted">
                  {fmtPct(pred.pre_cd_sign_hit_pct)} · {fmtPct(pred.pre_cd_price_accuracy_pct)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
                <span className="text-ink-muted">{it ? "benchmark (cohorte storica)" : "benchmark (historical cohort)"}</span>
                <span className="text-ink-muted">
                  {fmtPct(pred.benchmark_sign_hit_pct)} · {fmtPct(pred.benchmark_price_accuracy_pct)}
                </span>
              </div>
              {pred.reliability_by_cd && pred.reliability_by_cd.length > 0 ? (
                <div className="pt-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-muted">
                      {it ? "affidabilità per distanza-CD (T-60→T-1)" : "reliability by distance-to-CD"}
                    </span>
                    <Sparkline values={pred.reliability_by_cd.map((r) => r.sign_hit_pct)} positiveIsGood />
                  </div>
                  {pred.reliability_window ? (
                    <>
                      <div className="flex items-center justify-between gap-2 text-[12px] tabular-nums pt-0.5">
                        <span className="text-ink-muted">{it ? "finestra affidabile" : "reliable window"}</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          T{pred.reliability_window.lo_offset}→T{pred.reliability_window.hi_offset}
                        </span>
                      </div>
                      {pred.reliability_bands && pred.reliability_bands.length > 0 ? (
                        <div className="space-y-0.5 pt-1">
                          <span className="block text-[11px] font-medium text-ink">
                            {it ? "affidabilità media per periodo" : "average reliability by period"}
                          </span>
                          {pred.reliability_bands.map((b) => {
                            const d = deltaOf(`pred.band.${b.key}`);
                            return (
                              <div
                                key={b.key}
                                className={`flex items-center justify-between gap-2 text-[13px] tabular-nums py-0.5 ${deltaRowTone(d)}`}
                              >
                                <span className="text-ink">{it ? b.label_it : b.label_en}</span>
                                {b.mean_pct == null ? (
                                  <span className="text-[11px] text-ink-muted/60">
                                    {it ? "n/d · curva da CD−60g" : "n/a · curve from CD−60d"}
                                  </span>
                                ) : (
                                  <span className="flex items-baseline gap-1">
                                    <span className={`font-semibold ${deltaTone(d) || "text-emerald-600 dark:text-emerald-400"}`}>
                                      {fmtPct(b.mean_pct)}
                                    </span>
                                    <DeltaArrow diff={d} />
                                    <span className="text-[11px] text-ink-muted">· n={b.n}</span>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums pt-0.5">
                        <span className="text-ink-muted">{it ? "stelle per nodo" : "stars by node"}</span>
                        {pred.reliability_by_cd
                          .filter((r) => r.reliable && r.stars != null)
                          .sort((a, b) => b.offset - a.offset)
                          .map((r) => (
                            <span key={r.offset} className="inline-flex items-center gap-0.5">
                              <span className="text-ink-muted">{r.label}</span>
                              <Stars n={r.stars} />
                            </span>
                          ))}
                      </div>
                      <span className="block text-[10px] text-ink-muted/80 leading-snug">
                        {it
                          ? "5★ entro 2pp dal picco · fuori finestra: non affidabile (nessuna stima)"
                          : "5★ within 2pp of peak · outside window: not reliable (no estimate)"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[8px] text-ink-muted/80 leading-snug">
                      {it
                        ? "finestra affidabile non ancora calcolabile (curva in raccolta)"
                        : "reliable window not computable yet (curve collecting)"}
                    </span>
                  )}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[9px] text-ink-muted">{it ? "trend sign-hit pre-CD (settimane)" : "pre-CD sign-hit trend (weeks)"}</span>
                <Sparkline values={pred.weekly.map((w) => w.sign_hit_pct)} positiveIsGood />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-ink-muted">{it ? "miglioramento settimanale" : "weekly improvement"}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`text-[10px] tabular-nums ${liftClass(pred.weekly_delta_pp)}`}>
                    {fmtSigned(pred.weekly_delta_pp)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                      pred.weekly_significant ? VERDICT_TONE.improving : VERDICT_TONE.neutral
                    }`}
                  >
                    {pred.weekly_significant
                      ? it ? "significativo" : "significant"
                      : it ? "non significativo" : "not significant"}
                  </span>
                </span>
              </div>
              <div className="pt-1">
                <span className="text-[9px] uppercase tracking-wide text-ink-muted">{it ? "loop sul canale" : "loops on channel"}</span>
                {pred.loops.map((lp) => (
                  <LoopRow key={lp.loop} loop={lp} it={it} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-ink-muted leading-snug italic">
              {pred?.note ??
                (it
                  ? "Curva pre-CD non disponibile: rigenera model_sign_curve_daily.json."
                  : "Pre-CD curve unavailable: rebuild model_sign_curve_daily.json.")}
            </p>
          )}
        </Panel>

        {/* ── Channel 2 · Recommendation ─────────────────────────── */}
        <Panel
          title={it ? "2 · Raccomandazione" : "2 · Recommendation"}
          subtitle={
            it ? "follow-through direzionale per azione" : "directional follow-through by action"
          }
          badge={
            rec && !rec.available && !rescue?.available
              ? { text: it ? "in raccolta" : "collecting", tone: VERDICT_TONE.collecting_data }
              : undefined
          }
        >
          {rec && (rec.available || rescue?.available) ? (
            <>
              {/* BUY -> P(price up) · SELL -> P(price down) */}
              <div className="flex items-end justify-between gap-2">
                <Metric
                  label={it ? "BUY → P(rialzo)" : "BUY → P(up)"}
                  value={fmtPct(rec.buy.up_hit_pct)}
                  hint={`n=${rec.buy.graded_n}`}
                  delta={deltaOf("rec.buy")}
                />
                <Metric
                  label={it ? "SELL → P(ribasso)" : "SELL → P(down)"}
                  value={fmtPct(rec.sell.down_hit_pct)}
                  delta={deltaOf("rec.sell")}
                  hint={
                    rec.sell.graded_n === 0
                      ? rec.sell.pending_n > 0
                        ? `${it ? "in raccolta" : "collecting"} · ${rec.sell.pending_n} ${it ? "in attesa" : "pending"}`
                        : it ? "in raccolta · 0 vendite" : "collecting · 0 sales"
                      : rec.sell.pending_n > 0
                        ? `n=${rec.sell.graded_n}/${rec.sell.n} · ${rec.sell.pending_n} ${it ? "in attesa" : "pending"}`
                        : `n=${rec.sell.graded_n}`
                  }
                />
              </div>
              <p className="text-[8px] text-ink-muted/80 leading-snug">
                {it
                  ? "SELL → P(ribasso) = quota di vendite dopo cui il prezzo è sceso (prezzo di uscita → prezzo attuale): probabilità che la vendita sia corretta. Conta ogni uscita; dettaglio per motivo sotto."
                  : "SELL → P(down) = share of sales after which the price fell (exit price → latest price): probability the sell was right. Counts every exit; breakdown by reason below."}
              </p>

              {rec.sell.by_reason.length > 0 ? (
                <div className="pt-1">
                  <div className="flex justify-between text-[9px] text-ink-muted px-0.5">
                    <span>{it ? "SELL per motivo" : "SELL by reason"}</span>
                    <span>{it ? "n · P(ribasso)" : "n · P(down)"}</span>
                  </div>
                  {rec.sell.by_reason.map((b) => {
                    const d = deltaOf(`rec.sell.${b.reason}`);
                    return (
                      <div
                        key={b.reason}
                        className={`flex items-center justify-between gap-2 py-1 border-b border-[rgb(var(--border))]/20 last:border-0 ${deltaRowTone(d)}`}
                      >
                        <span className="text-[10.5px] text-ink">
                          {(SELL_REASON_LABEL[b.reason]?.[it ? "it" : "en"]) ?? b.reason}
                        </span>
                        <span className="flex items-baseline gap-1 text-[10px] tabular-nums">
                          <span className={deltaTone(d) || "text-ink-muted"}>
                            {b.n} · {fmtPct(b.down_hit_pct)}
                          </span>
                          <DeltaArrow diff={d} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Predictive SELL timing: MII↓ + EIS≤0 + low rescue, walk-forward graded */}
              <SellTimingBlock sellTiming={sellTiming} reactivePct={rec.sell.down_hit_pct} it={it} />

              {/* HOLD -> rescue score vs actual rebound (computed in the UI sheet) */}
              <div className="pt-1 border-t border-[rgb(var(--border))]/30">
                <div className="flex items-end justify-between gap-2">
                  <span className="text-[10px] font-medium text-ink">
                    {it ? "HOLD · rescue → rimbalzo" : "HOLD · rescue → rebound"}
                  </span>
                  {rescue?.available ? (
                    <span className="text-[9px] text-ink-muted">
                      {it ? "rimbalzo ≤" : "rebound ≤"}
                      {rescue.reboundHorizonDays}
                      {it ? "gg" : "d"}
                    </span>
                  ) : null}
                </div>
                {rescue?.available ? (
                  <>
                    <div className="flex items-end justify-between gap-2 pt-1">
                      <Metric
                        label={it ? "hit rimbalzo" : "rebound hit"}
                        value={fmtPct(rescue.hitRatePct)}
                        hint={`n=${rescue.n}`}
                        delta={deltaOf("rescue.hit")}
                      />
                      <Metric
                        label={it ? "corr score↔gg" : "corr score↔days"}
                        value={fmt(rescue.corrScoreDays)}
                      />
                      <Metric
                        label={it ? "corr score↔taglia" : "corr score↔size"}
                        value={fmt(rescue.corrScoreSize)}
                      />
                    </div>
                    <div className="pt-1.5">
                      <div className="text-[10px] font-medium text-ink px-0.5 pb-0.5">
                        {it ? "efficienza rescue score per tier" : "rescue-score efficiency by tier"}
                      </div>
                      <div className="flex justify-between text-[10px] text-ink-muted px-0.5">
                        <span>{it ? "tier score" : "score tier"}</span>
                        <span>{it ? "n · hit · gg · taglia" : "n · hit · days · size"}</span>
                      </div>
                      {rescue.tiers
                        .filter((t) => t.n > 0)
                        .map((t) => {
                          const d = deltaOf(`rescue.tier.${t.tier}`);
                          return (
                            <div
                              key={t.tier}
                              className={`flex items-center justify-between gap-2 py-1.5 border-b border-[rgb(var(--border))]/20 last:border-0 ${deltaRowTone(d)}`}
                            >
                              <span className="text-[13px] font-medium text-ink">{t.band}</span>
                              <span className="flex items-baseline gap-1 text-[12px] tabular-nums text-ink">
                                <span>
                                  {t.n} · <span className={`font-semibold ${deltaTone(d)}`}>{fmtPct(t.hitRatePct)}</span> ·{" "}
                                  {t.medianDaysToRebound == null ? "—" : `${fmt(t.medianDaysToRebound, 0)}${it ? "gg" : "d"}`}{" "}
                                  · {fmt(t.meanReboundSizePct, 1)}%
                                </span>
                                <DeltaArrow diff={d} />
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <p className="text-[9px] text-ink-muted leading-snug pt-1">
                    {it
                      ? "Nessuna posizione in perdita nello storico: il rescue → rimbalzo si popola coi cicli."
                      : "No loss episode in history yet: rescue → rebound populates as cycles run."}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[9px] text-ink-muted">
                  {it ? "trend P(rialzo) BUY" : "BUY P(up) trend"}
                </span>
                <Sparkline values={rec.weekly.map((w) => w.buy_up_hit_pct)} positiveIsGood />
              </div>
            </>
          ) : (
            <p className="text-[10px] text-ink-muted leading-snug">
              {rec?.note ??
                (it
                  ? "Nessun BUY/SELL valutabile ancora. Si popola coi cicli chiusi."
                  : "No gradable BUY/SELL yet. Populates as cycles close.")}
            </p>
          )}
        </Panel>

        {/* ── Channel 3 · Trading ────────────────────────────────── */}
        <Panel
          title={it ? "3 · Trading" : "3 · Trading"}
          subtitle={it ? "P&L per trade + win-rate" : "P&L per trade + win-rate"}
        >
          {trd ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <Metric label={it ? "win-rate" : "win-rate"} value={fmtPct(trd.win_pct)} delta={deltaOf("trd.win")} />
                <Metric label={it ? "P&L medio" : "mean P&L"} value={`${fmt(trd.mean_pnl_pct)}%`} delta={deltaOf("trd.meanPnl")} />
                <Metric label="n" value={String(trd.n)} />
              </div>
              <div className="flex items-end justify-between gap-2">
                <Metric label={it ? "P&L mediano" : "median P&L"} value={`${fmt(trd.median_pnl_pct)}%`} delta={deltaOf("trd.medianPnl")} />
                <Metric label={it ? "tot €" : "total €"} value={fmt(trd.total_eur, 0)} />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[9px] text-ink-muted">{it ? "trend P&L medio %" : "mean P&L% trend"}</span>
                <Sparkline values={trd.weekly.map((w) => w.mean_pnl_pct)} positiveIsGood />
              </div>
              <div className="pt-1 space-y-0.5">
                <span className="text-[9px] uppercase tracking-wide text-ink-muted">{it ? "ultime settimane" : "recent weeks"}</span>
                {trd.weekly.slice(-4).map((w) => (
                  <div key={w.week} className="flex items-center justify-between text-[10px] tabular-nums">
                    <span className="text-ink-muted">{w.week}</span>
                    <span className="text-ink">
                      {w.n}t · {fmtPct(w.win_pct)} · {fmt(w.mean_pnl_pct)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-1 space-y-0.5">
                <div className="flex justify-between text-[9px] uppercase tracking-wide text-ink-muted px-0.5">
                  <span>{it ? "P&L per regime d'ingresso" : "P&L by entry regime"}</span>
                  <span className="normal-case">{it ? "n · win% · P&L · lift" : "n · win% · P&L · lift"}</span>
                </div>
                {trd.regimes && trd.regimes.length > 0 ? (
                  trd.regimes.map((rg) => (
                    <div key={rg.regime} className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
                      <span className="text-ink">{rg.regime}</span>
                      <span className="text-ink-muted">
                        {rg.n} · {fmtPct(rg.win_pct)} · {fmt(rg.mean_pnl_pct)}% ·{" "}
                        <span className={liftClass(rg.lift_vs_book_pp)}>{fmtSigned(rg.lift_vs_book_pp)}</span>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[9px] text-ink-muted italic leading-snug">
                    {it
                      ? "In raccolta: il regime d'ingresso si popola sui nuovi trade chiusi (lo storico non lo porta)."
                      : "Collecting: entry regime populates on newly closed trades (history lacks it)."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-ink-muted italic">{it ? "nessuna posizione" : "no positions"}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
