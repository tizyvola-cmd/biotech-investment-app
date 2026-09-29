import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTesterAccess,
  fetchTesterFeedbackConfig,
  postTesterFeedbackEvent,
  registerDesktopTester,
  createTesterSession,
  type TesterAccess,
} from "../api/testerFeedback";
import {
  clearHostedPageRemoteApiBase,
  clearLoopbackRemoteApiBase,
  clearStaleNonDefaultRemoteApiBase,
  isLocalDesktopShell,
  resolveTesterFeedbackApiBase,
} from "../shared/remoteHost";
import {
  clearStoredTester,
  getStoredTester,
  isAllowedOwnerEmail,
  listStoredTesterAccounts,
  requiresDesktopTesterGate,
  saveStoredTester,
  setTesterSessionToken,
  testerIdFromEmail,
  type StoredTester,
} from "../sheet/testerSession";
import {
  OPEN_PREMIUM_REQUEST_EVENT,
  LANDING_PANEL_KEY,
  hasPremiumMembership,
} from "../shared/premiumAccess";

export type DesktopTesterGateState =
  | "skip"
  | "loading"
  | "needs_register"
  | "pending"
  | "revoked"
  | "ready";

const PING_INTERVAL_MS = 180_000; // 3 min â€” fewer writes under multi-user load
const PING_SECONDS = 180;
const WEB_ENTERED_KEY = "sn_web_entered";

function isElectronShell(): boolean {
  if (typeof window === "undefined") return false;
  const sn = (window as Window & { supernova?: { projectDataBase?: string } }).supernova;
  return Boolean(sn?.projectDataBase);
}

function forcePublicLanding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("landing") === "1";
  } catch {
    return false;
  }
}

/** Browser/VPS always starts on the public landing. Electron auto-enters if already signed in. */
function readWebEntered(): boolean {
  if (typeof window === "undefined") return false;
  if (forcePublicLanding()) return false;
  if (isElectronShell()) return Boolean(getStoredTester());
  try {
    return sessionStorage.getItem(WEB_ENTERED_KEY) === "1";
  } catch {
    return false;
  }
}

function isNetworkFetchError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const name = String((err as { name?: string }).name || "");
    if (name === "AbortError" || name === "TimeoutError") return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|fetch failed|aborterror|aborted|timed?\s*out/i.test(
    msg,
  );
}

/** Worker kill / gateway blip — must not demote an already-approved session to landing. */
function isTransientApiError(err: unknown): boolean {
  if (isNetworkFetchError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /\b(502|503|504|408|429)\b|api server not reachable|not reachable|gateway|worker timeout/i.test(
    msg,
  );
}

async function withTesterApiRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    const clearedLoopback = clearLoopbackRemoteApiBase();
    const clearedHosted = clearHostedPageRemoteApiBase();
    const clearedStale = isLocalDesktopShell() ? clearStaleNonDefaultRemoteApiBase() : false;
    if (
      !clearedLoopback &&
      !clearedHosted &&
      !clearedStale &&
      resolveTesterFeedbackApiBase()
    ) {
      throw e;
    }
    return await fn();
  }
}

async function ensureRegistered(stored: StoredTester): Promise<TesterAccess> {
  // Do not auto-create accounts here Ã¢â‚¬â€ new users must Request Access (pending until approved).
  return withTesterApiRetry(() => fetchTesterAccess(stored.testerId));
}

async function bootstrapFromWelcomeUrl(): Promise<StoredTester | null> {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return getStoredTester();
    const emailParam = params.get("email")?.trim().toLowerCase() ?? "";
    if (!emailParam.includes("@")) return getStoredTester();
    const stored = getStoredTester();
    if (stored?.email === emailParam) return stored;
    const testerId = testerIdFromEmail(emailParam);
    const access = await withTesterApiRetry(() => fetchTesterAccess(testerId));
    if (!access.registered) return stored;
    const next: StoredTester = {
      email: emailParam,
      testerId,
      displayName: String(access.display_name || stored?.displayName || emailParam),
    };
    saveStoredTester(next);
    return next;
  } catch {
    return getStoredTester();
  }
}

export function useDesktopTesterSession() {
  const gateRequired = requiresDesktopTesterGate();
  const [gate, setGate] = useState<DesktopTesterGateState>(
    gateRequired ? "loading" : "skip",
  );
  const [tester, setTester] = useState<StoredTester | null>(() => getStoredTester());
  const [accountRoster, setAccountRoster] = useState<StoredTester[]>(() =>
    listStoredTesterAccounts(),
  );
  /** Explicit UI lock Ã¢â‚¬â€ polling must not close Account / Sign-out flows. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;

  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [premiumFlag, setPremiumFlag] = useState(false);
  const lastPingRef = useRef(0);
  const [entered, setEntered] = useState(() => readWebEntered());
  const gateRef = useRef(gate);
  const enteredRef = useRef(entered);
  gateRef.current = gate;
  enteredRef.current = entered;

  const enterApp = useCallback(() => {
    try {
      sessionStorage.setItem(WEB_ENTERED_KEY, "1");
    } catch {
      /* ignore */
    }
    setEntered(true);
  }, []);

  /** Leave browse mode and open landing Premium waitlist CTA. */
  const openPremiumRequest = useCallback(() => {
    try {
      sessionStorage.setItem(LANDING_PANEL_KEY, "premium");
      sessionStorage.removeItem(WEB_ENTERED_KEY);
    } catch {
      /* ignore */
    }
    setEntered(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => openPremiumRequest();
    window.addEventListener(OPEN_PREMIUM_REQUEST_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PREMIUM_REQUEST_EVENT, onOpen);
  }, [openPremiumRequest]);

  const refreshRoster = useCallback(() => {
    setAccountRoster(listStoredTesterAccounts());
  }, []);

  useEffect(() => {
    if (!gateRequired) return;
    clearHostedPageRemoteApiBase();
    refreshRoster();
  }, [gateRequired, refreshRoster]);

  useEffect(() => {
    if (!gateRequired) return;
    void fetchTesterFeedbackConfig()
      .then((cfg) => setInviteRequired(!!cfg.invite_required))
      .catch(() => setInviteRequired(false));
  }, [gateRequired]);

  const ensureDeviceSession = useCallback(async (stored: StoredTester) => {
    try {
      const sess = await createTesterSession(stored.testerId, stored.email);
      const tok = (sess.tester as { session_token?: string } | undefined)?.session_token;
      if (tok) setTesterSessionToken(tok);
    } catch {
      /* owner may use admin token; testers need session Ã¢â‚¬â€ sign-in will surface errors */
    }
  }, []);

  const applyAccess = useCallback((a: TesterAccess, stored: StoredTester | null) => {
    if (!stored || !a.registered) {
      setGate("needs_register");
      setPremiumFlag(false);
      return;
    }
    if (a.status === "revoked") {
      setGate("revoked");
      setPremiumFlag(false);
      setEntered(false);
      try {
        sessionStorage.removeItem(WEB_ENTERED_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    if (!a.allowed) {
      setGate("pending");
      setPremiumFlag(false);
      setEntered(false);
      try {
        sessionStorage.removeItem(WEB_ENTERED_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setPremiumFlag(Boolean(a.premium) || isAllowedOwnerEmail(a.email || stored.email));
    setGate("ready");
  }, []);

  const refreshAccess = useCallback(async () => {
    if (!requiresDesktopTesterGate()) {
      setGate("skip");
      return;
    }
    // Never overwrite Account / Sign-out UI with a background poll.
    if (pickerOpenRef.current) return;

    const stored = await bootstrapFromWelcomeUrl();
    setTester(stored);
    refreshRoster();
    if (!stored) {
      setGate("needs_register");
      return;
    }
    try {
      const a = await ensureRegistered(stored);
      if (pickerOpenRef.current) return;
      applyAccess(a, stored);
      if (a.allowed) await ensureDeviceSession(stored);
      setAuthErr(null);
    } catch (e) {
      if (pickerOpenRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      // Background poll must not kick an approved user back to the landing page
      // when the API blips (gunicorn worker timeout / 502 / Cloudflare).
      if (isTransientApiError(e) && (gateRef.current === "ready" || enteredRef.current)) {
        if (isNetworkFetchError(e)) setAuthErr("NETWORK");
        return;
      }
      setAuthErr(msg);
      setGate("needs_register");
    }
  }, [applyAccess, ensureDeviceSession, refreshRoster]);

  const activateAccount = useCallback(
    async (stored: StoredTester) => {
      setAuthBusy(true);
      setAuthErr(null);
      try {
        // Keep previous email's capital pots; do not bleed budget into the next account.
        try {
          const prev = getStoredTester();
          if (prev?.testerId && prev.testerId !== stored.testerId) {
            const { stashCapitalPrefsForTester } = await import("../sheet/uiPrefs");
            stashCapitalPrefsForTester(prev.testerId);
          }
        } catch {
          /* optional */
        }
        saveStoredTester(stored);
        setTester(stored);
        refreshRoster();
        const a = await ensureRegistered(stored);
        applyAccess(a, stored);
        if (a.allowed) {
          await ensureDeviceSession(stored);
          enterApp();
        }
        setPickerOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAuthErr(msg);
        setGate("needs_register");
        setPickerOpen(true);
      } finally {
        setAuthBusy(false);
      }
    },
    [applyAccess, ensureDeviceSession, enterApp, refreshRoster],
  );

  const register = useCallback(
    async (
      email: string,
      displayName: string,
      inviteCode?: string,
      interest?: {
        edition?: "biotech" | "tech" | "both";
        otherSpaces?: string;
        firstName?: string;
        lastName?: string;
        birthYear?: number;
      },
    ) => {
      setAuthBusy(true);
      setAuthErr(null);
      try {
        if (inviteRequired && !(inviteCode ?? "").trim() && !isAllowedOwnerEmail(email)) {
          // Invite codes still optional for Request Access; owner never needs one.
        }
        const res = await withTesterApiRetry(() =>
          registerDesktopTester({
            email: email.trim(),
            display_name: displayName.trim() || email.trim(),
            invite_code: inviteCode?.trim() || undefined,
            interest_edition: interest?.edition,
            interest_other: interest?.otherSpaces,
            first_name: interest?.firstName,
            last_name: interest?.lastName,
            birth_year: interest?.birthYear,
          }),
        );
        const meta = res.tester;
        const stored: StoredTester = {
          email: String(meta.email || email).trim().toLowerCase(),
          testerId: String(meta.tester_id),
          displayName: String(meta.display_name || displayName || email),
        };
        saveStoredTester(stored);
        if (typeof (meta as { session_token?: string }).session_token === "string") {
          setTesterSessionToken((meta as { session_token?: string }).session_token);
        }
        setTester(stored);
        refreshRoster();
        // Pending Request Access Ã¢â‚¬â€ do not force ready; show waiting panel.
        if (meta.allowed === false || String(meta.status || "").toLowerCase() === "pending") {
          setGate("pending");
          setPickerOpen(false);
          return;
        }
        await activateAccount(stored);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "INVITE_REQUIRED") setAuthErr("INVITE_REQUIRED");
        else if (isNetworkFetchError(e)) setAuthErr("NETWORK");
        else setAuthErr(msg);
      } finally {
        setAuthBusy(false);
      }
    },
    [activateAccount, inviteRequired, refreshRoster],
  );

  /** Sign-in after approval Ã¢â‚¬â€ existing accounts only (new emails must Request Access). */
  const signIn = useCallback(
    async (email: string) => {
      setAuthBusy(true);
      setAuthErr(null);
      try {
        const em = email.trim().toLowerCase();
        const testerId = testerIdFromEmail(em);
        const access = await withTesterApiRetry(() => fetchTesterAccess(testerId));
        if (!access.registered) {
          setAuthErr(
            "No account yet Ã¢â‚¬â€ use Request access first. Access stays pending until the operator approves you.",
          );
          setGate("needs_register");
          return;
        }
        const stored: StoredTester = {
          email: em,
          testerId,
          displayName: String(access.display_name || em),
        };
        saveStoredTester(stored);
        setTester(stored);
        refreshRoster();
        applyAccess(access, stored);
        if (access.allowed) {
          await ensureDeviceSession(stored);
          enterApp();
        } else {
          setEntered(false);
          try {
            sessionStorage.removeItem(WEB_ENTERED_KEY);
          } catch {
            /* ignore */
          }
        }
        setPickerOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isNetworkFetchError(e)) setAuthErr("NETWORK");
        else setAuthErr(msg);
        setGate("needs_register");
      } finally {
        setAuthBusy(false);
      }
    },
    [applyAccess, ensureDeviceSession, enterApp, refreshRoster],
  );

  const openAccountPicker = useCallback(() => {
    refreshRoster();
    setAuthErr(null);
    setPickerOpen(true);
  }, [refreshRoster]);

  const signOut = useCallback(() => {
    try {
      const prev = getStoredTester();
      if (prev?.testerId) {
        void import("../sheet/uiPrefs").then(({ stashCapitalPrefsForTester }) => {
          stashCapitalPrefsForTester(prev.testerId);
        });
      }
    } catch {
      /* optional */
    }
    clearStoredTester();
    setTester(null);
    setAuthErr(null);
    setGate("needs_register");
    setPickerOpen(false);
    setEntered(false);
    try {
      sessionStorage.removeItem(WEB_ENTERED_KEY);
    } catch {
      /* ignore */
    }
    refreshRoster();
    void import("../sheet/investSimStorage").then(({ clearLocalInvestBookForAccountSwitch }) => {
      clearLocalInvestBookForAccountSwitch();
    });
  }, [refreshRoster]);

  const closeAccountPicker = useCallback(() => {
    const cur = getStoredTester();
    if (cur) {
      setTester(cur);
      setPickerOpen(false);
      setAuthErr(null);
      void refreshAccess();
      return;
    }
    setPickerOpen(true);
    setGate("needs_register");
  }, [refreshAccess]);

  // Boot + light poll Ã¢â‚¬â€ do NOT re-subscribe when gate flips (that raced the picker).
  useEffect(() => {
    if (!gateRequired) {
      setGate("skip");
      return;
    }
    void refreshAccess();
    const id = window.setInterval(() => {
      if (pickerOpenRef.current) return;
      void refreshAccess();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [gateRequired, refreshAccess]);

  /** Heartbeat Ã¢â€ â€™ usage_minutes_today on Access admin. */
  useEffect(() => {
    if (!gateRequired || gate !== "ready") return;
    const ping = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const stored = getStoredTester();
      if (!stored) return;
      const now = Date.now();
      if (now - lastPingRef.current < PING_INTERVAL_MS - 5_000) return;
      lastPingRef.current = now;
      try {
        await postTesterFeedbackEvent({
          tester_id: stored.testerId,
          display_name: stored.displayName,
          module: "dashboard",
          kind: "session_ping",
          source: "desktop",
          payload: {
            screen: "desktop",
            email: stored.email,
            seconds: PING_SECONDS,
          },
        });
      } catch {
        /* non-blocking */
      }
    };
    void ping();
    const jitter = Math.floor(Math.random() * 30_000); const id = window.setInterval(() => void ping(), PING_INTERVAL_MS + jitter);
    const onVis = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [gateRequired, gate]);

  const showGate =
    gateRequired &&
    (pickerOpen || (gate !== "ready" && gate !== "skip"));

  // Never open the desk until approved. Pending / revoked / register stay on landing
  // even if sessionStorage still has an old "entered" flag from a previous visit.
  const showLanding =
    gateRequired &&
    !pickerOpen &&
    gate !== "skip" &&
    (gate !== "ready" || !entered);

  return {
    gate,
    gateRequired,
    showGate,
    showLanding,
    pickerOpen,
    tester,
    accountRoster,
    authErr,
    authBusy,
    inviteRequired,
    hasPremium: hasPremiumMembership(gate, {
      premium: premiumFlag,
      email: tester?.email ?? null,
    }),
    register,
    signIn,
    activateAccount,
    refreshAccess,
    enterApp,
    openPremiumRequest,
    signOut,
    switchAccount: signOut,
    openAccountPicker,
    closeAccountPicker,
  };
}
