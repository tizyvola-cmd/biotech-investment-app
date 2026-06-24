import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import {
  fetchTesterFeedbackConfig,
  fetchTesterFeedbackEvents,
  fetchTesterFeedbackExport,
  fetchTesterFeedbackSummary,
  postTesterFeedbackEvent,
  registerTester,
  resendTesterApprovalEmail,
  saveTesterFeedbackCalibSnapshot,
  setTesterStatus,
  deleteTester,
} from "../api/testerFeedback";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import type {
  TesterFeedbackEvent,
  TesterFeedbackKind,
  TesterFeedbackModule,
  TesterFeedbackSummary,
  TesterFeedbackConfig,
  TesterMeta,
} from "../types/testerFeedback";
import type { ChartBundle, SheetTable } from "../types";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
} from "../data/investmentSimOutcomesData";
import { buildClosedSuccessMetrics } from "../sheet/portfolioSuccessBridge";
import type { ClosedSuccessMetrics } from "../sheet/portfolioSuccessBridge";
import { InvestDecisionSimPanel } from "./InvestDecisionSimPanel";
import { TesterPortfolioDiversifyTab } from "./TesterPortfolioDiversifyTab";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

type TesterMonitorTab = "mobile" | "decisionSim" | "diversify";

const MODULE_LABELS: Record<TesterFeedbackModule, { it: string; en: string }> = {
  dashboard: { it: "Dashboard", en: "Dashboard" },
  simulation: { it: "Simulation", en: "Simulation" },
  decisionLab: { it: "Decision Lab", en: "Decision Lab" },
  catalystFeed: { it: "Catalyst feed", en: "Catalyst feed" },
  portfolio: { it: "Portfolio", en: "Portfolio" },
  opportunities: { it: "Opportunities", en: "Opportunities" },
};

const KIND_LABELS: Record<TesterFeedbackKind, { it: string; en: string }> = {
  session_ping: { it: "Sessione", en: "Session" },
  prediction_outcome: { it: "Esito pred.", en: "Pred. outcome" },
  slope_error: { it: "Errore pendenza", en: "Slope error" },
  signal_feedback: { it: "Feedback segnale", en: "Signal feedback" },
  catalyst_label: { it: "Etichetta catalyst", en: "Catalyst label" },
  gain_note: { it: "Nota guadagno", en: "Gain note" },
};

function fmtTs(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtApprovalFeedback(mail: TesterMeta["approval_email"] | undefined, it: boolean): string {
  if (!mail) return it ? "Accesso approvato." : "Access approved.";
  const to = mail.to;
  const url = mail.welcome_url;
  if (mail.ok && to) {
    return it ? `Email inviata a ${to}` : `Email sent to ${to}`;
  }
  const parts: string[] = [];
  if (mail.skipped && mail.reason === "smtp_non_configurato") {
    parts.push(
      it
        ? "Approvato — SMTP non configurato sul server (SUPERNOVA_SMTP_*)."
        : "Approved — SMTP not configured on server (SUPERNOVA_SMTP_*).",
    );
  } else if (mail.skipped && mail.reason === "email_mancante") {
    parts.push(
      it
        ? "Approvato — nessuna email sul profilo tester."
        : "Approved — no email on tester profile.",
    );
  } else if (mail && !mail.ok && mail.reason) {
    parts.push(it ? `Approvato — email non inviata: ${mail.reason}` : `Approved — email failed: ${mail.reason}`);
  } else {
    parts.push(it ? "Accesso approvato." : "Access approved.");
  }
  if (url) {
    parts.push(it ? `Invia al tester questo link: ${url}` : `Send the tester this link: ${url}`);
  }
  return parts.join(" · ");
}

function payloadPreview(payload: Record<string, unknown>): string {
  const keys = ["outcome", "agree", "relevant", "error_type", "note", "horizon"];
  const parts: string[] = [];
  for (const k of keys) {
    if (payload[k] != null && String(payload[k]).trim()) {
      parts.push(`${k}=${String(payload[k]).slice(0, 40)}`);
    }
  }
  if (!parts.length) {
    const raw = JSON.stringify(payload);
    return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw || "—";
  }
  return parts.join(" · ");
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="tester-monitor-kpi tester-monitor-panel rounded-xl px-4 py-3 min-w-[120px]">
      <p className="tester-monitor-kpi-label text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      <p className="tester-monitor-kpi-value text-xl font-bold tabular-nums mt-0.5">{value}</p>
      {sub ? <p className="tester-monitor-muted text-[10px] mt-0.5">{sub}</p> : null}
    </div>
  );
}

export function TesterMonitorView({
  apiOk,
  simTable = null,
  chartsBundle = null,
}: {
  apiOk: boolean | null;
  simTable?: SheetTable | null;
  chartsBundle?: ChartBundle | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  const [activeTab, setActiveTab] = useState<TesterMonitorTab>("mobile");
  const [isTabTransitioning, setIsTabTransitioning] = useState(false);
  const tabContentRef = useRef<HTMLDivElement>(null);

  const [summary, setSummary] = useState<TesterFeedbackSummary | null>(null);
  const [events, setEvents] = useState<TesterFeedbackEvent[]>([]);
  const [storePath, setStorePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterTester, setFilterTester] = useState("");
  const [filterModule, setFilterModule] = useState<TesterFeedbackModule | "">("");
  const [filterKind, setFilterKind] = useState<TesterFeedbackKind | "">("");

  const [demoTesterId, setDemoTesterId] = useState("demo_tester");
  const [demoDisplay, setDemoDisplay] = useState("Demo");
  const [demoTicker, setDemoTicker] = useState("BNTX");
  const [demoModule, setDemoModule] = useState<TesterFeedbackModule>("simulation");
  const [demoKind, setDemoKind] = useState<TesterFeedbackKind>("prediction_outcome");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [emailCfg, setEmailCfg] = useState<TesterFeedbackConfig["approval_email"] | null>(null);
  const [closedSuccess, setClosedSuccess] = useState<ClosedSuccessMetrics | null>(null);

  useEffect(() => {
    if (apiOk === false) return;
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      const rows = closedSimOutcomeRowsFromDoc(doc);
      setClosedSuccess(buildClosedSuccessMetrics(rows));
    });
  }, [apiOk]);

  const reload = useCallback(async () => {
    if (apiOk === false) return;
    setLoading(true);
    setError(null);
    try {
      const [cfg, sum, evRes] = await Promise.all([
        fetchTesterFeedbackConfig(),
        fetchTesterFeedbackSummary(),
        fetchTesterFeedbackEvents({
          limit: 300,
          tester_id: filterTester.trim() || undefined,
          module: filterModule || undefined,
          kind: filterKind || undefined,
        }),
      ]);
      setStorePath(cfg.store_path);
      setEmailCfg(cfg.approval_email ?? null);
      setSummary(sum);
      setEvents(evRes.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiOk, filterTester, filterModule, filterKind]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 20_000);
    return () => clearInterval(id);
  }, [reload]);

  const moduleBreakdown = useMemo(() => {
    if (!summary?.by_module) return [];
    return Object.entries(summary.by_module).sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const kindBreakdown = useMemo(() => {
    if (!summary?.by_kind) return [];
    return Object.entries(summary.by_kind).sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const pendingTesters = useMemo(() => {
    if (!summary?.testers) return [];
    return summary.testers.filter((t) => (t.status || "pending").toLowerCase() === "pending");
  }, [summary]);

  const sortedTesters = useMemo(() => {
    if (!summary?.testers) return [];
    const rank = (st: string) => (st === "pending" ? 0 : st === "approved" ? 1 : 2);
    return [...summary.testers].sort((a, b) => {
      const ra = rank((a.status || "pending").toLowerCase());
      const rb = rank((b.status || "pending").toLowerCase());
      if (ra !== rb) return ra - rb;
      return String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""));
    });
  }, [summary]);

  const downloadExport = async () => {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const doc = await fetchTesterFeedbackExport();
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tester_feedback_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(it ? "JSON scaricato." : "JSON downloaded.");
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  const saveCalibSnapshot = async () => {
    setExportBusy(true);
    setExportMsg(null);
    try {
      const res = await saveTesterFeedbackCalibSnapshot();
      setExportMsg(it ? `Snapshot Model Lab: ${res.path}` : `Model Lab snapshot: ${res.path}`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  const [exportBusy, setExportBusy] = useState(false);

  const updateTesterStatus = async (
    testerId: string,
    status: "pending" | "approved" | "revoked",
  ) => {
    setStatusBusy(testerId);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await setTesterStatus(testerId, status);
      if (status === "approved") {
        setStatusMsg(fmtApprovalFeedback(res.tester?.approval_email, it));
      } else if (status === "revoked") {
        setStatusMsg(it ? "Richiesta rifiutata — accesso negato." : "Request rejected — access denied.");
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(null);
    }
  };

  const resendApprovalEmail = async (testerId: string) => {
    setStatusBusy(testerId);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await resendTesterApprovalEmail(testerId);
      setStatusMsg(fmtApprovalFeedback(res.tester?.approval_email, it));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(null);
    }
  };

  const removeTester = async (testerId: string, label: string) => {
    const msg = it
      ? `Eliminare definitivamente "${label}"?\nVerranno rimossi anche eventi feedback e portfolio mobile.`
      : `Permanently delete "${label}"?\nAssociated feedback events and mobile portfolio will be removed.`;
    if (!window.confirm(msg)) return;
    setStatusBusy(testerId);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await deleteTester(testerId);
      if (filterTester === testerId) setFilterTester("");
      setStatusMsg(
        it
          ? `Tester eliminato (${res.events_removed ?? 0} eventi rimossi).`
          : `Tester deleted (${res.events_removed ?? 0} events removed).`,
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(null);
    }
  };

  const submitDemo = async () => {
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      await registerTester({
        tester_id: demoTesterId.trim(),
        display_name: demoDisplay.trim() || demoTesterId.trim(),
        source: "desktop",
      });
      await postTesterFeedbackEvent({
        tester_id: demoTesterId.trim(),
        display_name: demoDisplay.trim(),
        module: demoModule,
        kind: demoKind,
        ticker: demoTicker.trim() || undefined,
        source: "desktop",
        payload:
          demoKind === "prediction_outcome"
            ? { outcome: "hit", horizon: "T+3", note: "desktop smoke test" }
            : { note: "desktop smoke test" },
      });
      setDemoMsg(it ? "Evento inviato." : "Event sent.");
      await reload();
    } catch (e) {
      setDemoMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoBusy(false);
    }
  };

  const handleTabClick = useCallback((tab: TesterMonitorTab) => {
    setIsTabTransitioning(true);
    startTransition(() => {
      setActiveTab(tab);
      setIsTabTransitioning(false);
      // Scroll to top when changing tabs
      setTimeout(() => {
        if (tabContentRef.current) {
          tabContentRef.current.scrollTop = 0;
        }
      }, 0);
    });
  }, []);

  return (
    <div className="tester-monitor-shell flex flex-col flex-1 gap-4 pb-6 pr-1">
      <div className="tester-monitor-panel shrink-0 rounded-2xl px-2 py-2 flex gap-1 relative z-10">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === "mobile"
              ? "bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] border border-[rgb(var(--accent))]/30"
              : "text-ink-muted hover:bg-surface/60 border border-transparent"
          }`}
          onClick={() => handleTabClick("mobile")}
          aria-selected={activeTab === "mobile"}
          role="tab"
        >
          {it ? "📱 Feedback mobile" : "📱 Mobile feedback"}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === "decisionSim"
              ? "bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] border border-[rgb(var(--accent))]/30"
              : "text-ink-muted hover:bg-surface/60 border border-transparent"
          }`}
          onClick={() => handleTabClick("decisionSim")}
          aria-selected={activeTab === "decisionSim"}
          role="tab"
        >
          {it ? "🔁 Sim invest/disinvest" : "🔁 Invest/divest sim loop"}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === "diversify"
              ? "bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] border border-[rgb(var(--accent))]/30"
              : "text-ink-muted hover:bg-surface/60 border border-transparent"
          }`}
          onClick={() => handleTabClick("diversify")}
          aria-selected={activeTab === "diversify"}
          role="tab"
        >
          {it ? "📊 Capitale & diversificazione" : "📊 Capital & diversification"}
        </button>
      </div>

      <div ref={tabContentRef} className="flex flex-col flex-1">
        {isTabTransitioning ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-ink-muted animate-pulse">{it ? "Caricamento..." : "Loading..."}</p>
          </div>
        ) : activeTab === "decisionSim" ? (
          <div key="decisionSim-tab" className="flex flex-col flex-1">
            <ViewErrorBoundary label="Sim loop">
              <InvestDecisionSimPanel
                simTable={simTable}
                chartsBundle={chartsBundle}
                closedSuccess={closedSuccess}
              />
            </ViewErrorBoundary>
          </div>
        ) : activeTab === "diversify" ? (
          <div key="diversify-tab" className="flex flex-col flex-1">
            <ViewErrorBoundary label="Cap & Div">
              <TesterPortfolioDiversifyTab apiOk={apiOk} simTable={simTable} />
            </ViewErrorBoundary>
          </div>
        ) : (
          <div key="mobile-tab" className="flex flex-col gap-4 flex-1">
            <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
        <p className="tester-monitor-text text-sm font-semibold">
          {it ? "📱 Monitor tester (app mobile)" : "📱 Tester monitor (mobile app)"}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {it
            ? "Registrazione mobile per email → stato pending finché non approvi qui (Approva/Revoca). Le sessioni compaiono come eventi session_ping."
            : "Mobile registers by email → pending until you approve here (Approve/Revoke). Sessions appear as session_ping events."}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {it
            ? "Confluenza feedback: esiti predizione, gain/loss portfolio mobile (per email), segnali, catalyst. Ogni tester ha simulazione separata dal desktop — store portfolio: "
            : "Feedback convergence: prediction outcomes, mobile portfolio gain/loss (per email), signals, catalyst. Each tester has a simulation separate from desktop — portfolio store: "}
          <code className="px-1 rounded text-[10px]">
            data/tester_sim_inputs/
          </code>
          {it ? " · eventi: " : " · events: "}
          <code className="px-1 rounded text-[10px]">
            data/tester_feedback_store.json
          </code>
          {it ? " — vedi " : " — see "}
          <code className="px-1 rounded text-[10px]">
            docs/MOBILE_TESTER_MVP.md
          </code>
          {it ? " per API e schema mobile." : " for mobile API and schema."}
        </p>
        {storePath && (
          <p className="tester-monitor-muted text-[10px] mt-1 font-mono truncate" title={storePath}>
            {storePath}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" className="btn text-xs py-1.5" disabled={loading || apiOk === false} onClick={() => void reload()}>
            {loading ? (it ? "Aggiorno…" : "Refreshing…") : it ? "↻ Aggiorna" : "↻ Refresh"}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 disabled:opacity-50"
            disabled={exportBusy || apiOk === false}
            onClick={() => void saveCalibSnapshot()}
          >
            {it ? "Salva per Model Lab" : "Save for Model Lab"}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 disabled:opacity-50"
            disabled={exportBusy || apiOk === false}
            onClick={() => void downloadExport()}
          >
            {it ? "Scarica JSON" : "Download JSON"}
          </button>
          {exportMsg ? <span className="tester-monitor-text text-[10px] self-center">{exportMsg}</span> : null}
          {summary?.updated_at && (
            <span className="tester-monitor-muted text-[10px] self-center tabular-nums">
              {it ? "Store: " : "Store: "}
              {fmtTs(summary.updated_at, locale)}
            </span>
          )}
        </div>
      </div>

      {emailCfg && !emailCfg.smtp_configured && (
        <p className="text-[12px] text-amber-200 bg-amber-500/10 border border-amber-500/35 rounded-lg px-3 py-2 shrink-0">
          {it
            ? "Email automatiche disattivate — sul server manca SUPERNOVA_SMTP_HOST/USER. Dopo Approva copia il link di installazione dal messaggio verde e invialo al tester (WhatsApp/email)."
            : "Automatic emails off — server missing SUPERNOVA_SMTP_HOST/USER. After Approve, copy the install link from the green message and send it to the tester."}
          {emailCfg.mobile_public_url ? (
            <span className="block mt-1 font-mono text-[10px] opacity-90">{emailCfg.mobile_public_url}</span>
          ) : (
            <span className="block mt-1 text-[10px]">
              {it ? "Imposta anche SUPERNOVA_PUBLIC_HOST o SUPERNOVA_MOBILE_PUBLIC_URL sul VPS." : "Also set SUPERNOVA_PUBLIC_HOST or SUPERNOVA_MOBILE_PUBLIC_URL on the VPS."}
            </span>
          )}
        </p>
      )}
      {apiOk === false && (
        <p className="text-[12px] text-[rgb(var(--signal-down))]">
          {it ? "API offline — avvia SuperNova desktop per ricevere eventi dai tester." : "API offline — start SuperNova desktop to receive tester events."}
        </p>
      )}
      {error && (
        <p className="text-[12px] text-[rgb(var(--signal-down))] bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {statusMsg && (
        <p className="text-[12px] text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10 border border-[rgb(var(--accent))]/30 rounded-lg px-3 py-2">
          {statusMsg}
        </p>
      )}

      {pendingTesters.length > 0 && (
        <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3 border-2 border-amber-500/40 bg-amber-500/5">
          <p className="tester-monitor-text text-sm font-bold">
            {it ? "Richieste da approvare" : "Access requests to approve"}
          </p>
          <p className="tester-monitor-muted text-[11px] mt-1">
            {it
              ? "Approva per consentire l’accesso, oppure Rifiuta (✕) per negarlo."
              : "Approve to grant access, or Reject (✕) to deny."}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {pendingTesters.map((t) => (
              <div
                key={t.tester_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 bg-surface/80 border border-[rgb(var(--tester-monitor-border))]/50"
              >
                <div className="min-w-0">
                  <p className="tester-monitor-text text-[12px] font-semibold truncate">
                    {t.email || t.display_name || t.tester_id}
                  </p>
                  <p className="tester-monitor-muted text-[10px] font-mono truncate">
                    {t.email ? `${t.tester_id} · ${t.display_name || "—"}` : t.tester_id}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="btn text-xs py-1.5 px-3"
                    disabled={statusBusy === t.tester_id || apiOk === false}
                    onClick={() => void updateTesterStatus(t.tester_id, "approved")}
                  >
                    {statusBusy === t.tester_id ? "…" : it ? "✓ Approva" : "✓ Approve"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs py-1.5 px-3 text-[rgb(var(--signal-down))] border border-red-500/30"
                    disabled={statusBusy === t.tester_id || apiOk === false}
                    title={it ? "Rifiuta richiesta" : "Reject request"}
                    aria-label={it ? "Rifiuta richiesta" : "Reject request"}
                    onClick={() => void updateTesterStatus(t.tester_id, "revoked")}
                  >
                    {statusBusy === t.tester_id ? "…" : it ? "✕ Rifiuta" : "✕ Reject"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs py-1.5 px-2 text-[rgb(var(--signal-down))] border border-red-500/30 font-bold"
                    disabled={statusBusy === t.tester_id || apiOk === false}
                    title={it ? "Elimina tester" : "Delete tester"}
                    aria-label={it ? "Elimina tester" : "Delete tester"}
                    onClick={() =>
                      void removeTester(t.tester_id, t.email || t.display_name || t.tester_id)
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap gap-2 shrink-0">
          <KpiCard
            label={it ? "In attesa" : "Pending"}
            value={summary.pending_testers ?? pendingTesters.length}
            sub={it ? "da approvare" : "awaiting approval"}
          />
          <KpiCard label={it ? "Tester" : "Testers"} value={summary.tester_count} />
          <KpiCard label={it ? "Eventi totali" : "Total events"} value={summary.events_total} />
          <KpiCard
            label={it ? "Attivi 24h" : "Active 24h"}
            value={summary.active_testers_24h}
            sub={it ? `${summary.active_testers_7d} in 7g` : `${summary.active_testers_7d} in 7d`}
          />
        </div>
      )}

      {summary && (moduleBreakdown.length > 0 || kindBreakdown.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 shrink-0">
          <div className="tester-monitor-panel-soft rounded-xl p-3">
            <p className="tester-monitor-text text-[11px] font-semibold mb-2">{it ? "Per modulo (mobile)" : "By module (mobile)"}</p>
            <div className="flex flex-wrap gap-1.5">
              {moduleBreakdown.map(([mod, n]) => (
                <span
                  key={mod}
                  className="tester-monitor-chip-module text-[10px] font-semibold px-2 py-1 rounded-full"
                >
                  {MODULE_LABELS[mod as TesterFeedbackModule]?.[lang] ?? mod}: {n}
                </span>
              ))}
            </div>
          </div>
          <div className="tester-monitor-panel-soft rounded-xl p-3">
            <p className="tester-monitor-text text-[11px] font-semibold mb-2">{it ? "Per tipo segnale" : "By signal type"}</p>
            <div className="flex flex-wrap gap-1.5">
              {kindBreakdown.map(([k, n]) => (
                <span
                  key={k}
                  className="tester-monitor-chip-kind text-[10px] font-semibold px-2 py-1 rounded-full"
                >
                  {KIND_LABELS[k as TesterFeedbackKind]?.[lang] ?? k}: {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {summary && summary.testers.length > 0 && (
        <div className="tester-monitor-panel rounded-xl overflow-hidden shrink-0">
          <p className="tester-monitor-text text-[11px] font-semibold px-3 py-2 border-b border-[rgb(var(--tester-monitor-border))]/40">
            {it ? "Tester registrati" : "Registered testers"}
          </p>
          <div className="overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[11px] border-collapse min-w-[860px]`}>
              <SheetGridColgroup columnCount={8} />
              <thead>
                <tr className="text-left uppercase tracking-wide text-[10px]">
                  <th className={gridTh("left", "py-2")}>Email</th>
                  <th className={gridTh("left", "py-2")}>ID</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Nome" : "Name"}</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Stato" : "Status"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Portfolio" : "Portfolio"}</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Ultimo accesso" : "Last seen"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Sessioni" : "Sessions"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Azioni" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTesters.map((t) => {
                  const st = (t.status || "pending").toLowerCase();
                  const pf = t.portfolio;
                  return (
                  <tr
                    key={t.tester_id}
                    className="cursor-pointer"
                    onClick={() => setFilterTester(t.tester_id)}
                  >
                    <td className={`${gridTd("left", "py-2")} text-[10px]`}>{t.email || "—"}</td>
                    <td className={`${gridTd("left", "py-2")} font-mono font-semibold text-[10px]`}>{t.tester_id}</td>
                    <td className={gridTd("left", "py-2")}>{t.display_name}</td>
                    <td className={gridTd("left", "py-2")}>
                      <span className={`tester-status-pill tester-status-pill--${st}`}>{st}</span>
                    </td>
                    <td className={`${gridTd("center", "py-2")} text-[10px] tabular-nums`}>
                      {pf && st === "approved" ? (
                        <>
                          {pf.open_positions ?? 0} {it ? "aperte" : "open"}
                          {(pf.open_capital_eur ?? 0) > 0 ? (
                            <span className="tester-monitor-muted"> · €{pf.open_capital_eur}</span>
                          ) : null}
                          {(pf.closed_positions ?? 0) > 0 ? (
                            <span className="tester-monitor-muted"> · {pf.closed_positions} {it ? "chiuse" : "closed"}</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${gridTd("left", "py-2")} tester-monitor-muted`}>{fmtTs(t.last_seen_at, locale)}</td>
                    <td className={`${gridTd("center", "py-2")} font-bold tabular-nums`}>
                      {t.session_ping_count ?? 0}
                      <span className="tester-monitor-muted font-normal text-[9px]">
                        {" "}/ {t.events_in_store ?? t.event_count ?? 0}
                      </span>
                    </td>
                    <td className={gridTd("center", "py-2")} onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {st === "pending" ? (
                          <>
                            <button
                              type="button"
                              className="btn-ghost text-[9px] px-1.5 py-0.5"
                              disabled={statusBusy === t.tester_id || apiOk === false}
                              onClick={() => void updateTesterStatus(t.tester_id, "approved")}
                            >
                              {it ? "✓ Approva" : "✓ Approve"}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-[9px] px-1.5 py-0.5 text-[rgb(var(--signal-down))]"
                              disabled={statusBusy === t.tester_id || apiOk === false}
                              title={it ? "Rifiuta" : "Reject"}
                              onClick={() => void updateTesterStatus(t.tester_id, "revoked")}
                            >
                              {it ? "✕ Rifiuta" : "✕ Reject"}
                            </button>
                          </>
                        ) : null}
                        {st === "approved" ? (
                          <>
                            <button
                              type="button"
                              className="btn-ghost text-[9px] px-1.5 py-0.5 text-[rgb(var(--signal-down))]"
                              disabled={statusBusy === t.tester_id || apiOk === false}
                              onClick={() => void updateTesterStatus(t.tester_id, "revoked")}
                            >
                              {it ? "Revoca" : "Revoke"}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-[9px] px-1.5 py-0.5"
                              disabled={statusBusy === t.tester_id || apiOk === false}
                              onClick={() => void resendApprovalEmail(t.tester_id)}
                            >
                              {it ? "↻ Reinvia link" : "↻ Resend link"}
                            </button>
                          </>
                        ) : null}
                        {st === "revoked" ? (
                          <button
                            type="button"
                            className="btn-ghost text-[9px] px-1.5 py-0.5"
                            disabled={statusBusy === t.tester_id || apiOk === false}
                            onClick={() => void updateTesterStatus(t.tester_id, "pending")}
                          >
                            {it ? "Ripristina" : "Restore"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost text-[9px] px-1.5 py-0.5 text-[rgb(var(--signal-down))] border border-red-500/25 font-bold min-w-[1.4rem]"
                          disabled={statusBusy === t.tester_id || apiOk === false}
                          title={it ? "Elimina tester" : "Delete tester"}
                          aria-label={it ? "Elimina tester" : "Delete tester"}
                          onClick={() =>
                            void removeTester(t.tester_id, t.email || t.display_name || t.tester_id)
                          }
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="tester-monitor-panel-soft rounded-xl p-3 shrink-0">
        <p className="tester-monitor-text text-[11px] font-semibold mb-2">{it ? "Filtri eventi" : "Event filters"}</p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            tester_id
            <input
              className="input text-[11px] py-1 w-[8rem]"
              value={filterTester}
              onChange={(e) => setFilterTester(e.target.value)}
              placeholder="alice"
            />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            module
            <select
              className="input text-[11px] py-1"
              value={filterModule}
              onChange={(e) => setFilterModule(e.target.value as TesterFeedbackModule | "")}
            >
              <option value="">{it ? "Tutti" : "All"}</option>
              {(summary?.valid_modules ?? []).map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m as TesterFeedbackModule]?.[lang] ?? m}
                </option>
              ))}
            </select>
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            kind
            <select
              className="input text-[11px] py-1"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as TesterFeedbackKind | "")}
            >
              <option value="">{it ? "Tutti" : "All"}</option>
              {(summary?.valid_kinds ?? []).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k as TesterFeedbackKind]?.[lang] ?? k}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-ghost text-[11px] py-1" onClick={() => { setFilterTester(""); setFilterModule(""); setFilterKind(""); }}>
            {it ? "Reset filtri" : "Reset filters"}
          </button>
        </div>
      </div>

      <div className="tester-monitor-panel rounded-xl flex-1 min-h-[200px]">
        <p className="tester-monitor-text text-[11px] font-semibold px-3 py-2 border-b border-[rgb(var(--tester-monitor-border))]/40">
          {it ? "Flusso eventi" : "Event stream"} ({events.length})
        </p>
        <div className="overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[11px] border-collapse min-w-[720px]`}>
            <SheetGridColgroup columnCount={7} />
            <thead className="sticky top-0 z-[1]">
              <tr className="text-left uppercase tracking-wide text-[10px]">
                <th className={gridTh("left", "py-2")}>{it ? "Quando" : "When"}</th>
                <th className={gridTh("left", "py-2")}>Tester</th>
                <th className={gridTh("left", "py-2")}>{it ? "Modulo" : "Module"}</th>
                <th className={gridTh("left", "py-2")}>Kind</th>
                <th className={gridTh("left", "py-2")}>Ticker</th>
                <th className={gridTh("left", "py-2")}>Payload</th>
                <th className={gridTh("left", "py-2")}>Src</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr className="tester-monitor-row-empty">
                  <td colSpan={7} className={`${gridTd("left", "py-10")} text-center italic`}>
                    {it
                      ? "Nessun evento — usa il form sotto o l’app mobile quando pronta."
                      : "No events — use the form below or the mobile app when ready."}
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id}>
                    <td className={`${gridTd("left", "py-2")} tester-monitor-muted whitespace-nowrap`}>{fmtTs(ev.created_at, locale)}</td>
                    <td className={`${gridTd("left", "py-2")} font-mono font-semibold`}>{ev.tester_id}</td>
                    <td className={gridTd("left", "py-2")}>{MODULE_LABELS[ev.module]?.[lang] ?? ev.module}</td>
                    <td className={gridTd("left", "py-2")}>{KIND_LABELS[ev.kind]?.[lang] ?? ev.kind}</td>
                    <td className={`${gridTd("left", "py-2")} font-bold`}>{ev.ticker ?? "—"}</td>
                    <td className={`${gridTd("left", "py-2")} tester-monitor-muted max-w-[240px] truncate`} title={JSON.stringify(ev.payload)}>
                      {payloadPreview(ev.payload)}
                    </td>
                    <td className={`${gridTd("left", "py-2")} text-[10px] uppercase`}>{ev.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <details className="tester-monitor-demo rounded-xl p-3 shrink-0">
        <summary className="text-[11px] font-semibold cursor-pointer select-none">
          {it ? "🧪 Invia evento di prova (smoke test API)" : "🧪 Send test event (API smoke test)"}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2 items-end">
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            tester_id
            <input className="input text-[11px] py-1 w-[7rem]" value={demoTesterId} onChange={(e) => setDemoTesterId(e.target.value)} />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            {it ? "Nome" : "Name"}
            <input className="input text-[11px] py-1 w-[6rem]" value={demoDisplay} onChange={(e) => setDemoDisplay(e.target.value)} />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            ticker
            <input className="input text-[11px] py-1 w-[5rem]" value={demoTicker} onChange={(e) => setDemoTicker(e.target.value)} />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            module
            <select className="input text-[11px] py-1" value={demoModule} onChange={(e) => setDemoModule(e.target.value as TesterFeedbackModule)}>
              {(Object.keys(MODULE_LABELS) as TesterFeedbackModule[]).map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m][lang]}
                </option>
              ))}
            </select>
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            kind
            <select className="input text-[11px] py-1" value={demoKind} onChange={(e) => setDemoKind(e.target.value as TesterFeedbackKind)}>
              {(Object.keys(KIND_LABELS) as TesterFeedbackKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k][lang]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn text-[11px] py-1.5" disabled={demoBusy || apiOk === false} onClick={() => void submitDemo()}>
            {demoBusy ? "…" : it ? "Invia" : "Send"}
          </button>
        </div>
        {demoMsg && <p className="tester-monitor-text text-[10px] mt-2 font-medium">{demoMsg}</p>}
      </details>
          </div>
        )}
      </div>
    </div>
  );
}
