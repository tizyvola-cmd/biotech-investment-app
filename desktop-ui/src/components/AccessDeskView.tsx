/**
 * Access tab — Basic members (interest spaces + daily minutes Δ%) and Premium waitlist.
 * Soft BUY/SELL unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteTester,
  dismissContactMessage,
  dismissPremiumWaitlist,
  fetchContactMessages,
  fetchPremiumWaitlist,
  fetchTesterFeedbackConfig,
  fetchTesterFeedbackSummary,
  grantPremiumWaitlist,
  resendTesterApprovalEmail,
  resolveTesterUiIssue,
  setTesterPremium,
  setTesterStatus,
  type ContactMessageEntry,
  type PremiumWaitlistEntry,
} from "../api/testerFeedback";
import { notifyAccessInboxChanged } from "../hooks/useAccessAdminAlertCount";
import { SUPERNOVA_SINGLE_OWNER_EMAIL } from "../sheet/testerSession";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import type { TesterFeedbackConfig, TesterFeedbackSummary, TesterMeta } from "../types/testerFeedback";

function fmtTs(iso: string | undefined | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function fmtDeltaPct(pct: number | null | undefined): { text: string; className: string } {
  if (pct == null || !Number.isFinite(pct)) {
    return { text: "—", className: "tabular-nums text-ink-muted" };
  }
  const sign = pct > 0 ? "+" : "";
  const className =
    pct > 0
      ? "tabular-nums font-semibold text-[rgb(var(--signal-up))]"
      : pct < 0
        ? "tabular-nums font-semibold text-[rgb(var(--signal-down))]"
        : "tabular-nums text-ink-muted";
  return { text: `${sign}${pct.toFixed(1)}%`, className };
}

function interestSpacesLabel(t: TesterMeta): string {
  const other = String(t.interest_other || "").trim();
  const ed = String(t.interest_edition || "").trim();
  if (other && !/^nessuno$/i.test(other) && other !== "—" && other !== "-") return other;
  if (ed === "biotech") return "Biotech";
  if (ed === "tech") return "Tech";
  if (ed === "both") return "Biotech + Tech";
  return "None";
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))] px-3 py-2.5 min-w-[7.5rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="text-[1.35rem] font-semibold tabular-nums text-ink mt-0.5">{value}</p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

export function AccessDeskView({ apiOk }: { apiOk: boolean | null }) {
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TesterFeedbackSummary | null>(null);
  const [emailCfg, setEmailCfg] = useState<TesterFeedbackConfig["approval_email"] | null>(null);
  const [premium, setPremium] = useState<PremiumWaitlistEntry[]>([]);
  const [premiumUpdated, setPremiumUpdated] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactMessageEntry[]>([]);
  const [contactsUpdated, setContactsUpdated] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const reloadGenRef = useRef(0);
  const loadingOwnedByRef = useRef<number | null>(null);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (apiOk === false) {
      loadingOwnedByRef.current = null;
      setLoading(false);
      return;
    }
    const silent = Boolean(opts?.silent);
    const gen = ++reloadGenRef.current;
    if (!silent) {
      loadingOwnedByRef.current = gen;
      setLoading(true);
      setError(null);
    }
    try {
      const [cfg, sum, wl, ct] = await Promise.all([
        fetchTesterFeedbackConfig(),
        fetchTesterFeedbackSummary(),
        fetchPremiumWaitlist().catch(() => ({
          ok: false,
          count: 0,
          updated_at: null as string | null,
          entries: [] as PremiumWaitlistEntry[],
        })),
        fetchContactMessages().catch(() => ({
          ok: false,
          count: 0,
          unread: 0,
          updated_at: null as string | null,
          entries: [] as ContactMessageEntry[],
        })),
      ]);
      if (gen !== reloadGenRef.current) return;
      setEmailCfg(cfg.approval_email ?? null);
      setSummary(sum);
      setPremium(Array.isArray(wl.entries) ? wl.entries : []);
      setPremiumUpdated(wl.updated_at ?? null);
      setContacts(Array.isArray(ct.entries) ? ct.entries : []);
      setContactsUpdated(ct.updated_at ?? null);
      // Bell is cleared by opening Access; no extra summary round-trip here.
    } catch (e) {
      if (gen !== reloadGenRef.current) return;
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Clear spinner for the request that turned it on, OR if a newer silent
      // poll finished while an older non-silent was superseded (avoids stuck
      // «Refreshing…» with empty tables).
      if (
        loadingOwnedByRef.current != null &&
        (loadingOwnedByRef.current === gen || gen === reloadGenRef.current)
      ) {
        loadingOwnedByRef.current = null;
        setLoading(false);
      }
    }
  }, [apiOk]);

  useEffect(() => {
    void reload();
    // Background polls must not flip the button to «Refreshing…» for 20–120s.
    const id = window.setInterval(() => void reload({ silent: true }), 60_000);
    return () => {
      reloadGenRef.current += 1;
      loadingOwnedByRef.current = null;
      setLoading(false);
      window.clearInterval(id);
    };
  }, [reload]);

  const pending = useMemo(
    () =>
      (summary?.testers ?? []).filter((t) => (t.status || "pending").toLowerCase() === "pending"),
    [summary],
  );

  const basicMembers = useMemo(() => {
    const rows = (summary?.testers ?? []).filter((t) => {
      const st = (t.status || "pending").toLowerCase();
      return st === "approved" || st === "revoked";
    });
    return [...rows].sort((a, b) =>
      String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")),
    );
  }, [summary]);

  const updateStatus = async (testerId: string, status: "pending" | "approved" | "revoked") => {
    setBusyId(testerId);
    setFlash(null);
    try {
      const res = await setTesterStatus(testerId, status);
      if (status === "approved" && res.tester?.approval_email) {
        const mail = res.tester.approval_email;
        if (mail.ok) {
          setFlash(it ? `Approvato Â· email a ${mail.to}` : `Approved Â· email to ${mail.to}`);
        } else if (mail.welcome_url) {
          setFlash(
            it
              ? `Approvato Â· invia questo link: ${mail.welcome_url}`
              : `Approved Â· send this link: ${mail.welcome_url}`,
          );
        }
      }
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const updatePremium = async (testerId: string, premium: boolean) => {
    setBusyId(testerId);
    setFlash(null);
    try {
      await setTesterPremium(testerId, premium);
      setFlash(
        premium
          ? it
            ? "Premium attivato (Calendar / Discovery / società)"
            : "Premium granted (Calendar / Discovery / companies)"
          : it
            ? "Premium rimosso"
            : "Premium revoked",
      );
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const grantFromWaitlist = async (email: string) => {
    setBusyId(`wl:${email}`);
    setFlash(null);
    try {
      const res = await grantPremiumWaitlist(email);
      setFlash(
        it
          ? `Premium concesso a ${res.email} — full app (Calendar / Discovery)`
          : `Premium granted to ${res.email} — full app (Calendar / Discovery)`,
      );
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const dismissFromWaitlist = async (email: string) => {
    setBusyId(`wl-dismiss:${email}`);
    setFlash(null);
    try {
      await dismissPremiumWaitlist(email);
      setFlash(it ? `Richiesta rimossa: ${email}` : `Request dismissed: ${email}`);
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const dismissContact = async (id: string) => {
    setBusyId(`ct-dismiss:${id}`);
    setFlash(null);
    try {
      await dismissContactMessage(id);
      setFlash(it ? "Messaggio Contact rimosso." : "Contact message dismissed.");
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (testerId: string) => {
    setBusyId(testerId);
    try {
      await resendTesterApprovalEmail(testerId);
      setFlash(it ? "Email di approvazione reinviata." : "Approval email resent.");
      await reload();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (testerId: string) => {
    if (!window.confirm(it ? `Eliminare ${testerId}?` : `Delete ${testerId}?`)) return;
    setBusyId(testerId);
    try {
      await deleteTester(testerId);
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openIssues = useMemo(() => {
    const rows = summary?.open_ui_issues ?? summary?.recent_ui_errors ?? [];
    return rows.filter((ev) => {
      const pl =
        ev.payload && typeof ev.payload === "object"
          ? (ev.payload as Record<string, unknown>)
          : {};
      return String(pl.issue_status || "open").toLowerCase() !== "resolved";
    });
  }, [summary]);

  const resolveIssue = async (eventId: string, problemLabel: string) => {
    setBusyId(eventId);
    setFlash(null);
    try {
      await resolveTesterUiIssue(eventId, {
        note: `Resolved from Access · ${problemLabel}`.slice(0, 200),
        resolved_by: "owner",
      });
      setFlash(it ? "Issue chiusa." : "Issue resolved.");
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const dismissAllIssues = async () => {
    const ids = openIssues.map((ev) => ev.id).filter(Boolean);
    if (!ids.length) return;
    if (
      !window.confirm(
        it
          ? `Cancellare tutti i ${ids.length} avvisi UI?`
          : `Clear all ${ids.length} UI error notices?`,
      )
    ) {
      return;
    }
    setBusyId("__dismiss_all_ui__");
    setFlash(null);
    try {
      for (const id of ids) {
        await resolveTesterUiIssue(id, {
          note: "Dismissed from Access (panel ×)",
          resolved_by: "owner",
        });
      }
      setFlash(it ? "Avvisi UI cancellati." : "UI error notices cleared.");
      await reload();
      notifyAccessInboxChanged();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openIssueCount = summary?.open_ui_issue_count ?? openIssues.length;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 px-4 py-3 pb-6 overflow-y-auto">
      <header className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[1.15rem] font-semibold text-ink">
              {it ? "Access" : "Access"}
            </h2>
            <p className="text-[12px] text-ink-muted mt-0.5 max-w-2xl leading-relaxed">
              {it
                ? "Iscritti Basic, lista Premium e messaggi dalla pagina Contact."
                : "Basic members, Premium waitlist, and Contact form messages."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-white/[0.04] disabled:opacity-50"
            disabled={loading || apiOk === false}
            onClick={() => void reload()}
          >
            {loading ? (it ? "Aggiorno…" : "Refreshing…") : it ? "↻ Aggiorna" : "↻ Refresh"}
          </button>
        </div>
        {emailCfg && !emailCfg.smtp_configured ? (
          <p className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {it
              ? "SMTP non configurato sul server — dopo Approva copia il link di installazione dal messaggio."
              : "SMTP not configured on server — after Approve, copy the install link from the flash message."}
          </p>
        ) : null}
        {error ? <p className="text-[12px] text-[rgb(var(--signal-down))]">{error}</p> : null}
        {flash ? (
          <p className="text-[12px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border border-[rgb(var(--warn))]/30 rounded-lg px-3 py-2 break-all">
            {flash}
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2 shrink-0">
        <Kpi
          label={it ? "In attesa" : "Pending"}
          value={pending.length}
          sub={it ? "da approvare" : "to approve"}
        />
        <Kpi
          label={it ? "Basic" : "Basic"}
          value={summary?.approved_testers ?? basicMembers.filter((t) => t.status === "approved").length}
          sub={it ? "approvati" : "approved"}
        />
        <Kpi
          label={it ? "Attivi oggi" : "Active today"}
          value={summary?.active_testers_24h ?? "—"}
          sub={it ? "sessioni 24h" : "sessions 24h"}
        />
        <Kpi
          label="Premium"
          value={premium.length}
          sub={it ? "waitlist" : "waitlist"}
        />
        <Kpi
          label="Contact"
          value={contacts.length}
          sub={it ? "messaggi" : "messages"}
        />
        <Kpi
          label={it ? "Issue aperte" : "Open issues"}
          value={openIssueCount}
          sub={it ? "da risolvere" : "to resolve"}
        />
      </div>

      {openIssues.length > 0 ? (
        <section className="shrink-0 rounded-xl border border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/5 overflow-hidden max-h-[18rem] flex flex-col">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[rgb(var(--signal-down))]/25 shrink-0">
            <p className="text-[11px] font-semibold text-[rgb(var(--signal-down))]">
              {it
                ? `UI errors / crashes · ${openIssues.length} (chi + cosa)`
                : `UI errors / crashes · ${openIssues.length} (who + what)`}
            </p>
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[14px] leading-none font-bold text-[rgb(var(--signal-down))]/80 hover:bg-[rgb(var(--signal-down))]/15 hover:text-[rgb(var(--signal-down))] disabled:opacity-40"
              title={it ? "Cancella tutti gli avvisi" : "Clear all notices"}
              aria-label={it ? "Chiudi avvisi" : "Dismiss notices"}
              disabled={busyId === "__dismiss_all_ui__"}
              onClick={() => void dismissAllIssues()}
            >
              ×
            </button>
          </div>
          <div className="overflow-auto min-h-0">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px]`}>
              <thead>
                <tr>
                  <th className={gridTh()}>{it ? "Quando" : "When"}</th>
                  <th className={gridTh()}>Email</th>
                  <th className={gridTh()}>{it ? "Problema" : "Problem"}</th>
                  <th className={gridTh()}>{it ? "Dettaglio" : "Detail"}</th>
                  <th className={gridTh()}>{it ? "Azione" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {openIssues.map((ev) => {
                  const payload =
                    ev.payload && typeof ev.payload === "object"
                      ? (ev.payload as Record<string, unknown>)
                      : {};
                  const label = String(payload.label || payload.problem || "—");
                  const problem = String(payload.problem || label);
                  const message = String(payload.message || "—").slice(0, 220);
                  const tester = (summary?.testers ?? []).find((t) => t.tester_id === ev.tester_id);
                  const email = tester?.email || ev.tester_id;
                  return (
                    <tr key={ev.id}>
                      <td className={`${gridTd()} tabular-nums whitespace-nowrap`}>
                        {fmtTs(ev.created_at, locale)}
                      </td>
                      <td className={gridTd()}>
                        <span className="font-semibold">{email}</span>
                        {tester?.display_name ? (
                          <div className="text-[10px] text-ink-muted">{tester.display_name}</div>
                        ) : null}
                      </td>
                      <td className={gridTd()}>
                        <span className="font-semibold text-[rgb(var(--signal-down))]">{label}</span>
                        <div className="text-[9px] text-ink-muted font-mono">{problem}</div>
                      </td>
                      <td className={`${gridTd()} max-w-[24rem]`}>
                        <span className="line-clamp-3" title={message}>
                          {message}
                        </span>
                      </td>
                      <td className={gridTd()}>
                        <button
                          type="button"
                          className="rounded-md bg-[rgb(var(--signal-up))]/20 text-[rgb(var(--signal-up))] px-2 py-0.5 text-[10px] font-bold disabled:opacity-50"
                          disabled={busyId === ev.id}
                          onClick={() => void resolveIssue(ev.id, label)}
                        >
                          {it ? "Risolto" : "Resolve"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pending.length > 0 ? (
        <section className="shrink-0 rounded-xl border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/5 overflow-hidden">
          <p className="text-[11px] font-semibold px-3 py-2 border-b border-[rgb(var(--warn))]/25 text-[rgb(var(--warn))]">
            {it ? `Richieste Basic da approvare · ${pending.length}` : `Basic requests to approve · ${pending.length}`}
          </p>
          <div className="overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px]`}>
              <thead>
                <tr>
                  <th className={gridTh()}>Email</th>
                  <th className={gridTh()}>{it ? "Spazi di interesse" : "Interest spaces"}</th>
                  <th className={gridTh()}>{it ? "Richiesta" : "Requested"}</th>
                  <th className={gridTh()}>{it ? "Azioni" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((t) => (
                  <tr key={t.tester_id}>
                    <td className={gridTd()}>
                      <div className="font-semibold text-ink">{t.email || t.tester_id}</div>
                      <div className="text-[10px] text-ink-muted">
                        {t.display_name}
                        {t.birth_year ? ` · ${t.birth_year}` : ""}
                      </div>
                    </td>
                    <td className={`${gridTd()} max-w-[18rem]`}>
                      <span className="line-clamp-3" title={interestSpacesLabel(t)}>
                        {interestSpacesLabel(t)}
                      </span>
                    </td>
                    <td className={`${gridTd()} tabular-nums whitespace-nowrap`}>
                      {fmtTs(t.created_at, locale)}
                    </td>
                    <td className={gridTd()}>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded-md bg-[rgb(var(--signal-up))]/20 text-[rgb(var(--signal-up))] px-2 py-0.5 text-[10px] font-bold disabled:opacity-50"
                          disabled={busyId === t.tester_id}
                          onClick={() => void updateStatus(t.tester_id, "approved")}
                        >
                          {it ? "Approva" : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                          disabled={busyId === t.tester_id}
                          onClick={() => void updateStatus(t.tester_id, "revoked")}
                        >
                          {it ? "Rifiuta" : "Deny"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="shrink-0 rounded-xl border border-white/[0.08] bg-[rgb(var(--surface))] overflow-hidden">
        <p className="text-[11px] font-semibold px-3 py-2 border-b border-white/[0.08]">
          {it ? `Basic membership · ${basicMembers.length}` : `Basic membership · ${basicMembers.length}`}
        </p>
        <div className="overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px]`}>
            <thead>
              <tr>
                <th className={gridTh()}>Email</th>
                <th className={gridTh()}>{it ? "Spazi di interesse" : "Interest spaces"}</th>
                <th className={gridTh()}>{it ? "Min oggi" : "Min today"}</th>
                <th className={gridTh()}>{it ? "Min ieri" : "Min yesterday"}</th>
                <th className={gridTh()}>Δ% {it ? "vs ieri" : "vs yday"}</th>
                <th className={gridTh()}>{it ? "Ultimo accesso" : "Last seen"}</th>
                <th className={gridTh()}>{it ? "Ultimo crash" : "Last crash"}</th>
                <th className={gridTh()}>Status</th>
                <th className={gridTh()}>{it ? "Azioni" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {basicMembers.length === 0 ? (
                <tr>
                  <td className={`${gridTd()} text-ink-muted`} colSpan={9}>
                    {it ? "Nessun iscritto Basic ancora." : "No Basic members yet."}
                  </td>
                </tr>
              ) : (
                basicMembers.map((t) => {
                  const delta = fmtDeltaPct(t.usage_minutes_delta_pct);
                  const st = (t.status || "").toLowerCase();
                  const isOwner =
                    String(t.email || "").trim().toLowerCase() === SUPERNOVA_SINGLE_OWNER_EMAIL;
                  const isPremium = Boolean(t.premium) || isOwner;
                  const crashLabel = String(t.last_ui_error_label || "").trim();
                  const crashMsg = String(t.last_ui_error_message || "").trim();
                  const crashTitle = [crashLabel, crashMsg].filter(Boolean).join(" — ");
                  return (
                    <tr key={t.tester_id} className={st === "revoked" ? "opacity-60" : undefined}>
                      <td className={gridTd()}>
                        <div className="font-semibold text-ink">{t.email || t.tester_id}</div>
                        <div className="text-[10px] text-ink-muted">
                        {t.display_name}
                        {t.birth_year ? ` · ${t.birth_year}` : ""}
                      </div>
                      </td>
                      <td className={`${gridTd()} max-w-[16rem]`}>
                        <span className="line-clamp-2" title={interestSpacesLabel(t)}>
                          {interestSpacesLabel(t)}
                        </span>
                      </td>
                      <td className={`${gridTd()} tabular-nums font-semibold`}>
                        {t.usage_minutes_today ?? 0}
                      </td>
                      <td className={`${gridTd()} tabular-nums text-ink-muted`}>
                        {t.usage_minutes_yesterday ?? 0}
                      </td>
                      <td className={`${gridTd()} ${delta.className}`}>{delta.text}</td>
                      <td className={`${gridTd()} tabular-nums whitespace-nowrap`}>
                        {fmtTs(t.last_seen_at, locale)}
                      </td>
                      <td className={`${gridTd()} max-w-[14rem]`}>
                        {t.last_ui_error_at ? (
                          <div title={crashTitle || undefined}>
                            <div className="tabular-nums text-[rgb(var(--signal-down))]">
                              {fmtTs(t.last_ui_error_at, locale)}
                            </div>
                            <div className="text-[10px] text-[rgb(var(--signal-down))]/90 line-clamp-2">
                              {crashLabel || crashMsg || (it ? "Crash segnalato" : "Crash reported")}
                              {crashLabel && crashMsg ? `: ${crashMsg.slice(0, 100)}` : ""}
                            </div>
                            {(t.ui_error_count ?? 0) > 1 ? (
                              <div className="text-[9px] text-ink-muted mt-0.5">
                                {t.ui_error_count}×
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className={gridTd()}>
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase w-fit ${
                              st === "approved"
                                ? "bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))]"
                                : "bg-white/10 text-ink-muted"
                            }`}
                          >
                            {st}
                          </span>
                          {isPremium ? (
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase w-fit bg-[#F3C451]/20 text-[#F3C451]">
                              Premium
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={gridTd()}>
                        <div className="flex flex-wrap gap-1">
                          {st === "approved" ? (
                            <>
                              {!isOwner ? (
                                <button
                                  type="button"
                                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 ${
                                    isPremium
                                      ? "border border-white/12 text-ink-muted"
                                      : "bg-[#F3C451]/20 text-[#F3C451] border border-[#F3C451]/40"
                                  }`}
                                  disabled={busyId === t.tester_id}
                                  onClick={() => void updatePremium(t.tester_id, !isPremium)}
                                >
                                  {isPremium
                                    ? it
                                      ? "Togli Premium"
                                      : "Revoke Premium"
                                    : it
                                      ? "Dai Premium"
                                      : "Grant Premium"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                                disabled={busyId === t.tester_id}
                                onClick={() => void resend(t.tester_id)}
                              >
                                {it ? "Reinvia mail" : "Resend mail"}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                                disabled={busyId === t.tester_id}
                                onClick={() => void updateStatus(t.tester_id, "revoked")}
                              >
                                Revoke
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="rounded-md bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))] px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50"
                              disabled={busyId === t.tester_id}
                              onClick={() => void updateStatus(t.tester_id, "approved")}
                            >
                              {it ? "Riattiva" : "Re-approve"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-md border border-[rgb(var(--signal-down))]/40 text-[rgb(var(--signal-down))] px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                            disabled={busyId === t.tester_id}
                            onClick={() => void remove(t.tester_id)}
                          >
                            {it ? "Elimina" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="shrink-0 rounded-xl border border-[#F3C451]/25 bg-[rgb(var(--surface))] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#F3C451]/20">
          <p className="text-[11px] font-semibold text-[#F3C451]">
            {it
              ? `Richieste Premium · ${premium.length}`
              : `Premium requests · ${premium.length}`}
          </p>
          {premiumUpdated ? (
            <span className="text-[10px] text-ink-muted tabular-nums">
              {it ? "Aggiornato " : "Updated "}
              {fmtTs(premiumUpdated, locale)}
            </span>
          ) : null}
        </div>
        <p className="px-3 py-1.5 text-[10px] text-ink-muted border-b border-[#F3C451]/10">
          {it
            ? "Arrivano da «Join Premium» in landing o dal link unlock su Calendar / Discovery. «Dai Premium» = approva Basic + sblocca full app."
            : "From landing «Join Premium» or Calendar / Discovery unlock links. «Grant Premium» = approve Basic + unlock full app."}
        </p>
        <div className="overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px]`}>
            <thead>
              <tr>
                <th className={gridTh()}>#</th>
                <th className={gridTh()}>Email</th>
                <th className={gridTh()}>{it ? "Stato Basic" : "Basic status"}</th>
                <th className={gridTh()}>{it ? "Iscrizione" : "Joined"}</th>
                <th className={gridTh()}>{it ? "Azioni" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {premium.length === 0 ? (
                <tr>
                  <td className={`${gridTd()} text-ink-muted`} colSpan={5}>
                    {it
                      ? "Nessuna richiesta Premium in coda."
                      : "No Premium requests queued."}
                  </td>
                </tr>
              ) : (
                premium.map((row) => {
                  const busy = busyId === `wl:${row.email}` || busyId === `wl-dismiss:${row.email}`;
                  const st = (row.status || "").toLowerCase();
                  return (
                    <tr key={`${row.position}-${row.email}`}>
                      <td className={`${gridTd()} tabular-nums text-ink-muted`}>{row.position}</td>
                      <td className={gridTd()}>
                        <div className="font-semibold">{row.email}</div>
                        {row.display_name ? (
                          <div className="text-[10px] text-ink-muted">{row.display_name}</div>
                        ) : null}
                      </td>
                      <td className={gridTd()}>
                        {row.tester_id ? (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              st === "approved"
                                ? "bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))]"
                                : st === "pending"
                                  ? "bg-[#F3C451]/15 text-[#F3C451]"
                                  : "bg-white/10 text-ink-muted"
                            }`}
                          >
                            {st || "—"}
                            {row.premium ? " · Premium" : ""}
                          </span>
                        ) : (
                          <span className="text-ink-muted text-[10px]">
                            {it ? "Non ancora Basic" : "Not Basic yet"}
                          </span>
                        )}
                      </td>
                      <td className={`${gridTd()} tabular-nums whitespace-nowrap`}>
                        {fmtTs(row.created_at, locale)}
                      </td>
                      <td className={gridTd()}>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded-md bg-[#F3C451]/20 text-[#F3C451] border border-[#F3C451]/40 px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50"
                            disabled={busy || Boolean(row.premium)}
                            onClick={() => void grantFromWaitlist(row.email)}
                          >
                            {row.premium
                              ? it
                                ? "Già Premium"
                                : "Already Premium"
                              : it
                                ? "Dai Premium"
                                : "Grant Premium"}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-white/12 text-ink-muted px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void dismissFromWaitlist(row.email)}
                          >
                            {it ? "Rimuovi" : "Dismiss"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="shrink-0 rounded-xl border overflow-hidden"
        style={{
          borderColor: "rgba(167, 154, 255, 0.28)",
          background: "rgb(var(--surface))",
        }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b"
          style={{ borderColor: "rgba(167, 154, 255, 0.18)" }}
        >
          <p className="text-[11px] font-semibold text-[#A79AFF]">
            {it
              ? `Contact · messaggi · ${contacts.length}`
              : `Contact · messages · ${contacts.length}`}
          </p>
          {contactsUpdated ? (
            <span className="text-[10px] text-ink-muted tabular-nums">
              {it ? "Aggiornato " : "Updated "}
              {fmtTs(contactsUpdated, locale)}
            </span>
          ) : null}
        </div>
        <p
          className="px-3 py-1.5 text-[10px] text-ink-muted border-b"
          style={{ borderColor: "rgba(167, 154, 255, 0.10)" }}
        >
          {it
            ? "Messaggi dalla pagina Contact sulla landing (email, nome, cognome, testo)."
            : "Messages from the landing Contact page (email, first name, last name, message)."}
        </p>
        <div className="overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px]`}>
            <thead>
              <tr>
                <th className={gridTh()}>{it ? "Quando" : "When"}</th>
                <th className={gridTh()}>{it ? "Nome" : "Name"}</th>
                <th className={gridTh()}>Email</th>
                <th className={gridTh()}>{it ? "Messaggio" : "Message"}</th>
                <th className={gridTh()}>{it ? "Azioni" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td className={`${gridTd()} text-ink-muted`} colSpan={5}>
                    {it
                      ? "Nessun messaggio Contact."
                      : "No Contact messages yet."}
                  </td>
                </tr>
              ) : (
                contacts.map((row) => {
                  const busy = busyId === `ct-dismiss:${row.id}`;
                  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
                  return (
                    <tr key={row.id || `${row.email}-${row.created_at}`}>
                      <td className={`${gridTd()} tabular-nums whitespace-nowrap`}>
                        {fmtTs(row.created_at, locale)}
                      </td>
                      <td className={`${gridTd()} font-semibold`}>{name}</td>
                      <td className={gridTd()}>{row.email}</td>
                      <td className={`${gridTd()} max-w-[28rem]`}>
                        <p className="whitespace-pre-wrap break-words leading-snug text-ink">
                          {row.message || "—"}
                        </p>
                      </td>
                      <td className={gridTd()}>
                        <button
                          type="button"
                          className="rounded-md border border-white/12 text-ink-muted px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void dismissContact(row.id)}
                        >
                          {it ? "Rimuovi" : "Dismiss"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** @deprecated name — Access tab */
export { AccessDeskView as TesterMonitorView };
