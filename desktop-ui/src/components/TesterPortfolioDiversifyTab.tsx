import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartPoint, SheetTable } from "../types";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
} from "../data/investmentSimOutcomesData";
import { loadSdsCohort, type SdsRow } from "../api/supernova";
import { useLang, useT } from "../shared/i18n";
import { reconcileInvestSimInputs } from "../sheet/investSimKeys";
import {
  hydrateInvestSimInputs,
  type InvestSimInputs,
} from "../sheet/investSimStorage";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import {
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { PortfolioDiversificationLabPanel } from "./PortfolioDiversificationLabPanel";

export function TesterPortfolioDiversifyTab({
  apiOk,
  simTable = null,
}: {
  apiOk: boolean | null;
  simTable?: SheetTable | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closedRows, setClosedRows] = useState<ReturnType<typeof closedSimOutcomeRowsFromDoc>>([]);
  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reloadInFlightRef = useRef(false);

  // Live InvestSimInputs (open portfolio capital, buy prices) — same source as
  // Simulation tab and Decision Lab. Required by selectMineDeals to detect
  // open positions (rowHasActivePortfolio).
  const investInputs = useInvestSimInputs(simTable ?? null, reloadToken);

  // ChartPoints per series — required by buildSuggestionMonitorRows to compute
  // probPct / planReturnPct per simTable row.
  const [chartsBundle, setChartsBundle] = useState<
    Awaited<ReturnType<typeof loadSimulationChartsBundle>>["bundle"] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setChartsBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [simTable?.rows?.length, reloadToken]);

  const pointsBySeriesKey = useMemo(() => {
    const m = new Map<string, ChartPoint[]>();
    if (!simTable?.rows?.length || !chartsBundle?.series) return m;
    for (const row of simTable.rows) {
      const sk = simulationRowSeriesKey(row);
      if (!sk) continue;
      const pts = chartsBundle.series[sk]?.points;
      if (pts && pts.length) m.set(sk, pts);
    }
    return m;
  }, [simTable, chartsBundle]);

  useEffect(() => {
    void loadSdsCohort(false).then((p) => setSdsRows(p.rows ?? null)).catch(() => {});
  }, []);

  const reload = useCallback(
    async (opts?: { rebuild?: boolean }) => {
      if (apiOk === false) {
        setLoading(false);
        return;
      }
      if (reloadInFlightRef.current) return;
      reloadInFlightRef.current = true;
      const rebuild = opts?.rebuild ?? false;
      setLoading(true);
      setError(null);
      try {
        let syncInputs: InvestSimInputs | undefined;
        if (rebuild) {
          const raw = await hydrateInvestSimInputs(simTable?.rows ?? undefined);
          syncInputs = simTable?.rows?.length
            ? reconcileInvestSimInputs(raw, simTable.rows)
            : raw;
        }
        const { doc, error: loadErr } = await loadInvestmentSimOutcomes({ rebuild, syncInputs });
        setClosedRows(closedSimOutcomeRowsFromDoc(doc));
        setGeneratedAt(doc?.generated_at ?? null);
        if (loadErr) setError(loadErr);
        if (rebuild) setReloadToken((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setClosedRows([]);
      } finally {
        setLoading(false);
        reloadInFlightRef.current = false;
      }
    },
    [apiOk, simTable],
  );

  useEffect(() => {
    void reload({ rebuild: false });
  }, [reload]);

  return (
    <div className="space-y-3 pb-6">
      <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
        <p className="tester-monitor-text text-sm font-semibold">{t("testerMonitor.diversify.title")}</p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {t("testerMonitor.diversify.subtitle")}
        </p>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          <button
            type="button"
            className="btn text-xs py-1.5"
            disabled={loading || apiOk === false}
            onClick={() => void reload({ rebuild: true })}
          >
            {loading ? (it ? "Aggiorno…" : "Refreshing…") : it ? "↻ Aggiorna esiti" : "↻ Refresh outcomes"}
          </button>
          {generatedAt ? (
            <span className="tester-monitor-muted text-[10px] tabular-nums">
              {it ? "Analisi: " : "Analysis: "}
              {new Date(generatedAt).toLocaleString(it ? "it-IT" : "en-US", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </div>
      </div>

      {apiOk === false ? (
        <p className="text-[12px] text-[rgb(var(--signal-down))]">
          {it ? "API offline — avvia SuperNova desktop." : "API offline — start SuperNova desktop."}
        </p>
      ) : null}
      {error ? (
        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}

      {loading && !closedRows.length ? (
        <p className="tester-monitor-muted text-sm py-8 text-center">{t("testerMonitor.diversify.loading")}</p>
      ) : (
        <PortfolioDiversificationLabPanel
          closedRows={closedRows}
          simTable={simTable}
          sdsRows={sdsRows}
          investInputs={investInputs}
          pointsBySeriesKey={pointsBySeriesKey}
        />
      )}
    </div>
  );
}
