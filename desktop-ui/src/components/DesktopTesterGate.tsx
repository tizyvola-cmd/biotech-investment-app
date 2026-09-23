import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { StoredTester } from "../sheet/testerSession";
import { useLang } from "../shared/i18n";

type Props = {
  mode: "loading" | "register" | "pending" | "revoked";
  tester: StoredTester | null;
  accountRoster?: StoredTester[];
  authBusy: boolean;
  authErr: string | null;
  inviteRequired?: boolean;
  /** True when switching / adding a second account while already logged in. */
  switching?: boolean;
  onRegister: (email: string, displayName: string, inviteCode: string) => void;
  onActivateAccount?: (account: StoredTester) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onCancelSwitch?: () => void;
};

export function DesktopTesterGate({
  mode,
  tester,
  accountRoster = [],
  authBusy,
  authErr,
  inviteRequired = false,
  switching = false,
  onRegister,
  onActivateAccount,
  onRefresh,
  onSignOut,
  onCancelSwitch,
}: Props) {
  const { lang } = useLang();
  const it = lang === "it";
  const welcomeEmail = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("welcome") !== "1") return "";
      return p.get("email")?.trim().toLowerCase() ?? "";
    } catch {
      return "";
    }
  }, []);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    if (switching) {
      setEmail("");
      setDisplayName("");
      return;
    }
    setEmail(tester?.email ?? welcomeEmail);
    setDisplayName(tester?.displayName && tester.displayName !== tester.email ? tester.displayName : "");
  }, [switching, tester?.email, tester?.displayName, welcomeEmail]);

  const otherAccounts = accountRoster.filter(
    (a) => !tester || (a.email !== tester.email && a.testerId !== tester.testerId),
  );
  const showRoster = otherAccounts.length > 0 || (switching && accountRoster.length > 0);
  const rosterForPick = switching
    ? accountRoster
    : otherAccounts;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgb(var(--bg-deep))]/95 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={it ? "Account SuperNova" : "SuperNova account"}
    >
      <div className="w-full max-w-md rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--bg-panel))] p-6 shadow-xl">
        {mode === "loading" ? (
          <p className="text-sm text-[rgb(var(--ink-muted))]">
            {it ? "Caricamento account…" : "Loading account…"}
          </p>
        ) : null}

        {mode === "pending" ? (
          <>
            <h1 className="text-lg font-semibold text-[rgb(var(--ink))]">
              {it ? "In attesa di approvazione" : "Waiting for approval"}
            </h1>
            <p className="mt-2 text-sm text-[rgb(var(--ink-muted))]">
              {it
                ? "Il tuo account email e registrato. Appena approvato potrai investire da zero."
                : "Your email is registered. Once approved you can invest from an empty book."}
            </p>
            {tester?.email ? (
              <p className="mt-3 text-sm font-medium text-[rgb(var(--ink))]">{tester.email}</p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-md bg-[rgb(var(--accent))] px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={authBusy}
                onClick={onRefresh}
              >
                {it ? "Controlla di nuovo" : "Check again"}
              </button>
              <button
                type="button"
                className="rounded-md border border-[rgb(var(--line))] px-3 py-2 text-sm"
                onClick={onSignOut}
              >
                {it ? "Altro account" : "Other account"}
              </button>
            </div>
          </>
        ) : null}

        {mode === "revoked" ? (
          <>
            <h1 className="text-lg font-semibold text-[rgb(var(--ink))]">
              {it ? "Account sospeso" : "Account revoked"}
            </h1>
            <p className="mt-2 text-sm text-[rgb(var(--ink-muted))]">
              {it
                ? "Questo account non puo accedere. Contatta chi gestisce SuperNova."
                : "This account cannot access SuperNova. Contact the operator."}
            </p>
            <button
              type="button"
              className="mt-4 rounded-md border border-[rgb(var(--line))] px-3 py-2 text-sm"
              onClick={onSignOut}
            >
              {it ? "Altro account" : "Other account"}
            </button>
          </>
        ) : null}

        {mode === "register" ? (
          <>
            <h1 className="text-lg font-semibold text-[rgb(var(--ink))]">
              {switching
                ? it
                  ? "Cambia o aggiungi account"
                  : "Switch or add account"
                : it
                  ? "Crea il tuo account SuperNova"
                  : "Create your SuperNova account"}
            </h1>
            <p className="mt-2 text-sm text-[rgb(var(--ink-muted))]">
              {switching
                ? it
                  ? "Ogni email ha il suo portafoglio. Usa la stessa email sull app mobile."
                  : "Each email has its own portfolio. Use the same email on the mobile app."
                : it
                  ? "Registrati con la tua email: parti con un portafoglio vuoto. Usa la stessa email sull app mobile per collegare gli investimenti."
                  : "Sign up with your email to start from an empty portfolio. Use the same email on the mobile app to link your investments."}
            </p>

            {showRoster && rosterForPick.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-[rgb(var(--ink-muted))]">
                  {it ? "Account su questo PC" : "Accounts on this device"}
                </p>
                {rosterForPick.map((a) => (
                  <button
                    key={a.testerId}
                    type="button"
                    disabled={authBusy}
                    className="flex w-full items-center justify-between rounded-md border border-[rgb(var(--line))] bg-[rgb(var(--bg-deep))] px-3 py-2 text-left text-sm hover:border-[rgb(var(--accent))]/50 disabled:opacity-50"
                    onClick={() => onActivateAccount?.(a)}
                  >
                    <span className="truncate font-medium text-[rgb(var(--ink))]">
                      {a.email}
                    </span>
                    <span className="shrink-0 text-xs text-[rgb(var(--accent))]">
                      {it ? "Entra" : "Open"}
                    </span>
                  </button>
                ))}
                <p className="pt-1 text-xs text-[rgb(var(--ink-muted))]">
                  {it ? "Oppure registra un nuovo account:" : "Or register a new account:"}
                </p>
              </div>
            ) : null}

            <label className="mt-4 block text-xs font-medium text-[rgb(var(--ink-muted))]">
              Email
              <input
                type="email"
                autoComplete="email"
                className="mt-1 w-full rounded-md border border-[rgb(var(--line))] bg-[rgb(var(--bg-deep))] px-3 py-2 text-sm text-[rgb(var(--ink))]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-[rgb(var(--ink-muted))]">
              {it ? "Nome (opzionale)" : "Name (optional)"}
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-[rgb(var(--line))] bg-[rgb(var(--bg-deep))] px-3 py-2 text-sm text-[rgb(var(--ink))]"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={it ? "Il tuo nome" : "Your name"}
              />
            </label>
            {inviteRequired ? (
              <label className="mt-3 block text-xs font-medium text-[rgb(var(--ink-muted))]">
                {it ? "Codice invito" : "Invite code"}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-[rgb(var(--line))] bg-[rgb(var(--bg-deep))] px-3 py-2 text-sm text-[rgb(var(--ink))]"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="mt-5 w-full rounded-md bg-[rgb(var(--accent))] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={authBusy || !email.includes("@")}
              onClick={() => onRegister(email, displayName, inviteCode)}
            >
              {authBusy
                ? "…"
                : switching
                  ? it
                    ? "Accedi / crea questo account"
                    : "Sign in / create this account"
                  : it
                    ? "Crea account e inizia"
                    : "Create account and start"}
            </button>
            {switching && onCancelSwitch && tester ? (
              <button
                type="button"
                className="mt-2 w-full rounded-md border border-[rgb(var(--line))] px-3 py-2 text-sm"
                disabled={authBusy}
                onClick={onCancelSwitch}
              >
                {it ? `Resta su ${tester.email}` : `Stay on ${tester.email}`}
              </button>
            ) : null}
            {authErr ? (
              <p className="mt-3 text-sm text-[rgb(var(--signal-down))]">
                {authErr === "INVITE_REQUIRED"
                  ? it
                    ? "Serve un codice invito."
                    : "Invite code required."
                  : authErr === "OWNER_ONLY"
                    ? it
                      ? "Solo l account operatore autorizzato puo accedere."
                      : "Only the authorized operator account can sign in."
                    : /failed to fetch|networkerror|load failed/i.test(authErr)
                      ? it
                        ? "Connessione al server fallita. Se in Impostazioni c’è http://127.0.0.1:8765, cancellalo e usa il VPS (http://91.99.15.48:8765), poi riprova."
                        : "Could not reach the server. If Settings has http://127.0.0.1:8765, clear it and use the VPS (http://91.99.15.48:8765), then retry."
                      : authErr}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-[rgb(var(--ink-muted))]">
              {it
                ? "Mobile: stessa email = stesso portafoglio. Account diversi = book separati."
                : "Mobile: same email = same portfolio. Different emails = separate books."}
            </p>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
