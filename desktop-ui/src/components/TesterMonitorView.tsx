import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTesterFeedbackConfig,
  fetchTesterFeedbackExport,
  fetchTesterFeedbackSummary,
  fetchTesterSimMonitor,
  postTesterFeedbackEvent,
  registerTester,
  resendTesterApprovalEmail,
  replyTesterEmail,
  saveTesterFeedbackCalibSnapshot,
  setTesterStatus,
  deleteTester,
} from "../api/testerFeedback";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import type {
  TesterFeedbackKind,
  TesterFeedbackModule,
  TesterFeedbackSummary,
  TesterFeedbackConfig,
  TesterMeta,
  TesterSimMonitor,
  TesterSimPosition,
  TesterSimRow,
} from "../types/testerFeedback";
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
  ui_error: { it: "Errore UI", en: "UI error" },
};

function editionLabel(raw: string | undefined, it: boolean): string {
  const ed = (raw || "").toLowerCase();
  if (ed === "biotech") return "Biotech";
  if (ed === "tech") return "Tech";
  if (ed === "both") return it ? "Biotech + Tech" : "Biotech + Tech";
  return "—";
}

function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({
    view: "cm",
    fs: "1",
    to,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

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

function fmtEur(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString(locale, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
  } catch {
    return `€${Math.round(value)}`;
  }
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function gainClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return "tabular-nums";
  }
  return value > 0
    ? "tabular-nums text-[rgb(var(--signal-up))]"
    : "tabular-nums text-[rgb(var(--signal-down))]";
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
}: {
  apiOk: boolean | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  const [summary, setSummary] = useState<TesterFeedbackSummary | null>(null);
  const [storePath, setStorePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  const [replyTester, setReplyTester] = useState<TesterMeta | null>(null);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyMsg, setReplyMsg] = useState<string | null>(null);

  const [simMonitor, setSimMonitor] = useState<TesterSimMonitor | null>(null);
  const [expandedSim, setExpandedSim] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (apiOk === false) return;
    setLoading(true);
    setError(null);
    try {
      const [cfg, sum, sim] = await Promise.all([
        fetchTesterFeedbackConfig(),
        fetchTesterFeedbackSummary(),
        fetchTesterSimMonitor().catch(() => null),
      ]);
      setStorePath(cfg.store_path);
      setEmailCfg(cfg.approval_email ?? null);
      setSummary(sum);
      setSimMonitor(sim);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiOk]);

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

  const inviteTester = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      setInviteMsg(it ? "Inserisci un’email." : "Enter an email.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteMsg(it ? "Email non valida." : "Invalid email.");
      return;
    }
    setInviteBusy(true);
    setInviteMsg(null);
    setInviteLink(null);
    setInviteLinkCopied(false);
    try {
      const reg = await registerTester({
        email,
        display_name: inviteName.trim() || undefined,
        source: "desktop",
      });
      const tid = reg.tester?.tester_id;
      if (!tid) {
        throw new Error(it ? "Registrazione fallita." : "Registration failed.");
      }
      const alreadyApproved =
        (reg.tester?.status || "").toLowerCase() === "approved";
      const finalMeta = alreadyApproved
        ? (await resendTesterApprovalEmail(tid)).tester
        : (await setTesterStatus(tid, "approved")).tester;
      const feedback = finalMeta?.approval_email;
      setInviteMsg(fmtApprovalFeedback(feedback, it));
      if (feedback?.welcome_url) setInviteLink(feedback.welcome_url);
      setInviteEmail("");
      setInviteName("");
      await reload();
    } catch (e) {
      setInviteMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
      window.setTimeout(() => setInviteLinkCopied(false), 2500);
    } catch {
      setInviteLinkCopied(false);
    }
  };

  const gmailBox =
    emailCfg?.gmail_reply_email || emailCfg?.owner_notify_email || "tizyvola@gmail.com";

  const startReply = (row: TesterMeta) => {
    const to = row.email || "";
    setReplyTester(row);
    setReplySubject(`SuperNova — ${to}`);
    setReplyBody("");
    setReplyMsg(null);
  };

  const openGmailFor = (row: TesterMeta) => {
    const to = (row.email || "").trim();
    if (!to) return;
    const subject = `SuperNova — ${to}`;
    const body = it
      ? `Ciao ${row.display_name || ""},\n\n`
      : `Hi ${row.display_name || ""},\n\n`;
    window.open(gmailComposeUrl(to, subject, body), "_blank", "noopener,noreferrer");
  };

  const sendReply = async () => {
    if (!replyTester) return;
    setReplyBusy(true);
    setReplyMsg(null);
    try {
      const res = await replyTesterEmail(replyTester.tester_id, {
        subject: replySubject,
        body: replyBody,
      });
      const sent = res.tester?.owner_reply;
      if (sent?.ok) {
        setReplyMsg(it ? `Inviata da ${sent.from || gmailBox}` : `Sent from ${sent.from || gmailBox}`);
        setReplyBody("");
        await reload();
      } else if (sent?.skipped) {
        setReplyMsg(
          it
            ? `SMTP non pronto (${sent.reason || "smtp"}). Apro Gmail.`
            : `SMTP not ready (${sent.reason || "smtp"}). Opening Gmail.`,
        );
        window.open(
          sent.gmail_compose_url ||
            gmailComposeUrl(replyTester.email || "", replySubject, replyBody),
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        setReplyMsg(sent?.reason || (it ? "Invio fallito." : "Send failed."));
      }
    } catch (e) {
      setReplyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setReplyBusy(false);
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

  return (
    <div className="tester-monitor-shell flex flex-col flex-1 gap-4 pb-6 pr-1">
      <div className="flex flex-col gap-4 flex-1">
            <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
        <p className="tester-monitor-text text-sm font-semibold">
          {it ? "Access — utenti e minuti" : "Access — users & minutes"}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {it
            ? "Request Access dalla landing → Approva qui. Poi l’utente entra con Sign-in / Sign-up. I minuti/giorno arrivano dai session_ping (desktop + mobile)."
            : "Request Access from the landing → Approve here. Then the user signs in. Daily minutes come from session_ping (desktop + mobile)."}
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
            {it ? "Store attivo: " : "Active store: "}
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

      <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
        <p className="tester-monitor-text text-sm font-semibold">
          {it ? "Gmail collegata" : "Connected Gmail"}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {it
            ? "Le richieste arrivano su questa casella. Reply-To è l’email dell’utente: da Gmail basta Rispondi. Puoi anche scrivere da qui."
            : "Access requests land in this mailbox. Reply-To is the applicant — hit Reply in Gmail. You can also write from here."}
        </p>
        <p className="tester-monitor-text text-[12px] font-mono mt-2">{gmailBox}</p>
        {emailCfg?.smtp_configured ? (
          <p className="tester-monitor-muted text-[10px] mt-1">
            {it ? "SMTP Gmail attivo — invio diretto dalla tab." : "Gmail SMTP on — send from this tab."}
          </p>
        ) : (
          <p className="tester-monitor-muted text-[10px] mt-1">
            {it
              ? "SMTP non configurato: usa “Apri in Gmail”. Per l’invio da qui imposta SUPERNOVA_SMTP_HOST=smtp.gmail.com e USER/PASSWORD della stessa casella."
              : "SMTP off: use Open in Gmail. To send from here set SUPERNOVA_SMTP_HOST=smtp.gmail.com and USER/PASSWORD for this mailbox."}
          </p>
        )}
      </div>
      {apiOk === false && (
        <p className="text-[12px] text-[rgb(var(--signal-down))]">
          {it ? "API offline — avvia SuperNova desktop per ricevere eventi dai tester." : "API offline — start SuperNova desktop to receive tester events."}
        </p>
      )}

      <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
        <p className="tester-monitor-text text-sm font-semibold">
          {it ? "✉️ Invita un tester" : "✉️ Invite a tester"}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[720px]">
          {it
            ? "Inserisci l’email: il tester viene registrato come approvato e riceve automaticamente il link di installazione dell’app mobile. Se l’SMTP non è configurato, sotto compare il link da inviare a mano (WhatsApp/email)."
            : "Enter an email: the tester is registered as approved and automatically receives the mobile install link. If SMTP is not configured, the link to send manually (WhatsApp/email) appears below."}
        </p>
        <form
          className="mt-3 flex flex-wrap gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void inviteTester();
          }}
        >
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            {it ? "Email tester" : "Tester email"}
            <input
              type="email"
              autoComplete="email"
              className="input text-[12px] py-1 w-[16rem]"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="alice@example.com"
              disabled={inviteBusy || apiOk === false}
              required
            />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5">
            {it ? "Nome (opzionale)" : "Name (optional)"}
            <input
              className="input text-[12px] py-1 w-[10rem]"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder={it ? "Alice" : "Alice"}
              disabled={inviteBusy || apiOk === false}
            />
          </label>
          <button
            type="submit"
            className="btn text-xs py-1.5 px-3"
            disabled={inviteBusy || apiOk === false || !inviteEmail.trim()}
          >
            {inviteBusy
              ? it ? "Invio…" : "Sending…"
              : it ? "✉️ Invia invito" : "✉️ Send invite"}
          </button>
        </form>
        {inviteMsg && (
          <p className="tester-monitor-text text-[11px] mt-2 font-medium">
            {inviteMsg}
          </p>
        )}
        {inviteLink && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[rgb(var(--tester-monitor-border))]/50 bg-surface/60 px-2 py-1.5">
            <code className="text-[10px] font-mono truncate max-w-[520px]" title={inviteLink}>
              {inviteLink}
            </code>
            <button
              type="button"
              className="btn-ghost text-[10px] py-0.5 px-2"
              onClick={() => void copyInviteLink()}
            >
              {inviteLinkCopied
                ? it ? "✓ Copiato" : "✓ Copied"
                : it ? "Copia link" : "Copy link"}
            </button>
          </div>
        )}
      </div>

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
                  <p className="tester-monitor-text text-[11px] mt-1">
                    {it ? "Versione: " : "Edition: "}
                    <span className="font-semibold">{editionLabel(t.interest_edition, it)}</span>
                  </p>
                  {t.interest_other ? (
                    <p className="tester-monitor-muted text-[11px] mt-0.5 whitespace-pre-wrap">
                      {it ? "Altri interessi: " : "Other markets: "}
                      {t.interest_other}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="btn-ghost text-xs py-1.5 px-3"
                    disabled={!t.email}
                    onClick={() => startReply(t)}
                  >
                    {it ? "Rispondi" : "Reply"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs py-1.5 px-3"
                    disabled={!t.email}
                    onClick={() => openGmailFor(t)}
                  >
                    {it ? "Apri in Gmail" : "Open in Gmail"}
                  </button>
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

      {replyTester ? (
        <div className="tester-monitor-panel shrink-0 rounded-2xl px-4 py-3">
          <p className="tester-monitor-text text-sm font-semibold">
            {it ? "Rispondi da Gmail" : "Reply from Gmail"}
          </p>
          <p className="tester-monitor-muted text-[11px] mt-1">
            {it ? "Da" : "From"} <span className="font-mono">{gmailBox}</span>
            {" → "}
            <span className="font-mono">{replyTester.email}</span>
            {" · "}
            {editionLabel(replyTester.interest_edition, it)}
            {replyTester.interest_other ? ` · ${replyTester.interest_other}` : ""}
          </p>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5 mt-3">
            {it ? "Oggetto" : "Subject"}
            <input
              className="input text-[12px] py-1"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
            />
          </label>
          <label className="tester-monitor-muted text-[10px] flex flex-col gap-0.5 mt-2">
            {it ? "Messaggio" : "Message"}
            <textarea
              className="input text-[12px] py-2 min-h-[7rem]"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              className="btn text-xs py-1.5 px-3"
              disabled={replyBusy || apiOk === false || !replyBody.trim()}
              onClick={() => void sendReply()}
            >
              {replyBusy ? "…" : it ? "Invia da Gmail" : "Send from Gmail"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs py-1.5 px-3"
              onClick={() =>
                window.open(
                  gmailComposeUrl(replyTester.email || "", replySubject, replyBody),
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              {it ? "Apri in Gmail" : "Open in Gmail"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs py-1.5 px-3"
              onClick={() => {
                setReplyTester(null);
                setReplyMsg(null);
              }}
            >
              {it ? "Chiudi" : "Close"}
            </button>
          </div>
          {replyMsg ? (
            <p className="tester-monitor-text text-[11px] mt-2">{replyMsg}</p>
          ) : null}
        </div>
      ) : null}

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
            <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[11px] border-collapse min-w-[980px]`}>
              <SheetGridColgroup columnCount={9} />
              <thead>
                <tr className="text-left uppercase tracking-wide text-[10px]">
                  <th className={gridTh("left", "py-2")}>Email</th>
                  <th className={gridTh("left", "py-2")}>ID</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Nome" : "Name"}</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Stato" : "Status"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Portfolio" : "Portfolio"}</th>
                  <th className={gridTh("left", "py-2")}>{it ? "Ultimo accesso" : "Last seen"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Min oggi" : "Min today"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Sessioni" : "Sessions"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Azioni" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTesters.map((t) => {
                  const st = (t.status || "pending").toLowerCase();
                  const pf = t.portfolio;
                  return (
                  <tr key={t.tester_id}>
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
                      {t.usage_minutes_today ?? 0}
                      <span className="tester-monitor-muted font-normal text-[9px]">
                        {" "}
                        {it ? "min" : "min"}
                        {(t.usage_minutes_total ?? 0) > 0
                          ? ` · Σ ${t.usage_minutes_total}`
                          : ""}
                      </span>
                    </td>
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
                              disabled={!t.email}
                              onClick={() => startReply(t)}
                            >
                              {it ? "Rispondi" : "Reply"}
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

      <div className="tester-monitor-panel rounded-2xl overflow-hidden shrink-0" data-testid="tester-sim-monitor-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-[rgb(var(--tester-monitor-border))]/40">
          <div>
            <p className="tester-monitor-text text-sm font-semibold">
              {it ? "📊 Simulazioni tester" : "📊 Tester simulations"}
            </p>
            <p className="tester-monitor-muted text-[11px] mt-0.5 max-w-[720px]">
              {it
                ? "Cosa hanno comprato e venduto ogni tester, con gain aperto (mark-to-market), gain chiuso realizzato e “follow rate”: quanti dei loro BUY sono ancora oggi coerenti col segnale del modello (direction_live=up e pred5>0)."
                : "What each tester bought and sold, with open gain (mark-to-market), realized closed gain and “follow rate”: how many of their BUYs are still aligned with today's model signal (direction_live=up and pred5>0)."}
            </p>
            {simMonitor && !simMonitor.sim_snapshot_available && (
              <p className="text-[11px] text-amber-300 mt-1">
                {it
                  ? "Snapshot Simulation non disponibile — prezzi correnti e follow rate potrebbero non essere aggiornati."
                  : "Simulation snapshot missing — current prices and follow rate may be stale."}
              </p>
            )}
            {!simMonitor && (
              <p className="text-[11px] text-amber-300 mt-1">
                {loading
                  ? it ? "Carico dati simulazioni…" : "Loading simulation data…"
                  : apiOk === false
                    ? it ? "API offline — nessun dato disponibile." : "API offline — no data available."
                    : it ? "Nessun dato di simulazione disponibile (endpoint /api/tester-feedback/sim-monitor)." : "No simulation data available (endpoint /api/tester-feedback/sim-monitor)."}
              </p>
            )}
          </div>
          {simMonitor && (
            <div className="flex flex-wrap gap-2">
              <KpiCard
                label={it ? "Cap. aperto" : "Open capital"}
                value={fmtEur(simMonitor.aggregate.total_open_capital_eur, locale)}
                sub={`${simMonitor.aggregate.total_open_positions} ${it ? "posizioni" : "positions"}`}
              />
              <KpiCard
                label={it ? "Gain aperto" : "Open gain"}
                value={fmtEur(simMonitor.aggregate.total_open_gain_eur, locale)}
                sub={
                  simMonitor.aggregate.total_open_gain_pct != null
                    ? fmtPct(simMonitor.aggregate.total_open_gain_pct)
                    : undefined
                }
              />
              <KpiCard
                label={it ? "Gain chiuso" : "Closed gain"}
                value={fmtEur(simMonitor.aggregate.total_closed_gain_eur, locale)}
                sub={`${simMonitor.aggregate.total_closed_positions} ${it ? "chiuse" : "closed"}`}
              />
              <KpiCard
                label={it ? "Follow rate medio" : "Avg follow rate"}
                value={
                  simMonitor.aggregate.avg_follow_rate_pct != null
                    ? `${simMonitor.aggregate.avg_follow_rate_pct.toFixed(1)}%`
                    : "—"
                }
                sub={
                  it
                    ? `${simMonitor.aggregate.testers_with_activity}/${simMonitor.aggregate.tester_count} tester attivi`
                    : `${simMonitor.aggregate.testers_with_activity}/${simMonitor.aggregate.tester_count} active testers`
                }
              />
            </div>
          )}
        </div>
        {!simMonitor ? (
          <p className="tester-monitor-muted text-[11px] italic px-4 py-6 text-center">
            {loading
              ? it ? "Carico posizioni tester…" : "Loading tester positions…"
              : it ? "Nessun dato disponibile — riprova con ↻ Aggiorna in alto." : "No data available — retry with ↻ Refresh above."}
          </p>
        ) : simMonitor.testers.length === 0 ? (
            <p className={`tester-monitor-muted text-[11px] italic px-4 py-6 text-center`}>
              {it
                ? "Nessun tester ha ancora salvato posizioni di simulazione dall'app mobile."
                : "No tester has saved simulation positions from the mobile app yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table
                className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[11px] border-collapse min-w-[960px]`}
              >
                <SheetGridColgroup columnCount={9} />
                <thead>
                  <tr className="text-left uppercase tracking-wide text-[10px]">
                    <th className={gridTh("left", "py-2")}>Tester</th>
                    <th className={gridTh("center", "py-2")}>{it ? "Buy" : "Buys"}</th>
                    <th className={gridTh("center", "py-2")}>{it ? "Sell" : "Sells"}</th>
                    <th className={gridTh("right", "py-2")}>{it ? "Cap. aperto" : "Open capital"}</th>
                    <th className={gridTh("right", "py-2")}>{it ? "Gain aperto" : "Open gain"}</th>
                    <th className={gridTh("right", "py-2")}>{it ? "Gain chiuso" : "Closed gain"}</th>
                    <th className={gridTh("center", "py-2")}>{it ? "Follow rate" : "Follow rate"}</th>
                    <th className={gridTh("left", "py-2")}>{it ? "Aggiornato" : "Updated"}</th>
                    <th className={gridTh("center", "py-2")}></th>
                  </tr>
                </thead>
                <tbody>
                  {simMonitor.testers.map((t: TesterSimRow) => {
                    const expanded = expandedSim === t.tester_id;
                    return (
                      <Fragment key={t.tester_id}>
                        <tr
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedSim(expanded ? null : t.tester_id)
                          }
                        >
                          <td className={gridTd("left", "py-2")}>
                            <div className="flex flex-col">
                              <span className="font-semibold text-[11px]">
                                {t.email || t.display_name || t.tester_id}
                              </span>
                              <span className="tester-monitor-muted text-[10px] font-mono">
                                {t.display_name && t.email ? t.display_name : ""}
                              </span>
                            </div>
                          </td>
                          <td className={`${gridTd("center", "py-2")} font-bold tabular-nums`}>
                            {t.totals.buys_count}
                          </td>
                          <td className={`${gridTd("center", "py-2")} font-bold tabular-nums`}>
                            {t.totals.closed_count}
                          </td>
                          <td className={`${gridTd("right", "py-2")} tabular-nums`}>
                            {fmtEur(t.totals.open_capital_eur, locale)}
                          </td>
                          <td className={`${gridTd("right", "py-2")} ${gainClass(t.totals.open_gain_eur)}`}>
                            <div className="flex flex-col items-end">
                              <span>{fmtEur(t.totals.open_gain_eur, locale)}</span>
                              {t.totals.open_gain_pct != null && (
                                <span className="text-[9px] opacity-75">
                                  {fmtPct(t.totals.open_gain_pct)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`${gridTd("right", "py-2")} ${gainClass(t.totals.closed_gain_eur)}`}>
                            {fmtEur(t.totals.closed_gain_eur, locale)}
                          </td>
                          <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                            {t.totals.follow_rate_pct != null ? (
                              <span className="font-bold">
                                {t.totals.follow_rate_pct.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="tester-monitor-muted">—</span>
                            )}
                            <span className="tester-monitor-muted text-[9px] block">
                              {t.totals.aligned_buys}/{t.totals.buys_count}
                            </span>
                          </td>
                          <td className={`${gridTd("left", "py-2")} tester-monitor-muted text-[10px]`}>
                            {fmtTs(t.sim_updated_at ?? undefined, locale)}
                          </td>
                          <td className={`${gridTd("center", "py-2")} text-[10px]`}>
                            {t.totals.buys_count > 0
                              ? expanded
                                ? it ? "▲ chiudi" : "▲ hide"
                                : it ? "▼ dettagli" : "▼ details"
                              : ""}
                          </td>
                        </tr>
                        {expanded && t.positions.length > 0 && (
                          <tr className="tester-monitor-row-detail">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="overflow-x-auto">
                                <table className="tester-monitor-subtable text-[10px] border-collapse w-full">
                                  <thead>
                                    <tr className="text-left uppercase tracking-wide text-[9px] tester-monitor-muted">
                                      <th className="py-1 pr-2">{it ? "Stato" : "State"}</th>
                                      <th className="py-1 pr-2">Ticker</th>
                                      <th className="py-1 pr-2">{it ? "Buy" : "Bought"}</th>
                                      <th className="py-1 pr-2 text-right">{it ? "Cap. €" : "Cap. €"}</th>
                                      <th className="py-1 pr-2 text-right">{it ? "Buy $" : "Buy $"}</th>
                                      <th className="py-1 pr-2 text-right">{it ? "Now $" : "Now $"}</th>
                                      <th className="py-1 pr-2 text-right">{it ? "Valore €" : "Value €"}</th>
                                      <th className="py-1 pr-2 text-right">{it ? "P&L €" : "P&L €"}</th>
                                      <th className="py-1 pr-2 text-right">P&L %</th>
                                      <th className="py-1 pr-2 text-center">{it ? "Segnale oggi" : "Signal today"}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {t.positions.map((p: TesterSimPosition, idx: number) => {
                                      const pnlEur =
                                        p.state === "open" ? p.open_pnl_eur : p.closed_pnl_eur;
                                      const pnlPct =
                                        p.state === "open" ? p.open_pnl_pct : p.closed_pnl_pct;
                                      const value =
                                        p.state === "open" ? p.value_eur : p.closed_value_eur;
                                      return (
                                        <tr
                                          key={`${t.tester_id}-${p.ticker}-${idx}`}
                                          className="border-t border-[rgb(var(--tester-monitor-border))]/25"
                                        >
                                          <td className="py-1 pr-2">
                                            <span
                                              className={`tester-status-pill tester-status-pill--${
                                                p.state === "open" ? "approved" : "pending"
                                              }`}
                                            >
                                              {p.state === "open"
                                                ? it ? "aperta" : "open"
                                                : it ? "chiusa" : "closed"}
                                            </span>
                                          </td>
                                          <td className="py-1 pr-2 font-mono font-semibold">
                                            {p.ticker}
                                            {p.name && (
                                              <span className="tester-monitor-muted font-normal ml-1">
                                                {p.name}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-1 pr-2 tester-monitor-muted">
                                            {fmtDate(p.invested_at, locale)}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums">
                                            {fmtEur(p.capital_eur, locale)}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums">
                                            {p.buy_price_usd != null
                                              ? `$${p.buy_price_usd.toFixed(2)}`
                                              : "—"}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums">
                                            {p.current_price_usd != null
                                              ? `$${p.current_price_usd.toFixed(2)}`
                                              : "—"}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums">
                                            {fmtEur(value ?? null, locale)}
                                          </td>
                                          <td className={`py-1 pr-2 text-right ${gainClass(pnlEur ?? null)}`}>
                                            {fmtEur(pnlEur ?? null, locale)}
                                          </td>
                                          <td className={`py-1 pr-2 text-right ${gainClass(pnlPct ?? null)}`}>
                                            {fmtPct(pnlPct ?? null)}
                                          </td>
                                          <td className="py-1 pr-2 text-center">
                                            {p.signal_up_now ? (
                                              <span
                                                className="text-[rgb(var(--signal-up))] font-bold"
                                                title={it ? "Segnale corrente allineato al BUY" : "Current signal aligned with BUY"}
                                              >
                                                ▲ BUY
                                              </span>
                                            ) : (
                                              <span
                                                className="tester-monitor-muted"
                                                title={
                                                  it
                                                    ? "Segnale corrente non allineato al BUY"
                                                    : "Current signal not aligned with BUY"
                                                }
                                              >
                                                ▬
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  );
}
