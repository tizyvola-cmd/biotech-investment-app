import { useMemo, useState } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import type { StoredTester } from "../testerSession";

function emailFromWelcomeUrl(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return "";
    return params.get("email")?.trim().toLowerCase() ?? "";
  } catch {
    return "";
  }
}

type Props = {
  mode: "register" | "pending" | "revoked" | "loading";
  tester: StoredTester | null;
  authBusy: boolean;
  authErr: string | null;
  inviteRequired?: boolean;
  onRegister: (email: string, displayName: string, inviteCode: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onEnterApproved?: (email: string) => void;
};

export function TesterGateView({
  mode,
  tester,
  authBusy,
  authErr,
  inviteRequired = false,
  onRegister,
  onRefresh,
  onSignOut,
  onEnterApproved,
}: Props) {
  const { t } = useMobileLang();
  const welcomeEmail = useMemo(() => emailFromWelcomeUrl(), []);
  const [email, setEmail] = useState(tester?.email ?? welcomeEmail);
  const [displayName, setDisplayName] = useState(tester?.displayName ?? "");
  const [inviteCode, setInviteCode] = useState("");

  if (mode === "loading") {
    return (
      <div className="card tester-gate-card">
        <p className="hint">{t("tester.loading")}</p>
      </div>
    );
  }

  if (mode === "pending") {
    return (
      <div className="card tester-gate-card">
        <h2>{t("tester.pendingTitle")}</h2>
        <p className="hint">{t("tester.pendingBody")}</p>
        {tester?.email ? (
          <p className="tester-gate-email">
            {tester.email}
          </p>
        ) : null}
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={authBusy} onClick={onRefresh}>
            {authBusy ? "…" : t("tester.checkAgain")}
          </button>
          <button type="button" className="btn btn-outline" onClick={onSignOut}>
            {t("tester.changeAccount")}
          </button>
        </div>
        {authErr ? <p className="msg err">{authErr}</p> : null}
        <p className="hint tester-pending-hint">{t("tester.pendingApprovedHint")}</p>
      </div>
    );
  }

  if (mode === "revoked") {
    return (
      <div className="card tester-gate-card tester-gate-card--revoked">
        <h2>{t("tester.revokedTitle")}</h2>
        <p className="hint">{t("tester.revokedBody")}</p>
        {tester?.email ? <p className="tester-gate-email">{tester.email}</p> : null}
        <button type="button" className="btn btn-outline" onClick={onSignOut}>
          {t("tester.changeAccount")}
        </button>
      </div>
    );
  }

  return (
    <div className="card tester-gate-card">
      <h2>{t("tester.registerTitle")}</h2>
      <p className="hint">{t("tester.registerBody")}</p>
      {welcomeEmail ? (
        <>
          <p className="hint tester-welcome-link-hint">{t("tester.welcomeLinkHint")}</p>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={authBusy}
              onClick={() => onEnterApproved?.(welcomeEmail)}
            >
              {authBusy ? "…" : t("tester.welcomeEnterAs", { email: welcomeEmail })}
            </button>
          </div>
        </>
      ) : null}
      <div className="field">
        <label>{t("tester.email")}</label>
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tester@example.com"
        />
      </div>
      <div className="field">
        <label>{t("tester.displayName")}</label>
        <input
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("tester.displayNameHint")}
        />
      </div>
      {inviteRequired ? (
        <div className="field">
          <label>{t("tester.inviteCodeRequired")}</label>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={t("tester.invitePlaceholder")}
            autoComplete="off"
          />
          <p className="hint tester-invite-hint">{t("tester.inviteRequiredHint")}</p>
        </div>
      ) : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={authBusy || !email.trim() || (inviteRequired && !inviteCode.trim())}
          onClick={() => onRegister(email, displayName, inviteCode)}
        >
          {authBusy ? "…" : t("tester.requestAccess")}
        </button>
      </div>
      {authErr ? (
        <p className="msg err">
          {authErr === "INVITE_REQUIRED"
            ? t("tester.inviteRequiredError")
            : /invito/i.test(authErr)
              ? t("tester.inviteInvalid")
              : authErr}
        </p>
      ) : null}
    </div>
  );
}
