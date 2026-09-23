/**
 * Desktop email accounts (same `sn_tester_*` keys as mobile).
 * Multi-account switcher lives on DESKTOP only — mobile stays one email session.
 * Each email → own invest book; mobile links with the same email.
 */
import { hasStoredApiToken } from "../api/supernova";

const LS_EMAIL = "sn_tester_email";
const LS_ID = "sn_tester_id";
const LS_NAME = "sn_tester_display_name";
const LS_SESSION = "sn_tester_session";
const LS_ACCOUNTS = "sn_tester_accounts";

export const TESTER_SESSION_CHANGED_EVENT = "supernova:tester-session-changed";
export const TESTER_SESSION_HEADER = "X-SuperNova-Tester-Session";

/** Matches server tester_feedback_io._EMAIL_DOMAIN_TYPOS. */
const EMAIL_DOMAIN_TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
};

export type StoredTester = {
  testerId: string;
  email: string;
  displayName: string;
};

/**
 * Operator email — Access admin tab + shared Pulse book.
 * Other emails Request Access → pending until approved.
 */
export const SUPERNOVA_SINGLE_OWNER_EMAIL = "tizyvola@gmail.com";

export function isAllowedOwnerEmail(email: string): boolean {
  return normalizeTesterEmail(email) === SUPERNOVA_SINGLE_OWNER_EMAIL;
}

/** Desktop multi-account switcher — owner may keep a second local account. */
export function allowsDesktopAccountSwitch(): boolean {
  return isAllowedOwnerEmail(getStoredTester()?.email ?? "");
}

const MAX_ROSTER = 12;

/** Fix common email typos so desktop/mobile share one tester book. */
export function normalizeTesterEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return `${local}@${EMAIL_DOMAIN_TYPOS[domain] ?? domain}`;
}

export function getStoredTester(): StoredTester | null {
  if (typeof window === "undefined") return null;
  const email = localStorage.getItem(LS_EMAIL)?.trim() ?? "";
  const testerId = localStorage.getItem(LS_ID)?.trim() ?? "";
  const displayName = localStorage.getItem(LS_NAME)?.trim() ?? "";
  if (!email || !testerId) return null;
  const fixedEmail = normalizeTesterEmail(email);
  const fixedId = testerIdFromEmail(fixedEmail);
  const next: StoredTester = {
    email: fixedEmail,
    testerId: fixedId,
    displayName: displayName || fixedEmail,
  };
  if (fixedEmail !== email.toLowerCase() || fixedId !== testerId) {
    // Keep the invest-book owner tag aligned so hydrate does not treat this as
    // a different account and wipe local opens (gamil → gmail).
    try {
      const ownerKey = "supernova_invest_sim_inputs_owner";
      const owner = localStorage.getItem(ownerKey)?.trim() || "";
      if (owner && owner === testerId) {
        localStorage.setItem(ownerKey, fixedId);
      }
    } catch {
      /* ignore */
    }
    saveStoredTester(next);
  }
  return next;
}

export function getTesterSessionToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LS_SESSION)?.trim() || "";
}

export function setTesterSessionToken(token: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const v = String(token || "").trim();
  if (v) localStorage.setItem(LS_SESSION, v);
  else localStorage.removeItem(LS_SESSION);
}

function readRoster(): StoredTester[] {
  try {
    const raw = localStorage.getItem(LS_ACCOUNTS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: StoredTester[] = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const email = String((row as StoredTester).email ?? "")
        .trim()
        .toLowerCase();
      const testerId = String((row as StoredTester).testerId ?? "").trim();
      const displayName = String((row as StoredTester).displayName ?? email).trim();
      if (!email.includes("@") || !testerId) continue;
      out.push({ email, testerId, displayName: displayName || email });
    }
    return out;
  } catch {
    return [];
  }
}

function writeRoster(list: StoredTester[]): void {
  localStorage.setItem(LS_ACCOUNTS, JSON.stringify(list.slice(0, MAX_ROSTER)));
}

export function purgeNonOwnerTesterAccounts(): void {
  /* Multi-user Request Access enabled — do not wipe non-owner sessions. */
}

/** Known emails on this desktop (most recent first). */
export function listStoredTesterAccounts(): StoredTester[] {
  if (typeof window === "undefined") return [];
  const roster = readRoster();
  const cur = getStoredTester();
  if (!cur) return roster;
  const rest = roster.filter((a) => a.testerId !== cur.testerId && a.email !== cur.email);
  return [cur, ...rest];
}

function rememberInRoster(t: StoredTester): void {
  const email = normalizeTesterEmail(t.email);
  const next: StoredTester = {
    email,
    testerId: testerIdFromEmail(email),
    displayName: (t.displayName || email).trim(),
  };
  const rest = readRoster().filter(
    (a) => a.testerId !== next.testerId && a.email !== next.email,
  );
  writeRoster([next, ...rest]);
}

export function saveStoredTester(t: StoredTester): void {
  const email = normalizeTesterEmail(t.email);
  const testerId = testerIdFromEmail(email);
  localStorage.setItem(LS_EMAIL, email);
  localStorage.setItem(LS_ID, testerId);
  localStorage.setItem(LS_NAME, (t.displayName || email).trim());
  rememberInRoster({ email, testerId, displayName: t.displayName || email });
  try {
    window.dispatchEvent(new CustomEvent(TESTER_SESSION_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Stable id from email — matches server tester_feedback_io._tester_id_from_email. */
export function testerIdFromEmail(email: string): string {
  const e = normalizeTesterEmail(email);
  return e.replace("@", "_at_").replace(/[^a-z0-9._+-]/g, "_").slice(0, 64) || "tester";
}

/** Clear active session only — roster kept for switching to a second email. */
export function clearStoredTester(): void {
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_NAME);
  localStorage.removeItem(LS_SESSION);
  try {
    window.dispatchEvent(new CustomEvent(TESTER_SESSION_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function removeTesterFromRoster(testerIdOrEmail: string): void {
  const key = testerIdOrEmail.trim().toLowerCase();
  writeRoster(
    readRoster().filter(
      (a) => a.testerId !== testerIdOrEmail.trim() && a.email !== key,
    ),
  );
}

/**
 * Shared operator Pulse book — only with explicit `?lab=1` + API token.
 * Electron / EXE / VPS web all use email accounts by default (multi-user).
 */
export function isDesktopLabOperatorMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("lab") === "1" && hasStoredApiToken()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Desktop always requires an email account unless lab operator mode. */
export function requiresDesktopTesterGate(): boolean {
  if (typeof window === "undefined") return false;
  if (isDesktopLabOperatorMode()) return false;
  return true;
}

/**
 * Email that historically owns the shared Pulse portfolio on this deployment.
 * Other emails get independent empty tester books — they never share this book.
 */
const SHARED_BOOK_OWNER_EMAILS = new Set([SUPERNOVA_SINGLE_OWNER_EMAIL]);

export function ownsSharedInvestBook(email?: string | null): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return Boolean(e) && SHARED_BOOK_OWNER_EMAILS.has(e);
}

/**
 * Active email book id. `null` = shared Pulse book (lab operator OR primary owner).
 * Other logged-in emails → their private `/testers/{id}/sim-inputs` file.
 */
export function getActiveInvestTesterId(): string | null {
  if (isDesktopLabOperatorMode()) return null;
  const stored = getStoredTester();
  if (!stored) return null;
  if (ownsSharedInvestBook(stored.email)) return null;
  return stored.testerId;
}

/** Shared `/api/investment/sim-inputs` — lab mode or the primary owner email only. */
export function usesSharedOperatorInvestBook(): boolean {
  if (isDesktopLabOperatorMode()) return true;
  return ownsSharedInvestBook(getStoredTester()?.email);
}
