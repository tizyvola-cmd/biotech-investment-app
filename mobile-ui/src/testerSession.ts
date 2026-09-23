const LS_EMAIL = "sn_tester_email";
const LS_ID = "sn_tester_id";
const LS_NAME = "sn_tester_display_name";
const LS_SESSION = "sn_tester_session";

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

/** Fix common email typos so mobile hits the same book as desktop. */
export function normalizeTesterEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return `${local}@${EMAIL_DOMAIN_TYPOS[domain] ?? domain}`;
}

export function getStoredTester(): StoredTester | null {
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

export function saveStoredTester(t: StoredTester): void {
  const email = normalizeTesterEmail(t.email);
  localStorage.setItem(LS_EMAIL, email);
  localStorage.setItem(LS_ID, testerIdFromEmail(email));
  localStorage.setItem(LS_NAME, (t.displayName || email).trim());
}

export function getTesterSessionToken(): string {
  return localStorage.getItem(LS_SESSION)?.trim() || "";
}

export function setTesterSessionToken(token: string | null | undefined): void {
  const v = String(token || "").trim();
  if (v) localStorage.setItem(LS_SESSION, v);
  else localStorage.removeItem(LS_SESSION);
}

/** Stable id from email — matches server tester_feedback_io._tester_id_from_email. */
export function testerIdFromEmail(email: string): string {
  const e = normalizeTesterEmail(email);
  return e.replace("@", "_at_").replace(/[^a-z0-9._+-]/g, "_").slice(0, 64) || "tester";
}

export function clearStoredTester(): void {
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_NAME);
  localStorage.removeItem(LS_SESSION);
}

/** Primary owner of the shared Pulse book on this deployment (same as desktop). */
const SHARED_BOOK_OWNER_EMAILS = new Set(["tizyvola@gmail.com"]);

export function ownsSharedInvestBook(email?: string | null): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return Boolean(e) && SHARED_BOOK_OWNER_EMAILS.has(e);
}

/**
 * Mobile companion book id — always the logged-in email’s desktop book.
 * - Shared Pulse owner → null (same `/api/investment/sim-inputs` as desktop)
 * - Every other email → `/api/tester-feedback/testers/{id}/sim-inputs`
 * Never falls back to the operator book when an email session is present.
 */
export function investBookTesterIdForEmail(
  email?: string | null,
  testerId?: string | null,
): string | null {
  if (ownsSharedInvestBook(email)) return null;
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  return testerId?.trim() || testerIdFromEmail(e);
}
