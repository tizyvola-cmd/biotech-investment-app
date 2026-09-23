import { useCallback, useEffect, useState } from "react";
import {
  fetchTesterFeedbackExport,
  saveTesterFeedbackCalibSnapshot,
  type TesterCalibrationDoc,
} from "../api/testerFeedback";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Eventi feedback aggregati per calibrazione (senza identità tester — vedi tab Monitor tester). */
export function TesterFeedbackLabPanel() {
  const { lang } = useLang();
  const it = lang === "it";
  const [doc, setDoc] = useState<TesterCalibrationDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDoc(await fetchTesterFeedbackExport());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSnapshot = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveTesterFeedbackCalibSnapshot();
      setMsg(it ? `Salvato in ${res.path}` : `Saved to ${res.path}`);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s = doc?.summary;

  return (
    <section className="tester-monitor-panel rounded-lg p-3 flex flex-col gap-3 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="tester-monitor-text text-sm font-semibold">
          {it ? "📱 Feedback → calibrazione" : "📱 Feedback → calibration"}
        </h3>
        <span className="tester-monitor-muted text-[10px] flex-1 min-w-[200px]">
          {it
            ? "Confluenza eventi mobile/desktop per confronto con accuracy monitor."
            : "Mobile/desktop event convergence vs accuracy monitor."}
          <code className="ml-1 text-[9px]">tester_feedback_calibration.json</code>
        </span>
        <button type="button" className="btn-ghost text-xs shrink-0" disabled={loading} onClick={() => void reload()}>
          ↻
        </button>
        <button
          type="button"
          className="btn-primary text-xs shrink-0 disabled:opacity-50"
          disabled={busy || !doc}
          onClick={() => void handleSnapshot()}
        >
          {busy ? "…" : it ? "Salva snapshot" : "Save snapshot"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs shrink-0 disabled:opacity-50"
          disabled={!doc}
          onClick={() => doc && downloadJson(`feedback_calibration_${Date.now()}.json`, doc)}
        >
          {it ? "Scarica JSON" : "Download JSON"}
        </button>
      </div>

      {msg ? <p className="tester-monitor-text text-[11px]">{msg}</p> : null}
      {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      {loading ? (
        <p className="tester-monitor-muted text-sm">{it ? "Caricamento…" : "Loading…"}</p>
      ) : s ? (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="tester-monitor-chip-kind text-[10px] font-semibold px-2 py-1 rounded-full">
              {it ? "Eventi" : "Events"}: {s.events_total}
            </span>
            <span className="tester-monitor-chip-module text-[10px] font-semibold px-2 py-1 rounded-full">
              {it ? "Esiti pred." : "Pred. outcomes"}: {s.prediction_outcome_rows}
            </span>
            {s.hit_rate_pct != null ? (
              <span className="tester-monitor-chip-kind text-[10px] font-semibold px-2 py-1 rounded-full">
                Hit%: {s.hit_rate_pct}% ({s.hits}/{s.hits + s.misses || s.prediction_outcome_rows})
              </span>
            ) : null}
          </div>
          {doc.calibration_rows.length > 0 ? (
            <div className="overflow-auto max-h-[220px] rounded-lg border border-[rgb(var(--tester-monitor-border))]/40">
              <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[10px] border-collapse min-w-[520px]`}>
                <SheetGridColgroup columnCount={5} />
                <thead>
                  <tr>
                    <th className={gridTh("left")}>{it ? "Quando" : "When"}</th>
                    <th className={gridTh("left")}>Ticker</th>
                    <th className={gridTh("left")}>Kind</th>
                    <th className={gridTh("left")}>{it ? "Esito" : "Outcome"}</th>
                    <th className={gridTh("left")}>Src</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.calibration_rows.slice(0, 50).map((r) => (
                    <tr key={String(r.event_id)}>
                      <td className={`${gridTd("left")} tester-monitor-muted whitespace-nowrap`}>
                        {String(r.created_at ?? "").slice(0, 16)}
                      </td>
                      <td className={`${gridTd("left")} font-bold`}>{String(r.ticker ?? "—")}</td>
                      <td className={gridTd("left")}>{String(r.kind)}</td>
                      <td className={gridTd("left")}>{String(r.outcome ?? r.agree ?? r.relevant ?? "—")}</td>
                      <td className={`${gridTd("left")} uppercase`}>{String(r.source)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="tester-monitor-muted text-[11px] italic">
              {it
                ? "Nessun evento di feedback registrato."
                : "No feedback events recorded yet."}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
