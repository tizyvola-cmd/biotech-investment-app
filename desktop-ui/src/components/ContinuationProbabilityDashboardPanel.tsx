/**
 * Dashboard strip: P(continuation) for open book — index table only (no curves).
 */
import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { buildSimRowByKeyMap, normalizedRowKey } from "../sheet/investSimKeys";
import { rowHasActivePortfolio } from "../sheet/simulationPosition";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import {
  P_CONT_SELL_MIN_G10,
  resolveContG10WithFallback,
  resolveContPBase,
  resolveContSellEdge,
  resolveContSellUiRegime,
  resolveDisplayPContinuation,
  resolvePExhaustion,
  withContG10Fallback,
} from "../sheet/continuationScore";
import {
  resolveContPctOwn,
  resolveContPctPopRate,
} from "../sheet/continuationPercentileCurve";
import {
  ContG10Badge,
  ContPContBadge,
  contRunHeaderLabel,
  G10_HELP_EN,
  G10_HELP_IT,
} from "./ContG10Badge";
import { useLang } from "../shared/i18n";

type ContRow = {
  key: string;
  ticker: string;
  simRow: Record<string, unknown>;
  pExh: number | null;
  pCont: number | null;
  pBase: number | null;
  g10: number | null;
  pctOwn: number | null;
  pctPop: number | null;
  edge: number | null;
  sellPressure: boolean;
  eligible: boolean;
  regime: ReturnType<typeof resolveContSellUiRegime>;
};

export function ContinuationProbabilityDashboardPanel({
  simTable,
  inputs,
  chartBundle = null,
  onOpenTicker,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  chartBundle?: ChartBundle | null;
  onOpenTicker?: (ticker: string) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const pointsBySeriesKey = useMemo(
    () => (chartBundle ? chartPointsMapFromBundle(chartBundle) : new Map<string, ChartPoint[]>()),
    [chartBundle],
  );

  const buildRow = (
    r: Record<string, unknown>,
    byKey: Map<string, Record<string, unknown>>,
  ): ContRow | null => {
    const ticker = String(r.Ticker ?? r.ticker ?? "").trim().toUpperCase();
    if (!ticker) return null;
    const key = normalizedRowKey(ticker, r["Completion Date"]);
    const raw = (byKey.get(key) ?? r) as Record<string, unknown>;
    const sk = simulationRowSeriesKey(raw);
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const simRow = withContG10Fallback(raw, chartPts) ?? raw;
    const g10 = resolveContG10WithFallback(simRow, chartPts);
    const regime = resolveContSellUiRegime(g10);
    const eligible = regime === "in_regime";
    const pExh = eligible ? resolvePExhaustion(simRow) : null;
    const edge = eligible ? resolveContSellEdge(simRow) : null;
    // pct Pop/Own: chart placement on the half-bell (also early runs 0…+5%).
    // Edge / sell P stay sell-regime only.
    const pctOwn = resolveContPctOwn(simRow);
    const pctPop = resolveContPctPopRate(simRow);
    const pCont = eligible ? resolveDisplayPContinuation(simRow) : null;
    const pBase = eligible ? resolveContPBase(simRow) : null;
    return {
      key,
      ticker,
      simRow,
      pExh,
      pCont,
      pBase,
      g10,
      pctOwn,
      pctPop,
      edge,
      sellPressure: edge != null && edge > 0,
      eligible,
      regime,
    };
  };

  /** Full simulation universe — scored in refresh; used for the summary line only. */
  const universeStats = useMemo(() => {
    if (!simTable?.rows?.length) {
      return { n: 0, withG10: 0, inRegime: 0, scored: 0, declining: 0, weak: 0 };
    }
    const byKey = buildSimRowByKeyMap(simTable.rows);
    let withG10 = 0;
    let inRegime = 0;
    let scored = 0;
    let declining = 0;
    let weak = 0;
    for (const r of simTable.rows) {
      const row = buildRow(r as Record<string, unknown>, byKey);
      if (!row) continue;
      if (row.g10 != null) withG10 += 1;
      if (row.eligible) inRegime += 1;
      if (row.regime === "declining") declining += 1;
      if (row.regime === "not_run") weak += 1;
      if (row.pCont != null || row.pExh != null) scored += 1;
    }
    return { n: simTable.rows.length, withG10, inRegime, scored, declining, weak };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildRow closes over pointsBySeriesKey
  }, [simTable, pointsBySeriesKey]);

  const rows = useMemo(() => {
    if (!simTable?.rows?.length) return [] as ContRow[];
    const byKey = buildSimRowByKeyMap(simTable.rows);
    const out: ContRow[] = [];
    for (const r of simTable.rows) {
      const row = r as Record<string, unknown>;
      if (!rowHasActivePortfolio(row, inputs)) continue;
      const built = buildRow(row, byKey);
      if (built) out.push(built);
    }
    out.sort((a, b) => {
      const rank = (r: ContRow) =>
        r.regime === "declining" ? 0 : r.regime === "not_run" ? 1 : r.eligible ? 2 : 3;
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return a.ticker.localeCompare(b.ticker);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simTable, inputs, pointsBySeriesKey]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!rows.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !rows.some((r) => r.key === selectedKey)) {
      setSelectedKey(rows[0]!.key);
    }
  }, [rows, selectedKey]);

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? rows[0] ?? null;

  return (
    <section
      className="rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--panel))]/80 px-3 py-2.5 shadow-sm"
      aria-label="P(continuation)"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-sm font-semibold text-ink tracking-tight">
            {it ? "P(continuation) — book aperto" : "P(continuation) — open book"}
          </h2>
          <p className="text-[12px] text-ink leading-snug mt-0.5">
            {it
              ? "Indice P(cont)% sul book aperto (vento empirico). Non è il prezzo."
              : "P(cont)% index on the open book (empirical wind). Not price."}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? `Universo: ${universeStats.inRegime}/${universeStats.n} in regime sell (${contRunHeaderLabel(it)}≥${P_CONT_SELL_MIN_G10}%) · ${universeStats.declining} in calo · ${universeStats.weak} corsa nascente · ${universeStats.withG10} con ${contRunHeaderLabel(it)}.`
              : `Universe: ${universeStats.inRegime}/${universeStats.n} in sell regime (${contRunHeaderLabel(it)}≥${P_CONT_SELL_MIN_G10}%) · ${universeStats.declining} declining · ${universeStats.weak} early run · ${universeStats.withG10} with ${contRunHeaderLabel(it)}.`}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto mb-2 rounded-md border border-[rgb(var(--border))]/40">
        <table className="w-full text-[10px] min-w-[520px]">
          <thead>
            <tr className="bg-[rgb(var(--surface-2))]/50 text-ink-muted uppercase tracking-wide">
              <th className="text-left px-2 py-1 font-semibold">{it ? "Ticker" : "Ticker"}</th>
              <th
                className="text-right px-2 py-1 font-semibold"
                title={it ? G10_HELP_IT : G10_HELP_EN}
              >
                {contRunHeaderLabel(it)}
              </th>
              <th
                className="text-right px-2 py-1 font-semibold"
                title={
                  it
                    ? "Percentile Own della corsa tra analoghi dello stesso titolo."
                    : "Own-run percentile among same-ticker analogues."
                }
              >
                {it ? "pct Own" : "pct Own"}
              </th>
              <th
                className="text-right px-2 py-1 font-semibold"
                title={
                  it
                    ? "Percentile popolazione tra analoghi di universo."
                    : "Population percentile among universe analogues."
                }
              >
                {it ? "pct Pop" : "pct Pop"}
              </th>
              <th className="text-right px-2 py-1 font-semibold">
                {it ? "P(cont)" : "P(cont)"}
              </th>
              <th
                className="text-right px-2 py-1 font-semibold"
                title={
                  it
                    ? `Edge esaurimento — solo in regime sell (${contRunHeaderLabel(it)} ≥ +${P_CONT_SELL_MIN_G10}%).`
                    : `Exhaustion edge — sell regime only (${contRunHeaderLabel(it)} ≥ +${P_CONT_SELL_MIN_G10}%).`
                }
              >
                edge
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = r.key === selectedRow?.key;
              return (
                <tr
                  key={r.key}
                  className={`border-t border-[rgb(var(--border))]/30 cursor-pointer ${
                    active
                      ? "bg-sky-50"
                      : r.sellPressure
                        ? "bg-rose-50/50"
                        : r.regime === "declining"
                          ? "bg-rose-50/30"
                          : r.regime === "not_run"
                            ? "bg-amber-50/40"
                            : "bg-white hover:bg-[rgb(var(--surface-2))]/40"
                  }`}
                  onClick={() => setSelectedKey(r.key)}
                  onDoubleClick={() => onOpenTicker?.(r.ticker)}
                  title={
                    it
                      ? "Click seleziona · doppio click apre la riga"
                      : "Click to select · double-click opens row"
                  }
                >
                  <td className="px-2 py-1 font-semibold text-ink">{r.ticker}</td>
                  <td className="px-2 py-1 text-right">
                    <ContG10Badge g10={r.g10} it={it} dense />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.pctOwn != null ? r.pctOwn.toFixed(0) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.pctPop != null ? r.pctPop.toFixed(0) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <ContPContBadge
                      pCont={r.pCont}
                      g10={r.g10}
                      regime={r.regime}
                      it={it}
                      dense
                    />
                  </td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums font-semibold ${
                      r.sellPressure ? "text-rose-700" : "text-ink-muted"
                    }`}
                  >
                    {r.eligible && r.edge != null
                      ? `${r.edge > 0 ? "+" : ""}${r.edge.toFixed(1)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-ink-muted py-2 text-center">
          {it ? "Nessuna posizione aperta nel book." : "No open book positions."}
        </p>
      ) : null}
    </section>
  );
}
