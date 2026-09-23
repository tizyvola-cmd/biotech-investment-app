import { getStoredToken } from "./supernova";
import { resolveTesterFeedbackApiBase } from "../shared/remoteHost";
import { testerIdFromEmail, normalizeTesterEmail } from "../sheet/testerSession";
import type {
  TesterFeedbackConfig,
  TesterFeedbackEvent,
  TesterFeedbackKind,
  TesterFeedbackModule,
  TesterFeedbackSummary,
  TesterMeta,
  TesterSimMonitor,
} from "../types/testerFeedback";

type ApiOptions = { timeoutMs?: number };

function isPublicTesterAuthPath(path: string): boolean {
  return (
    path === "/api/tester-feedback/testers/register" ||
    path === "/api/tester-feedback/config" ||
    path === "/api/tester-feedback/events" ||
    path === "/api/premium-waitlist" ||
    path === "/api/hitech-notify" ||
    path === "/api/contact" ||
    /\/api\/tester-feedback\/testers\/[^/]+\/access$/.test(path) ||
    /\/api\/tester-feedback\/testers\/[^/]+\/session$/.test(path)
  );
}

async function testerApi<T>(path: string, init?: RequestInit, opts?: ApiOptions): Promise<T> {
  const base = resolveTesterFeedbackApiBase().replace(/\/$/, "");
  const url = `${base}${path}`;
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  const publicAuth =
    method === "POST" && isPublicTesterAuthPath(path);
  const adminGet =
    method === "GET" &&
    (path === "/api/tester-feedback/summary" ||
      path === "/api/tester-feedback/events" ||
      path === "/api/tester-feedback/export" ||
      path === "/api/tester-feedback/sim-monitor" ||
      path === "/api/premium-waitlist" ||
      path === "/api/contact" ||
      path === "/api/hitech-notify" ||
      path.startsWith("/api/tester-feedback/events?"));
  const needsOwnerToken =
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) || adminGet;
  if (needsOwnerToken && !publicAuth) {
    const token = getStoredToken();
    if (token) headers.set("X-SuperNova-Token", token);
  }
  const body = init?.body;
  if (
    ["POST", "PUT", "PATCH"].includes(method) &&
    body != null &&
    typeof body === "string" &&
    body.length > 0 &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  let signal = init?.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  if (!signal && typeof AbortController !== "undefined") {
    const ac = new AbortController();
    signal = ac.signal;
    timeoutId = setTimeout(() => {
      try {
        ac.abort(
          typeof DOMException !== "undefined"
            ? new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError")
            : ("timeout" as unknown as DOMException),
        );
      } catch {
        ac.abort();
      }
    }, timeoutMs);
  }
  const res = await fetch(url, { ...init, headers, signal }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTesterFeedbackConfig() {
  return testerApi<TesterFeedbackConfig>("/api/tester-feedback/config", undefined, {
    timeoutMs: 20_000,
  });
}

export function fetchTesterFeedbackSummary() {
  return testerApi<TesterFeedbackSummary>("/api/tester-feedback/summary", undefined, {
    timeoutMs: 20_000,
  });
}

export function fetchTesterFeedbackEvents(opts?: {
  limit?: number;
  tester_id?: string;
  module?: TesterFeedbackModule;
  kind?: TesterFeedbackKind;
}) {
  const q = new URLSearchParams();
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.tester_id) q.set("tester_id", opts.tester_id);
  if (opts?.module) q.set("module", opts.module);
  if (opts?.kind) q.set("kind", opts.kind);
  const qs = q.toString();
  return testerApi<{ events: TesterFeedbackEvent[]; count: number }>(
    `/api/tester-feedback/events${qs ? `?${qs}` : ""}`,
  );
}

export function registerTester(body: {
  tester_id?: string;
  display_name?: string;
  invite_code?: string;
  email?: string;
  source?: "mobile" | "desktop" | "api";
  interest_edition?: "biotech" | "tech" | "both" | string;
  interest_other?: string;
  first_name?: string;
  last_name?: string;
  birth_year?: number;
}) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    "/api/tester-feedback/testers/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 45_000 },
  );
}

export type PremiumWaitlistResult = {
  ok: boolean;
  already?: boolean;
  position?: number;
  founding_free_year?: boolean;
  founding_cap?: number;
};

export type PremiumWaitlistEntry = {
  email: string;
  created_at?: string | null;
  position: number;
  tester_id?: string | null;
  status?: string | null;
  premium?: boolean;
  display_name?: string | null;
};

export type PremiumWaitlistList = {
  ok: boolean;
  updated_at?: string | null;
  count: number;
  entries: PremiumWaitlistEntry[];
};

export function joinPremiumWaitlist(email: string) {
  return testerApi<PremiumWaitlistResult>("/api/premium-waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export type HitechNotifyResult = {
  ok: boolean;
  already?: boolean;
  position?: number;
};

export function joinHitechNotify(email: string) {
  return testerApi<HitechNotifyResult>("/api/hitech-notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export type HitechNotifyEntry = {
  email: string;
  created_at?: string | null;
  position?: number;
};

export type HitechNotifyList = {
  ok: boolean;
  updated_at?: string | null;
  count: number;
  entries: HitechNotifyEntry[];
};

/** @deprecated Technology notify list removed from Access — kept for API compat. */
export function fetchHitechNotify() {
  return testerApi<HitechNotifyList>("/api/hitech-notify", undefined, {
    timeoutMs: 15_000,
  });
}

/** @deprecated */
export function dismissHitechNotify(email: string) {
  return testerApi<{ ok: boolean; removed: boolean; email: string }>(
    "/api/hitech-notify/dismiss",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    },
  );
}

export type ContactMessageEntry = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  message: string;
  created_at?: string | null;
  read?: boolean;
};

export type ContactMessageList = {
  ok: boolean;
  updated_at?: string | null;
  count: number;
  unread?: number;
  entries: ContactMessageEntry[];
};

/** Public Contact form on landing. */
export function submitContactMessage(payload: {
  email: string;
  first_name: string;
  last_name: string;
  message: string;
}) {
  return testerApi<{ ok: boolean; id: string }>("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email.trim().toLowerCase(),
      first_name: payload.first_name.trim(),
      last_name: payload.last_name.trim(),
      message: payload.message.trim(),
    }),
  });
}

/** Access tab — Contact inbox. */
export function fetchContactMessages() {
  return testerApi<ContactMessageList>("/api/contact", undefined, {
    timeoutMs: 15_000,
  });
}

/** Access tab — dismiss one Contact message. */
export function dismissContactMessage(id: string) {
  return testerApi<{ ok: boolean; removed: boolean; id: string }>(
    "/api/contact/dismiss",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    },
  );
}

export function fetchPremiumWaitlist() {
  return testerApi<PremiumWaitlistList>("/api/premium-waitlist", undefined, {
    timeoutMs: 15_000,
  });
}

/** Access tab — approve Basic + grant Premium, remove waitlist row. */
export function grantPremiumWaitlist(email: string) {
  return testerApi<{
    ok: boolean;
    email: string;
    tester_id: string;
    created?: boolean;
    approved_now?: boolean;
    waitlist_removed?: boolean;
  }>("/api/premium-waitlist/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

/** Access tab — remove waitlist row without granting. */
export function dismissPremiumWaitlist(email: string) {
  return testerApi<{ ok: boolean; removed: boolean; email: string }>(
    "/api/premium-waitlist/dismiss",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    },
  );
}

export type TesterAccess = {
  tester_id: string;
  registered: boolean;
  display_name?: string;
  email?: string;
  status: string;
  allowed: boolean;
  /** Calendar / Discovery / interest enroll. Owner always true. */
  premium?: boolean;
  created_at?: string;
  last_seen_at?: string;
};

export function fetchTesterAccess(testerId: string) {
  return testerApi<TesterAccess>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/access`,
    undefined,
    { timeoutMs: 15_000 },
  );
}

/** Device session for per-tester portfolio (anti-IDOR). */
export function createTesterSession(testerId: string, email: string) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/session`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
    { timeoutMs: 15_000 },
  );
}

/** Desktop remote signup — same register endpoint as mobile, source=desktop. */
export function registerDesktopTester(body: {
  email: string;
  display_name?: string;
  invite_code?: string;
  interest_edition?: "biotech" | "tech" | "both";
  interest_other?: string;
  first_name?: string;
  last_name?: string;
  birth_year?: number;
}) {
  const email = normalizeTesterEmail(body.email);
  return registerTester({
    email,
    tester_id: testerIdFromEmail(email),
    display_name: body.display_name,
    invite_code: body.invite_code,
    source: "desktop",
    interest_edition: body.interest_edition,
    interest_other: body.interest_other,
    first_name: body.first_name,
    last_name: body.last_name,
    birth_year: body.birth_year,
  });
}

export function setTesterStatus(
  testerId: string,
  status: "pending" | "approved" | "revoked",
  note?: string,
) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    },
  );
}

export function setTesterPremium(testerId: string, premium: boolean) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/premium`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ premium }),
    },
  );
}

export function replyTesterEmail(
  testerId: string,
  body: { subject: string; body: string },
) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function resendTesterApprovalEmail(testerId: string) {
  return testerApi<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/resend-approval-email`,
    { method: "POST" },
  );
}

export function deleteTester(testerId: string) {
  return testerApi<{
    ok: boolean;
    tester_id: string;
    removed: boolean;
    events_removed?: number;
    sim_inputs_removed?: boolean;
  }>(`/api/tester-feedback/testers/${encodeURIComponent(testerId)}`, {
    method: "DELETE",
  });
}

export type TesterCalibrationDoc = {
  schema_version: number;
  exported_at: string;
  source_store: string;
  store_updated_at: string | null;
  summary: {
    tester_count: number;
    events_total: number;
    prediction_outcome_rows: number;
    hits: number;
    misses: number;
    hit_rate_pct: number | null;
    outcome_counts: Record<string, number>;
    by_tester_outcome: Record<string, Record<string, number>>;
    by_module: Record<string, number>;
    by_kind: Record<string, number>;
  };
  calibration_rows: Array<Record<string, unknown>>;
  testers: import("../types/testerFeedback").TesterMeta[];
};

export function fetchTesterFeedbackExport() {
  return testerApi<TesterCalibrationDoc>("/api/tester-feedback/export");
}

export function fetchTesterSimMonitor() {
  return testerApi<TesterSimMonitor>("/api/tester-feedback/sim-monitor");
}

export function saveTesterFeedbackCalibSnapshot() {
  return testerApi<{ ok: boolean; path: string; exported_at: string }>(
    "/api/tester-feedback/export/snapshot",
    { method: "POST" },
  );
}

export function postTesterFeedbackEvent(body: {
  tester_id: string;
  module: TesterFeedbackModule;
  kind: TesterFeedbackKind;
  ticker?: string;
  source?: "mobile" | "desktop" | "api";
  display_name?: string;
  payload?: Record<string, unknown>;
}) {
  return testerApi<{ ok: boolean; event: TesterFeedbackEvent }>("/api/tester-feedback/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Owner Access: close a user UI error after the problem is handled. */
export function resolveTesterUiIssue(
  eventId: string,
  opts?: { note?: string; resolved_by?: string },
) {
  return testerApi<{
    ok: boolean;
    already_resolved?: boolean;
    event: TesterFeedbackEvent;
  }>(
    `/api/tester-feedback/events/${encodeURIComponent(eventId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: opts?.note?.trim() || undefined,
        resolved_by: opts?.resolved_by?.trim() || "owner",
      }),
    },
    { timeoutMs: 30_000 },
  );
}
