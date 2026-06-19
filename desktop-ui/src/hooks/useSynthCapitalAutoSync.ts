import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimLoopSynthAllocation } from "./useSimLoopSynthAllocation";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { SimulationPosition } from "../sheet/simulationPosition";
import {
  positionCapitalPnlPct,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";
import {
  appendSynthCapitalSyncEntries,
  applySimTableCapitalUpdates,
  buildSynthSyncSummary,
  countSynthCapitalSyncRows,
  dispatchSynthSyncCompleted,
  loadLastSynthSnapshot,
  loadSynthCapitalSyncLog,
  planManualSynthSyncs,
  planSynthCapitalSyncs,
  pushSynthSyncBatch,
  revertSynthCapitalSyncs,
  resolvePortfolioSynthTargetEur,
  saveLastSynthSnapshot,
  saveSynthCapitalSyncLog,
  SYNTH_CAPITAL_LOG_CHANGED_EVENT,
  type SynthCapitalSyncEntry,
  type SynthCapitalSyncSource,
} from "../sheet/synthCapitalSyncLog";

function applyCapitalPatch(
  patchInputs: (updater: (prev: InvestSimInputs) => InvestSimInputs) => void,
  capitalUpdates: Record<string, number>,
  simRowByKeyForBuy: Map<string, Record<string, unknown>>,
): void {
  applySimTableCapitalUpdates(patchInputs, capitalUpdates, simRowByKeyForBuy);
}

export function useSynthCapitalAutoSync(args: {
  synthAlloc: SimLoopSynthAllocation | null;
  topCapital: number;
  inputs: InvestSimInputs;
  positions: SimulationPosition[];
  simRowByKey: Map<string, Record<string, unknown>>;
  patchInputs: (updater: (prev: InvestSimInputs) => InvestSimInputs) => void;
  simRowByKeyForBuy: Map<string, Record<string, unknown>>;
  enabled?: boolean;
}) {
  const {
    synthAlloc,
    topCapital,
    inputs,
    positions,
    simRowByKey,
    patchInputs,
    simRowByKeyForBuy,
    enabled = true,
  } = args;

  const [logByKey, setLogByKey] = useState(() => loadSynthCapitalSyncLog());
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);
  const snapshotRef = useRef(loadLastSynthSnapshot());
  const appliedSigRef = useRef("");

  useEffect(() => {
    const reload = () => setLogByKey(loadSynthCapitalSyncLog());
    window.addEventListener(SYNTH_CAPITAL_LOG_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SYNTH_CAPITAL_LOG_CHANGED_EVENT, reload);
  }, []);

  const inPortfolioByKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const p of positions) {
      const simRow = simRowByKey.get(p.key);
      map[p.key] = simRow
        ? rowHasActivePortfolio(simRow, inputs)
        : p.capital > 0 && !inputs[p.key]?.ignoreSheet;
    }
    return map;
  }, [positions, simRowByKey, inputs]);

  const pnlPctByKey = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const p of positions) {
      if (p.pnlUnavailable) {
        map[p.key] = null;
        continue;
      }
      map[p.key] =
        positionCapitalPnlPct(p.pnlEur, p.capital) ??
        (Number.isFinite(p.pnlPct) ? p.pnlPct : null);
    }
    return map;
  }, [positions]);

  const commitSyncPlan = useCallback(
    (
      entries: SynthCapitalSyncEntry[],
      capitalUpdates: Record<string, number>,
      snapshotPatch: Record<string, { synthEur: number; synthShare: number; topCapitalEur: number; at: string }>,
    ) => {
      if (Object.keys(snapshotPatch).length > 0) {
        snapshotRef.current = { ...snapshotRef.current, ...snapshotPatch };
        saveLastSynthSnapshot(snapshotRef.current);
      }
      let syncedEntries: SynthCapitalSyncEntry[] = [];
      if (entries.length > 0) {
        const verifiedEntries = entries.map((e) => ({
          ...e,
          fromCapitalEur: Math.round(inputs[e.rowKey]?.capital ?? e.fromCapitalEur),
        }));
        syncedEntries = verifiedEntries;
        pushSynthSyncBatch(verifiedEntries);
        setLogByKey((prev) => {
          const nextLog = appendSynthCapitalSyncEntries(prev, verifiedEntries);
          saveSynthCapitalSyncLog(nextLog);
          return nextLog;
        });
      }
      applyCapitalPatch(patchInputs, capitalUpdates, simRowByKeyForBuy);
      const summary = buildSynthSyncSummary(syncedEntries, syncedEntries[0]?.source ?? "manual");
      if (summary) dispatchSynthSyncCompleted(summary);
    },
    [patchInputs, simRowByKeyForBuy, inputs],
  );

  useEffect(() => {
    if (!enabled || !synthAlloc || topCapital <= 0) return;

    const plan = planSynthCapitalSyncs({
      synthAlloc,
      topCapitalEur: topCapital,
      inputs,
      positions,
      inPortfolioByKey,
      prevSnapshot: snapshotRef.current,
      pnlPctByKey,
    });

    const sig = JSON.stringify({
      snapshot: plan.snapshot,
      updates: plan.capitalUpdates,
      entries: plan.entries.map((e) => `${e.rowKey}:${e.at}:${e.toCapitalEur}`),
    });
    if (sig === appliedSigRef.current) return;
    appliedSigRef.current = sig;

    if (plan.snapshotChanged) {
      snapshotRef.current = plan.snapshot;
      saveLastSynthSnapshot(plan.snapshot);
    }

    // Baseline snapshot only — capital changes require explicit Sync → Synth click.
  }, [
    enabled,
    synthAlloc,
    topCapital,
    inputs,
    positions,
    inPortfolioByKey,
    pnlPctByKey,
  ]);

  const synthCapEurForRow = useCallback(
    (rowKey: string, inPortfolio: boolean): number | null => {
      if (!synthAlloc || topCapital <= 0 || !inPortfolio) return null;
      return resolvePortfolioSynthTargetEur(
        synthAlloc,
        rowKey,
        topCapital,
        inputs[rowKey]?.capital ?? 0,
        pnlPctByKey[rowKey],
      );
    },
    [synthAlloc, topCapital, inputs, pnlPctByKey],
  );

  const syncRowToSynth = useCallback(
    (rowKey: string, source: SynthCapitalSyncSource = "manual") => {
      if (!enabled || !synthAlloc || topCapital <= 0 || !inPortfolioByKey[rowKey]) return false;
      const plan = planManualSynthSyncs({
        synthAlloc,
        topCapitalEur: topCapital,
        inputs,
        positions,
        inPortfolioByKey,
        pnlPctByKey,
        rowKeys: [rowKey],
        source,
      });
      if (plan.entries.length === 0) return false;
      commitSyncPlan(plan.entries, plan.capitalUpdates, plan.snapshot);
      return true;
    },
    [
      enabled,
      synthAlloc,
      topCapital,
      inputs,
      positions,
      inPortfolioByKey,
      pnlPctByKey,
      commitSyncPlan,
    ],
  );

  const syncAllPortfolioToSynth = useCallback(() => {
    if (!enabled || !synthAlloc || topCapital <= 0) return 0;
    const plan = planManualSynthSyncs({
      synthAlloc,
      topCapitalEur: topCapital,
      inputs,
      positions,
      inPortfolioByKey,
      pnlPctByKey,
      source: "bulk",
    });
    if (plan.entries.length === 0) return 0;
    commitSyncPlan(plan.entries, plan.capitalUpdates, plan.snapshot);
    return plan.entries.length;
  }, [
    enabled,
    synthAlloc,
    topCapital,
    inputs,
    positions,
    inPortfolioByKey,
    pnlPctByKey,
    commitSyncPlan,
  ]);

  const portfolioDriftCount = useMemo(() => {
    if (!synthAlloc || topCapital <= 0) return 0;
    let n = 0;
    for (const p of positions) {
      if (!inPortfolioByKey[p.key]) continue;
      const synthEur = synthCapEurForRow(p.key, true);
      if (synthEur == null) continue;
      const cap = inputs[p.key]?.capital ?? 0;
      if (Math.round(cap) !== synthEur) n++;
    }
    return n;
  }, [synthAlloc, topCapital, positions, inPortfolioByKey, inputs, synthCapEurForRow]);

  const revertableLogRowCount = useMemo(
    () => countSynthCapitalSyncRows(logByKey),
    [logByKey],
  );

  const revertAllSynthCapital = useCallback(() => {
    if (!enabled) return 0;
    const freshLog = loadSynthCapitalSyncLog();
    const n = revertSynthCapitalSyncs(
      patchInputs,
      inputs,
      simRowByKeyForBuy,
      freshLog,
    );
    if (n > 0) {
      setLogByKey(loadSynthCapitalSyncLog());
    }
    return n;
  }, [enabled, patchInputs, inputs, simRowByKeyForBuy]);

  const toggleLogExpanded = useCallback((rowKey: string) => {
    setExpandedLogKey((prev) => (prev === rowKey ? null : rowKey));
  }, []);

  const entriesForRow = useCallback(
    (rowKey: string): SynthCapitalSyncEntry[] => logByKey[rowKey] ?? [],
    [logByKey],
  );

  return {
    entriesForRow,
    expandedLogKey,
    toggleLogExpanded,
    synthCapEurForRow,
    syncRowToSynth,
    syncAllPortfolioToSynth,
    revertAllSynthCapital,
    portfolioDriftCount,
    revertableLogRowCount,
  };
}
