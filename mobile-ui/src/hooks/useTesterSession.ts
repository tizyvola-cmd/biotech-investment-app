import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTesterAccess,
  fetchTesterFeedbackConfig,
  postTesterFeedbackEvent,
  registerMobileTester,
  createTesterSession,
  type TesterAccess,
} from "../api";
import {
  getStoredTester,
  saveStoredTester,
  clearStoredTester,
  getTesterSessionToken,
  setTesterSessionToken,
  testerIdFromEmail,
  type StoredTester,
} from "../testerSession";
import { MOBILE_APP_VERSION } from "../version";

export type TesterGateState = "loading" | "needs_register" | "pending" | "revoked" | "ready";

const PING_INTERVAL_MS = 5 * 60 * 1000;
const PENDING_POLL_MS = 12_000;
const LS_WELCOME = "sn_tester_show_welcome";

async function ensureServerRegistration(stored: StoredTester): Promise<TesterAccess> {
  let access = await fetchTesterAccess(stored.testerId);
  if (!access.registered) {
    await registerMobileTester({
      email: stored.email,
      display_name: stored.displayName || stored.email,
    });
    access = await fetchTesterAccess(stored.testerId);
  }
  return access;
}

/** Restore session from approval email link (?welcome=1&email=…). */
async function bootstrapTesterFromWelcomeUrl(): Promise<StoredTester | null> {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return getStoredTester();
    const emailParam = params.get("email")?.trim().toLowerCase() ?? "";
    if (!emailParam.includes("@")) return getStoredTester();

    const stored = getStoredTester();
    if (stored?.email === emailParam) return stored;

    const testerId = testerIdFromEmail(emailParam);
    let access = await fetchTesterAccess(testerId);
    if (!access.registered) {
      await registerMobileTester({
        email: emailParam,
        display_name: emailParam.split("@")[0] || emailParam,
      });
      access = await fetchTesterAccess(testerId);
    }
    if (!access.registered) return stored;

    const next: StoredTester = {
      email: emailParam,
      testerId,
      displayName: String(access.display_name || stored?.displayName || emailParam),
    };
    saveStoredTester(next);
    if (access.allowed) {
      try {
        sessionStorage.setItem(LS_WELCOME, "1");
      } catch {
        /* ignore */
      }
    }
    return next;
  } catch {
    return getStoredTester();
  }
}

export function useTesterSession(activeScreen?: string) {
  const [gate, setGate] = useState<TesterGateState>("loading");
  const [tester, setTester] = useState<StoredTester | null>(() => getStoredTester());
  const [access, setAccess] = useState<TesterAccess | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const lastPingRef = useRef(0);
  const gateRef = useRef<TesterGateState>("loading");

  useEffect(() => {
    gateRef.current = gate;
  }, [gate]);

  useEffect(() => {
    void fetchTesterFeedbackConfig()
      .then((cfg) => setInviteRequired(!!cfg.invite_required))
      .catch(() => setInviteRequired(false));
  }, []);

  const applyAccess = useCallback((a: TesterAccess, stored: StoredTester | null) => {
    setAccess(a);
    if (!stored) {
      setGate("needs_register");
      return;
    }
    if (!a.registered) {
      setGate("needs_register");
      return;
    }
    if (a.status === "revoked") {
      setGate("revoked");
      return;
    }
    if (!a.allowed) {
      setGate("pending");
      return;
    }
    if (gateRef.current === "pending") {
      try {
        sessionStorage.setItem(LS_WELCOME, "1");
      } catch {
        /* ignore */
      }
    }
    setGate("ready");
    if (!getTesterSessionToken()) {
      void createTesterSession(stored.testerId, stored.email)
        .then((sess) => {
          const tok = sess.tester?.session_token;
          if (typeof tok === "string" && tok) setTesterSessionToken(tok);
        })
        .catch(() => {
          /* ignore */
        });
    }
  }, []);

  const refreshAccess = useCallback(async () => {
    const stored = await bootstrapTesterFromWelcomeUrl();
    setTester(stored);
    if (!stored) {
      setGate("needs_register");
      return null;
    }
    try {
      const a = await ensureServerRegistration(stored);
      applyAccess(a, stored);
      setAuthErr(null);
      return a;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthErr(msg === "INVITE_REQUIRED" ? "INVITE_REQUIRED" : msg);
      setGate("needs_register");
      return null;
    }
  }, [applyAccess]);

  const register = useCallback(
    async (email: string, displayName: string, inviteCode?: string) => {
      setAuthBusy(true);
      setAuthErr(null);
      try {
        if (inviteRequired && !(inviteCode ?? "").trim()) {
          throw new Error("INVITE_REQUIRED");
        }
        const res = await registerMobileTester({
          email: email.trim(),
          display_name: displayName.trim() || email.trim(),
          invite_code: inviteCode?.trim() || undefined,
        });
        const meta = res.tester;
        const stored: StoredTester = {
          email: String(meta.email || email).trim().toLowerCase(),
          testerId: String(meta.tester_id),
          displayName: String(meta.display_name || displayName || email),
        };
        saveStoredTester(stored);
        const tok = (meta as { session_token?: string }).session_token;
        if (tok) setTesterSessionToken(tok);
        setTester(stored);
        const a = await ensureServerRegistration(stored);
        applyAccess(a, stored);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAuthErr(msg === "INVITE_REQUIRED" ? "INVITE_REQUIRED" : msg);
      } finally {
        setAuthBusy(false);
      }
    },
    [applyAccess, inviteRequired],
  );

  const signOutTester = useCallback(() => {
    clearStoredTester();
    setTester(null);
    setAccess(null);
    setGate("needs_register");
  }, []);

  const pingSession = useCallback(
    async (screen?: string) => {
      const stored = getStoredTester();
      if (!stored || gate !== "ready") return;
      const now = Date.now();
      if (now - lastPingRef.current < 30_000) return;
      lastPingRef.current = now;
      // Mobile is dashboard-only; map legacy tab names to dashboard.
      const module =
        screen === "detail" || screen === "opportunity" || screen === "dashboard"
          ? screen
          : "dashboard";
      try {
        await postTesterFeedbackEvent({
          tester_id: stored.testerId,
          display_name: stored.displayName,
          module,
          kind: "session_ping",
          source: "mobile",
          payload: {
            app_version: MOBILE_APP_VERSION,
            screen: screen ?? module,
            email: stored.email,
            seconds: Math.round(PING_INTERVAL_MS / 1000),
          },
        });
      } catch {
        /* non-blocking */
      }
    },
    [gate],
  );

  useEffect(() => {
    void refreshAccess();
    const ms = gate === "pending" ? PENDING_POLL_MS : 60_000;
    const id = window.setInterval(() => void refreshAccess(), ms);
    return () => window.clearInterval(id);
  }, [refreshAccess, gate]);

  useEffect(() => {
    if (gate !== "ready") return;
    void pingSession(activeScreen);
    const id = window.setInterval(() => void pingSession(activeScreen), PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [gate, activeScreen, pingSession]);

  return {
    gate,
    tester,
    access,
    authErr,
    authBusy,
    register,
    refreshAccess,
    signOutTester,
    pingSession,
    inviteRequired,
  };
}
