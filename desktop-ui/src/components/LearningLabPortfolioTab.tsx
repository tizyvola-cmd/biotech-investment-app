import { useCallback, useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { api } from "../api/supernova";
import {
  fetchLearningLoops,
  fetchPortfolioAdviceSnapshot,
  putPortfolioAdviceSnapshot,
  type LoopWithStatus,
} from "../api/learningBus";
import { listProposals, loadFrozenWeights } from "../calibration/proposalStore";
import { pullCalibrationFromServer } from "../calibration/calibrationServerSync";
import { loadAdviceFeedback, serializeAdviceFeedback } from "../sheet/adviceFeedback";
import { loadApprovedPattern, listProposals as listPatternProposals } from "../riskPattern/patternProposalStore";
import { CalibrationCenterView } from "./CalibrationCenterView";
import { LearningLabPortfolioErrorPanel } from "./LearningLabPortfolioErrorPanel";
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
  const [loops, setLoops] = useState<LoopWithStatus[]>([]);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ rows?: SimOutcomeRow[] }>("/api/investment/sim-outcomes")
      .then((doc) => setOutcomes(Array.isArray(doc.rows) ? doc.rows : []))
      .catch(() => setOutcomes([]));
    void fetchLearningLoops()
      .then((doc) => setLoops((doc.loops ?? []).filter((l) => l.family === "C_portfolio")))
      .catch(() => setLoops([]));
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

  const loopRows = useMemo(
    () =>
      loops.map((l) => ({
        id: l.id,
        name: it ? l.name_it : l.name_en,
        verdict: l.status?.verdict ?? "unknown",
      })),
    [loops, it],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-ink-muted flex-1 min-w-[200px]">
          {it
            ? "Review queue sizing + loop portafoglio/advice. Sync opzionale verso server."
            : "Sizing review queue + portfolio/advice loops. Optional sync to server."}
        </p>
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void syncFromServer()}>
          ← server
        </button>
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void syncToServer()}>
          Sync → server
        </button>
      </div>
      {syncMsg ? <p className="text-[10px] text-ink-muted">{syncMsg}</p> : null}

      <LearningLabPortfolioErrorPanel reloadToken={reloadToken} />

      <CalibrationCenterView outcomes={outcomes} simTable={simTable} sdsRows={sdsRows} />

      {loopRows.length > 0 ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/60 overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40">
                <th className="text-left py-1.5 px-2">Loop</th>
                <th className="text-right py-1.5 px-2">{it ? "Verdetto" : "Verdict"}</th>
              </tr>
            </thead>
            <tbody>
              {loopRows.map((r) => (
                <tr key={r.id} className="border-b border-[rgb(var(--border))]/20">
                  <td className="py-1 px-2">{r.name}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
