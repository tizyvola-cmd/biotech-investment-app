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
import type { ChannelImpact, ChannelLoopEffect } from "../api/supernova";

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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums text-ink leading-none">{value}</span>
      <span className="text-[9px] text-ink-muted">{label}</span>
    </div>
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

export function ChannelImpactPanels({ data, it }: { data?: ChannelImpact; it: boolean }) {
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

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          {it ? "Impatto per canale" : "Per-channel impact"}
        </h3>
        <p className="text-[10px] text-ink-muted">
          {it
            ? "I tre canali che muovono davvero l'efficienza: predizione, raccomandazione, trading. I loop di magnitudo (sotto) hanno impatto ≈0."
            : "The three channels that actually move efficiency: prediction, recommendation, trading. The magnitude loops (below) have ≈0 impact."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* ── Channel 1 · Prediction ─────────────────────────────── */}
        <Panel
          title={it ? "1 · Predizione" : "1 · Prediction"}
          subtitle={it ? "direction-hit % + errore di calibrazione" : "direction-hit % + calibration error"}
        >
          {pred ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <Metric label={it ? "direction-hit" : "direction-hit"} value={fmtPct(pred.direction_hit_pct)} />
                <Metric label={it ? "|bias|" : "|bias|"} value={`${fmt(pred.abs_bias_pp)} pp`} />
                <Metric label="MAE" value={`${fmt(pred.mae_pp)} pp`} />
                <Metric label="n" value={String(pred.n)} />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[9px] text-ink-muted">{it ? "trend direction-hit (settimane)" : "direction-hit trend (weeks)"}</span>
                <Sparkline values={pred.weekly.map((w) => w.direction_hit_pct)} positiveIsGood />
              </div>
              <div className="pt-1">
                <span className="text-[9px] uppercase tracking-wide text-ink-muted">{it ? "loop sul canale" : "loops on channel"}</span>
                {pred.loops.map((lp) => (
                  <LoopRow key={lp.loop} loop={lp} it={it} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-ink-muted italic">{it ? "nessun outcome" : "no outcomes"}</p>
          )}
        </Panel>

        {/* ── Channel 2 · Recommendation ─────────────────────────── */}
        <Panel
          title={it ? "2 · Raccomandazione" : "2 · Recommendation"}
          subtitle={it ? "hit-rate azione SDS vs book" : "SDS action hit-rate vs book"}
          badge={
            rec && !rec.available
              ? { text: it ? "in raccolta" : "collecting", tone: VERDICT_TONE.collecting_data }
              : undefined
          }
        >
          {rec && rec.available ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <Metric label={it ? "win book" : "book win"} value={fmtPct(rec.book_win_pct)} />
                <Metric label="n" value={String(rec.n)} />
              </div>
              <div className="pt-1">
                <div className="flex justify-between text-[9px] text-ink-muted px-0.5">
                  <span>{it ? "azione" : "action"}</span>
                  <span>{it ? "n · win% · lift" : "n · win% · lift"}</span>
                </div>
                {rec.actions.map((a) => (
                  <div
                    key={a.action}
                    className="flex items-center justify-between gap-2 py-1 border-b border-[rgb(var(--border))]/20 last:border-0"
                  >
                    <span className="text-[10.5px] text-ink">{a.action}</span>
                    <span className="text-[10px] tabular-nums text-ink-muted">
                      {a.n} · {fmtPct(a.win_pct)} ·{" "}
                      <span
                        className={
                          a.lift_vs_book_pp != null && a.lift_vs_book_pp > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : a.lift_vs_book_pp != null && a.lift_vs_book_pp < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : ""
                        }
                      >
                        {fmtSigned(a.lift_vs_book_pp)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[9px] text-ink-muted">{it ? "trend win% BUY" : "BUY win% trend"}</span>
                <Sparkline values={rec.weekly.map((w) => w.buy_win_pct)} positiveIsGood />
              </div>
            </>
          ) : (
            <p className="text-[10px] text-ink-muted leading-snug">
              {rec?.note ??
                (it
                  ? "Nessuna posizione porta ancora l'SDS d'ingresso. Si popola con i nuovi cicli."
                  : "No position carries entry SDS yet. Populates as new cycles close.")}
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
                <Metric label={it ? "win-rate" : "win-rate"} value={fmtPct(trd.win_pct)} />
                <Metric label={it ? "P&L medio" : "mean P&L"} value={`${fmt(trd.mean_pnl_pct)}%`} />
                <Metric label="n" value={String(trd.n)} />
              </div>
              <div className="flex items-end justify-between gap-2">
                <Metric label={it ? "P&L mediano" : "median P&L"} value={`${fmt(trd.median_pnl_pct)}%`} />
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
