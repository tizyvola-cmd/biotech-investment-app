/**
 * Report client UI crashes / freezes to Access admin queue.
 * Each report opens an issue (issue_status=open) until the owner clicks Resolve.
 */
import { postTesterFeedbackEvent } from "../api/testerFeedback";
import { getStoredTester } from "./testerSession";

const DEDUPE_MS = 8_000;
const recentKeys = new Map<string, number>();

function dedupeKey(label: string, message: string): string {
  return `${label}|${message.slice(0, 160)}`;
}

function problemCode(label: string, message: string, stack?: string | null): string {
  const raw = `${label} ${message} ${stack || ""}`.toLowerCase();
  // DOM reconcile (often Recharts/react-smooth in the recharts chunk) — do not
  // mis-label as freeze just because the stack URL contains "recharts".
  if (/removechild|insertbefore|not a child of this node|notfounderror/.test(raw)) {
    return "dom_reconcile_error";
  }
  if (/freeze|stuck|boot did not finish|request storm/.test(raw)) {
    return "entry_freeze_request_storm";
  }
  if (/chunkload|loading chunk|dynamically imported/.test(raw)) {
    return "chunk_load_failure";
  }
  if (/network|failed to fetch|load failed/.test(raw)) {
    return "network_error";
  }
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return slug || "ui_error";
}

export function reportUiError(opts: {
  label?: string;
  message: string;
  stack?: string | null;
  source?: "boundary" | "window" | "promise";
  problem?: string;
}): void {
  const stored = getStoredTester();
  if (!stored?.testerId) return;
  const label = (opts.label || "SuperNova").trim() || "SuperNova";
  const message = (opts.message || "Unknown error").trim().slice(0, 800);
  const key = dedupeKey(label, message);
  const now = Date.now();
  const prev = recentKeys.get(key) ?? 0;
  const problemGuess = (
    opts.problem || problemCode(label, message, opts.stack)
  ).trim().slice(0, 80);
  // Reconcile storms fire many times in <1s — keep Access clean.
  const windowMs = /dom_reconcile/.test(problemGuess) ? 60_000 : DEDUPE_MS;
  if (now - prev < windowMs) return;
  recentKeys.set(key, now);

  const problem = problemGuess;

  void postTesterFeedbackEvent({
    tester_id: stored.testerId,
    display_name: stored.displayName || stored.email,
    module: "dashboard",
    kind: "ui_error",
    source: "desktop",
    payload: {
      label,
      message,
      problem,
      issue_status: "open",
      stack: (opts.stack || "").slice(0, 2500) || null,
      href: typeof window !== "undefined" ? window.location.href.slice(0, 300) : null,
      source: opts.source || "boundary",
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      email: stored.email || null,
    },
  }).catch(() => {
    /* non-blocking */
  });
}
