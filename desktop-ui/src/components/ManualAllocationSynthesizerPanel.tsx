import type { ConfidenceLevel } from "../calibration/calibrationTypes";
import { conditionLabel } from "../riskPattern/lossRiskPattern";
import { dimensionLabel } from "../riskPattern/lossRiskScreening";
import { applyManualAllocationPattern } from "../riskPattern/manualAllocationPatternApply";
import type {
  ManualAllocationPatternResult,
  ManualAllocationSynthesizerBundle,
  ManualAllocationSynthesizerBundleResult,
  ManualAllocationSynthesizerInput,
} from "../sheet/manualAllocationPatternSynthesizer";

function fmtPct01(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

function fmtPp(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}pp`;
}

function ConfBadge({ level }: { level: ConfidenceLevel | null }) {
  if (!level) return <span className="text-ink-muted">—</span>;
  const styles =
    level === "high"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : level === "medium"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${styles}`}>
      {level.toUpperCase()}
    </span>
  );
}

function UniverseSynthesizerBlock({
  input,
  result,
  it,
  onApply,
}: {
  input: ManualAllocationSynthesizerInput;
  result: ManualAllocationPatternResult | null;
  it: boolean;
  onApply: (result: ManualAllocationPatternResult) => void;
}) {
  const universeLabel =
    input.universe === "portfolio"
      ? it
        ? "Portfolio reale"
        : "Real portfolio"
      : it
        ? "Sim loop BUY"
        : "Sim loop BUY";

  if (!result) {
    return (
      <div className="rounded-lg border border-teal-200/50 bg-white/50 dark:bg-surface/40 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-teal-900 dark:text-teal-100">
          {universeLabel}
        </p>
        <p className="text-[10px] text-ink-muted mt-1">
          {it
            ? `n=${input.deals.length} aperte — abbassa almeno uno slider sotto il peso weighted per generare indici e pattern.`
            : `n=${input.deals.length} open — lower at least one slider below the weighted share to synthesize indices and pattern.`}
        </p>
      </div>
    );
  }

  const condLabel = result.pattern.conditions
    .map((c) => conditionLabel(c, it ? "it" : "en"))
    .join(" AND ");

  return (
    <div className="rounded-lg border border-teal-300/60 bg-white/60 dark:bg-surface/50 px-3 py-2.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase font-semibold text-teal-700 dark:text-teal-300">
            {universeLabel}
          </p>
          {result.estimatedErrorPct != null ? (
            <p className="text-[18px] font-bold tabular-nums text-rose-700 dark:text-rose-300 mt-0.5">
              {result.estimatedErrorPct.toFixed(1)}%
              <span className="text-[11px] font-normal text-ink-muted ml-1.5">
                {it ? "errore stimato (chiusi)" : "estimated error (closed)"}
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-ink-muted mt-0.5">
              {it
                ? "Validazione storica insufficiente — usa gli indici Phase A sotto."
                : "Insufficient closed validation — use Phase A indices below."}
            </p>
          )}
          <p className="text-[11px] font-mono font-semibold text-teal-900 dark:text-teal-100 mt-1">
            {condLabel}
          </p>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it ? "Penalizzate" : "Down-weighted"}:{" "}
            {result.penalizedTickers.join(", ") || "—"}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-[11px] shrink-0"
          onClick={() => onApply(result)}
        >
          {it ? "Approva pattern" : "Approve pattern"}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] tabular-nums text-ink-muted">
        <span>
          {it ? "Precisione (aperte)" : "Precision (open)"}:{" "}
          {fmtPct01(result.openBookStats.precision)}
        </span>
        <span>Recall: {fmtPct01(result.openBookStats.recall)}</span>
        <span>Lift: {result.openBookStats.lift.toFixed(2)}×</span>
        {result.closedValidation ? (
          <span>
            {it ? "Loss su chiusi (pattern)" : "Closed loss (pattern)"}:{" "}
            {fmtPct01(result.closedValidation.precision)} · n=
            {result.closedValidation.firedN}
          </span>
        ) : null}
      </div>

      {result.companyRows.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-[10px] font-semibold text-teal-800 dark:text-teal-200 mb-1">
            {it ? "Società — peso e pattern" : "Companies — share and pattern"}
          </p>
          <table className="w-full min-w-[520px] text-[10px] tabular-nums">
            <thead>
              <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
                <th className="font-medium py-1 pr-2">Ticker</th>
                <th className="font-medium py-1 pr-2 text-right">
                  {it ? "% portafoglio" : "% portfolio"}
                </th>
                <th className="font-medium py-1 pr-2 text-right">
                  {it ? "% baseline" : "% baseline"}
                </th>
                <th className="font-medium py-1 pr-2 text-right">Δ share</th>
                <th className="font-medium py-1">{it ? "Pattern" : "Pattern"}</th>
              </tr>
            </thead>
            <tbody>
              {result.companyRows.map((row) => (
                <tr
                  key={row.rowKey}
                  className={
                    row.patternMatches
                      ? "bg-teal-50/60 dark:bg-teal-950/20"
                      : row.penalized
                        ? "bg-rose-50/40 dark:bg-rose-950/10"
                        : undefined
                  }
                >
                  <td className="py-1 pr-2 font-semibold">{row.ticker}</td>
                  <td className="py-1 pr-2 text-right">{row.manualSharePct.toFixed(1)}%</td>
                  <td className="py-1 pr-2 text-right text-ink-muted">
                    {row.baselineSharePct.toFixed(1)}%
                  </td>
                  <td
                    className={`py-1 pr-2 text-right ${
                      row.shareDeltaPp < -0.5
                        ? "text-rose-600 dark:text-rose-400"
                        : row.shareDeltaPp > 0.5
                          ? "text-emerald-600 dark:text-emerald-400"
                          : ""
                    }`}
                  >
                    {fmtPp(row.shareDeltaPp)}
                  </td>
                  <td className="py-1 font-mono text-[9px] leading-snug">
                    {row.patternLabel ?? (
                      <span className="text-ink-muted font-sans">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.indexRows.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-[10px] font-semibold text-teal-800 dark:text-teal-200 mb-1">
            {it ? "Indici aggregati (bucket)" : "Aggregate indices (buckets)"}
          </p>
          <table className="w-full min-w-[640px] text-[10px] tabular-nums">
            <thead>
              <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
                <th className="font-medium py-1 pr-2">{it ? "Dimensione" : "Dimension"}</th>
                <th className="font-medium py-1 pr-2">{it ? "Cella" : "Cell"}</th>
                <th className="font-medium py-1 pr-2 text-right">Δ share</th>
                <th className="font-medium py-1 pr-2 text-right">
                  {it ? "% loss chiusi" : "Closed loss %"}
                </th>
                <th className="font-medium py-1 pr-2 text-right">n</th>
                <th className="font-medium py-1 pr-2">Conf</th>
                <th className="font-medium py-1">{it ? "Pattern" : "Pattern"}</th>
              </tr>
            </thead>
            <tbody>
              {result.indexRows.map((row) => (
                <tr
                  key={`${row.dimension}|${row.cell}`}
                  className={
                    row.inSuggestedPattern
                      ? "bg-teal-50/60 dark:bg-teal-950/20"
                      : undefined
                  }
                >
                  <td className="py-1 pr-2">{dimensionLabel(row.dimension, it ? "it" : "en")}</td>
                  <td className="py-1 pr-2 font-medium">{row.cell}</td>
                  <td
                    className={`py-1 pr-2 text-right ${
                      row.shareDeltaPp < -0.5
                        ? "text-rose-600 dark:text-rose-400"
                        : row.shareDeltaPp > 0.5
                          ? "text-emerald-600 dark:text-emerald-400"
                          : ""
                    }`}
                  >
                    {fmtPp(row.shareDeltaPp)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {row.closedLossRate != null ? fmtPct01(row.closedLossRate) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">{row.closedN > 0 ? row.closedN : "—"}</td>
                  <td className="py-1 pr-2">
                    <ConfBadge level={row.closedConfidence} />
                  </td>
                  <td className="py-1">
                    {row.inSuggestedPattern ? (
                      <span className="text-teal-700 dark:text-teal-300 font-semibold">✓</span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function ManualAllocationSynthesizerPanel({
  bundle,
  outcomes,
  it,
  onPatternApproved,
}: {
  bundle: ManualAllocationSynthesizerBundle;
  outcomes: ManualAllocationSynthesizerBundleResult;
  it: boolean;
  onPatternApproved?: () => void;
}) {
  const portfolioInput = bundle.portfolio?.enabled ? bundle.portfolio : null;
  const simLoopInput = bundle.simLoop?.enabled ? bundle.simLoop : null;

  if (!portfolioInput && !simLoopInput) return null;

  function handleApply(result: ManualAllocationPatternResult) {
    const ok = applyManualAllocationPattern(
      result.pattern,
      it ? "it" : "en",
      "manual_allocation_step3",
    );
    if (ok) onPatternApproved?.();
  }

  return (
    <section className="rounded-xl border border-teal-300/50 bg-teal-50/30 dark:bg-teal-950/15 px-3 py-3 space-y-2">
      <div>
        <p className="text-[12px] font-semibold text-teal-900 dark:text-teal-100">
          {it
            ? "Sintetizzatore — pesi → indici → % errore"
            : "Synthesizer — weights → indices → error %"}
        </p>
        <p className="text-[10px] text-teal-800/80 dark:text-teal-200/70 mt-0.5 max-w-3xl">
          {it
            ? "Legge le posizioni aperte che hai sotto-pesato con gli slider, inferisce un pattern AND (come Step 2) e incrocia ogni bucket con la % di loss storica sui trade chiusi (Phase A). La % errore in evidenza è la precision del pattern sui chiusi quando n è sufficiente."
            : "Reads open positions you down-weighted via sliders, infers an AND pattern (like Step 2) and cross-references each bucket with historical closed-trade loss % (Phase A). The headline error % is pattern precision on closed trades when n is sufficient."}
        </p>
      </div>

      <div
        className={`grid gap-3 ${
          portfolioInput && simLoopInput ? "lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {portfolioInput ? (
          <UniverseSynthesizerBlock
            input={portfolioInput}
            result={outcomes.portfolio}
            it={it}
            onApply={handleApply}
          />
        ) : null}
        {simLoopInput ? (
          <UniverseSynthesizerBlock
            input={simLoopInput}
            result={outcomes.simLoop}
            it={it}
            onApply={handleApply}
          />
        ) : null}
      </div>
    </section>
  );
}
