import { useMemo, type ReactNode } from "react";
import type { SheetTable } from "../types";
import { useLang } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import {
  loadInvestSimHistory,
  loadInvestSimInputs,
} from "../sheet/investSimStorage";
import { aggregateOpenPortfolioPnl } from "../sheet/simulationPosition";
import {
  analyzeSellErrors,
  buildAcceptanceBreakdown,
  type AcceptanceCandidate,
  type SellErrorRow,
} from "../sheet/sellErrorAnalysis";
import { loadSimLoopPolicy } from "../sheet/simLoopAcceptancePolicy";
import {
  SIM_LOOP_BUY_PROB_MIN,
  SIM_LOOP_BUY_WATCH_PROB_MIN,
  MOMENTUM_P_STRONG_MIN,
} from "../sheet/investDecisionSimLoop";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { SIM_TABLE_SYNTH_MAX_SHARE } from "../sheet/approvedWeightPortfolioShares";
import { DEFAULT_MAX_OPEN_POSITIONS } from "../sheet/investDecisionSimExperiment";

const eurFmt = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return eurFmt.format(Math.round(v));
}

function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;
}

/** Extract acceptance candidates from the current Simulation sheet rows. */
function candidatesFromSimTable(simTable: SheetTable | null | undefined): AcceptanceCandidate[] {
  const rows = simTable?.rows ?? [];
  const out: AcceptanceCandidate[] = [];
  for (const row of rows) {
    const ticker = String(row["Ticker"] ?? row["ticker"] ?? "").trim();
    if (!ticker) continue;
    const sds: number | null = (() => {
      const raw = row["SDS"] ?? row["sds"];
      if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
      return null;
    })();
    const pplanPct: number | null = (() => {
      const raw =
        row["Plan_Prob_Pct"] ?? row["Affidabilità\ncalib %"] ?? row["Affidabilità\n%"];
      if (raw == null) return null;
      const n = Number(String(raw).replace("%", "").replace(",", "."));
      if (!Number.isFinite(n)) return null;
      return Math.abs(n) <= 1.5 ? n * 100 : n;
    })();
    const suggestedAction = String(
      row["suggestedAction"] ?? row["Suggested Action"] ?? "",
    ).toLowerCase() || null;
    out.push({ ticker, suggestedAction, sds, pplanPct });
  }
  return out;
}

function CertoBadge({ it }: { it: boolean }) {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
      {it ? "dato certo" : "observed fact"}
    </span>
  );
}

function StimaBadge({ it }: { it: boolean }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30">
      {it ? "stima controfattuale" : "controfactual estimate"}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "neutral" | "good" | "warn" | "bad";
  badge?: ReactNode;
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : "text-ink";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/80 dark:bg-white/5 p-3 flex flex-col gap-1 min-w-[10rem]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-ink-muted leading-tight">{label}</span>
        {badge}
      </div>
      <span className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</span>
      {sub ? <span className="text-[9px] text-ink-muted leading-snug">{sub}</span> : null}
    </div>
  );
}

/** Simple 3-step gain-open waterfall: real → + missed-sell recovery (estimate) → ideal. */
function GainOpenWaterfall({
  real,
  missedRecovery,
  it,
}: {
  real: number;
  missedRecovery: number;
  it: boolean;
}) {
  const ideal = real + missedRecovery;
  const maxAbs = Math.max(Math.abs(real), Math.abs(ideal), 1);
  const widthPct = (v: number) => `${Math.min(100, (Math.abs(v) / maxAbs) * 100)}%`;
  const bars: { label: string; value: number; cls: string; badge?: ReactNode }[] = [
    {
      label: it ? "Gain open reale" : "Real open gain",
      value: real,
      cls: real >= 0 ? "bg-sky-500/70" : "bg-rose-500/70",
      badge: <CertoBadge it={it} />,
    },
    {
      label: it ? "+ recupero mancate vendite" : "+ missed-sell recovery",
      value: missedRecovery,
      cls: "bg-amber-500/70",
      badge: <StimaBadge it={it} />,
    },
    {
      label: it ? "Gain open ideale" : "Ideal open gain",
      value: ideal,
      cls: ideal >= 0 ? "bg-emerald-500/70" : "bg-rose-500/70",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <div className="w-44 shrink-0 flex items-center gap-1.5">
            <span className="text-[10px] text-ink leading-tight">{b.label}</span>
            {b.badge}
          </div>
          <div className="flex-1 h-4 rounded bg-surface/30 overflow-hidden">
            <div className={`h-full ${b.cls}`} style={{ width: widthPct(b.value) }} />
          </div>
          <span className="w-20 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink">
            {fmtEur(b.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SellErrorTable({ rows, it }: { rows: SellErrorRow[]; it: boolean }) {
  if (!rows.length) {
    return (
      <p className="text-[11px] text-ink-muted">
        {it
          ? "Nessun segnale di vendita controfattuale sulle posizioni aperte attuali."
          : "No controfactual sell signal on the currently open positions."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-ink-muted text-left border-b border-[rgb(var(--border))]/40">
            <th className="py-1 pr-2 font-medium">{it ? "Titolo" : "Ticker"}</th>
            <th className="py-1 pr-2 font-medium">{it ? "Tipo" : "Type"}</th>
            <th className="py-1 pr-2 font-medium text-right">{it ? "Mossa post" : "Post move"}</th>
            <th className="py-1 pr-2 font-medium text-right">{it ? "Impatto €" : "Impact €"}</th>
            <th className="py-1 pr-2 font-medium text-right">{it ? "Anticipo" : "Lead"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.key}-${i}`} className="border-b border-[rgb(var(--border))]/20">
              <td className="py-1 pr-2 font-medium text-ink">{r.ticker}</td>
              <td className="py-1 pr-2">
                {r.kind === "missed" ? (
                  <span className="text-amber-700 dark:text-amber-300">
                    {it ? "mancata vendita" : "missed sell"}
                  </span>
                ) : (
                  <span className="text-sky-700 dark:text-sky-300">
                    {it ? "vendita precoce (se seguita)" : "premature (if followed)"}
                  </span>
                )}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{fmtPp(r.forwardMovePct)}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-semibold">{fmtEur(r.impactEur)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">
                {r.leadDays != null ? `${r.leadDays}${it ? "gg" : "d"}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcceptanceBreakdownTable({
  simTable,
  it,
}: {
  simTable: SheetTable | null | undefined;
  it: boolean;
}) {
  const policy = useMemo(() => loadSimLoopPolicy(), []);
  const breakdown = useMemo(
    () =>
      buildAcceptanceBreakdown(candidatesFromSimTable(simTable), {
        minPplanPct: policy.minPplanPct,
        minSds: policy.minSds,
      }),
    [simTable, policy.minPplanPct, policy.minSds],
  );

  const rows: { label: string; n: number; tone: string }[] = [
    {
      label: it ? "Accolta (entra)" : "Accepted (enters)",
      n: breakdown.accepted,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: it ? `Scartata · P(plan) < ${policy.minPplanPct}%` : `Rejected · P(plan) < ${policy.minPplanPct}%`,
      n: breakdown.byReason.belowPplan,
      tone: "text-rose-600 dark:text-rose-400",
    },
    {
      label: it ? `Scartata · SDS < ${policy.minSds}` : `Rejected · SDS < ${policy.minSds}`,
      n: breakdown.byReason.belowSds,
      tone: "text-rose-600 dark:text-rose-400",
    },
    {
      label: it ? "Non-passata · non è BUY" : "Not passed · not a BUY",
      n: breakdown.byReason.notBuy,
      tone: "text-ink-muted",
    },
    {
      label: it ? "Scartata · book pieno" : "Rejected · book full",
      n: 0,
      tone: "text-ink-muted",
    },
    {
      label: it ? "Dato mancante (SDS/P)" : "Missing data (SDS/P)",
      n: breakdown.byReason.unknown,
      tone: "text-ink-muted",
    },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-ink-muted text-left border-b border-[rgb(var(--border))]/40">
            <th className="py-1 pr-2 font-medium">{it ? "Esito (snapshot oggi)" : "Outcome (today snapshot)"}</th>
            <th className="py-1 pr-2 font-medium text-right">{it ? "Sim loop" : "Sim loop"}</th>
            <th className="py-1 pr-2 font-medium text-right">{it ? "Synth sim loop" : "Synth sim loop"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-[rgb(var(--border))]/20">
              <td className={`py-1 pr-2 ${r.tone}`}>{r.label}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-semibold">{r.n}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-semibold">{r.n}</td>
            </tr>
          ))}
          <tr className="border-t border-[rgb(var(--border))]/40">
            <td className="py-1 pr-2 font-semibold text-ink">{it ? "Totale candidati" : "Total candidates"}</td>
            <td className="py-1 pr-2 text-right tabular-nums font-semibold">{breakdown.total}</td>
            <td className="py-1 pr-2 text-right tabular-nums font-semibold">{breakdown.total}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-[9px] text-ink-muted leading-snug mt-1">
        {it
          ? "Sim loop e synth sim loop condividono lo STESSO gate di accettazione (stessa soglia/universo): le colonne coincidono. La differenza è solo nel sizing del capitale (sotto)."
          : "Sim loop and synth sim loop share the SAME acceptance gate (same threshold/universe): the columns match. They differ only in capital sizing (below)."}
      </p>
    </div>
  );
}

export function SellsQualityPanel({
  simTable = null,
  reloadToken = 0,
}: {
  simTable?: SheetTable | null;
  reloadToken?: number;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const { analysis, gainOpenReal } = useMemo(() => {
    const history = loadInvestSimHistory();
    const inputs = loadInvestSimInputs();
    const a = analyzeSellErrors({ history, inputs });
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
    return { analysis: a, gainOpenReal: totals.pnlEur };
    // reloadToken forces a re-read of localStorage history/inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simTable, reloadToken]);

  const capPct = Math.round(SIM_TABLE_SYNTH_MAX_SHARE * 100);
  const bookCapped = Number.isFinite(DEFAULT_MAX_OPEN_POSITIONS);

  return (
    <div className="flex flex-col flex-1 gap-4 pr-1">
      {/* Intro */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-gradient-to-br from-white via-rose-50/40 to-amber-50/30 dark:from-white/5 dark:via-white/5 dark:to-white/5 p-4 space-y-1 shrink-0">
        <h3 className="text-base font-semibold text-ink">
          {it ? "Sells · qualità delle uscite" : "Sells · exit quality"}
        </h3>
        <p className="text-[11px] text-ink-muted leading-snug max-w-3xl">
          {it
            ? "Analisi read-only degli errori di vendita e dell'adesione alle raccomandazioni. Niente simulazioni, email o tick partono da questa scheda."
            : "Read-only analysis of sell errors and recommendation adherence. No simulations, emails or ticks are triggered from this tab."}
        </p>
        <p className="text-[10px] text-ink-muted/90 leading-snug flex flex-wrap items-center gap-2 pt-1">
          <CertoBadge it={it} />
          <span>{it ? "= osservato sullo storico" : "= observed in history"}</span>
          <StimaBadge it={it} />
          <span>{it ? "= controfattuale, non un fatto" : "= controfactual, not a fact"}</span>
        </p>
      </div>

      {/* Section A */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 dark:bg-white/5 p-4 space-y-3 shrink-0">
        <div>
          <h4 className="text-sm font-semibold text-ink">
            {it ? "A · Tassonomia errori SELL + impatto sul gain open" : "A · SELL error taxonomy + open-gain impact"}
          </h4>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300 leading-snug flex items-start gap-2">
          <span aria-hidden>ⓘ</span>
          <span>
            {it
              ? "Le vendite precoci REALI (uscita già chiusa → prezzo successivo, dato certo) non sono calcolabili in-UI: lo storico del portafoglio non conserva il titolo dopo la vendita (serve una serie prezzo post-uscita dal backend). Qui sotto misuriamo il controfattuale del segnale di debolezza sulle posizioni ANCORA APERTE — è una stima, etichettata come tale."
              : "REAL premature sells (closed exit → subsequent price, observed fact) cannot be computed in-UI: portfolio history drops the ticker once sold (a post-exit price series from the backend is needed). Below we measure the controfactual weakness signal on STILL-OPEN positions — an estimate, labelled as such."}
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          <KpiCard
            tone={gainOpenReal >= 0 ? "good" : "bad"}
            label={it ? "Gain open reale" : "Real open gain"}
            value={fmtEur(gainOpenReal)}
            badge={<CertoBadge it={it} />}
            sub={it ? "posizioni aperte (fonte unica)" : "open positions (single source)"}
          />
          <KpiCard
            tone="warn"
            label={it ? "Mancate vendite · erosione" : "Missed sells · erosion"}
            value={fmtEur(analysis.missedSellErosionEur)}
            badge={<StimaBadge it={it} />}
            sub={
              it
                ? `${analysis.missedSellCount} segnali · tenuto mentre scendeva`
                : `${analysis.missedSellCount} signals · held while falling`
            }
          />
          <KpiCard
            tone="neutral"
            label={it ? "Vendite precoci se seguite · costo" : "Premature if followed · cost"}
            value={fmtEur(analysis.prematureCostEur)}
            badge={<StimaBadge it={it} />}
            sub={
              it
                ? `${analysis.prematureCount} falsi positivi · prezzo poi risalito`
                : `${analysis.prematureCount} false positives · price then rose`
            }
          />
          <KpiCard
            tone="neutral"
            label={it ? "P(ribasso) precoce" : "Early P(down)"}
            value={analysis.timing.pDownPct != null ? `${Math.round(analysis.timing.pDownPct)}%` : "—"}
            sub={
              it
                ? `n=${analysis.timing.gradedN}${analysis.timing.medianLeadDays != null ? ` · anticipo ${analysis.timing.medianLeadDays}gg` : ""}`
                : `n=${analysis.timing.gradedN}${analysis.timing.medianLeadDays != null ? ` · lead ${analysis.timing.medianLeadDays}d` : ""}`
            }
          />
        </div>

        <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/20 p-3 space-y-2">
          <p className="text-[10px] font-medium text-ink-muted">
            {it
              ? "Cascata gain open — quanto recupererebbe vendendo sui segnali mancati (stima)"
              : "Open-gain waterfall — how much selling on missed signals would recover (estimate)"}
          </p>
          <GainOpenWaterfall real={gainOpenReal} missedRecovery={analysis.missedSellErosionEur} it={it} />
        </div>

        <SellErrorTable rows={analysis.rows} it={it} />
      </div>

      {/* Section B */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 dark:bg-white/5 p-4 space-y-3 shrink-0">
        <div>
          <h4 className="text-sm font-semibold text-ink">
            {it ? "B · Adesione alla raccomandazione (sim loop vs synth sim loop)" : "B · Recommendation adherence (sim loop vs synth sim loop)"}
          </h4>
        </div>

        <AcceptanceBreakdownTable simTable={simTable} it={it} />

        {/* Capital rule per experiment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/20 p-2.5 text-[10px] leading-snug">
            <span className="font-semibold text-ink">{it ? "Sim loop (uniforme)" : "Sim loop (uniform)"}</span>
            <p className="text-ink-muted mt-0.5">
              {it
                ? `${fmtEur(DEFAULT_PLAN_CAPITAL_EUR)} fissi a company.`
                : `${fmtEur(DEFAULT_PLAN_CAPITAL_EUR)} fixed per company.`}
            </p>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/20 p-2.5 text-[10px] leading-snug">
            <span className="font-semibold text-ink">{it ? "Synth sim loop (pesato)" : "Synth sim loop (weighted)"}</span>
            <p className="text-ink-muted mt-0.5">
              {it
                ? `Capitale ridistribuito sui pesi del pattern approvato (cap ${capPct}%/deal).`
                : `Capital redistributed on the approved pattern weights (cap ${capPct}%/deal).`}
            </p>
          </div>
        </div>

        {/* Thresholds legend */}
        <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/20 p-3 text-[10px] text-ink-muted leading-snug space-y-1">
          <p>
            <span className="font-semibold text-ink">{it ? "Due livelli di soglia:" : "Two threshold levels:"}</span>{" "}
            {it
              ? `accettazione sim loop = P(plan) ≥ 50% · SDS ≥ 30 · solo BUY espliciti (gate). Derivazione dell'azione a monte = P ≥ ${SIM_LOOP_BUY_PROB_MIN}% (BUY), ${SIM_LOOP_BUY_WATCH_PROB_MIN}% (watch), ${MOMENTUM_P_STRONG_MIN}% (momentum).`
              : `sim-loop acceptance = P(plan) ≥ 50% · SDS ≥ 30 · explicit BUY only (gate). Upstream action derivation = P ≥ ${SIM_LOOP_BUY_PROB_MIN}% (BUY), ${SIM_LOOP_BUY_WATCH_PROB_MIN}% (watch), ${MOMENTUM_P_STRONG_MIN}% (momentum).`}
          </p>
          {!bookCapped ? (
            <p className="text-amber-700 dark:text-amber-300">
              {it
                ? "maxOpenPositions = ∞ (nessun cap): \"book pieno\" non scarta mai nulla, quindi la riga \"book pieno\" è sempre 0. Riflette la configurazione attuale, non un bug."
                : "maxOpenPositions = ∞ (no cap): \"book full\" never rejects anything, so the \"book full\" row is always 0. This reflects the current configuration, not a bug."}
            </p>
          ) : null}
          <p>
            {it
              ? "Conteggi = snapshot del foglio di oggi. Lo storico giorno-per-giorno (accolta/scartata nel tempo) richiede persistenza dedicata, non ancora presente."
              : "Counts = today's sheet snapshot. The day-by-day history (accepted/rejected over time) requires dedicated persistence, not yet in place."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SellsQualityTab(props: {
  simTable?: SheetTable | null;
  reloadToken?: number;
}) {
  return (
    <ViewErrorBoundary label="Sells quality">
      <SellsQualityPanel {...props} />
    </ViewErrorBoundary>
  );
}
