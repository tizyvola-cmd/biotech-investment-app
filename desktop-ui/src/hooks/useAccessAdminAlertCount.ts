/**
 * Owner Access tab: pending Basic requests + Premium waitlist + Contact inbox + open UI issues.
 * Polls lightly so the sidebar can show a 🔔 without opening Access.
 * Opening Access acknowledges the current inbox — bell hides until something new arrives.
 */
import { useEffect, useState } from "react";
import {
  fetchContactMessages,
  fetchPremiumWaitlist,
  fetchTesterFeedbackSummary,
} from "../api/testerFeedback";

export const ACCESS_INBOX_CHANGED_EVENT = "supernova:access-inbox-changed";
const SEEN_FP_KEY = "supernova.accessInbox.seenFp";

export function notifyAccessInboxChanged(): void {
  try {
    window.dispatchEvent(new Event(ACCESS_INBOX_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export type AccessAdminAlertSnapshot = {
  count: number;
  /** Stable signature of what is waiting — changes when items are added/removed. */
  fingerprint: string;
};

function readSeenFingerprint(): string {
  try {
    return String(localStorage.getItem(SEEN_FP_KEY) || "");
  } catch {
    return "";
  }
}

/** Mark current inbox as seen (call when owner opens Access). */
export function acknowledgeAccessInbox(
  fingerprint: string,
  opts?: { silent?: boolean },
): void {
  if (!fingerprint) {
    try {
      localStorage.removeItem(SEEN_FP_KEY);
    } catch {
      /* ignore */
    }
  } else {
    try {
      localStorage.setItem(SEEN_FP_KEY, fingerprint);
    } catch {
      /* ignore */
    }
  }
  if (!opts?.silent) notifyAccessInboxChanged();
}

export async function fetchAccessAdminAlertSnapshot(): Promise<AccessAdminAlertSnapshot> {
  const [sum, wl, ct] = await Promise.all([
    fetchTesterFeedbackSummary(),
    fetchPremiumWaitlist().catch(() => ({
      count: 0,
      entries: [] as Array<{ email?: string }>,
    })),
    fetchContactMessages().catch(() => ({
      count: 0,
      unread: 0,
      entries: [] as Array<{ id?: string; created_at?: string | null }>,
    })),
  ]);

  const pendingIds = (sum.testers ?? [])
    .filter((t) => (t.status || "pending").toLowerCase() === "pending")
    .map((t) => `b:${String(t.tester_id || t.email || "").toLowerCase()}`)
    .filter((x) => x.length > 2)
    .sort();

  const premiumIds = (Array.isArray(wl.entries) ? wl.entries : [])
    .map((e) => `p:${String(e.email || "").toLowerCase()}`)
    .filter((x) => x.length > 2)
    .sort();

  const contactIds = (Array.isArray(ct.entries) ? ct.entries : [])
    .map((e) => `c:${String(e.id || e.created_at || "").toLowerCase()}`)
    .filter((x) => x.length > 2)
    .sort();

  const uiIds = (sum.open_ui_issues ?? [])
    .map((ev) => `u:${String(ev.id || ev.created_at || "").toLowerCase()}`)
    .filter((x) => x.length > 2)
    .sort();

  // Fallback when issue list is missing but count is set.
  const uiN = Math.max(0, Number(sum.open_ui_issue_count) || 0);
  if (uiIds.length === 0 && uiN > 0) {
    uiIds.push(`u:n${uiN}`);
  }

  const parts = [...pendingIds, ...premiumIds, ...contactIds, ...uiIds];
  const fingerprint = parts.join("|");
  return { count: parts.length, fingerprint };
}

/** @deprecated prefer fetchAccessAdminAlertSnapshot */
export async function fetchAccessAdminAlertCount(): Promise<number> {
  const snap = await fetchAccessAdminAlertSnapshot();
  return snap.count;
}

/**
 * Badge count for Access menu 🔔.
 * Hides after owner opens Access for the current inbox; returns when fingerprint changes.
 */
export function useAccessAdminAlertCount(
  enabled: boolean,
  accessTabOpen = false,
): number {
  const [badge, setBadge] = useState(0);

  // Clear bell immediately when opening Access — don't wait on network.
  useEffect(() => {
    if (!enabled) {
      setBadge(0);
      return;
    }
    if (accessTabOpen) setBadge(0);
  }, [enabled, accessTabOpen]);

  useEffect(() => {
    if (!enabled) return;
    // While Access is open: one acknowledge pass, then stop polling (desk owns refreshes).
    if (accessTabOpen) {
      setBadge(0);
      let cancelled = false;
      void (async () => {
        try {
          const snap = await fetchAccessAdminAlertSnapshot();
          if (cancelled) return;
          acknowledgeAccessInbox(snap.fingerprint, { silent: true });
          setBadge(0);
        } catch {
          if (!cancelled) setBadge(0);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await fetchAccessAdminAlertSnapshot();
        if (cancelled) return;
        const seen = readSeenFingerprint();
        const show = snap.count > 0 && snap.fingerprint !== seen;
        setBadge(show ? snap.count : 0);
      } catch {
        /* keep last known */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 45_000);
    const onChanged = () => void tick();
    window.addEventListener(ACCESS_INBOX_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener(ACCESS_INBOX_CHANGED_EVENT, onChanged);
    };
  }, [enabled, accessTabOpen]);

  return badge;
}
