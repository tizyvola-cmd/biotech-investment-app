import { useMemo, useState } from "react";
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
import {
  extractAllRowFeatures,
  runUnivariateScreening,
} from "../riskPattern/lossRiskScreening";
import {
  conditionLabel,
  describePattern,
  evaluatePatternStats,
  matchPattern,
  searchBestPatternEmpirical,
  splitInVsOutOfSample,
} from "../riskPattern/lossRiskPattern";
import {
  approvePatternProposal,
  rejectPatternProposal,
} from "../riskPattern/patternProposalEngine";
import {
  loadApprovedPattern,
  listProposals,
  listFlaggedTags,
  patternApprovalSourceLabel,
} from "../riskPattern/patternProposalStore";
import { normalizedRowKey } from "../sheet/investSimKeys";
import type {
  PatternProposal,
  PatternApprovalSource,
  RiskPattern,
} from "../riskPattern/riskPatternTypes";
import { applyManualAllocationPattern } from "../riskPattern/manualAllocationPatternApply";
import { useLang } from "../shared/i18n";
import { listSnapshots } from "../sheet/patternSearchHistory";

function fmtPct01(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

export function CapDivStep2RiskView({
  closedRows,
  simTable,
  sdsRows,
  onPatternChanged,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Notify orchestrator when approved pattern changes (so Step 3 toggle picks it up). */
  onPatternChanged?: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  // â”€â”€ Phase A screening (memo on outcomes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const phaseA = useMemo(
    () => runUnivariateScreening(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );
  const features = useMemo(
    () => extractAllRowFeatures(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  // Approved pattern + history
  const [approvedRecord, setApprovedRecord] = useState(() => loadApprovedPattern());
  const [proposals, setProposals] = useState<PatternProposal[]>(() => listProposals());
  const flaggedTags = useMemo(() => listFlaggedTags(), [approvedRecord, proposals]);

  function refresh() {
    setApprovedRecord(loadApprovedPattern());
    setProposals(listProposals());
    onPatternChanged?.();
  }

  // Out-of-sample stats for the approved pattern
  const approvedOos = useMemo(() => {
    const p = approvedRecord.current;
    if (!p || !p.approvedAt) return null;
    const { outOfSample } = splitInVsOutOfSample(closedRows, p.approvedAt);
    if (outOfSample.length === 0) return null;
    return evaluatePatternStats(p, outOfSample, features);
  }, [approvedRecord, closedRows, features]);

  // ── Auto-detected empirical pattern (closed trades — retrospective) ──
  const pcseSnap = useMemo(() => {
    const snaps = listSnapshots();
    if (!snaps.length) return null;
    return snaps[snaps.length - 1]!;
  }, [proposals]);

  const [searchKey, setSearchKey] = useState(0);
  const empiricalAuto = useMemo(
    () =>
      searchBestPatternEmpirical(phaseA, closedRows, features, {
        maxConditions: 3,
        minFiredN: 5,
        minLift: 1.0,
      }),
    // searchKey is intentionally part of deps to support force-recompute
    [phaseA, closedRows, features, searchKey],
  );
  const [empiricalDismissed, setEmpiricalDismissed] = useState(false);

  function onApplyEmpiricalToScore() {
    if (!empiricalAuto) return;
    const ok = applyManualAllocationPattern(
      empiricalAuto.pattern,
      it ? "it" : "en",
      "auto_apply",
    );
    if (ok) {
      setEmpiricalDismissed(false);
    refresh();
    }
  }

  function onRerunEmpiricalSearch() {
    setEmpiricalDismissed(false);
    setSearchKey((k) => k + 1);
  }

  function onDismissEmpirical() {
    setEmpiricalDismissed(true);
  }

  function onApprove(id: string) {
    approvePatternProposal(id);
    refresh();
  }
  function onReject(id: string) {
    rejectPatternProposal(id);
    refresh();
  }

  const pending = proposals.filter((p) => p.status === "pending");

  // Scatter data for the errors panel — one bubble per resolved closed trade
  // that has both a finite entry P(plan) and a finite realised P&L%. The
  // pattern-match flags drive the rose ring overlay in the chart, so the user
  // can visually see which losses the auto-detected pattern actually catches
  // (true positives) and which wins it wrongly flags (false positives).
  const scatterPoints = useMemo<ScatterPoint[]>(() => {
    const out: ScatterPoint[] = [];
    for (const r of closedRows) {
      const prob = r.affidabilita_pct;
      const pnl = r.pnl_pct;
      if (prob == null || !Number.isFinite(prob)) continue;
      if (pnl == null || !Number.isFinite(pnl)) continue;
      const feat = features.get(normalizedRowKey(r.ticker, r.completion_date));
      const matchAuto =
        empiricalAuto?.pattern && feat ? matchPattern(empiricalAuto.pattern, feat) : false;
      const matchApproved =
        approvedRecord.current && feat ? matchPattern(approvedRecord.current, feat) : false;
      out.push({
        ticker: r.ticker,
        cd: r.completion_date,
        prob,
        pnlPct: pnl,
        isLoss: !r.is_win,
        matchAuto,
        matchApproved,
        capitalEur: r.capital_eur,
      });
    }
    return out;
  }, [closedRows, features, empiricalAuto, approvedRecord]);

  const showAutoCard = empiricalAuto != null && !empiricalDismissed;

  return (
    <section className="rounded-2xl border border-rose-200/60 dark:border-rose-800/40 bg-gradient-to-br from-rose-50/40 via-white to-amber-50/30 dark:from-rose-950/15 dark:via-surface dark:to-amber-950/15 px-4 py-4 space-y-4">
      {/* Header — single-sentence summary of the new 3-block flow:
          (1) errors scatter → (2) auto-detected pattern → (3) one-click apply. */}
      <header className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-rose-500/15 dark:bg-rose-400/20 flex items-center justify-center text-rose-700 dark:text-rose-200 font-bold">
          2
        </div>
        <div>
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-100">
            {it
              ? "Step 2 — Errori della sim loop → Pattern di rischio → Score"
              : "Step 2 — Sim-loop errors → Risk pattern → Score"}
          </h2>
          <p className="text-[11px] leading-relaxed text-rose-800/75 dark:text-rose-200/75 max-w-3xl">
            {it
              ? "Questo step identifica automaticamente quali combinazioni di caratteristiche (fascia SDS, fase clinica, ecc.) sono statisticamente associate alle perdite nel tuo storico. " +
                "Il sistema cerca il pattern AND che meglio predice le perdite, lo mostra nel grafico scatter, e ti chiede se vuoi approvarlo. " +
                "Una volta approvato, il pattern abbassa automaticamente il sizing suggerito (Step 3) per i deal che lo matchano."
              : "This step automatically identifies which feature combinations (SDS bucket, clinical phase, etc.) are statistically associated with losses in your history. " +
                "The system searches for the AND pattern that best predicts losses, shows it on the scatter chart, and asks if you want to approve it. " +
                "Once approved, the pattern automatically lowers the suggested sizing (Step 3) for any deal that matches it."}
          </p>
        </div>
      </header>

      {/* Currently approved pattern + OOS stats */}
      <ApprovedPatternCard
        approved={approvedRecord.current}
        approvalSource={approvedRecord.currentSource}
        oos={approvedOos}
        flaggedButTakenCount={flaggedTags.length}
        it={it}
      />

      <LossErrorsScatter
        points={scatterPoints}
        baseLossRate={phaseA.globalLossRate}
        totalTrades={phaseA.totalTrades}
        autoPatternConditionsLabel={
          empiricalAuto
            ? empiricalAuto.pattern.conditions
                .map((c) => conditionLabel(c, it ? "it" : "en"))
                .join(" AND ")
            : null
        }
        approvedPatternActive={approvedRecord.current != null}
        it={it}
      />

      {/* Auto-detected pattern card with one-click apply */}
      {showAutoCard && empiricalAuto ? (
        <AutoPatternCard
          result={empiricalAuto}
          activePattern={approvedRecord.current}
          onApplyToScore={onApplyEmpiricalToScore}
          onRerun={onRerunEmpiricalSearch}
          onDismiss={onDismissEmpirical}
          it={it}
        />
      ) : empiricalAuto == null ? (
        <NoEmpiricalPatternHint
          totalTrades={phaseA.totalTrades}
          onRerun={onRerunEmpiricalSearch}
          it={it}
        />
          ) : null}

      {/* Legacy proposal queue — visible only when something is pending
          (engine-generated proposals or older sessions). The 1-click flow
          above bypasses this queue. */}
      {pending.length > 0 ? (
      <PatternProposalQueue
        proposals={pending}
        onApprove={onApprove}
        onReject={onReject}
        it={it}
      />
      ) : null}

      {/* PCSE badge — stato del sistema, full UI nel Calibration Center */}
      <div className="flex items-center gap-3 rounded-xl border border-indigo-200/40 dark:border-indigo-800/30 bg-indigo-50/20 dark:bg-indigo-950/10 px-4 py-2.5">
        <span className="text-[11px] text-indigo-700 dark:text-indigo-300 font-semibold">
          {it ? "⚡ Pattern combinations" : "⚡ Pattern combinations"}
        </span>
        {pcseSnap ? (
          <>
            <span className="text-[11px] text-ink-muted">
              {pcseSnap.topCandidates.filter(r => r.promotionReady).length > 0
                ? (it
                  ? `${pcseSnap.topCandidates.filter(r => r.promotionReady).length} pronti · `
                  : `${pcseSnap.topCandidates.filter(r => r.promotionReady).length} ready · `)
                : ""}
              {it
                ? `${pcseSnap.topCandidates.length} combinazioni · ultimo run ${pcseSnap.ts.slice(0,10)}`
                : `${pcseSnap.topCandidates.length} combinations · last run ${pcseSnap.ts.slice(0,10)}`}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-ink-muted italic">
            {it ? "Nessun run ancora" : "No run yet"}
          </span>
        )}
        <span className="ml-auto text-[10px] text-indigo-500 dark:text-indigo-400">
          {it ? "→ Model Quality · Combinazioni" : "→ Model Quality · Combinations"}
        </span>
      </div>

    </section>
  );
}

// -- Subcomponents -----------------------------------------------------------

function ApprovedPatternCard({
  approved,
  approvalSource,
  oos,
  flaggedButTakenCount,
  it,
}: {
  approved: RiskPattern | null;
  approvalSource?: PatternApprovalSource | null;
  oos: import("../riskPattern/riskPatternTypes").PatternStats | null;
  flaggedButTakenCount: number;
  it: boolean;
}) {
  if (!approved) {
    return (
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/15 px-3 py-2">
        <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
          {it ? "Nessun pattern approvato attivo" : "No active approved pattern"}
        </p>
        <p className="text-[10px] text-amber-800/80 dark:text-amber-200/70 mt-0.5">
          {it
            ? "Step 3 userà l'intero pool senza filtri. Genera o costruisci un pattern qui sotto per attivare il filtro di esclusione."
            : "Step 3 will use the full pool with no filter. Generate or build a pattern below to activate the exclusion filter."}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-indigo-200/60 bg-indigo-50/40 dark:bg-indigo-950/15 px-3 py-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300">
            {it ? "Pattern approvato attivo" : "Active approved pattern"}
          </p>
          <p className="text-[12px] font-semibold text-indigo-900 dark:text-indigo-100 mt-0.5">
            {approved.conditions.map((c, i) => (
              <span key={i}>
                {i > 0 ? <span className="text-indigo-500 mx-1.5">AND</span> : null}
                {conditionLabel(c, it ? "it" : "en")}
              </span>
            ))}
          </p>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it ? "Approvato il" : "Approved at"} {approved.approvedAt ? new Date(approved.approvedAt).toLocaleString() : "—"}
          </p>
          <p className="text-[11px] text-indigo-800/90 dark:text-indigo-200/90 mt-1">
            {it ? "Fonte:" : "Source:"}{" "}
            <span className="font-semibold">
              {patternApprovalSourceLabel(approvalSource, it ? "it" : "en")}
            </span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <ApprovedStat
          label={it ? "Precision in-sample" : "In-sample precision"}
          value={fmtPct01(approved.inSampleStats.precision)}
          sub={`n=${approved.inSampleStats.firedN}`}
          isSample="in"
          tooltip={it
            ? `Precision = quando il pattern scatta, quante volte il trade finisce in perdita. Es. 60% = 6 volte su 10 il deal matchato risulta una perdita. IS = calcolato sui trade usati per costruire il pattern.`
            : `Precision = when the pattern fires, how often does the trade end in a loss? E.g. 60% = 6 out of 10 matched deals were losses. IS = computed on the trades used to build the pattern.`}
        />
        <ApprovedStat
          label={it ? "Precision out-of-sample" : "OOS precision"}
          value={oos ? fmtPct01(oos.precision) : (it ? "n/d" : "n/a")}
          sub={oos ? `n=${oos.firedN}` : (it ? "nessun trade dopo l'approvazione" : "no trades after approval")}
          isSample="out"
          tooltip={it
            ? `OOS (out-of-sample) = precision calcolata sui trade chiusi DOPO l'approvazione del pattern — è il vero test di robustezza. Se n/a non ci sono ancora trade successivi all'approvazione.`
            : `OOS (out-of-sample) = precision computed on trades closed AFTER the pattern was approved — the real robustness test. n/a means no trades have closed since approval yet.`}
        />
        <ApprovedStat
          label="Recall in-sample"
          value={fmtPct01(approved.inSampleStats.recall)}
          sub={`${describePattern(approved).length > 50 ? "" : ""}`}
          isSample="in"
          tooltip={it
            ? `Recall = quante delle perdite storiche verrebbero catturate dal pattern. Es. 40% = il filtro avrebbe bloccato 4 perdite su 10. Recall bassa = il filtro è selettivo ma lascia passare molte perdite.`
            : `Recall = what fraction of historical losses would the pattern have caught? E.g. 40% = the filter would have blocked 4 out of 10 losses. Low recall = selective filter but misses many losses.`}
        />
        <ApprovedStat
          label={it ? "Lift in-sample" : "In-sample lift"}
          value={approved.inSampleStats.lift != null ? `${approved.inSampleStats.lift.toFixed(2)}×` : "—"}
          sub={approved.inSampleStats.baseLossRate != null ? `base ${(approved.inSampleStats.baseLossRate * 100).toFixed(1)}%` : undefined}
          isSample="in"
          tooltip={it
            ? `Lift = quanto è più probabile la perdita nei deal che matchano il pattern rispetto alla media. Es. lift 2× = i deal matchati perdono il doppio rispetto alla media storica. Valori <1.3 indicano un pattern poco discriminante.`
            : `Lift = how much more likely is a loss for deals matching the pattern vs the average. E.g. lift 2× = matched deals lose twice as often as the historical average. Values <1.3 indicate a weak pattern.`}
        />
      </div>
      {flaggedButTakenCount > 0 ? (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          {it
            ? `⚠ ${flaggedButTakenCount} posizioni flaggate ma prese comunque — l'esito conta verso la precision effettiva del filtro.`
            : `⚠ ${flaggedButTakenCount} positions flagged but taken anyway — outcomes count against the filter's effective precision.`}
        </p>
      ) : null}
    </div>
  );
}

function ApprovedStat({
  label,
  value,
  sub,
  isSample,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  isSample: "in" | "out";
  tooltip?: string;
}) {
  return (
    <div
      className="rounded-md bg-white/70 dark:bg-surface/70 px-2 py-1.5 border border-[rgb(var(--border))]/30 cursor-help"
      title={tooltip}
    >
      <p className="text-[9px] uppercase font-medium text-ink-muted flex items-center gap-1">
        {label}
        <span
          className={`text-[8px] px-1 rounded ${
            isSample === "in"
              ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              : "bg-indigo-200 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-100"
          }`}
        >
          {isSample === "in" ? "IS" : "OOS"}
        </span>
        {tooltip ? <span className="text-[8px] text-ink-muted/60">ⓘ</span> : null}
      </p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums">{sub}</p> : null}
    </div>
  );
}

function BuilderStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div
      className="rounded-md border border-rose-200/40 bg-rose-50/30 dark:bg-rose-950/15 px-2 py-1.5 cursor-help"
      title={tooltip}
    >
      <p className="text-[9px] uppercase font-medium text-ink-muted flex items-center gap-1">
        {label}
        {tooltip ? <span className="text-[8px] text-ink-muted/60">ⓘ</span> : null}
      </p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function PatternProposalQueue({
  proposals,
  onApprove,
  onReject,
  it,
}: {
  proposals: PatternProposal[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  it: boolean;
}) {
  if (proposals.length === 0) return null;
  return (
    <div className="rounded-xl border border-indigo-200/60 bg-indigo-50/40 dark:bg-indigo-950/15">
      <header className="px-3 py-2 border-b border-indigo-200/40">
        <h3 className="text-[12px] font-semibold text-indigo-900 dark:text-indigo-100">
          {it ? "Coda proposte pattern" : "Pattern proposal queue"} ({proposals.length})
        </h3>
      </header>
      <ul className="p-3 space-y-2">
        {proposals.map((p) => {
          const isAlarm = p.reason === "currentPatternDegraded";
          return (
            <li
              key={p.id}
              className={`rounded-md border px-3 py-2 ${
                isAlarm
                  ? "border-rose-300/60 bg-rose-50/50 dark:bg-rose-950/20"
                  : "border-indigo-200/50 bg-white/60 dark:bg-surface/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[9px] uppercase font-semibold px-2 py-0.5 rounded ${
                    p.reason === "currentPatternDegraded"
                      ? "bg-rose-200 text-rose-900"
                      : p.reason === "betterPatternFound"
                        ? "bg-emerald-200 text-emerald-900"
                        : "bg-indigo-200 text-indigo-900"
                  }`}
                >
                  {p.reason === "currentPatternDegraded"
                    ? it ? "Pattern attuale degradato" : "Current pattern degraded"
                    : p.reason === "betterPatternFound"
                      ? it ? "Pattern migliore trovato" : "Better pattern found"
                      : it ? "Prima proposta" : "First pattern"}
                </span>
                <span className="text-[9px] text-ink-muted ml-auto">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
              </div>
              {p.currentPattern ? (
                <p className="text-[11px] mb-1">
                  <span className="text-ink-muted">{it ? "Attuale:" : "Current:"}</span>{" "}
                  <span className="font-mono">{describePattern(p.currentPattern.pattern)}</span>
                </p>
              ) : null}
              {p.proposedPattern ? (
                <p className="text-[11px] mb-1">
                  <span className="text-ink-muted">{it ? "Proposto:" : "Proposed:"}</span>{" "}
                  <span className="font-mono">{describePattern(p.proposedPattern.pattern)}</span>
                </p>
              ) : null}
              <p className="text-[10px] text-ink-muted leading-relaxed">{p.rationale}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn-primary text-[11px]" onClick={() => onApprove(p.id)}>
                  {it ? "✓ Approva" : "✓ Approve"}
                </button>
                <button type="button" className="btn-ghost text-[11px]" onClick={() => onReject(p.id)}>
                  {it ? "✕ Rifiuta" : "✕ Reject"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// â”€â”€ Errors scatter (protagonist of the simplified flow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ScatterPoint = {
  ticker: string;
  cd: string;
  /** Affidabilità at entry (0..100). */
  prob: number;
  /** Realised P&L %. Sign and magnitude drive the colour and y-position. */
  pnlPct: number;
  isLoss: boolean;
  /** This trade matches the auto-detected pattern (would have been flagged). */
  matchAuto: boolean;
  /** This trade matches the currently active approved pattern. */
  matchApproved: boolean;
  capitalEur: number;
};

/** Compact two-line tooltip that explains exactly what the bubble represents. */
function ScatterTooltip({ active, payload, it }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }>; it: boolean }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const sign = p.pnlPct >= 0 ? "+" : "";
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/40 bg-white/95 dark:bg-surface/95 px-2 py-1.5 text-[10px] shadow-md">
      <p className="font-semibold text-ink">
        {p.ticker} <span className="text-ink-muted">· CD {p.cd}</span>
      </p>
      <p className="tabular-nums">
        {it ? "P(plan) entry" : "Entry P(plan)"}: <span className="font-semibold">{p.prob.toFixed(0)}%</span>
        {" · "}
        {it ? "P&L" : "P&L"}: <span className={`font-semibold ${p.isLoss ? "text-rose-700" : "text-emerald-700"}`}>{sign}{p.pnlPct.toFixed(1)}%</span>
      </p>
      <p className="text-ink-muted tabular-nums">
        {it ? "Capitale" : "Capital"}: â‚¬{p.capitalEur.toFixed(0)}
        {p.matchAuto ? (
          <> · <span className="text-rose-700 font-semibold">{it ? "matcha pattern auto" : "matches auto pattern"}</span></>
        ) : null}
        {p.matchApproved ? (
          <> · <span className="text-indigo-700 font-semibold">{it ? "matcha pattern attivo" : "matches active pattern"}</span></>
        ) : null}
      </p>
    </div>
  );
}

function LossErrorsScatter({
  points,
  baseLossRate,
  totalTrades,
  autoPatternConditionsLabel,
  approvedPatternActive,
  it,
}: {
  points: ScatterPoint[];
  baseLossRate: number;
  totalTrades: number;
  /** Human-readable condition list of the currently auto-detected pattern,
   *  or null when no eligible pattern exists. Drives the ring legend. */
  autoPatternConditionsLabel: string | null;
  approvedPatternActive: boolean;
  it: boolean;
}) {
  // Split into 4 series so each gets its own visual treatment (color + ring).
  // This is the simplest way to layer styling in recharts ScatterChart.
  const losses = points.filter((p) => p.isLoss && !p.matchAuto);
  const lossesMatched = points.filter((p) => p.isLoss && p.matchAuto);
  const wins = points.filter((p) => !p.isLoss && !p.matchAuto);
  const winsMatched = points.filter((p) => !p.isLoss && p.matchAuto);

  const capturedLossPct =
    losses.length + lossesMatched.length > 0
      ? Math.round((lossesMatched.length / (losses.length + lossesMatched.length)) * 100)
      : null;
  const falsePositivesPct =
    wins.length + winsMatched.length > 0
      ? Math.round((winsMatched.length / (wins.length + winsMatched.length)) * 100)
      : null;

  return (
    <div className="rounded-xl border border-rose-200/40 dark:border-rose-800/30 bg-white/60 dark:bg-surface/60">
      <header className="px-3 py-2 border-b border-rose-200/40 dark:border-rose-800/30 space-y-0.5">
        <h3 className="text-[12px] font-semibold text-ink flex items-center gap-2">
          {it ? "Errori dalla sim loop — trade chiusi" : "Sim-loop errors — closed trades"}
          <span className="text-[10px] font-normal text-ink-muted">
            n={totalTrades} · base loss {(baseLossRate * 100).toFixed(1)}%
          </span>
        </h3>
        <p className="text-[10px] text-ink-muted leading-relaxed">
          {it
            ? "Asse X = P(plan) all'entry · Asse Y = P&L % realizzato · rosso = perdita, verde = win."
            : "X = P(plan) at entry · Y = realised P&L % · red = loss, green = win."}
          {autoPatternConditionsLabel ? (
            <>
              {" "}
              <span className="text-rose-700 dark:text-rose-300 font-semibold">
                â—
              </span>{" "}
              {it ? "anello rosa = trade che matchano il pattern auto-rilevato" : "rose ring = trades matching the auto-detected pattern"}{" "}
              <span className="font-mono">({autoPatternConditionsLabel})</span>.
              {capturedLossPct != null ? (
                <>
                  {" "}
                  {it
                    ? `Cattura ${capturedLossPct}% delle perdite e ${falsePositivesPct ?? 0}% dei win (falsi positivi).`
                    : `Catches ${capturedLossPct}% of losses and ${falsePositivesPct ?? 0}% of wins (false positives).`}
                </>
              ) : null}
            </>
          ) : (
            <>
              {" "}
              {it
                ? "Nessun pattern auto-rilevato: serve più dati o nessuna combinazione AND supera la soglia minima (n≥5, lift≥1)."
                : "No auto-detected pattern: need more data or no AND-combination passes the minimum floor (n≥5, lift≥1)."}
            </>
          )}
          {approvedPatternActive ? (
            <>
              {" "}
              {it
                ? "Il pattern già attivo è mostrato sopra (sezione viola)."
                : "The currently active pattern is shown above (purple section)."}
            </>
          ) : null}
        </p>
      </header>
      <div className="p-3">
        {points.length === 0 ? (
          <p className="text-[11px] text-ink-muted py-6 text-center">
            {it
              ? "Nessun trade chiuso con P(plan) e P&L% finiti — non si può graficare ancora."
              : "No closed trade has both a finite P(plan) and a finite P&L% yet — nothing to plot."}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 28, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
              <XAxis
                type="number"
                dataKey="prob"
                name={it ? "P(plan) entry" : "Entry P(plan)"}
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}%`}
                label={{
                  value: it ? "P(plan) all'entry (%)" : "Entry P(plan) (%)",
                  position: "insideBottom",
                  offset: -10,
                  fontSize: 10,
                }}
              />
              <YAxis
                type="number"
                dataKey="pnlPct"
                name="P&L %"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                label={{ value: "P&L %", angle: -90, position: "insideLeft", fontSize: 10 }}
              />
              <ZAxis type="number" range={[40, 40]} />
              <Tooltip content={<ScatterTooltip it={it} />} cursor={{ strokeDasharray: "3 3" }} />
              <ReferenceLine y={0} stroke="rgba(148,163,184,0.6)" strokeDasharray="3 3" />
              {/* Order matters: wins first (behind), losses on top, matched-pattern bubbles
                  rendered last so the rose ring sits visually above the base fill. */}
              {wins.length > 0 ? (
                <Scatter
                  name={it ? "Win" : "Win"}
                  data={wins}
                  fill="#10b981"
                  fillOpacity={0.55}
                  stroke="#059669"
                />
              ) : null}
              {losses.length > 0 ? (
                <Scatter
                  name={it ? "Perdita" : "Loss"}
                  data={losses}
                  fill="#ef4444"
                  fillOpacity={0.65}
                  stroke="#b91c1c"
                />
              ) : null}
              {winsMatched.length > 0 ? (
                <Scatter
                  name={it ? "Win (falso pos. pattern)" : "Win (pattern false pos.)"}
                  data={winsMatched}
                  fill="#10b981"
                  fillOpacity={0.55}
                  stroke="#f43f5e"
                  strokeWidth={2}
                />
              ) : null}
              {lossesMatched.length > 0 ? (
                <Scatter
                  name={it ? "Perdita catturata dal pattern" : "Loss caught by pattern"}
                  data={lossesMatched}
                  fill="#ef4444"
                  fillOpacity={0.85}
                  stroke="#f43f5e"
                  strokeWidth={2}
                />
              ) : null}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// â”€â”€ Auto-detected pattern card with 1-click apply â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AutoPatternCard({
  result,
  activePattern,
  onApplyToScore,
  onRerun,
  onDismiss,
  it,
}: {
  result: NonNullable<ReturnType<typeof searchBestPatternEmpirical>>;
  activePattern: RiskPattern | null;
  onApplyToScore: () => void;
  onRerun: () => void;
  onDismiss: () => void;
  it: boolean;
}) {
  const { pattern, stats, alternatives, candidatesEvaluated } = result;

  // Detect "we already approved this exact pattern" so the primary CTA can
  // visually communicate that re-applying is a no-op (the score is already
  // dampened by the same conditions).
  const sameAsActive =
    activePattern != null && describePattern(activePattern) === describePattern(pattern);

  return (
    <div className="rounded-xl border-2 border-indigo-400/70 bg-indigo-50/60 dark:bg-indigo-950/30 px-3 py-3 space-y-3 shadow-sm">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
            {it
              ? `🔬 Pattern empirico trovato · ${candidatesEvaluated} combinazioni valutate`
              : `🔬 Empirical pattern found · ${candidatesEvaluated} combinations evaluated`}
          </p>
          <p className="text-[12px] font-semibold text-indigo-950 dark:text-indigo-100 mt-0.5 break-words">
            {pattern.conditions.map((c, i) => (
              <span key={i}>
                {i > 0 ? <span className="text-indigo-500 mx-1.5">AND</span> : null}
                {conditionLabel(c, it ? "it" : "en")}
              </span>
            ))}
          </p>
          <p className="text-[10px] text-ink-muted mt-1 leading-snug max-w-2xl">
            {it
              ? "Combinazione AND di feature×bucket che meglio predice la perdita sui trade chiusi. " +
                "Es: \"SDS <40 AND Phase 2\" significa che i deal con SDS basso E in fase 2 perdono più spesso. " +
                "Clicca \"Usa nello score\" per attivarlo: i deal che lo matchano riceveranno un sizing suggerito più basso in Step 3."
              : "The AND-combination of feature×bucket that best predicts loss on closed trades. " +
                "E.g. \"SDS <40 AND Phase 2\" means deals with low SDS AND in phase 2 lose more often. " +
                "Click \"Use in score\" to activate it: deals matching it will get a lower suggested sizing in Step 3."}
          </p>
        </div>
        {sameAsActive ? (
          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/30 px-2 py-1 rounded">
            {it ? "Già attivo" : "Already active"}
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <BuilderStat
          label="n fired"
          value={String(stats.firedN)}
          tooltip={it ? "Quanti trade storici matchano questo pattern (lo avrebbero triggerato)" : "How many historical trades match this pattern (would have triggered it)"}
        />
        <BuilderStat
          label="Precision"
          value={`${(stats.precision * 100).toFixed(1)}%`}
          tooltip={it ? "% dei deal matchati che sono finiti in perdita — più alto = pattern più affidabile come filtro" : "% of matched deals that ended in a loss — higher = more reliable filter"}
        />
        <BuilderStat
          label="Recall"
          value={`${(stats.recall * 100).toFixed(1)}%`}
          tooltip={it ? "% delle perdite storiche totali che il pattern avrebbe catturato — più alto = cattura più errori" : "% of total historical losses this pattern would have caught — higher = catches more errors"}
        />
        <BuilderStat
          label={it ? "Lift vs base" : "Lift vs base"}
          value={`${stats.lift.toFixed(2)}×`}
          tooltip={it
            ? `Lift = tasso di perdita nei deal matchati ÷ tasso base (${(stats.baseLossRate * 100).toFixed(1)}%). Es. 2.56× = i deal matchati perdono 2.56 volte più spesso della media`
            : `Lift = loss rate in matched deals ÷ base rate (${(stats.baseLossRate * 100).toFixed(1)}%). E.g. 2.56× = matched deals lose 2.56× more often than average`}
        />
        <BuilderStat
          label={it ? "Base loss" : "Base loss"}
          value={`${(stats.baseLossRate * 100).toFixed(1)}%`}
          tooltip={it ? "Tasso di perdita medio su tutti i trade chiusi — è il riferimento (benchmark) contro cui si misura il lift" : "Average loss rate across all closed trades — this is the benchmark against which lift is measured"}
        />
      </div>

      {alternatives.length > 0 ? (
        <details className="text-[10px] text-ink rounded-md border border-indigo-200/50 bg-white/60 dark:bg-surface/60">
          <summary className="px-2 py-1 cursor-pointer font-semibold text-indigo-800 dark:text-indigo-200">
            {it
              ? `▾ Runners-up (${alternatives.length}) — alternative testate`
              : `▾ Runners-up (${alternatives.length}) — alternatives tested`}
          </summary>
          <ul className="px-3 py-1.5 space-y-1 leading-snug">
            {alternatives.map((alt, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 border-b border-indigo-200/30 pb-1 last:border-b-0">
                <span className="font-mono text-[10px] text-ink">
                  {alt.pattern.conditions
                    .map((c) => conditionLabel(c, it ? "it" : "en"))
                    .join(" AND ")}
                </span>
                <span className="text-ink-muted text-[10px] tabular-nums whitespace-nowrap">
                  prec {(alt.stats.precision * 100).toFixed(0)}% · n={alt.stats.firedN} · lift {alt.stats.lift.toFixed(2)}×
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={onApplyToScore}
          disabled={sameAsActive}
          title={
            sameAsActive
              ? it
                ? "Questo pattern è già il pattern attivo — niente da applicare."
                : "This pattern is already the active one — nothing to apply."
              : it
                ? "Approva e applica immediatamente al loss risk score (Step 3). Senza passare dalla coda."
                : "Approve and apply to the loss risk score (Step 3) immediately. No queue stop."
          }
        >
          {sameAsActive
            ? it ? "✓ Già nello score" : "✓ Already in score"
            : it ? "📌 Usa nello score" : "📌 Use in score"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onRerun}
          title={it ? "Ri-esegui la ricerca empirica" : "Re-run the empirical search"}
        >
          {it ? "🔄 Riprova ricerca" : "🔄 Re-run search"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onDismiss}
          title={it ? "Nascondi questo suggerimento (riapparirà al prossimo refresh dati)" : "Hide this suggestion (will reappear on next data refresh)"}
        >
          {it ? "✕ Scarta" : "✕ Discard"}
        </button>
      </div>
    </div>
  );
}

// â”€â”€ No-pattern fallback hint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NoEmpiricalPatternHint({
  totalTrades,
  onRerun,
  it,
}: {
  totalTrades: number;
  onRerun: () => void;
  it: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-snug max-w-2xl">
        {it
          ? `Nessun pattern empirico significativo trovato sui ${totalTrades} trade chiusi disponibili. Serve più dati, oppure i bucket "rischiosi" non superano la soglia minima (n≥5, lift≥1).`
          : `No significant empirical pattern found on the ${totalTrades} available closed trades. Need more data, or risky buckets don't pass the minimum floor (n≥5, lift≥1).`}
      </p>
      <button type="button" className="btn-ghost text-xs" onClick={onRerun}>
        {it ? "🔄 Riprova" : "🔄 Re-run"}
      </button>
    </div>
  );
}
