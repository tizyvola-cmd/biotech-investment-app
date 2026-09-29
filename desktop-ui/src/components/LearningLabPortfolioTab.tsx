import { useCallback, useEffect, useState } from "react";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { loadInvestmentSimOutcomes } from "../data/investmentSimOutcomesData";
import {
  fetchPortfolioAdviceSnapshot,
  putPortfolioAdviceSnapshot,
} from "../api/learningBus";
import { listProposals, loadFrozenWeights } from "../calibration/proposalStore";
import { pullCalibrationFromServer } from "../calibration/calibrationServerSync";
import { loadAdviceFeedback, serializeAdviceFeedback } from "../sheet/adviceFeedback";
import { loadApprovedPattern, listProposals as listPatternProposals } from "../riskPattern/patternProposalStore";
import { LearningLabPortfolioErrorPanel } from "./LearningLabPortfolioErrorPanel";
import { PortfolioAdviceOverviewPanel } from "./PortfolioAdviceOverviewPanel";
import { useLang } from "../shared/i18n";

function collectLocalSnapshot() {
  const af = loadAdviceFeedback();
  return {
    calibration_proposals: listProposals(),
    frozen_weights: loadFrozenWeights(),
    advice_feedback: af ? serializeAdviceFeedback(af) : null,
    risk_pattern: {
      proposals: listPatternProposals(),
      approved: loadApprovedPattern(),
      validation: {},
      flagged: {},
    },
  };
}

export function LearningLabPortfolioTab({
  simTable,
  sdsRows,
  reloadToken = 0,
}: {
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  reloadToken?: number;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [outcomes, setOutcomes] = useState<SimOutcomeRow[]>([]);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Perf (Jul 2026): use the deduped loader instead of a raw `api(...)` call.
    // The direct call bypassed the in-flight coalescer + 30 s response cache
    // added in `investmentSimOutcomesData.ts`, so on Learning Lab / Models
    // mount three consumers each fired their own 6 s /api/investment/sim-outcomes
    // fetch instead of sharing one.
    let cancelled = false;
    void loadInvestmentSimOutcomes()
      .then((res) => {
        if (cancelled) return;
        const rows = res.doc?.rows;
        setOutcomes(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        setOutcomes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const syncToServer = useCallback(async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      const local = collectLocalSnapshot();
      await putPortfolioAdviceSnapshot({
        schema_version: 1,
        updated_at: new Date().toISOString(),
        source: "desktop_sync",
        calibration_proposals: local.calibration_proposals,
        frozen_weights: local.frozen_weights,
        advice_feedback: local.advice_feedback,
        risk_pattern: local.risk_pattern,
      });
      const remote = await fetchPortfolioAdviceSnapshot();
      setSyncMsg(
        it
          ? `Snapshot sincronizzato · server ${remote.updated_at ?? "—"}`
          : `Snapshot synced · server ${remote.updated_at ?? "—"}`,
      );
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [it]);

  const syncFromServer = useCallback(async () => {
    setBusy(true);
    setSyncMsg(null);
    try {
      const res = await pullCalibrationFromServer();
      setSyncMsg(res.message);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-ink-muted flex-1 min-w-[200px]">
          {it
            ? "Vista sintetica di probabilità, pesi e allocazione."
            : "Summary of probability, weights and allocation."}
        </p>
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void syncFromServer()}>
          ← server
        </button>
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void syncToServer()}>
          Sync → server
        </button>
      </div>
      {syncMsg ? <p className="text-[10px] text-ink-muted">{syncMsg}</p> : null}

      <PortfolioAdviceOverviewPanel outcomes={outcomes} simTable={simTable} sdsRows={sdsRows} />

      <LearningLabPortfolioErrorPanel reloadToken={reloadToken} />
    </div>
  );
}