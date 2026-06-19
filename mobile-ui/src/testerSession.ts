const LS_EMAIL = "sn_tester_email";
const LS_ID = "sn_tester_id";
const LS_NAME = "sn_tester_display_name";

export type StoredTester = {
  testerId: string;
  email: string;
  displayName: string;
};

export function getStoredTester(): StoredTester | null {
  const email = localStorage.getItem(LS_EMAIL)?.trim() ?? "";
  const testerId = localStorage.getItem(LS_ID)?.trim() ?? "";
  const displayName = localStorage.getItem(LS_NAME)?.trim() ?? "";
  if (!email || !testerId) return null;
  return {
    email,
    testerId,
    displayName: displayName || email,
  };
}

export function saveStoredTester(t: StoredTester): void {
  localStorage.setItem(LS_EMAIL, t.email.trim().toLowerCase());
  localStorage.setItem(LS_ID, t.testerId.trim());
  localStorage.setItem(LS_NAME, (t.displayName || t.email).trim());
}

/** Stable id from email — matches server tester_feedback_io._tester_id_from_email. */
export function testerIdFromEmail(email: string): string {
  const e = email.trim().toLowerCase();
  return e.replace("@", "_at_").replace(/[^a-z0-9._+-]/g, "_").slice(0, 64) || "tester";
}

export function clearStoredTester(): void {
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_NAME);
}
