/**
 * Owner banner: new Basic Request Access OR open user UI issues → alert + sound.
 * Polls tester summary; Access is where the owner resolves issues.
 */
import { useEffect, useRef, useState } from "react";
import { fetchTesterFeedbackSummary } from "../api/testerFeedback";
import { playAccessRequestBeep } from "../sheet/accessRequestAlert";
import { useLang } from "../shared/i18n";

const SEEN_PENDING_KEY = "sn_access_pending_seen_ids";
const SEEN_ISSUE_KEY = "sn_access_issue_seen_ids";
const POLL_MS = 12_000;

function readSeenIds(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeSeenIds(key: string, ids: Set<string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

type BannerAlert =
  | {
      kind: "access";
      count: number;
      emails: string[];
      ids: string[];
    }
  | {
      kind: "issue";
      count: number;
      emails: string[];
      labels: string[];
      ids: string[];
    };

export function AccessRequestBanner({
  enabled,
  onOpenAccess,
}: {
  enabled: boolean;
  onOpenAccess: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [alert, setAlert] = useState<BannerAlert | null>(null);
  const seenPendingRef = useRef<Set<string>>(readSeenIds(SEEN_PENDING_KEY));
  const seenIssueRef = useRef<Set<string>>(readSeenIds(SEEN_ISSUE_KEY));
  const primedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const sum = await fetchTesterFeedbackSummary();
        if (cancelled) return;

        const pending = (sum.testers ?? []).filter(
          (t) => (t.status || "pending").toLowerCase() === "pending",
        );
        const pendingIds = pending.map((t) => t.tester_id);
        const pendingSet = new Set(pendingIds);

        const openIssues = sum.open_ui_issues ?? [];
        const issueIds = openIssues.map((e) => e.id);
        const issueSet = new Set(issueIds);

        if (!primedRef.current) {
          primedRef.current = true;
          seenPendingRef.current = new Set(pendingIds);
          seenIssueRef.current = new Set(issueIds);
          writeSeenIds(SEEN_PENDING_KEY, seenPendingRef.current);
          writeSeenIds(SEEN_ISSUE_KEY, seenIssueRef.current);
          // Prefer showing open user issues if any are already waiting.
          if (openIssues.length > 0) {
            const emails = openIssues.slice(0, 5).map((ev) => {
              const t = (sum.testers ?? []).find((x) => x.tester_id === ev.tester_id);
              return t?.email || t?.display_name || ev.tester_id;
            });
            const labels = openIssues.slice(0, 5).map((ev) => {
              const pl =
                ev.payload && typeof ev.payload === "object"
                  ? (ev.payload as Record<string, unknown>)
                  : {};
              return String(pl.label || pl.problem || "UI error");
            });
            setAlert({
              kind: "issue",
              count: openIssues.length,
              emails,
              labels,
              ids: issueIds,
            });
          } else if (pending.length > 0) {
            setAlert({
              kind: "access",
              count: pending.length,
              emails: pending.map((t) => t.email || t.display_name || t.tester_id).slice(0, 5),
              ids: pendingIds,
            });
          }
          return;
        }

        const newPending = pending.filter((t) => !seenPendingRef.current.has(t.tester_id));
        const prunedPending = new Set(
          [...seenPendingRef.current].filter((id) => pendingSet.has(id)),
        );
        for (const t of pending) prunedPending.add(t.tester_id);
        seenPendingRef.current = prunedPending;
        writeSeenIds(SEEN_PENDING_KEY, prunedPending);

        const newIssues = openIssues.filter((e) => !seenIssueRef.current.has(e.id));
        const prunedIssues = new Set(
          [...seenIssueRef.current].filter((id) => issueSet.has(id)),
        );
        for (const e of openIssues) prunedIssues.add(e.id);
        seenIssueRef.current = prunedIssues;
        writeSeenIds(SEEN_ISSUE_KEY, prunedIssues);

        if (newIssues.length > 0) {
          playAccessRequestBeep();
          const emails = newIssues.slice(0, 5).map((ev) => {
            const t = (sum.testers ?? []).find((x) => x.tester_id === ev.tester_id);
            return t?.email || t?.display_name || ev.tester_id;
          });
          const labels = newIssues.slice(0, 5).map((ev) => {
            const pl =
              ev.payload && typeof ev.payload === "object"
                ? (ev.payload as Record<string, unknown>)
                : {};
            return String(pl.label || pl.problem || "UI error");
          });
          setAlert({
            kind: "issue",
            count: openIssues.length,
            emails,
            labels,
            ids: issueIds,
          });
        } else if (newPending.length > 0) {
          playAccessRequestBeep();
          setAlert({
            kind: "access",
            count: pending.length,
            emails: newPending.map((t) => t.email || t.display_name || t.tester_id).slice(0, 5),
            ids: pendingIds,
          });
        } else if (openIssues.length === 0 && pending.length === 0) {
          setAlert(null);
        }
      } catch {
        /* ignore poll errors */
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  if (!enabled || !alert) return null;

  const markSeenAndClose = () => {
    if (alert.kind === "access") {
      const next = new Set(seenPendingRef.current);
      for (const id of alert.ids) next.add(id);
      seenPendingRef.current = next;
      writeSeenIds(SEEN_PENDING_KEY, next);
    } else {
      const next = new Set(seenIssueRef.current);
      for (const id of alert.ids) next.add(id);
      seenIssueRef.current = next;
      writeSeenIds(SEEN_ISSUE_KEY, next);
    }
    setAlert(null);
  };

  const isIssue = alert.kind === "issue";

  return (
    <div
      role="alert"
      className={`fixed top-3 left-1/2 z-[200] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ${
        isIssue
          ? "border-[rgb(var(--signal-down))]/55 bg-[#1A0A0A]"
          : "border-[#F3C451]/55 bg-[#1A1406]"
      }`}
    >
      <button
        type="button"
        className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[16px] leading-none font-bold text-white/55 hover:bg-white/10 hover:text-white"
        title={it ? "Chiudi" : "Dismiss"}
        aria-label={it ? "Chiudi avviso" : "Dismiss alert"}
        onClick={markSeenAndClose}
      >
        ×
      </button>
      <p
        className={`pr-6 text-[11px] font-bold uppercase tracking-[0.14em] ${
          isIssue ? "text-[rgb(var(--signal-down))]" : "text-[#F3C451]"
        }`}
      >
        {isIssue
          ? it
            ? "Problema utente"
            : "User issue"
          : it
            ? "Nuova richiesta di accesso"
            : "New access request"}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-[#F3F5FA]">
        {isIssue
          ? it
            ? `${alert.count} issue aperte — apri Access e chiudi con Resolve`
            : `${alert.count} open issue(s) — open Access and Resolve`
          : it
            ? `${alert.count} richiesta/e Basic in attesa`
            : `${alert.count} Basic request(s) waiting`}
        {alert.emails.length ? (
          <>
            {": "}
            <span
              className={`font-semibold ${
                isIssue ? "text-[rgb(var(--signal-down))]" : "text-[#F3C451]"
              }`}
            >
              {alert.emails.join(", ")}
            </span>
          </>
        ) : null}
        {isIssue && alert.labels.length ? (
          <span className="block mt-1 text-[12px] text-white/80">
            {alert.labels.join(" · ")}
          </span>
        ) : null}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-[12px] font-bold hover:brightness-110 ${
            isIssue
              ? "bg-[rgb(var(--signal-down))] text-white"
              : "bg-[#F3C451] text-[#1A1406]"
          }`}
          onClick={() => {
            markSeenAndClose();
            onOpenAccess();
          }}
        >
          {it ? "Apri Access" : "Open Access"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white/90 hover:bg-white/5"
          onClick={markSeenAndClose}
        >
          {it ? "Nascondi" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
